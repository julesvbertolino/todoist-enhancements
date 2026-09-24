import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { DateField } from './DateField';
import { useT } from '@/hooks/useT';
import { useStore } from '@/store/store';
import { useConfirm } from './overlays/Confirm';
import { markerStyle } from '@/domain/colors';
import { BULK_MENU_EVENT, type BulkMenuName } from '@/hooks/useKeyboard';
import { toDisplayPriority, toTodoistPriority, type DisplayPriority } from '@/domain/types';
import type { DropTarget } from '@/domain/dnd';
import { matchesSearch } from '@/domain/search';
import { byChildOrder, byLabelOrder, bySectionOrder } from '@/domain/orderKey';

/**
 * One button in the bar, and the panel it opens.
 *
 * Every property a selection can be changed by gets the same control: an icon,
 * the name of the property, and a panel above the bar — above, because the bar
 * itself is pinned to the foot of the window and a menu dropping out of it
 * would open off the bottom of the page. It closes on a click outside and on
 * Escape, and the Escape it swallows is its own: the one that clears the
 * selection belongs to the bar, and should not also throw the menu away.
 */
function BulkMenu({
  icon, label, name, children,
}: {
  icon: IconName;
  label: string;
  /** Which keyboard request opens this panel (T for date, V for move). */
  name?: BulkMenuName;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  /** Where the focus was when the panel opened, to give it back on closing. */
  const opener = useRef<HTMLElement | null>(null);
  /** Closes the panel and, from the keys, hands the focus straight back. */
  const closeFromKeys = () => {
    const back = opener.current;
    if (back?.isConnected) back.focus({ preventScroll: true });
    setOpen(false);
  };

  /** Opened by a key, so the panel takes the focus once it is drawn. */
  const focusOnOpen = useRef(false);

  const panelItems = (): HTMLElement[] => {
    const panel = ref.current?.querySelector('.bulkpop');
    return panel
      ? [...panel.querySelectorAll<HTMLElement>('input, button:not([disabled])')]
        .filter((item) => item.offsetParent !== null)
      : [];
  };

  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const panel = ref.current?.querySelector('.bulkpop');
    if (panel && !panel.contains(document.activeElement)) panelItems()[0]?.focus();
  }, [open]);

  /* Opened from the keyboard, the panel takes the focus: its own field when it
     has one (Move's search already asks for it), otherwise its first choice. */
  useEffect(() => {
    if (!name) return;
    const onAsk = (event: Event) => {
      if ((event as CustomEvent<BulkMenuName>).detail !== name) return;
      opener.current = document.activeElement as HTMLElement | null;
      focusOnOpen.current = true;
      setOpen(true);
    };
    window.addEventListener(BULK_MENU_EVENT, onAsk);
    return () => window.removeEventListener(BULK_MENU_EVENT, onAsk);
  }, [name]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (ref.current?.contains(target)) return;
      /* DateField is portalled to the document body so the bar cannot clip
         its calendar. It is still part of this menu: clicking its typing
         field must not close the menu, unmount the field and hand the next
         letter to the app-wide search shortcut. */
      if (target?.closest('.datepanel')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      /* Up or Down with the focus still outside (on the task, or on the bar's
         button after a click) steps into the panel. */
      const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      const panel = ref.current?.querySelector('.bulkpop');
      if (step !== 0 && panel && !panel.contains(e.target as Node)) {
        const items = panelItems();
        if (items.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        items[step > 0 ? 0 : items.length - 1].focus();
        return;
      }
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeFromKeys();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      /* Closing takes the focused choice with it, and the cursor with that:
         the next key then opened the search instead of acting on the tasks.
         The focus goes back where it came from, when that is still there. */
      const back = opener.current;
      opener.current = null;
      window.setTimeout(() => {
        const lost = !document.activeElement || document.activeElement === document.body;
        if (lost && back?.isConnected) back.focus({ preventScroll: true });
      }, 0);
    };
  }, [open]);

  /**
   * The keyboard inside the panel. Up and Down walk every choice — the search
   * field, the options, the tag boxes, the date field — and wrap; Enter and
   * Space are the focused control's own. Escape closes the panel even from a
   * field that keeps its other keys to itself (Move's search). Caught on the
   * way down, before those fields see the key, and only for what is really in
   * the panel: the date field's calendar is drawn elsewhere and has keys of
   * its own.
   */
  const onPanelKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const panel = event.currentTarget;
    const target = event.target as Node;
    if (!panel.contains(target)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeFromKeys();
      return;
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    const items = panelItems();
    if (items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
    items[next].focus();
    items[next].scrollIntoView({ block: 'nearest' });
  };

  return (
    <div className="bulkmenu" ref={ref}>
      <button
        className="btn sm"
        aria-expanded={open}
        onClick={() => {
          if (!open) opener.current = document.activeElement as HTMLElement | null;
          setOpen((v) => !v);
        }}
      >
        <Icon name={icon} size="sm" />
        {label}
        <Icon name="caret" size="sm" />
      </button>
      {open && (
        <div className="popover bulkpop" role="menu" aria-label={label} onKeyDownCapture={onPanelKey}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/**
 * What to do with the tasks you picked out.
 *
 * It exists only while something is selected, and it stays in one place at the
 * foot of the window rather than following the rows around: a bar that moves
 * is a bar you have to find again after every change. Each button is the same
 * change the drop table already defines, applied to the whole set as one
 * request with one undo — the selection was one decision, so taking it back
 * should be one too.
 *
 * One button per property rather than a row of date shortcuts: a date was the
 * only thing a selection could be given, so moving fifteen tasks to a project,
 * or taking one tag off all of them, meant opening fifteen tasks.
 */
export function BulkBar() {
  const { t } = useT();
  const confirm = useConfirm();
  const selection = useStore((s) => s.selection);
  const clearSelection = useStore((s) => s.clearSelection);
  const sendManyTo = useStore((s) => s.sendManyTo);
  const removeTasks = useStore((s) => s.removeTasks);
  const updateMany = useStore((s) => s.updateMany);
  const moveMany = useStore((s) => s.moveMany);
  const skipOccurrences = useStore((s) => s.skipOccurrences);
  const toast = useStore((s) => s.toast);
  const snapshot = useStore((s) => s.snapshot);
  const [date, setDate] = useState('');
  const [projectQuery, setProjectQuery] = useState('');
  const [tagQuery, setTagQuery] = useState('');

  /* The bar and the toasts share the foot of the window, and the toast that
     answers a bulk action used to land on the very buttons the next one needs.
     The bar says how much of the window it takes, and the toasts stand on it
     (see `.toasts`); with no bar the variable is gone and they sit where they
     always have. Measured rather than assumed: on a phone the bar wraps, and
     the tags panel stays open while tags are ticked one after another, so an
     open panel counts as part of the bar. */
  const unmeasure = useRef<(() => void) | null>(null);
  const measureBar = useCallback((node: HTMLDivElement | null) => {
    unmeasure.current?.();
    unmeasure.current = null;
    const root = document.documentElement.style;
    if (!node) { root.removeProperty('--bulkbar-room'); return; }
    const place = () => {
      const top = Math.min(
        node.getBoundingClientRect().top,
        ...[...node.querySelectorAll('.bulkpop')].map((pop) => pop.getBoundingClientRect().top),
      );
      root.setProperty('--bulkbar-room', `${Math.ceil(window.innerHeight - top)}px`);
    };
    place();
    const resized = new ResizeObserver(place);
    resized.observe(node);
    const opened = new MutationObserver(place);
    opened.observe(node, { childList: true, subtree: true });
    window.addEventListener('resize', place);
    unmeasure.current = () => {
      resized.disconnect();
      opened.disconnect();
      window.removeEventListener('resize', place);
    };
  }, []);

  if (selection.length === 0) return null;

  const count = selection.length;
  const picked = selection.map((id) => snapshot.items[id]).filter(Boolean);
  const recurringCount = picked.filter((item) => item.due?.is_recurring).length;

  const send = async (target: DropTarget, destination: string) => {
    const ids = selection;
    clearSelection();
    await sendManyTo(ids, target, destination);
  };

  const remove = async () => {
    const ids = selection;
    const ok = await confirm({
      /* Plural, because the body is: asking "delete this task?" over a list
         of three is the dialog disagreeing with itself. */
      title: t(ids.length > 1 ? 'task.deleteTitleMany' : 'task.deleteTitle'),
      body: t('bulk.deleteConfirm', { count: ids.length }),
      confirmLabel: t('task.delete'),
      destructive: true,
    });
    if (!ok) return;
    clearSelection();
    await removeTasks(ids);
  };

  const projects = Object.values(snapshot.projects)
    .filter((p) => !p.is_archived && !p.is_deleted && !p.is_folder)
    .sort(byChildOrder);
  const sections = Object.values(snapshot.sections)
    .filter((section) => !section.is_archived && !section.is_deleted)
    .sort(bySectionOrder);
  const destinations = projects.flatMap((project) => {
    const projectName = project.inbox_project ? t('nav.inbox') : project.name;
    return [
      {
        key: `project:${project.id}`,
        projectId: project.id,
        sectionId: null as string | null,
        label: projectName,
        search: projectName,
        color: project.color,
        section: false,
        projectName,
      },
      ...sections
        .filter((section) => section.project_id === project.id)
        .map((section) => ({
          key: `section:${section.id}`,
          projectId: project.id,
          sectionId: section.id as string | null,
          label: section.name || t('section.untitled'),
          search: `${projectName} ${section.name}`,
          color: project.color,
          section: true,
          projectName,
        })),
    ];
  });
  const filteredDestinations = destinations.filter((destination) =>
    matchesSearch(destination.search, projectQuery));

  /* Only the tags in play, plus every tag that exists: the point of the panel
     is usually to take one off, and the ones already on the selection are the
     answer to that. Estimates are labels too, and are not tags — they have a
     field of their own everywhere else in the app. */
  const tags = Object.values(snapshot.labels)
    .filter((l) => !l.is_deleted && !l.name.startsWith('est-'))
    .sort(byLabelOrder);
  const filteredTags = tags.filter((label) => matchesSearch(label.name, tagQuery));

  /** How many of the selected tasks carry this tag: none, some, or all. */
  const tagState = (name: string): 'none' | 'some' | 'all' => {
    const on = picked.filter((item) => item.labels.includes(name)).length;
    return on === 0 ? 'none' : on === picked.length ? 'all' : 'some';
  };

  const setTag = (name: string, on: boolean) => {
    const ids = selection;
    void updateMany(
      ids,
      (item) => {
        const has = item.labels.includes(name);
        if (has === on) return null;
        return {
          labels: on ? [...item.labels, name] : item.labels.filter((l) => l !== name),
        };
      },
      t(on ? 'bulk.tagAdded' : 'bulk.tagRemoved', { count: ids.length, name }),
    );
  };

  /* The selection stays: a priority moves nothing off the page, and the next
     change is usually for the same tasks. */
  const setPriority = (priority: DisplayPriority) => {
    const ids = selection;
    void updateMany(
      ids,
      (item) =>
        toDisplayPriority(item.priority) === priority
          ? null
          : { priority: toTodoistPriority(priority) },
      t('bulk.prioritySet', { count: ids.length, priority: `P${priority}` }),
    );
  };

  return (
    <div ref={measureBar} className="bulkbar" role="toolbar" aria-label={t('bulk.title')}>
      <strong>{t('bulk.count', { count })}</strong>
      <span className="sep" aria-hidden="true" />

      <BulkMenu icon="calendar" label={t('bulk.date')} name="date">
        {(close) => (
          <>
            <button
              className="opt"
              onClick={() => { close(); void send({ kind: 'today' }, t('common.today')); }}
            >
              <span>{t('review.to.today')}</span>
            </button>
            <button
              className="opt"
              onClick={() => { close(); void send({ kind: 'anytime' }, t('nav.week')); }}
            >
              <span>{t('review.to.anytime')}</span>
            </button>
            <button
              className="opt"
              onClick={() => { close(); void send({ kind: 'someday' }, t('nav.someday')); }}
            >
              <span>{t('review.to.someday')}</span>
            </button>
            {recurringCount > 0 && (
              <button
                className="opt"
                onClick={() => {
                  const ids = selection;
                  close();
                  clearSelection();
                  void skipOccurrences(ids).then((skipped) => {
                    if (skipped > 0) toast(t('bulk.skippedRecurring', { count: skipped }));
                  });
                }}
              >
                <span>{t('task.nextOccurrence')}</span>
                <small>{t('bulk.recurringSubset', { count: recurringCount })}</small>
              </button>
            )}
            <hr />
            {/* A date, rather than the three shortcuts, for the times the
                answer is neither today nor this week. */}
            <div className="bulkpop-date">
              <DateField
                value={date}
                label={t('task.schedule')}
                placeholder={t('bulk.pickDate')}
                onChange={(next) => {
                  setDate('');
                  if (!next) return;
                  close();
                  void send({ kind: 'day', date: new Date(`${next}T00:00:00`) }, next);
                }}
              />
            </div>
          </>
        )}
      </BulkMenu>

      <BulkMenu icon="project" label={t('bulk.move')} name="move">
        {(close) => (
          <div className="bulkpop-list">
            <div className="pickersearch">
              <Icon name="search" size="sm" />
              <input
                autoFocus
                value={projectQuery}
                placeholder={t('nav.search')}
                aria-label={t('nav.search')}
                onChange={(event) => setProjectQuery(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter' && filteredDestinations[0]) {
                    event.preventDefault();
                    const destination = filteredDestinations[0];
                    const ids = selection;
                    const name = destination.section
                      ? `${destination.projectName} / ${destination.label}`
                      : destination.label;
                    close();
                    setProjectQuery('');
                    clearSelection();
                    void moveMany(ids, {
                      project_id: destination.projectId,
                      section_id: destination.sectionId,
                    }, name);
                  }
                }}
              />
            </div>
            {filteredDestinations.length === 0 && <p className="menuhint">{t('search.noResults')}</p>}
            {filteredDestinations.map((destination) => (
              <button
                key={destination.key}
                className={`opt${destination.section ? ' sectionopt' : ''}`}
                onClick={() => {
                  const ids = selection;
                  const name = destination.section
                    ? `${destination.projectName} / ${destination.label}`
                    : destination.label;
                  close();
                  setProjectQuery('');
                  clearSelection();
                  void moveMany(ids, {
                    project_id: destination.projectId,
                    section_id: destination.sectionId,
                  }, name);
                }}
              >
                <span className="bulkdest">
                  {destination.section
                    ? <Icon name="section" size="sm" />
                    : <span className="hash" style={markerStyle(destination.color)}>#</span>}
                  <span className="bulkdest-label">{destination.label}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </BulkMenu>

      <BulkMenu icon="tag" label={t('bulk.labels')}>
        {() => (
          <>
            <div className="pickersearch">
              <Icon name="search" size="sm" />
              <input
                autoFocus
                value={tagQuery}
                placeholder={t('nav.search')}
                aria-label={t('nav.search')}
                onChange={(event) => setTagQuery(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter' && filteredTags[0]) {
                    event.preventDefault();
                    const first = filteredTags[0];
                    setTag(first.name, tagState(first.name) !== 'all');
                  }
                }}
              />
            </div>
            <div className="bulkpop-list">
              {tags.length === 0 && <p className="menuhint">{t('labels.none')}</p>}
              {tags.length > 0 && filteredTags.length === 0 && <p className="menuhint">{t('search.noResults')}</p>}
              {filteredTags.map((label) => {
                const state = tagState(label.name);
                return (
                  <label className="checkrow" key={label.id}>
                    <input
                      type="checkbox"
                      checked={state === 'all'}
                      /* Some of them, not all: the box says so rather than
                         pretending the answer is no, and clicking it puts the
                         tag on the ones that are missing it. */
                      ref={(node) => { if (node) node.indeterminate = state === 'some'; }}
                      onChange={() => setTag(label.name, state !== 'all')}
                    />
                    <Icon name="tag" size="sm" className="taglabel" style={markerStyle(label.color, false)} />
                    <span>{label.name}</span>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </BulkMenu>

      <BulkMenu icon="flag" label={t('bulk.priority')}>
        {(close) => (
          <>
            {([1, 2, 3, 4] as const).map((p) => (
              <button
                key={p}
                className="opt"
                onClick={() => { close(); setPriority(p); }}
              >
                <span>
                  <Icon name="flag" size="sm" className={`bulkflag p${p}`} />
                  {`P${p}`}
                </span>
              </button>
            ))}
          </>
        )}
      </BulkMenu>

      <span className="sep" aria-hidden="true" />
      <button className="btn sm danger" onClick={() => void remove()}>
        <Icon name="close" size="sm" />
        {t('task.delete')}
      </button>
      <button className="btn sm quiet" onClick={clearSelection}>
        {t('bulk.clear')}
      </button>
    </div>
  );
}
