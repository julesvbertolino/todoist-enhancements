import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { COMPLETION_LINGER_MS } from '@/components/TaskRow';
import { EstimateField } from '@/components/EstimateField';
import { Select } from '@/components/Select';
import { useT } from '@/hooks/useT';
import { useData } from '@/hooks/useData';
import { useCompleted } from '@/hooks/useCompleted';
import { useStore } from '@/store/store';
import { navigate } from '@/hooks/useRoute';
import { rootItems } from '@/store/selectors';
import { markerStyle } from '@/domain/colors';
import { formatDuration, effectiveEstimate } from '@/domain/estimates';
import { dueDate, formatRelativeDay } from '@/domain/dates';
import { summariseInsights } from '@/domain/insights';
import { summariseLoad, weeklyCapacity } from '@/domain/load';
import {
  Bars, ChartCard, Donut, SplitBar, seriesColor,
  type BarDatum, type SliceDatum,
} from '@/components/charts';
import { formatRange, rangeFor } from '@/domain/periods';
import { addDays, format, startOfDay } from 'date-fns';
import { displayTaskContent, isUncompletable, toDisplayPriority, type CompletedItem, type Item, type Project } from '@/domain/types';
import type { DropTarget } from '@/domain/dnd';
import {
  buildReview,
  type ReviewAction, type ReviewCadence, type ReviewStep,
} from '@/domain/review';
import type { TranslationKey } from '@/i18n';

/** The destination each action stands for, in the drop table's own terms. */
const targetFor = (action: ReviewAction): DropTarget => {
  switch (action) {
    case 'today': return { kind: 'today' };
    case 'tomorrow': return { kind: 'day', date: addDays(startOfDay(new Date()), 1) };
    case 'anytime': return { kind: 'anytime' };
    case 'someday': return { kind: 'someday' };
  }
};

/**
 * Where the mail actually is.
 *
 * Four links rather than a setting. Two are web clients and open in a tab;
 * the other two are handed to the operating system — `message:` is Apple
 * Mail's own scheme, and `mailto:` reaches whatever else this machine has
 * registered. Neither can be checked from here: a machine with no handler
 * for a scheme says so itself, which is a better answer than this app
 * guessing what is installed.
 */
const MAIL_CLIENTS = [
  { label: 'Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' },
  { label: 'Outlook', url: 'https://outlook.live.com/mail/0/' },
  { label: 'Apple Mail', url: 'message://' },
  { label: null, url: 'mailto:' },
] as const;

/** How the finished list can be ordered. */
type DoneOrder = 'date' | 'priority';

interface ReviewViewProps {
  onOpen: (id: string) => void;
}

/**
 * The daily and weekly review.
 *
 * A planning tool is only as good as the habit of looking at it, and what
 * makes that hard is that looking at everything is exhausting. This asks one
 * question at a time, in an order, with an end.
 *
 * Every answer is a change Todoist already understands, made through the same
 * rules a drag makes, so a pass through here leaves nothing behind that the
 * official app would not recognise. Nothing about the review is stored: it is
 * a way of reading what is already there.
 */
export function ReviewView({ onOpen }: ReviewViewProps) {
  const { t, locale } = useT();
  const { snapshot, items, childrenOf } = useData();
  const prefs = useStore((s) => s.prefs);
  const sendTo = useStore((s) => s.sendTo);
  const toggleTask = useStore((s) => s.toggleTask);
  const skipOccurrence = useStore((s) => s.skipOccurrence);
  const moveTask = useStore((s) => s.moveTask);

  const startDay = snapshot.user?.start_day ?? 1;

  const [cadence, setCadence] = useState<ReviewCadence>('daily');
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [doneOrder, setDoneOrder] = useState<DoneOrder>('date');
  /**
   * Which week is under review: 0 is the one in progress, -1 the one before.
   *
   * A weekly review read the current week and nothing else, which only works
   * for somebody who does it on a Sunday night. Done on a Monday morning it
   * read a week two hours old. It opens on the week that has just ended while
   * the new one is still young, and the arrows say the rest.
   */
  const [weekOffset, setWeekOffset] = useState(() => (earlyInTheWeek(startDay) ? -1 : 0));

  /**
   * What you chose for a row during this pass.
   *
   * Not where the task already is: most answers take the row out of the list,
   * and the ones that leave it there — "stay in the week", "leave it in
   * Someday" — are the ones worth marking, because they are decisions you
   * made rather than states the data happened to be in.
   */
  const [chosen, setChosen] = useState<Record<string, ReviewAction>>({});

  /* The weekly pass reports what was finished, which is history and is read
     on demand. The daily pass never asks, so it never fetches. */
  const weekRange = useMemo(
    () => rangeFor('week', weekOffset, null, startDay),
    [weekOffset, startDay],
  );
  /* `previous` is the week before, which is what turns a bar chart into a
     comparison: the same seven days, one week back, drawn as a dotted line. */
  const { data: completed, previous, loading } = useCompleted(weekRange, cadence === 'weekly');

  const roots = useMemo(() => rootItems(items), [items]);

  const capacity = weeklyCapacity(prefs.dailyCapacity, prefs.weeklyCapacityOverride);

  /** Where an Inbox task can be filed: every project, the Inbox included. */
  const fileDestinations = useMemo(
    () => Object.values(snapshot.projects)
      .filter((p) => !p.is_archived && !p.is_deleted && !p.is_folder)
      .sort((a, b) => a.child_order - b.child_order)
      .map((p) => ({
        value: p.id,
        label: p.inbox_project ? t('nav.inbox') : p.name,
        marker: p.color,
      })),
    [snapshot.projects, t],
  );

  const steps = useMemo(
    () => buildReview(cadence, {
      roots,
      projects: snapshot.projects,
      completed,
      inboxProjectId: snapshot.user?.inbox_project_id ?? null,
      now: new Date(),
      quietAfterDays: prefs.quietAfterDays,
      weeklyCapacityMinutes: capacity,
      childrenOf,
    }),
    [cadence, roots, snapshot.projects, snapshot.user?.inbox_project_id, completed,
      prefs.quietAfterDays, capacity, childrenOf],
  );

  // Changing cadence starts the review again rather than landing mid-way.
  useEffect(() => {
    setIndex(0);
    setFinished(false);
    setChosen({});
  }, [cadence]);

  const step = steps[index];
  const last = index === steps.length - 1;

  /**
   * The rows this step is showing, which is not the same as the rows that
   * still belong in it.
   *
   * Answering a question moves the task out of the bucket the step is built
   * from, so the row used to vanish from under the pointer the moment it was
   * answered — the list shrinking as you worked down it, and no way to see
   * what you had just said or change your mind about it. A step keeps every
   * task it has shown until you leave it: the answer is marked on the row
   * instead of removing it.
   *
   * Tasks that arrive in the bucket later are added, and one deleted outright
   * drops out, because it no longer exists to show.
   */
  const shown = useRef<{ stepId: string | null; ids: string[] }>({ stepId: null, ids: [] });
  const rowsFor = (s: ReviewStep): Item[] => {
    if (shown.current.stepId !== `${cadence}:${s.id}`) {
      shown.current = { stepId: `${cadence}:${s.id}`, ids: [] };
    }
    const seen = new Set(shown.current.ids);
    for (const item of s.items) seen.add(item.id);
    shown.current.ids = [...seen];

    /* Insertion order, deliberately unsorted. A row that has been answered is
       no longer in the bucket and so has no place in its ordering — sorting by
       that sent it to the bottom of the list, which is the same disappearing
       act in slower motion. Where it was is where it stays. */
    return shown.current.ids
      .map((id) => snapshot.items[id])
      .filter((item): item is Item => !!item && !item.is_deleted);
  };

  /**
   * Takes a row out of the list the step is holding.
   *
   * A step keeps every row it has shown, because answering a question about a
   * task should not make the task vanish before you have seen what you said.
   * Finishing one is not an answer to the step's question, though — it is the
   * task leaving — so a completed row is forgotten and goes, the same way it
   * would in any other list.
   */
  const forget = (id: string) => {
    shown.current.ids = shown.current.ids.filter((kept) => kept !== id);
  };

  const atPresent = weekOffset >= 0;

  return (
    <div className="page review">
      <div className="reviewhead">
        <h1 className="ptitle">{t('review.title')}</h1>
        {/* Which week is being closed, to the left of the cadence control and
            on the same line. Given a row of its own it pushed the rail and
            everything under it down the moment the weekly pass was chosen, so
            the one control that held still was surrounded by things that did
            not. */}
        {cadence === 'weekly' && (
          <div className="reviewweek">
            <span className="pager">
              <button
                className="iconbtn"
                aria-label={t('review.previousWeek')}
                title={t('review.previousWeek')}
                onClick={() => setWeekOffset((w) => w - 1)}
              >
                <Icon name="arrow-left" size="sm" />
              </button>
              <button
                className="iconbtn"
                aria-label={t('review.nextWeek')}
                title={t('review.nextWeek')}
                disabled={atPresent}
                onClick={() => setWeekOffset((w) => w + 1)}
              >
                <Icon name="arrow-right" size="sm" />
              </button>
            </span>
            <span className="rangelabel">
              {formatRange(weekRange, locale === 'fr' ? 'fr-FR' : 'en-GB')}
              {weekOffset === -1 && <small> · {t('review.lastWeek')}</small>}
              {weekOffset === 0 && <small> · {t('review.thisWeek')}</small>}
            </span>
          </div>
        )}

        <div className="segmented small reviewcadence" role="group" aria-label={t('review.title')}>
          {(['daily', 'weekly'] as const).map((value) => (
            <button
              key={value}
              aria-pressed={cadence === value}
              onClick={() => setCadence(value)}
            >
              {t(`review.cadence.${value}` as TranslationKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Where you are, and how much is left. A review with no visible end is
          the thing people stop doing. */}
      <ol className="reviewrail">
        {steps.map((s, i) => {
          /* Where you are in the pass, and nothing else. Colouring a pip by
             how much was in the step meant the rail changed meaning as you
             answered it — green for "nothing here", red for "twelve things" —
             and the two were the same circle carrying two different units. A
             step behind you is behind you whatever you left in it. */
          const current = i === index && !finished;
          const seen = finished || i < index;
          /* A number where a number means "to deal with"; a mark where the
             step hands you something to read instead. */
          const outstanding = s.reports ? null : countOf(s);

          return (
            <li key={s.id}>
              <button
                className={`reviewpip${current ? ' current' : ''}${seen ? ' seen' : ''}${s.reports ? ' reports' : ''}`}
                aria-current={current ? 'step' : undefined}
                onClick={() => { setIndex(i); setFinished(false); }}
              >
                <span className="reviewpip-dot" aria-hidden="true">
                  {/* A tick where there is nothing to answer — a red "0" in a
                      circle is a number pretending to be a problem — and the
                      same tick once the step is behind you. */}
                  {(seen && !current) || outstanding === 0
                    ? <Icon name="check" size="sm" />
                    : outstanding === null
                      ? <Icon name="bars" size="sm" />
                      : <b>{outstanding}</b>}
                </span>
                <span className="reviewpip-label">
                  {t(`review.step.${s.id}` as TranslationKey)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {finished || !step ? (
        <Done />
      ) : (
        <>
          {/* One fixed frame: the question at the top, the answer below it, and
              the same two buttons in the same place on every step of both
              cadences. What changes between steps is the content, not where
              anything is. */}
          <section className="reviewstep" key={step.id}>
            <h2>{t(`review.step.${step.id}` as TranslationKey)}</h2>
            <p className="reviewask">
              {t(`review.ask.${step.id}` as TranslationKey, { days: prefs.quietAfterDays })}
            </p>
            <div className="reviewbody">{body()}</div>
          </section>

          <div className="reviewfoot">
            <button
              className="btn quiet"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              <Icon name="arrow-left" size="sm" />
              {t('review.back')}
            </button>
            <span className="reviewcount">
              {t('review.position', { index: index + 1, total: steps.length })}
            </span>
            <button
              className="btn primary"
              onClick={() => (last ? setFinished(true) : setIndex((i) => i + 1))}
            >
              {last ? t('review.finish') : t('review.next')}
              {!last && <Icon name="arrow-right" size="sm" />}
            </button>
          </div>
        </>
      )}
    </div>
  );

  /** The number on a step's pip: how many things it is still asking about. */
  function countOf(s: ReviewStep): number {
    if (s.id === 'load') return s.items.length;
    return s.items.length + s.projects.length + s.completed.length;
  }

  function body() {
    if (!step) return null;

    if (step.id === 'stats') return <Stats />;
    if (step.id === 'done') return <DoneList />;
    if (step.id === 'quiet') return <Quiet />;
    if (step.id === 'email') return <Mail />;
    if (step.id === 'unestimated') {
      /* Keyed on the step, so moving away and back starts a fresh pass rather
         than reviving drafts for a list that has since changed. */
      return (
        <Estimates
          key="unestimated"
          items={step.items}
          projects={snapshot.projects}
          onOpen={onOpen}
        />
      );
    }
    /* Today is a day's worth of work measured against a day's hours; the last
       step of the weekly is a week's against a week's. Same question, same
       block, two capacities. */
    if (step.id === 'load') return <Load step={step} capacity={capacity} />;
    if (step.id === 'today') {
      return <Load step={step} capacity={prefs.dailyCapacity[new Date().getDay()]} />;
    }

    const rows = rowsFor(step);
    if (rows.length === 0) return <Settled />;

    return (
      <div className="reviewlist">
        {rows.map((item) => (
          <Row key={item.id} item={item} step={step} />
        ))}
      </div>
    );
  }

  /** One decision, one row. */
  function Row({ item, step: s }: { item: Item; step: ReviewStep }) {
    const project = snapshot.projects[item.project_id];
    /* Ticked here, not yet gone: the same pause `TaskRow` takes, for the same
       reason — a row that vanishes under the pointer leaves you asking which
       one you just hit. */
    const [settling, setSettling] = useState(false);
    const complete = () => {
      if (settling) return;
      setSettling(true);
      window.setTimeout(() => {
        forget(item.id);
        void toggleTask(item.id);
      }, COMPLETION_LINGER_MS);
    };
    const { minutes } = effectiveEstimate(item, childrenOf);
    const due = dueDate(item);
    /* The button naming the list you are looking at starts pressed, because it
       is already true: a task in the week step is in the week, and a row of
       buttons where none is on reads as a question that has not been answered
       yet. Only steps whose own bucket is one of their answers get this —
       nothing is pre-selected on Overdue, where every option is a change. */
    const settled = s.actions.find((a) => a === s.id) ?? null;
    const current = chosen[item.id] ?? settled;

    return (
      /* Ticked off here exactly as it is ticked off anywhere else: the tick
         lands, is legible for a beat, and the row leans out and goes. The
         honest answer to "this is late" is often "I did it on Friday and
         forgot to tick it", and that answer has to look the same in a review
         as it does in a list. */
      <div className={`reviewrow${settling ? ' done settling' : ''}`}>
        {/* Sometimes the answer is that it is already done. */}
        {isUncompletable(item) ? (
          <span
            className={`check p${toDisplayPriority(item.priority)} nocheck`}
            aria-hidden="true"
          />
        ) : (
          <span
            className={`check p${toDisplayPriority(item.priority)}`}
            role="checkbox"
            aria-checked={item.checked || settling}
            aria-label={t('task.complete')}
            title={t('task.complete')}
            tabIndex={0}
            onClick={complete}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); complete(); }
            }}
          >
            <Icon name="check" />
          </span>
        )}

        <button className="reviewname" onClick={() => onOpen(item.id)}>
          <span className="ttitle">{displayTaskContent(item)}</span>
          <span className="meta">
            {due && (
              <span className={s.id === 'overdue' ? 'late' : undefined}>
                <Icon name="calendar" />{formatRelativeDay(due, locale)}
              </span>
            )}
            {minutes !== null && (
              <span><Icon name="clock" />{formatDuration(minutes, locale)}</span>
            )}
            {project && !project.inbox_project && (
              <span className="proj" style={markerStyle(project.color, false)}>
                #{project.name}
              </span>
            )}
          </span>
        </button>

        {s.fileable ? (
          /* What an Inbox task is missing is a project. Filing it is the whole
             answer, and the row leaves the list once it has one. */
          <span className="reviewfile">
            <Select
              value={item.project_id}
              ariaLabel={t('detail.project')}
              onChange={(next) => void moveTask(item.id, { project_id: next })}
              options={fileDestinations}
            />
          </span>
        ) : (
          <span className="reviewactions">
            {item.due?.is_recurring && (
              <button
                className="btn quiet"
                onClick={() => {
                  forget(item.id);
                  void skipOccurrence(item.id);
                }}
              >
                {t('review.nextOccurrence')}
              </button>
            )}
            {s.actions.map((action) => (
              <button
                key={action}
                className={`btn quiet${current === action ? ' on' : ''}`}
                aria-pressed={current === action}
                onClick={() => {
                  // Pressing the state it is already in is not a change, and
                  // sending it would put an undo toast on a no-op.
                  if (action === current) return;
                  setChosen((prev) => ({ ...prev, [item.id]: action }));
                  void sendTo(item.id, targetFor(action), null);
                }}
              >
                {t(`review.to.${action}` as TranslationKey)}
              </button>
            ))}
          </span>
        )}
      </div>
    );
  }

  /**
   * The week ahead, weighed.
   *
   * Load is the idea the whole product is built on, and the ritual meant to
   * steer it never mentioned it. The step closes the weekly pass with the one
   * question worth ending on — does the next week fit — and lets you take work
   * out of it on the spot, because a step that only states a problem is a step
   * that gets skipped.
   */
  function Load({ step: s, capacity: against }: { step: ReviewStep; capacity: number }) {
    const load = summariseLoad(s.items, childrenOf, against);
    const rows = rowsFor(s);
    const level = load.level === 'over' ? 'over' : load.level === 'tight' ? 'warn' : 'ok';

    return (
      <>
        <div className="reviewload">
          <span className={`loadpill ${level}`}>{load.percentage ?? 0}%</span>
          <span className="reviewload-figures">
            <b>{formatDuration(load.estimatedMinutes, locale)}</b>
            <small>
              {t('review.load.against', { capacity: formatDuration(against, locale) })}
            </small>
          </span>
          {load.unestimatedCount > 0 && (
            <small className="reviewload-note">
              {t('metrics.unestimated', { count: load.unestimatedCount })}
            </small>
          )}
        </div>

        {/* The figures above are the load, which only open tasks weigh on;
            the list below is the step, which holds every row it has shown.
            Rendering the bucket straight made a task ticked off here vanish
            from under the pointer — the one disappearing act the other steps
            were deliberately built to avoid. */}
        {rows.length === 0 ? (
          <Settled />
        ) : (
          <div className="reviewlist scrolls">
            {rows.map((item) => <Row key={item.id} item={item} step={s} />)}
          </div>
        )}
      </>
    );
  }

  /**
   * The mail, which this app cannot see.
   *
   * It is placed before the Inbox because that is where the tasks it produces
   * land, and a review that files the inbox before the mail has been read is
   * filing half of it. The step claims nothing it cannot know: it states the
   * pass and takes your word for it.
   */
  function Mail() {
    return (
      <div className="reviewmail">
        <span className="reviewclear-mark" aria-hidden="true">
          <Icon name="inbox" />
        </span>
        <strong>{t('review.mail.todo')}</strong>
        <span>{t('review.mail.how')}</span>

        {/* The step cannot open your mail, but it can save you looking for it.
            The last one is whatever this machine calls its mail application. */}
        <div className="reviewmail-links">
          {MAIL_CLIENTS.map((client) => (
            <a
              key={client.url}
              className="btn sm"
              href={client.url}
              /* Only the web ones want a tab. A scheme handed to the operating
                 system in a new tab leaves an empty one behind. */
              target={client.url.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer noopener"
            >
              <Icon name="external" size="sm" />
              {client.label ?? t('review.mail.default')}
            </a>
          ))}
        </div>
      </div>
    );
  }

  /** What you finished, in the order you want to read it. */
  function DoneList() {
    const ordered = useMemo(() => {
      const list = [...(step?.completed ?? [])];
      if (doneOrder === 'priority') {
        return list.sort((a, b) => {
          const left = toDisplayPriority(a.priority ?? 1);
          const right = toDisplayPriority(b.priority ?? 1);
          if (left !== right) return left - right;
          return new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime();
        });
      }
      return list.sort(
        (a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime(),
      );
    }, [step?.completed, doneOrder]);

    if (loading && ordered.length === 0) return <p className="reviewquiet">{t('common.loading')}</p>;
    if (ordered.length === 0) return <Settled note={t('review.doneNone')} />;

    return (
      <>
        <div className="reviewtoolbar">
          <span className="reviewtally">
            {t('review.doneCount', { count: ordered.length })}
          </span>
          <div className="segmented small" role="group" aria-label={t('toolbar.sortBy')}>
            {(['date', 'priority'] as const).map((option) => (
              <button
                key={option}
                aria-pressed={doneOrder === option}
                onClick={() => setDoneOrder(option)}
              >
                {t(`review.order.${option}` as TranslationKey)}
              </button>
            ))}
          </div>
        </div>

        {/* The list scrolls, not the page under it. A week of finished work is
            a thing to read through, and reading it should not move the
            question, the rail, or the button that leaves the step. */}
        <div className="reviewlist scrolls">
          {ordered.map((done) => <DoneRow key={done.id} done={done} />)}
        </div>
      </>
    );
  }

  function DoneRow({ done }: { done: CompletedItem }) {
    const project = snapshot.projects[done.project_id];
    const priority = toDisplayPriority(done.priority ?? 1);
    /* Todoist keeps a completed task in the same `items` the sync API always
       returns — checked, but otherwise intact with its due date, deadline and
       description — so opening it here reaches the real task, not a summary,
       and edits through it go through the same item_update every open task
       uses. Only a task old enough to have aged out of that collection falls
       back to plain text. */
    const taskId = done.task_id ?? done.id;
    const live = snapshot.items[taskId];
    const body = (
      <>
        <span className="ttitle">{done.content}</span>
        <span className="meta">
          <span>{formatRelativeDay(new Date(done.completed_at), locale)}</span>
          {project && !project.inbox_project && (
            <span className="proj" style={markerStyle(project.color, false)}>
              #{project.name}
            </span>
          )}
        </span>
      </>
    );
    return (
      <div className="reviewrow done">
        {/* A tick, not a line through it. This is a record of work, and a
            review is no place to read your own week crossed out. */}
        <span className={`check done p${priority}`} aria-hidden="true"><Icon name="check" /></span>
        {live ? (
          <button
            className="reviewname"
            title={t('task.editComplete')}
            onClick={() => onOpen(taskId)}
          >
            {body}
          </button>
        ) : (
          <span className="reviewname as-text">{body}</span>
        )}
      </div>
    );
  }

  /** The week in figures, drawn with the same pieces the dashboard uses. */
  function Stats() {
    const summary = useMemo(
      () => summariseInsights(step?.completed ?? [], roots, snapshot),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [step?.completed, roots, snapshot],
    );

    const byPriority: SliceDatum[] = useMemo(
      () => ([1, 2, 3, 4] as const).map((p) => ({
        key: `p${p}`,
        label: t(`common.p${p}` as TranslationKey),
        value: summary.priorities[`p${p}` as 'p1'],
        color: `var(--p${p})`,
      })),
      [summary.priorities],
    );

    const byProject: SliceDatum[] = useMemo(
      () => summary.byProject.map((entry, index) => ({
        key: entry.projectId,
        label: entry.name,
        value: entry.count,
        color: seriesColor(index),
      })),
      [summary.byProject],
    );

    /* The seven days of the week under review, in order, including the ones
       nothing was finished on — a gap is part of the shape — each carrying the
       same weekday of the week before as its reference. */
    const byDay: BarDatum[] = useMemo(() => {
      const counts = new Map(summary.byDay.map((d) => [d.date, d.count]));
      const before = new Map<string, number>();
      for (const done of previous) {
        const key = format(new Date(done.completed_at), 'yyyy-MM-dd');
        before.set(key, (before.get(key) ?? 0) + 1);
      }
      const todayKey = format(startOfDay(new Date()), 'yyyy-MM-dd');
      return Array.from({ length: 7 }, (_, offset) => {
        const day = new Date(weekRange.since.getTime() + offset * 86_400_000);
        const key = format(day, 'yyyy-MM-dd');
        const lastWeek = format(new Date(day.getTime() - 7 * 86_400_000), 'yyyy-MM-dd');
        return {
          key,
          label: new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(day),
          value: counts.get(key) ?? 0,
          current: key === todayKey,
          reference: before.get(lastWeek) ?? 0,
        };
      });
    }, [summary.byDay, previous]);

    if (loading && summary.completedCount === 0) {
      return <p className="reviewquiet">{t('common.loading')}</p>;
    }

    return (
      <div className="bento reviewbento">
        {/* Three numbers, three cards. One card holding all three read as a
            banner rather than as three things you could compare. */}
        <section className="card w4 reviewfig">
          <b>{summary.completedCount}</b>
          <span>{t('review.fig.finished')}</span>
        </section>

        <section className="card w4 reviewfig">
          <b>{formatDuration(summary.completedMinutes, locale)}</b>
          <span>{t('review.fig.time')}</span>
          {summary.completedWithoutEstimate > 0 && (
            <small>
              {t('review.fig.timeNote', { count: summary.completedWithoutEstimate })}
            </small>
          )}
        </section>

        {/* The bars belong to the focus score: they are what it is made of. */}
        <section className="card w4 reviewfig">
          <b>{summary.focusScore}%</b>
          <span>{t('review.fig.focus')}</span>
          <SplitBar data={byPriority} />
        </section>

        <ChartCard
          title={t('review.chart.perDay')}
          span={6}
          trailing={<span className="kpi-label">{summary.completedCount}</span>}
        >
          <Bars
            data={byDay}
            height={140}
            emptyLabel={t('review.doneNone')}
            referenceLabel={t('review.chart.lastWeek')}
            format={(value) => t('metrics.tasks', { count: value })}
          />
        </ChartCard>

        <ChartCard title={t('review.chart.byProject')} span={6}>
          <Donut
            data={byProject}
            limit={6}
            otherLabel={t('insights.otherProjects')}
            total={summary.completedCount}
            caption={t('insights.tasks')}
            emptyLabel={t('review.doneNone')}
            format={(value) => t('metrics.tasks', { count: value })}
          />
        </ChartCard>
      </div>
    );
  }

  function Quiet() {
    if (!step || step.projects.length === 0) return <Settled />;
    return (
      <div className="reviewlist">
        {step.projects.map((project) => (
          <div className="reviewrow project" key={project.id}>
            <button
              className="reviewname as-row"
              onClick={() => navigate('project', project.id)}
            >
              <span className="hash" style={markerStyle(project.color)}>#</span>
              <span className="ttitle">{project.name}</span>
            </button>
            <span className="reviewquiet">
              {t('review.quietFor', { days: prefs.quietAfterDays })}
            </span>
          </div>
        ))}
      </div>
    );
  }

  /** Nothing to settle. Which is the whole point of asking. */
  function Settled({ note }: { note?: string }) {
    return (
      <div className="reviewclear">
        <span className="reviewclear-mark" aria-hidden="true"><Icon name="check" /></span>
        <strong>{note ?? t('review.settled')}</strong>
        <span>{t(`review.clear.${step?.id ?? 'overdue'}` as TranslationKey)}</span>
      </div>
    );
  }

  function Done() {
    return (
      <section className="reviewdone">
        <span className="reviewdone-mark" aria-hidden="true"><Icon name="check" /></span>
        <h2>{t('review.doneTitle')}</h2>
        <p>{t(`review.doneBody.${cadence}` as TranslationKey)}</p>
        <div className="reviewdone-actions">
          <button className="btn primary" onClick={() => navigate('week')}>
            {t('nav.week')}
          </button>
          <button
            className="btn quiet"
            onClick={() => { setIndex(0); setFinished(false); }}
          >
            {t('review.again')}
          </button>
        </div>
      </section>
    );
  }
}

/**
 * Putting a number on everything in play, in one pass.
 *
 * This step used to write an `item_update` per task, which meant the row you
 * were typing in left the list the moment you pressed Enter and the next one
 * jumped under the cursor. It now holds drafts the way the Unestimated sheet
 * does: the list stays still, Tab walks down it, the total gathers at the
 * foot, and one request goes out at the end.
 *
 * It lives outside the view rather than inside it because a component declared
 * inside a render is a new component type on every render, and React throws
 * away its state: a background sync landing mid-pass would have wiped the
 * numbers already typed.
 */
function Estimates({
  items, projects, onOpen,
}: {
  items: Item[];
  projects: Record<string, Project>;
  onOpen: (id: string) => void;
}) {
  const { t, locale } = useT();
  const setEstimates = useStore((s) => s.setEstimates);
  const listRef = useRef<HTMLDivElement>(null);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  /* The list is fixed when the step opens. Writing the estimates changes what
     the step would contain, and a list that empties itself under your hands is
     the thing this is fixing. */
  const [frozen] = useState(() => items);

  const filled = Object.entries(drafts);
  const total = filled.reduce((sum, [, minutes]) => sum + minutes, 0);

  const record = (id: string, minutes: number | null) =>
    setDrafts((prev) => {
      if (minutes === null) {
        if (!(id in prev)) return prev;
        const { [id]: _removed, ...rest } = prev;
        return rest;
      }
      if (prev[id] === minutes) return prev;
      return { ...prev, [id]: minutes };
    });

  const move = (field: HTMLInputElement, direction: 1 | -1) => {
    const fields = Array.from(listRef.current?.querySelectorAll('input') ?? []);
    const next = fields[fields.indexOf(field) + direction];
    if (next) next.focus();
    else if (direction === 1) field.blur();
  };

  if (frozen.length === 0) {
    return (
      <div className="reviewclear">
        <span className="reviewclear-mark" aria-hidden="true"><Icon name="check" /></span>
        <strong>{t('review.settled')}</strong>
        <span>{t('review.clear.unestimated')}</span>
      </div>
    );
  }

  return (
    <>
      <div className="reviewlist scrolls" ref={listRef}>
        {frozen.map((item, at) => {
          const project = projects[item.project_id];
          return (
            <div
              className={`reviewrow${drafts[item.id] !== undefined ? ' filled' : ''}`}
              key={item.id}
            >
              <span
                className={`check p${toDisplayPriority(item.priority)}`}
                aria-hidden="true"
              >
                <Icon name="check" />
              </span>
              <button className="reviewname" tabIndex={-1} onClick={() => onOpen(item.id)}>
                <span className="ttitle">{item.content}</span>
                {project && !project.inbox_project && (
                  <span className="meta">
                    <span className="proj" style={markerStyle(project.color, false)}>
                      #{project.name}
                    </span>
                  </span>
                )}
              </button>
              <span className="reviewest">
                <EstimateField
                  minutes={null}
                  autoFocus={at === 0}
                  onChange={(value) => record(item.id, value)}
                  onCommit={(value) => record(item.id, value)}
                  onAdvance={move}
                />
              </span>
            </div>
          );
        })}
      </div>

      <div className="reviewtally">
        <span>
          {t('issues.estimateFilled', { count: filled.length, total: frozen.length })}
          {total > 0 && <b>{formatDuration(total, locale)}</b>}
        </span>
        <button
          className="btn primary"
          disabled={filled.length === 0 || saving}
          onClick={() => {
            setSaving(true);
            void setEstimates(filled.map(([id, minutes]) => ({ id, minutes })))
              .finally(() => setSaving(false));
          }}
        >
          {t('common.save')}
        </button>
      </div>
    </>
  );
}

/**
 * True in the first two days of a week.
 *
 * A review done then is almost certainly about the week that has just ended:
 * the new one has barely happened and there is nothing in it to read.
 */
function earlyInTheWeek(startDay: number, now = new Date()): boolean {
  const since = (now.getDay() - (startDay % 7) + 7) % 7;
  return since <= 1;
}
