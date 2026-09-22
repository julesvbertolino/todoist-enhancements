import { useDraggable } from '@dnd-kit/core';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useRowTarget } from './dnd/useRowTarget';
import { TaskActions } from './TaskActions';
import { useT } from '@/hooks/useT';
import { usePhoneBehaviour } from '@/hooks/useTouchLayout';
import { useRowGesture } from '@/hooks/useRowGesture';
import { useStore } from '@/store/store';
import { displayTaskContent, isUncompletable, toDisplayPriority, type Item } from '@/domain/types';
import { effectiveEstimate, formatDuration } from '@/domain/estimates';
import { deadlineDate, dueDate, formatRelativeDay, formatTime, hasTime, isOverdue, isToday, overdueBy } from '@/domain/dates';
import { markerStyle } from '@/domain/colors';
import { renderInlineMarkdown } from '@/domain/markdown';

/**
 * Whether rows draw the subtasks nested under them.
 *
 * "Show subtasks" is a per-view filter, and a row three components deep has no
 * way of knowing which view it is in. A context carries the answer down instead
 * of a boolean being handed through every list, group and board column on the
 * way — the rows never had to know, and now they still do not.
 */
/**
 * How long a finished task stays on screen before it goes.
 *
 * Long enough to see the tick land and read it as "yes, that one", short
 * enough that nobody waits for it. Instant removal makes a mis-click
 * indistinguishable from a correct one: the row is simply gone and you are
 * left wondering which one you hit.
 */
/**
 * How long a ticked row stays before it goes.
 *
 * Exported so the review ticks a task off with the same pause: two places that
 * complete a task should not have two different ideas of how long that takes.
 */
export const COMPLETION_LINGER_MS = 420;

const ShowSubtasks = createContext(true);

export const SubtasksProvider = ShowSubtasks.Provider;

interface TaskRowProps {
  item: Item;
  childrenOf: (id: string) => Item[];
  onOpen: (id: string) => void;
  /** Subtasks render indented under their parent. */
  depth?: number;
  showProject?: boolean;
  dragHandleProps?: Record<string, unknown>;
  /** Whether another task can be dropped onto this row to become its subtask. */
  nestable?: boolean;
  /** Registers the row itself as the thing being dragged, for a subtask. */
  dragRef?: (node: HTMLElement | null) => void;
  /** The row is the one in flight. */
  lifted?: boolean;
}

export function TaskRow({
  item, childrenOf, onOpen, depth = 0, showProject = true, dragHandleProps, nestable = false,
  dragRef, lifted = false,
}: TaskRowProps) {
  const { setRowRef, nestOver, landing } = useRowTarget(item.id, { nestable });
  const { t, locale } = useT();
  const snapshot = useStore((s) => s.snapshot);
  const hour12 = useStore((s) => s.prefs.hour12);
  const toggleTask = useStore((s) => s.toggleTask);
  const picked = useStore((s) => s.selection.includes(item.id));
  const toggleSelection = useStore((s) => s.toggleSelection);
  const selectionAnchor = useStore((s) => s.selectionAnchor);
  const setSelectionAnchor = useStore((s) => s.setSelectionAnchor);
  const selectRange = useStore((s) => s.selectRange);
  const showSubtasks = useContext(ShowSubtasks);

  const phone = usePhoneBehaviour();
  /* The two gestures a phone has in place of a pointer hovering over the row:
     pull it aside for its buttons, hold it down for their names. */
  const gesture = useRowGesture(phone);

  const [expanded, setExpanded] = useState(true);
  /** Ticked here, not yet ticked at Todoist: the pause between the two. */
  const [settling, setSettling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /* Re-opening a task needs no pause — nothing disappears — so only the
     completing direction waits. A second click while it is waiting is ignored
     rather than queueing a second toggle that would undo the first. */
  const complete = () => {
    if (item.checked) { void toggleTask(item.id); return; }
    if (settling) return;
    setSettling(true);
    timer.current = setTimeout(() => { void toggleTask(item.id); }, COMPLETION_LINGER_MS);
  };

  const uncompletable = isUncompletable(item);
  const children = childrenOf(item.id);
  const openChildren = children.filter((c) => !c.checked);
  const doneChildren = children.length - openChildren.length;

  const { minutes, computed } = effectiveEstimate(item, childrenOf);
  const priority = toDisplayPriority(item.priority);
  const due = dueDate(item);
  const deadline = deadlineDate(item);
  const late = isOverdue(item);
  const project = snapshot.projects[item.project_id];

  /**
   * The DOM is the final truth about range order.
   *
   * Views may filter, sort, group and collapse their rows after the snapshot
   * has been read. Reading the rows that are actually mounted guarantees a
   * Shift range cannot pick a hidden group, another page, or a collapsed
   * subtask. The same function serves pointer and keyboard selection.
   */
  const pickRange = (additive: boolean) => {
    const visible = [...document.querySelectorAll<HTMLElement>('.screen.active [data-task-id]')]
      .map((row) => row.dataset.taskId)
      .filter((id): id is string => Boolean(id));
    const ids = [...new Set(visible)];
    const from = selectionAnchor ? ids.indexOf(selectionAnchor) : -1;
    const to = ids.indexOf(item.id);
    if (from < 0 || to < 0) {
      selectRange([item.id], additive);
      return;
    }
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    const range = ids.slice(start, end + 1);
    /* The clicked endpoint, not the bottom of an upward range, becomes the
       next anchor. `selectRange` uses the final id, so reverse when needed. */
    selectRange(to < from ? [...range].reverse() : range, additive);
  };

  // Estimate labels are shown as a duration, never as an ordinary tag.
  const visibleLabels = item.labels.filter((l) => !l.toLowerCase().startsWith('est-'));

  /* A tag carries a colour in Todoist, so it carries it here too. The task
     stores names, and the colour lives on the label, which is the lookup. */
  const labelColours = useMemo(() => {
    const byName = new Map<string, string>();
    for (const label of Object.values(snapshot.labels)) byName.set(label.name, label.color);
    return byName;
  }, [snapshot.labels]);

  return (
    <>
      <div
        ref={(node) => { setRowRef(node); dragRef?.(node); }}
        className={`task${item.checked || settling ? ' done' : ''}${settling ? ' settling' : ''}${picked ? ' picked' : ''}${nestOver ? ' nesttarget' : ''}${landing ? ' landing' : ''}${lifted ? ' dragging' : ''}${gesture.className}`}
        role="button"
        tabIndex={0}
        /* The row the keyboard is on is the row that has focus, so the walk
           needs nothing but a way to recognise a task row in the document. */
        data-task-id={item.id}
        {...gesture.handlers}
        /* The tour lights up a parent together with the children under it,
           because the two being one thing is the point being made. They are
           siblings rather than nested — a wrapper here would have to fight the
           group's own layout — so the row says "take my following siblings
           too" and the tour works out the rectangle around the lot. */
        data-tour={showSubtasks && expanded && openChildren.length > 0 ? 'subtasks' : undefined}
        data-tour-extend={
          showSubtasks && expanded && openChildren.length > 0 ? 'siblings' : undefined
        }
        data-depth={depth > 0 ? depth : undefined}
        style={{
          ...(depth > 0 ? ({ '--depth': depth } as React.CSSProperties) : {}),
          ...gesture.style,
        }}
        aria-selected={picked || undefined}
        onMouseDown={(e) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) e.preventDefault();
        }}
        /* Cmd (or Ctrl) and a click picks the row out instead of opening it:
           the same gesture every file list has used for thirty years, and the
           only one that does not cost the plain click its meaning. */
        onClick={(e) => {
          if (e.shiftKey) {
            e.preventDefault();
            e.currentTarget.focus({ preventScroll: true });
            pickRange(e.metaKey || e.ctrlKey);
            return;
          }
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            e.currentTarget.focus({ preventScroll: true });
            toggleSelection(item.id);
            return;
          }
          /* A row that has just been pulled aside, or held down, has already
             answered the press. The click the browser sends afterwards is not
             a second instruction to open the task. */
          if (gesture.justGestured()) return;
          setSelectionAnchor(item.id);
          onOpen(item.id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (e.shiftKey) { pickRange(e.metaKey || e.ctrlKey); return; }
            if (e.metaKey || e.ctrlKey) { toggleSelection(item.id); return; }
            setSelectionAnchor(item.id);
            onOpen(item.id);
          }
        }}
      >
        {dragHandleProps && (
          <span className="drag" title={t('task.drag')} {...dragHandleProps}>
            <Icon name="drag" />
          </span>
        )}

        {uncompletable ? (
          /* Todoist gives a "* " task no checkbox at all, so this one does
             not click, focus, or announce itself as one — it only holds the
             row's alignment. */
          <span className={`check p${priority} nocheck`} aria-hidden="true" />
        ) : (
          <span
            className={`check p${priority}`}
            role="checkbox"
            aria-checked={item.checked || settling}
            aria-label={t('task.complete')}
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              complete();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                complete();
              }
            }}
          >
            <Icon name="check" />
          </span>
        )}

        <span className="tmain">
          <span className="ttitle">{displayTaskContent(item)}</span>

          {item.description && (
            /* The row shows the formatted line, not the Markdown syntax. */
            <span
              className="tdesc"
              dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(item.description) }}
            />
          )}

          <span className="meta">
            {minutes !== null && (
              <span className="est" title={computed ? t('task.computedEstimate') : undefined}>
                <Icon name="clock" />
                {formatDuration(minutes, locale)}
                {computed && '*'}
              </span>
            )}

            {due && (
              <span className={late ? 'late' : 'at'}>
                {!late && <Icon name="calendar" />}
                {formatRelativeDay(due, locale)}
                {hasTime(item.due) && ` ${formatTime(due, locale, hour12)}`}
                {late && overdueBy(item) > 0 && ` · ${overdueBy(item)}d`}
              </span>
            )}

            {item.due?.is_recurring && (
              <span
                className={`repeatdot ${late ? 'late' : isToday(item) ? 'today' : 'future'}`}
                title={item.due.string}
              >
                <Icon name="repeat" size="sm" />
              </span>
            )}

            {deadline && (
              <span className="deadline">
                <Icon name="deadline" />
                {formatRelativeDay(deadline, locale)}
              </span>
            )}

            {visibleLabels.map((label) => (
              <span className="tag" key={label} style={markerStyle(labelColours.get(label))}>
                <Icon name="tag" size="sm" />
                {label}
              </span>
            ))}

            {showProject && project && !project.inbox_project && (
              <span className="proj" style={markerStyle(project.color, false)}>
                #{project.name}
              </span>
            )}

            {children.length > 0 && (
              <span className="subprog">
                <Icon name="subtask" />
                {t('task.subtaskProgress', { done: doneChildren, total: children.length })}
              </span>
            )}
          </span>
        </span>

        <span className="trow-end">
          {showSubtasks && openChildren.length > 0 && (
            <button
              className="iconbtn subcaret"
              aria-expanded={expanded}
              aria-label={t('detail.subtasks')}
              title={t('detail.subtasks')}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
            >
              <Icon name={expanded ? 'caret-up' : 'caret'} size="sm" />
            </button>
          )}
          <TaskActions item={item} childrenOf={childrenOf} onOpen={onOpen} />
        </span>
      </div>

      {showSubtasks && expanded &&
        openChildren.map((child) => (
          <SubtaskRow
            key={child.id}
            item={child}
            childrenOf={childrenOf}
            onOpen={onOpen}
            depth={depth + 1}
            showProject={showProject}
            nestable={nestable}
          />
        ))}
    </>
  );
}

/**
 * Prefixes the id a subtask row is picked up by.
 *
 * Deliberately not `sub:`, which is a prefix of the `subtask:` the task panel
 * gives its own rows: every test for one would answer true for the other.
 */
export const SUBTASK_DRAG_PREFIX = 'subrow:';

/**
 * A subtask that can be picked up by its handle.
 *
 * Dragged out to the left, or onto a group, it becomes a task of its own;
 * dragged out to the right over another row, it moves under that one. The id
 * is prefixed because a task can be drawn twice, as a row of its own and under
 * its parent, and the drag registry keeps one entry per id. No wrapper goes
 * around the row: a board card styles its subtasks as the rows that follow
 * its first one, and a wrapper would turn each of them into a card of its own.
 */
function SubtaskRow(props: TaskRowProps) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `${SUBTASK_DRAG_PREFIX}${props.item.id}`,
  });
  return (
    <TaskRow
      {...props}
      dragHandleProps={{ ...attributes, ...listeners }}
      dragRef={setNodeRef}
      lifted={isDragging}
    />
  );
}
