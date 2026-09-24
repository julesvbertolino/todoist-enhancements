import { SYSTEM_LABELS, weekLabel, type Item } from './types';
import { toApiDate } from './dates';
import { dueForDate } from './recurrence';
import { byChildOrder } from './orderKey';

/**
 * What a drop means.
 *
 * Section 7 of the specification fixes one mutation per destination. Putting
 * them in one place keeps the rules readable and stops the interface from
 * inventing its own.
 */

export type DropTarget =
  | { kind: 'today' }
  /** Today, and tagged quick: the Quick group is defined by that tag. */
  | { kind: 'quick' }
  | { kind: 'anytime' }
  | { kind: 'someday' }
  | { kind: 'day'; date: Date }
  | { kind: 'project'; projectId: string }
  | { kind: 'section'; sectionId: string | null; projectId: string }
  | { kind: 'label'; label: string }
  /**
   * The Favourites heading in the sidebar.
   *
   * A place for a project or a tag to be dropped, and for nothing else: a
   * task has no business being a favourite, so `dropMutation` reads this as
   * no mutation at all and the heading stands down while a task is in flight.
   */
  | { kind: 'favourites' };

export interface DropMutation {
  /** Fields for an `item_update` command, when the drop changes the task itself. */
  update?: Record<string, unknown>;
  /** Fields for an `item_move` command, when the drop changes where it lives. */
  move?: { project_id?: string; section_id?: string | null };
}

/**
 * Todoist's `item_move` takes exactly one destination. A section implies its
 * project, so the section is sent when there is one and the project otherwise.
 */
export function moveArgs(
  move: { project_id?: string; section_id?: string | null },
): { section_id: string } | { project_id?: string } {
  return move.section_id ? { section_id: move.section_id } : { project_id: move.project_id };
}

const withoutWeek = (labels: string[]): string[] =>
  labels.filter((l) => l.toLowerCase() !== weekLabel().toLowerCase());

const withWeek = (labels: string[]): string[] =>
  withoutWeek(labels).concat(weekLabel());

/**
 * A due value for a calendar date.
 *
 * The one in domain/recurrence, because dropping a repeating task onto a day
 * is the commonest way to end a series by accident: it used to write the date
 * into `due.string` while leaving `is_recurring` true, which leaves a task
 * wearing a repeat marker that will never repeat again.
 */
const dueOn = (item: Item, date: Date) => dueForDate(item.due, toApiDate(date));

/**
 * Where a task typed into a group should land, from what the group means.
 *
 * A section's "Add task" line and a task dropped onto that same section are
 * the same intention said two ways, and they used to disagree: dropping into
 * Anytime this week put the week label on, and adding there opened an empty
 * composer, so the task went to Someday — out of the section it was added
 * from and out of the week. Both readings come from one table now, so a group
 * cannot mean one thing to a drop and another to a line.
 */
export interface TaskPlacement {
  projectId?: string;
  sectionId?: string;
  date?: string;
  labels?: string[];
  /** As it is written and read, 1 to 4, not Todoist's inverted number. */
  priority?: 1 | 2 | 3 | 4;
}

export function placementFor(target: DropTarget, now = new Date()): TaskPlacement {
  switch (target.kind) {
    case 'today':
      return { date: toApiDate(now) };
    case 'quick':
      return { date: toApiDate(now), labels: [SYSTEM_LABELS.quick] };
    case 'day':
      return { date: toApiDate(target.date) };
    case 'anytime':
      return { labels: [weekLabel()] };
    // Nothing to carry: Someday is what a task with no date and no week label
    // already is.
    case 'someday':
      return {};
    case 'project':
      return { projectId: target.projectId };
    case 'section':
      return target.sectionId
        ? { projectId: target.projectId, sectionId: target.sectionId }
        : { projectId: target.projectId };
    case 'label':
      return { labels: [target.label] };
    default:
      return {};
  }
}

export function dropMutation(item: Item, target: DropTarget): DropMutation | null {
  switch (target.kind) {
    case 'today':
      // Today's date, the week label dropped, the time of day and reminders kept.
      return { update: { due: dueOn(item, new Date()), labels: withoutWeek(item.labels) } };

    case 'quick': {
      const labels = withoutWeek(item.labels);
      const tagged = labels.some((l) => l.toLowerCase() === SYSTEM_LABELS.quick);
      return {
        update: {
          due: dueOn(item, new Date()),
          labels: tagged ? labels : [...labels, SYSTEM_LABELS.quick],
        },
      };
    }

    case 'day':
      /* A real date and the week tag on the same task is the contradiction the
         app reports rather than resolves, so giving a task a day takes the tag
         off — exactly as dropping it on Today does. */
      return { update: { due: dueOn(item, target.date), labels: withoutWeek(item.labels) } };

    case 'anytime':
      // Committed to this week, but to no particular day.
      return { update: { due: null, labels: withWeek(item.labels) } };

    case 'someday':
      return { update: { due: null, labels: withoutWeek(item.labels) } };

    /* A subtask dropped on the place it already lives in is lifted out of its
       parent, so the same list it came from is still a real destination. */
    case 'project':
      if (item.project_id === target.projectId && !item.parent_id) return null;
      return { move: { project_id: target.projectId } };

    case 'section':
      if (item.section_id === target.sectionId && !item.parent_id) return null;
      return { move: { project_id: target.projectId, section_id: target.sectionId } };

    case 'label': {
      // A tag is added to whatever the task already carries; it never replaces.
      const already = item.labels.some((l) => l.toLowerCase() === target.label.toLowerCase());
      if (already) return null;
      return { update: { labels: [...item.labels, target.label] } };
    }

    default:
      return null;
  }
}

/**
 * The droppable id of a task row that another task can be dropped onto.
 *
 * One target, two readings, told apart by direction the way the sidebar tells
 * them apart: straight down the list the task takes that row's position, out
 * to the right it goes inside it. Kept apart from `DropTarget` because neither
 * is a destination with a mutation of its own — both need the row itself, one
 * for its place among its siblings and the other for the project and section
 * the task follows it into.
 */
const ROW_PREFIX = 'row:';
export const rowTargetId = (itemId: string): string => `${ROW_PREFIX}${itemId}`;
export const decodeRowTarget = (id: string): string | null =>
  (id.startsWith(ROW_PREFIX) ? id.slice(ROW_PREFIX.length) : null);

/**
 * How a list keeps the order its rows are dropped into.
 *
 * `project` is one project's own numbering, which is what Todoist counts and
 * what a project page shows. `day` is the number Todoist keeps for the lists
 * that cross projects — a week, a tag, everything you put off — because there
 * is no other field that can hold an order across them.
 */
export type RowOrder = 'project' | 'day';

/**
 * The tasks that share a place with this one, in the order they are drawn.
 *
 * Todoist counts `child_order` inside one container — a project, or a section
 * of it, or a parent task — so those are the tasks a reorder can renumber, and
 * a task dropped in from anywhere else has to join the container first.
 */
export function siblingTasks(items: Record<string, Item>, of: Item): string[] {
  return Object.values(items)
    .filter((other) => !other.is_deleted
      && other.project_id === of.project_id
      && (other.section_id ?? null) === (of.section_id ?? null)
      && (other.parent_id ?? null) === (of.parent_id ?? null))
    .sort(byChildOrder)
    .map((other) => other.id);
}

/**
 * How many levels of subtasks Todoist keeps under a task. It refuses a move
 * that would go deeper, and the row would jump back on the next sync.
 */
export const MAX_SUBTASK_DEPTH = 4;

/** How many parents a task has above it. */
function depthOf(items: Record<string, Item>, id: string): number {
  let depth = 0;
  for (let at = items[id]; at?.parent_id; at = items[at.parent_id]) depth += 1;
  return depth;
}

/**
 * The open subtasks of every task, built once per snapshot.
 *
 * Every row on screen asks `canNest` the same question the moment a drag
 * crosses the indent threshold, and reading the depth below a task by walking
 * the whole snapshot made that a scan of every task for every row. The
 * snapshot is replaced rather than edited, so a new one builds a new index and
 * the old one is collected with it.
 */
const childIndexes = new WeakMap<Record<string, Item>, Map<string, Item[]>>();

function childrenIndex(items: Record<string, Item>): Map<string, Item[]> {
  const cached = childIndexes.get(items);
  if (cached) return cached;
  const index = new Map<string, Item[]>();
  for (const item of Object.values(items)) {
    if (!item.parent_id || item.is_deleted) continue;
    const siblings = index.get(item.parent_id);
    if (siblings) siblings.push(item);
    else index.set(item.parent_id, [item]);
  }
  childIndexes.set(items, index);
  return index;
}

/** How many levels of open subtasks hang below a task; 0 for none. */
function heightOf(items: Record<string, Item>, id: string): number {
  const index = childrenIndex(items);
  const below = (parentId: string): number => {
    let height = 0;
    for (const child of index.get(parentId) ?? []) height = Math.max(height, 1 + below(child.id));
    return height;
  };
  return below(id);
}

/**
 * Whether a task may go inside another one: not inside itself, not inside
 * something already below it, not where it already is, and not so deep that
 * it or its own subtasks would pass the limit.
 */
export function canNest(items: Record<string, Item>, itemId: string, parentId: string): boolean {
  const item = items[itemId];
  const parent = items[parentId];
  if (!item || !parent || item.parent_id === parentId) return false;
  for (let at: Item | undefined = parent; at; at = at.parent_id ? items[at.parent_id] : undefined) {
    if (at.id === itemId) return false;
  }
  return depthOf(items, parentId) + 1 + heightOf(items, itemId) <= MAX_SUBTASK_DEPTH;
}

/**
 * Encodes a target as a droppable id, and reads it back.
 *
 * Two places can offer the same destination — the sidebar's "My week" and the
 * page's "Anytime this week" are both `anytime` — and a droppable registry is
 * keyed by id, so without a scope the second registration silently replaces
 * the first and one of the two stops accepting drops.
 */
export function encodeTarget(target: DropTarget, scope?: string): string {
  const id = encodeKind(target);
  return scope ? `${scope}|${id}` : id;
}

function encodeKind(target: DropTarget): string {
  switch (target.kind) {
    case 'day': return `day:${toApiDate(target.date)}`;
    case 'project': return `project:${target.projectId}`;
    case 'section': return `section:${target.projectId}:${target.sectionId ?? ''}`;
    case 'label': return `label:${target.label}`;
    default: return target.kind;
  }
}

export function decodeTarget(encoded: string): DropTarget | null {
  const id = encoded.includes('|') ? encoded.slice(encoded.indexOf('|') + 1) : encoded;
  if (id === 'today' || id === 'quick' || id === 'anytime' || id === 'someday'
    || id === 'favourites') return { kind: id };

  const [kind, ...rest] = id.split(':');
  if (kind === 'day') {
    const date = new Date(`${rest[0]}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : { kind: 'day', date };
  }
  if (kind === 'project') return { kind: 'project', projectId: rest[0] };
  if (kind === 'section') {
    return { kind: 'section', projectId: rest[0], sectionId: rest[1] || null };
  }
  if (kind === 'label') return { kind: 'label', label: rest.join(':') };
  return null;
}
