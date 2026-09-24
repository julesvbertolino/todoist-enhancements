import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addDays, nextMonday } from 'date-fns';
import { Icon } from './Icon';
import { useT } from '@/hooks/useT';
import { useMenuKeys } from '@/hooks/useMenuKeys';
import { usePhoneBehaviour } from '@/hooks/useTouchLayout';
/* Two ways in, one destination: a key pressed on the row the cursor is on, and
   a finger held on the row it is under. Both ask this component to open one of
   its menus, and both say which by name. */
import { ROW_MENU_EVENT } from '@/hooks/useKeyboard';
import { ROW_PRESS_EVENT, type RowMenu } from '@/domain/gestures';
import { useStore } from '@/store/store';
import { useConfirm } from './overlays/Confirm';
import { withEstimate, effectiveEstimate, formatDuration } from '@/domain/estimates';
import { EstimateField } from './EstimateField';
import { DateField } from './DateField';
import { formatDay, formatDayOrName, toApiDate } from '@/domain/dates';
import { readNaturalDate } from '@/domain/nlp';
import { dueForDate, readRecurrence } from '@/domain/recurrence';
import { dateSuggestions, type DateSuggestion } from '@/domain/dateWords';
import { weekLabel } from '@/domain/types';
import { markerStyle } from '@/domain/colors';
import { dropMutation, moveArgs, type DropTarget } from '@/domain/dnd';
import { updateItem, moveItem } from '@/api/commands';
import type { Item, Snapshot } from '@/domain/types';
import { byChildOrder, bySectionOrder } from '@/domain/orderKey';

/** "Tuesday", for a date whose number is already on the line beside it. */
const weekdayName = (date: Date, locale: 'en' | 'fr'): string =>
  new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long' })
    .format(date);

/** A word with its case and accents set aside, so "Été" is found by "ete". */
const fold = (value: string): string =>
  value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Two words that are the same word once accents and case are set aside. */
const sameWord = (a: string, b: string): boolean => fold(a) === fold(b);

/** Somewhere a task can be sent: a project, or a section inside one. */
interface Destination {
  key: string;
  target: DropTarget;
  /** The project's name, or the section's. */
  label: string;
  /** The project a section belongs to, so a match on the section says where. */
  hint?: string;
  colour?: string;
  current: boolean;
}

/** How far below the row's buttons a menu hangs, matching `.rowmenu` in CSS. */
const ROWMENU_OFFSET_PX = 32;

/**
 * Which way a row menu opens.
 *
 * `.rowmenu` hung below its button at a fixed offset and measured nothing, so
 * a task near the foot of the window opened its menu off the bottom of the
 * screen — and the foot of a list is exactly where the work nobody has dealt
 * with sits. The pickers in the composer and the task panel already measure
 * the room below them and flip above when the list would not fit; this is that
 * rule, given to the row menus that were never handed it.
 *
 * The menu changes height while it is open — the schedule field grows a list
 * of suggestions under it as you type — so it is measured again whenever it
 * resizes rather than only when it appears.
 */
function useMenuPlacement(open: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [up, setUp] = useState(false);

  useLayoutEffect(() => {
    if (!open) { setUp(false); return; }
    const menu = ref.current;
    const anchor = menu?.parentElement;
    if (!menu || !anchor) return;

    const place = () => {
      const box = anchor.getBoundingClientRect();
      const height = menu.offsetHeight;
      const margin = 8;
      const fitsBelow = box.top + ROWMENU_OFFSET_PX + height <= window.innerHeight - margin;
      const fitsAbove = box.bottom - ROWMENU_OFFSET_PX - height >= margin;
      // Below by default: a menu only moves when it has to, and only when the
      // other side is genuinely better.
      setUp(!fitsBelow && fitsAbove);
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [open]);

  return { ref, className: up ? ' up' : '' };
}

/**
 * The durations an estimate usually is.
 *
 * Fifteen minutes to two hours, which is the whole of what a task on a week's
 * plan realistically takes — anything longer is a project, and the app says so
 * elsewhere. Offered as buttons because typing "45" on a phone means opening a
 * keyboard over half the screen to press two keys.
 */
const QUICK_ESTIMATES = [5, 15, 30, 45, 60, 90, 120];

interface TaskActionsProps {
  item: Item;
  childrenOf: (id: string) => Item[];
  onOpen: (id: string) => void;
}

/**
 * The controls that appear on a row when the pointer is over it.
 *
 * Each one is an icon with a real label and tooltip, so nothing depends on the
 * reader guessing what a glyph does.
 */
export function TaskActions({ item, childrenOf, onOpen }: TaskActionsProps) {
  const { t, locale } = useT();
  const updateTask = useStore((s) => s.updateTask);
  const removeTask = useStore((s) => s.removeTask);
  const skipOccurrence = useStore((s) => s.skipOccurrence);
  const confirm = useConfirm();
  const snapshot = useStore((s) => s.snapshot);
  const apply = useStore((s) => s.apply);
  const setRecurrence = useStore((s) => s.setRecurrence);
  const toast = useStore((s) => s.toast);
  const dateFormat = useStore((s) => s.prefs.dateFormat);
  const [menu, setMenu] = useState<'none' | 'schedule' | 'more' | 'estimate' | 'move'>('none');
  /** What has been typed into the schedule field, before it is a date. */
  const [typed, setTyped] = useState('');
  /** Which suggestion the keyboard is on; -1 means "what I typed". */
  const [pick, setPick] = useState(-1);
  /** What has been typed to narrow the destinations, and where the keyboard is. */
  const [dest, setDest] = useState('');
  const [destPick, setDestPick] = useState(-1);
  const ref = useRef<HTMLSpanElement>(null);
  /* Only the overflow menu. The other two open with a field already focused,
     and taking the caret out of it would undo the point of opening them. */
  const moreKeys = useMenuKeys(menu === 'more', () => setMenu('none'));
  /** Whether this menu was opened by a key, and so owes the row its focus back. */
  const fromKeyboard = useRef(false);
  /* The sheet is drawn into the document rather than into the row, so a click
     inside it is not inside `ref` and has to be recognised separately. */
  const sheetRef = useRef<HTMLDivElement>(null);
  const phone = usePhoneBehaviour();
  /* Only where a menu hangs off its row. On a phone it is a sheet along the
     bottom edge, placed by the stylesheet, with nothing to flip. */
  const placement = useMenuPlacement(!phone && menu !== 'none' && menu !== 'estimate');

  // A menu that opens holding the last thing typed into it is a menu lying
  // about what it will do if you press Enter.
  useEffect(() => { if (menu !== 'schedule') { setTyped(''); setPick(-1); } }, [menu]);
  useEffect(() => { if (menu !== 'move') { setDest(''); setDestPick(-1); } }, [menu]);

  /* Two ways to be asked for a menu, and the row is where both arrive: a key
     pressed on the row the cursor is on, and a finger held on the row under
     it. Each is an event on the row's own element rather than a context,
     because a context would re-render every other row on the page to tell
     this one. Only the key owes the cursor anything afterwards — a finger
     leaves no cursor to give back. */
  useEffect(() => {
    const row = ref.current?.closest<HTMLElement>('[data-task-id]');
    if (!row) return;
    const byKey = (event: Event) => {
      fromKeyboard.current = true;
      setMenu((event as CustomEvent<RowMenu>).detail);
    };
    const byFinger = (event: Event) => setMenu((event as CustomEvent<RowMenu>).detail);
    row.addEventListener(ROW_MENU_EVENT, byKey);
    row.addEventListener(ROW_PRESS_EVENT, byFinger);
    return () => {
      row.removeEventListener(ROW_MENU_EVENT, byKey);
      row.removeEventListener(ROW_PRESS_EVENT, byFinger);
    };
  }, []);

  /* A menu opened from the keyboard takes focus into its own field. Closing
     it has to give the cursor back to the row it belongs to, or every schedule
     from the keyboard ends with the cursor nowhere. */
  useEffect(() => {
    if (menu !== 'none' || !fromKeyboard.current) return;
    fromKeyboard.current = false;
    ref.current?.closest<HTMLElement>('[data-task-id]')?.focus({ preventScroll: true });
  }, [menu]);


  useEffect(() => {
    if (menu === 'none') return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (sheetRef.current?.contains(target)) return;
      setMenu('none');
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu('none'); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const { minutes, computed } = effectiveEstimate(item, childrenOf);

  /* Moving a task means moving it somewhere it can live. Where it sits in time
     is the schedule menu's business, which is the button next to this one. */
  const projects = useMemo(
    () => Object.values(snapshot.projects)
      .filter((p) => !p.is_deleted && !p.is_archived && !p.is_folder)
      .sort(byChildOrder),
    [snapshot.projects],
  );

  /**
   * Every place the task could go, a project and its sections alike.
   *
   * A section is a destination in Todoist, so it is one here: moving a task
   * into "Design / In review" used to take two gestures, the move and then a
   * drag down the page into the right group.
   */
  const destinations = useMemo<Destination[]>(() => {
    const sections = Object.values(snapshot.sections)
      .filter((s) => !s.is_deleted && !s.is_archived)
      .sort(bySectionOrder);

    return projects.flatMap((project) => [
      {
        key: project.id,
        /* The project itself, said as "this project, no section" rather than
           as a bare project: a task already in the project but sitting in one
           of its sections is going somewhere when it picks this, and a plain
           project destination reads as "already there" and does nothing. */
        target: {
          kind: 'section', projectId: project.id, sectionId: null,
        } as DropTarget,
        label: project.name,
        colour: project.color,
        current: project.id === item.project_id && item.section_id === null,
      },
      ...sections
        .filter((s) => s.project_id === project.id)
        .map((section) => ({
          key: `${project.id}:${section.id}`,
          target: {
            kind: 'section', projectId: project.id, sectionId: section.id,
          } as DropTarget,
          label: section.name || t('section.untitled'),
          hint: project.name,
          current: section.id === item.section_id,
        })),
    ]);
  }, [projects, snapshot.sections, item.project_id, item.section_id, t]);

  /* Typing narrows the list, on the section's name or on the project's, so
     "rev" finds "In review" wherever it lives. */
  const matches = useMemo(() => {
    const needle = fold(dest.trim());
    if (!needle) return destinations;
    return destinations.filter(
      (d) => fold(d.label).includes(needle) || (d.hint ? fold(d.hint).includes(needle) : false),
    );
  }, [destinations, dest]);

  /**
   * Lifts a subtask out of its parent, leaving it where it already lives.
   *
   * Moving a task to a project is what clears its parent — `item_update` does
   * not carry one — so the destination is the project and section it is in
   * already, which changes nothing but the one thing being asked for.
   */
  async function unnest() {
    const parentId = item.parent_id;
    if (!parentId) return;
    const patch = (parent_id: string | null) => (snap: Snapshot): Snapshot => ({
      ...snap,
      items: { ...snap.items, [item.id]: { ...snap.items[item.id], parent_id } as Item },
    });
    await apply(
      [moveItem(item.id, moveArgs({ project_id: item.project_id, section_id: item.section_id }))],
      patch(null),
    );
    toast(item.content, () => {
      void apply([moveItem(item.id, { parent_id: parentId })], patch(parentId));
    });
  }

  /**
   * Sends the task to a view.
   *
   * The destination decides the change, using the same table drag and drop
   * uses, so dropping onto "anytime this week" and choosing it from this menu
   * do exactly the same thing.
   */
  async function moveTo(target: DropTarget, destination: string) {
    setMenu('none');
    const mutation = dropMutation(item, target);
    if (!mutation) return;

    // Captured before the change so the undo can put every field back.
    const before = {
      due: item.due,
      labels: item.labels,
      project_id: item.project_id,
      section_id: item.section_id,
    };
    const patch = (fields: Record<string, unknown>) => (snap: Snapshot): Snapshot => ({
      ...snap,
      items: { ...snap.items, [item.id]: { ...snap.items[item.id], ...fields } as Item },
    });

    if (mutation.update) {
      await apply([updateItem(item.id, mutation.update)], patch(mutation.update));
    } else if (mutation.move) {
      /* One destination per move: a section implies its project, and sending
         both is how `item_move` is refused. */
      await apply([moveItem(item.id, moveArgs(mutation.move))], patch(mutation.move));
    }

    /* A move is undone by a move. `item_update` takes neither a project nor a
       section, so undoing one used to put the task back on screen and leave it
       where it had been sent on the server. */
    const undo = mutation.move
      ? moveItem(item.id, moveArgs({
          project_id: before.project_id, section_id: before.section_id,
        }))
      : updateItem(item.id, { due: before.due, labels: before.labels });

    toast(t('task.movedTo', { destination }), () => {
      void apply([undo], patch(before));
    });
  }

  /**
   * The date somebody typed, read the way the composer reads one.
   *
   * Three shortcuts answer most days and a calendar answers the rest, but
   * neither answers "next sunday" as fast as typing it. The field is the first
   * thing in the menu and has the focus, so the whole gesture is: click, type,
   * Enter.
   */
  const reading = useMemo(() => (typed.trim() ? readNaturalDate(typed) : null), [typed]);

  /* The same field reads a repeat rule. It has to: this menu is the fastest
     way to a task's date, and "every monday" is a date in the sense that
     matters — the answer to when does this happen. */
  const repeat = useMemo(() => (typed.trim() ? readRecurrence(typed) : null), [typed]);

  /* What the words could still turn into. Narrowing as you type is the whole
     point: "to" is both today and tomorrow, "tom" is only one of them. */
  const suggestions = useMemo(() => dateSuggestions(typed, locale), [typed, locale]);
  const chosen = pick >= 0 ? suggestions[pick] : undefined;

  function commitTyped(override?: DateSuggestion) {
    /* A rule wins over a date. Nothing else can have been meant: a suggestion
       list narrowing on "every" has nothing in it, and the words that make a
       recurrence are the same words that make a single day. */
    if (!override && repeat) return commitRecurrence();

    const iso = override?.date ?? chosen?.date ?? currentReading()?.date;
    if (!iso) return;
    setMenu('none');
    setTyped('');

    const before = { due: item.due, labels: item.labels };
    const update = {
      // Keeps the rule when there is one, so dating an occurrence of a
      // recurring task moves that occurrence instead of ending the series.
      due: dueForDate(item.due, iso),
      /* A real date and the week tag on the same task is the contradiction the
         app reports rather than resolves, so giving it a day takes the tag off
         — exactly as every other way of dating a task here does. */
      labels: item.labels.filter((l) => l.toLowerCase() !== weekLabel().toLowerCase()),
    };
    const patch = (fields: Record<string, unknown>) => (snap: Snapshot): Snapshot => ({
      ...snap,
      items: { ...snap.items, [item.id]: { ...snap.items[item.id], ...fields } as Item },
    });

    void apply([updateItem(item.id, update)], patch(update)).then(() => {
      toast(
        t('task.movedTo', {
          destination: formatDayOrName(new Date(iso.slice(0, 10)), locale, dateFormat),
        }),
        () => { void apply([updateItem(item.id, before)], patch(before)); },
      );
    });
  }

  /** The reading the field currently stands for, so the commit path has one. */
  function currentReading() { return reading; }

  /**
   * Replacing the repeat rule from the same field.
   *
   * No date goes with it. Todoist works out which day the new rule lands on,
   * and sending one of our own alongside would fix the first occurrence to a
   * date the rule may not even contain.
   */
  function commitRecurrence() {
    if (!repeat) return;
    setMenu('none');
    setTyped('');

    const before = { due: item.due, labels: item.labels };
    const patch = (fields: Record<string, unknown>) => (snap: Snapshot): Snapshot => ({
      ...snap,
      items: { ...snap.items, [item.id]: { ...snap.items[item.id], ...fields } as Item },
    });

    /* A real date and the week tag on the same task is the contradiction the
       app reports rather than resolves, and a rule is a date in that sense. */
    const labels = item.labels.filter((l) => l.toLowerCase() !== weekLabel().toLowerCase());
    if (labels.length !== item.labels.length) void updateTask(item.id, { labels });

    void setRecurrence(item.id, repeat).then(() => {
      toast(t('task.repeats', { rule: repeat.string }), () => {
        void apply([updateItem(item.id, before)], patch(before));
      });
    });
  }

  function schedule(date: Date | null) {
    setMenu('none');
    void updateTask(item.id, {
      due: date ? dueForDate(item.due, toApiDate(date)) : null,
    });
  }

  /* Setting an estimate is a field, not a menu, and on a phone it belongs in
     the same sheet as everything else rather than squeezed into a tray 152px
     wide. */
  const setEstimate = (value: number | null) => {
    setMenu('none');
    void updateTask(item.id, { labels: withEstimate(item.labels, value) });
  };

  const estimateSheet = (
    <div className="popover rowmenu asSheet estimatesheet" role="menu">
      <h5>{t('task.setEstimate')}</h5>
      {/* Most estimates are one of these, and on a phone typing "45" means
          opening a keyboard over half the screen to press two keys. The field
          stays underneath for the ones that are not. */}
      <div className="estquick">
        {QUICK_ESTIMATES.map((quick) => (
          <button
            key={quick}
            className={`estchip${minutes === quick && !computed ? ' on' : ''}`}
            onClick={() => setEstimate(quick)}
          >
            {formatDuration(quick, locale)}
          </button>
        ))}
        {minutes !== null && !computed && (
          <button className="estchip clear" onClick={() => setEstimate(null)}>
            <Icon name="close" size="sm" />
            {t('date.clear')}
          </button>
        )}
      </div>
      <EstimateField
        autoFocus
        minutes={computed ? null : minutes}
        placeholder={t('task.estimatePlaceholder')}
        onCancel={() => setMenu('none')}
        onCommit={setEstimate}
      />
    </div>
  );

  const menus = (
    <>
      {phone && menu === 'estimate' && estimateSheet}
        {menu === 'schedule' && (
          <div
            className={`popover rowmenu schedulemenu${phone ? ' asSheet' : placement.className}`}
            role="menu"
            ref={placement.ref}
          >
            {/* Typing is the fastest way to say "next sunday", so it is the
                first thing here and it already has the caret. */}
            <input
              className="schedulefield"
              autoFocus
              value={typed}
              placeholder={t('task.typeDate')}
              aria-label={t('task.schedule')}
              onChange={(e) => { setTyped(e.target.value); setPick(-1); }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'ArrowDown' && suggestions.length > 0) {
                  e.preventDefault();
                  setPick((at) => (at + 1) % suggestions.length);
                  return;
                }
                if (e.key === 'ArrowUp' && suggestions.length > 0) {
                  e.preventDefault();
                  setPick((at) => (at <= 0 ? suggestions.length - 1 : at - 1));
                  return;
                }
                if (e.key === 'Enter') { e.preventDefault(); commitTyped(); }
                if (e.key === 'Escape') setMenu('none');
              }}
            />

            {/* A short list under the field, at most three long, each line
                saying what it would do. A word shows the day it resolves to; a
                bare day of the month shows the date and the weekday, which is
                the part you actually want to know before choosing between three
                fifteenths. */}
            {typed.trim() !== '' && (
              suggestions.length > 0 ? (
                <div className="schedulesuggest" role="listbox">
                  {suggestions.map((option, at) => {
                    const day = new Date(`${option.date.slice(0, 10)}T00:00:00`);
                    const named = formatDayOrName(day, locale, dateFormat);
                    const label = option.word ?? formatDay(day, locale, dateFormat);
                    const hint = option.word
                      ? (sameWord(named, option.word) ? null : named)
                      : weekdayName(day, locale);
                    return (
                      <button
                        key={option.date + (option.word ?? '')}
                        role="option"
                        aria-selected={at === pick}
                        className={`scheduleoption${at === pick ? ' on' : ''}`}
                        onMouseDown={(e) => { e.preventDefault(); commitTyped(option); }}
                        onMouseEnter={() => setPick(at)}
                      >
                        <span>{label}</span>
                        {hint && <small>{hint}</small>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className={`schedulepreview${reading ? '' : ' none'}`}>
                  {reading
                    ? formatDayOrName(new Date(reading.date.slice(0, 10)), locale, dateFormat)
                    : t('task.dateNotRead')}
                </p>
              )
            )}

            <button
              className="opt"
              onClick={() => void moveTo({ kind: 'today' }, t('common.today'))}
            >
              <span><Icon name="week" size="sm" /> {t('common.today')}</span>
            </button>
            <button
              className="opt"
              onClick={() =>
                void moveTo({ kind: 'day', date: addDays(new Date(), 1) }, t('common.tomorrow'))}
            >
              <span><Icon name="arrow-right" size="sm" /> {t('common.tomorrow')}</span>
            </button>
            <button
              className="opt"
              onClick={() =>
                void moveTo({ kind: 'day', date: nextMonday(new Date()) }, t('task.nextWeek'))}
            >
              <span><Icon name="upcoming" size="sm" /> {t('task.nextWeek')}</span>
            </button>

            {/* And a calendar, for a date it is easier to point at than to
                name. The same one the composer uses, so picking a date from a
                row and picking one while writing the task are the same control
                rather than two that drifted apart. */}
            <div className="rowmenu-date">
              <DateField
                value={item.due?.date.slice(0, 10) ?? ''}
                label={t('task.schedule')}
                placeholder={t('task.pickDate')}
                searchable={false}
                showValue={false}
                onChange={(next) => {
                  if (!next) { schedule(null); return; }
                  const day = new Date(`${next}T00:00:00`);
                  void moveTo({ kind: 'day', date: day }, formatDayOrName(day, locale, dateFormat));
                }}
              />
            </div>

            {item.due?.is_recurring && (
              <>
                <hr />
                <button
                  className="opt"
                  onClick={() => { setMenu('none'); void skipOccurrence(item.id); }}
                >
                  <span><Icon name="repeat" size="sm" /> {t('task.nextOccurrence')}</span>
                </button>
                <p className="menuhint">{t('task.nextOccurrenceHint')}</p>
              </>
            )}

            {item.due && (
              <>
                <hr />
                <button className="opt" onClick={() => schedule(null)}>
                  <span><Icon name="close" size="sm" /> {t('task.removeDate')}</span>
                </button>
              </>
            )}
          </div>
        )}

        {menu === 'move' && (
          <div
            className={`popover rowmenu movemenu${phone ? ' asSheet' : placement.className}`}
            role="menu"
            ref={placement.ref}
          >
            {/* Typing is how you find one project among forty, so the field is
                the first thing here and it already has the caret — the same
                gesture the schedule menu asks for. The heading goes: the field's
                placeholder says what the menu is for. */}
            <input
              className="schedulefield"
              autoFocus
              value={dest}
              placeholder={t('task.typeDestination')}
              aria-label={t('task.moveToProject')}
              onChange={(e) => { setDest(e.target.value); setDestPick(-1); }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'ArrowDown' && matches.length > 0) {
                  e.preventDefault();
                  setDestPick((at) => (at + 1) % matches.length);
                  return;
                }
                if (e.key === 'ArrowUp' && matches.length > 0) {
                  e.preventDefault();
                  setDestPick((at) => (at <= 0 ? matches.length - 1 : at - 1));
                  return;
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  /* Nothing is highlighted until you arrow onto it, so Enter on
                     an untouched list would move the task somewhere you never
                     looked at. It commits the first match only once you have
                     typed enough to make "the first match" mean something. */
                  const chosenDest = destPick >= 0
                    ? matches[destPick]
                    : dest.trim() ? matches[0] : undefined;
                  if (chosenDest) void moveTo(chosenDest.target, chosenDest.label);
                  return;
                }
                if (e.key === 'Escape') setMenu('none');
              }}
            />

            <div className="movelist" role="listbox">
              {matches.map((destination, at) => (
                <button
                  key={destination.key}
                  role="option"
                  aria-selected={at === destPick}
                  aria-checked={destination.current}
                  className={`opt${destination.hint ? ' sectionopt' : ''}${at === destPick ? ' on' : ''}`}
                  onMouseEnter={() => setDestPick(at)}
                  onClick={() => void moveTo(destination.target, destination.label)}
                >
                  <span>
                    {destination.hint ? (
                      <Icon name="section" size="sm" />
                    ) : (
                      <span className="hash" style={markerStyle(destination.colour)}>#</span>
                    )}
                    {destination.label}
                  </span>
                  {/* Only while filtering: in the full list the section sits
                      under its project and saying so twice is noise. */}
                  {destination.hint && dest.trim() !== '' && <small>{destination.hint}</small>}
                </button>
              ))}
              {matches.length === 0 && <p className="menuhint">{t('search.noResults')}</p>}
            </div>
          </div>
        )}

        {menu === 'more' && (
          <div
            className={`popover rowmenu${phone ? ' asSheet' : placement.className}`}
            role="menu"
            ref={(node) => { placement.ref.current = node; moreKeys.current = node; }}
          >
            <button className="opt" onClick={() => { setMenu('none'); onOpen(item.id); }}>
              <span><Icon name="edit" size="sm" /> {t('detail.title')}</span>
            </button>
            {/* On a phone this sheet is what holding the row opens, and it has
                to be the whole of what hovering one would have shown — the
                swipe tray is the shortcut to the three most-used of these, not
                the only way to reach them. */}
            {phone && (
              <>
                <button className="opt" onClick={() => setMenu('schedule')}>
                  <span><Icon name="calendar" size="sm" /> {t('task.schedule')}</span>
                </button>
                <button className="opt" onClick={() => setMenu('move')}>
                  <span><Icon name="project" size="sm" /> {t('task.moveToProject')}</span>
                </button>
                <button className="opt" onClick={() => setMenu('estimate')}>
                  <span><Icon name="clock" size="sm" /> {t('task.setEstimate')}</span>
                </button>
                <hr />
              </>
            )}
            {/* Dragging a subtask out to the left does this too, but a gesture
                nobody has been told about is not a way out of anything. */}
            {item.parent_id && (
              <button className="opt" onClick={() => { setMenu('none'); void unnest(); }}>
                <span><Icon name="subtask" size="sm" /> {t('task.unnest')}</span>
              </button>
            )}
            <button
              className="opt"
              onClick={() => {
                setMenu('none');
                window.open(`https://app.todoist.com/app/task/${item.id}`, '_blank', 'noopener');
              }}
            >
              <span><Icon name="external" size="sm" /> {t('task.openInTodoist')}</span>
            </button>
            <hr />
            <button
              className="opt danger"
              onClick={() => {
                setMenu('none');
                // Deleting is irreversible here, so it is always confirmed.
                void confirm({
                  title: t('task.deleteTitle'),
                  body: t('task.deleteConfirm', { name: item.content }),
                  confirmLabel: t('task.delete'),
                  destructive: true,
                }).then((ok) => { if (ok) void removeTask(item.id); });
              }}
            >
              <span><Icon name="close" size="sm" /> {t('task.delete')}</span>
            </button>
          </div>
        )}
    </>
  );

  return (
    <span className="trow-actions" ref={ref} onClick={(e) => e.stopPropagation()}>
      {menu === 'estimate' && !phone ? (
        <EstimateField
          autoFocus
          minutes={computed ? null : minutes}
          onCancel={() => setMenu('none')}
          onCommit={(value) => {
            setMenu('none');
            void updateTask(item.id, { labels: withEstimate(item.labels, value) });
          }}
        />
      ) : (
        <>
          {/* Opening the task is what tapping the row already does, so on a
              phone that button is the one the tray leaves out. An estimate is
              not: it is the number this whole app is built on, and asking for
              it should be a swipe rather than a trip through the panel. */}
          <button
            className="rowact-wide"
            aria-label={t('detail.title')}
            title={t('detail.title')}
            onClick={() => onOpen(item.id)}
          >
            <Icon name="edit" size="sm" />
          </button>
          <button
            aria-label={t('task.setEstimate')}
            title={t('task.setEstimate')}
            onClick={() => setMenu('estimate')}
          >
            <Icon name="clock" size="sm" />
          </button>
        </>
      )}

      <button
        aria-label={t('task.schedule')}
        title={t('task.schedule')}
        aria-expanded={menu === 'schedule'}
        onClick={() => setMenu(menu === 'schedule' ? 'none' : 'schedule')}
      >
        <Icon name="calendar" size="sm" />
      </button>

      <button
        aria-label={t('task.moveToProject')}
        title={t('task.moveToProject')}
        aria-expanded={menu === 'move'}
        onClick={() => setMenu(menu === 'move' ? 'none' : 'move')}
      >
        <Icon name="project" size="sm" />
      </button>

      <button
        aria-label={t('task.moreActions')}
        title={t('task.moreActions')}
        aria-expanded={menu === 'more'}
        onClick={() => setMenu(menu === 'more' ? 'none' : 'more')}
      >
        <Icon name="more" size="sm" />
      </button>

      {/* On a phone the menus come up from the bottom edge as sheets with
          room for a thumb, drawn into the document rather than into the row:
          the row slides sideways to show its buttons, and anything positioned
          inside a sliding row slides with it. */}
      {phone
        ? menu !== 'none' && createPortal(
          <div className="rowsheet" ref={sheetRef}>
            <div className="rowsheet-scrim" onClick={() => setMenu('none')} />
            {menus}
          </div>,
          document.body,
        )
        : menus}
    </span>
  );
}
