import {
  toDisplayPriority,
  type GroupKey, type Item, type Project, type Snapshot,
  type SortKey, type ViewFilters,
} from '@/domain/types';
import { estimateOf, effectiveEstimate } from '@/domain/estimates';
import { dueDate } from '@/domain/dates';
import { hasLabel, isOpen } from '@/domain/views';
import type { RowOrder } from '@/domain/dnd';
import { PREFERENCES_TASK_CONTENT } from './prefs';

/**
 * The workspace filter's stand-in for "My projects".
 *
 * Todoist's personal space isn't a workspace at all — it's just the absence
 * of one, `workspace_id: null` — so there is no real id to put in
 * `filters.workspaces` for it. This is never a real Todoist id (those are
 * numeric strings), so it can share the same array without colliding.
 */
export const PERSONAL_WORKSPACE = 'personal';

/** Index of parent id to its children, built once per snapshot. */
export function childIndex(snapshot: Snapshot): Map<string, Item[]> {
  const index = new Map<string, Item[]>();
  for (const item of Object.values(snapshot.items)) {
    if (!item.parent_id || item.is_deleted) continue;
    const bucket = index.get(item.parent_id);
    if (bucket) bucket.push(item);
    else index.set(item.parent_id, [item]);
  }
  for (const bucket of index.values()) bucket.sort((a, b) => a.child_order - b.child_order);
  return index;
}

export const makeChildrenOf =
  (index: Map<string, Item[]>) =>
  (parentId: string): Item[] =>
    index.get(parentId) ?? [];

/** Every open task, with tasks living in archived projects left out. */
export function openItems(snapshot: Snapshot): Item[] {
  return Object.values(snapshot.items).filter((item) => {
    if (item.content === PREFERENCES_TASK_CONTENT) return false;
    if (!isOpen(item)) return false;
    const project = snapshot.projects[item.project_id];
    return !project || (!project.is_archived && !project.is_deleted);
  });
}

/** Top-level tasks only: subtasks are rendered under their parent, not beside it. */
export const rootItems = (items: Item[]): Item[] => items.filter((i) => !i.parent_id);

export function applyFilters(
  items: Item[],
  filters: ViewFilters,
  snapshot: Snapshot,
  childrenOf: (id: string) => Item[],
): Item[] {
  return items.filter((item) => {
    if (filters.projects.length > 0 && !filters.projects.includes(item.project_id)) return false;

    if (filters.workspaces.length > 0) {
      const workspaceId = snapshot.projects[item.project_id]?.workspace_id ?? null;
      const bucket = workspaceId ?? PERSONAL_WORKSPACE;
      if (!filters.workspaces.includes(bucket)) return false;
    }

    if (filters.labels.length > 0 && !filters.labels.some((l) => hasLabel(item, l))) return false;

    if (
      filters.priorities.length > 0 &&
      !filters.priorities.includes(toDisplayPriority(item.priority))
    ) {
      return false;
    }

    if (filters.estimated !== null) {
      const { minutes } = effectiveEstimate(item, childrenOf);
      if (filters.estimated && minutes === null) return false;
      if (!filters.estimated && minutes !== null) return false;
    }

    if (!filters.includeScheduled && item.due) return false;

    return true;
  });
}

export function countActiveFilters(filters: ViewFilters): number {
  let count = 0;
  if (filters.projects.length) count += 1;
  if (filters.workspaces.length) count += 1;
  if (filters.labels.length) count += 1;
  if (filters.priorities.length) count += 1;
  if (filters.estimated !== null) count += 1;
  if (!filters.includeScheduled) count += 1;
  if (!filters.showSubtasks) count += 1;
  if (filters.showCompleted) count += 1;
  return count;
}

/** Where a task sits in a hand-made order, or the end of it if it has no place yet. */
const dayRank = (item: Item): number =>
  (item.day_order > 0 ? item.day_order : Number.MAX_SAFE_INTEGER);

/** The hand-made order that is meaningful on the surface being rendered. */
const manualCompare = (a: Item, b: Item, order: RowOrder): number =>
  order === 'day'
    ? dayRank(a) - dayRank(b)
      || (a.added_at ?? '').localeCompare(b.added_at ?? '')
      || a.id.localeCompare(b.id)
    : a.child_order - b.child_order || a.id.localeCompare(b.id);

/** Todoist stores labels by id while a task carries their names. */
const labelOrderByName = (snapshot: Snapshot): Map<string, number> => {
  const order = new Map<string, number>();
  for (const label of Object.values(snapshot.labels)) {
    if (!label.is_deleted) order.set(label.name.toLowerCase(), label.item_order);
  }
  return order;
};

export function sortItems(
  items: Item[],
  sort: SortKey,
  childrenOf: (id: string) => Item[],
  /* Which number "manual" means here. A list of one project is numbered by
     `child_order`; a list drawn from several can only be numbered by
     `day_order`, and a task never put in place by hand has neither. */
  order: RowOrder = 'project',
  snapshot?: Snapshot,
): Item[] {
  const copy = [...items];
  const estimate = (i: Item) => effectiveEstimate(i, childrenOf).minutes;

  // Only the label sort needs this, and needs it built once rather than
  // once per comparison.
  const labelPositions = snapshot ? labelOrderByName(snapshot) : new Map<string, number>();
  const labelRank = (item: Item): [bucket: number, position: number, unknown: string] => {
    const labels = item.labels.filter((label) => !label.toLowerCase().startsWith('est-'));
    if (labels.length === 0) return [2, Number.POSITIVE_INFINITY, ''];
    const known = labels
      .map((label) => labelPositions.get(label.toLowerCase()))
      .filter((position): position is number => position !== undefined);
    if (known.length > 0) return [0, Math.min(...known), ''];
    return [1, Number.POSITIVE_INFINITY, [...labels].sort().join('\u0000').toLowerCase()];
  };

  const compare = (a: Item, b: Item): number => {
    switch (sort) {
      case 'priority':
        // Todoist stores 4 as the most urgent, so the higher number comes first.
        return b.priority - a.priority || manualCompare(a, b, order);
      case 'due': {
        const da = dueDate(a)?.getTime();
        const db = dueDate(b)?.getTime();
        // Undated tasks sink to the bottom rather than jumping to the top.
        if (da === undefined && db === undefined) return manualCompare(a, b, order);
        if (da === undefined) return 1;
        if (db === undefined) return -1;
        return da - db || manualCompare(a, b, order);
      }
      case 'added-asc':
      case 'added-desc': {
        const direction = sort === 'added-asc' ? 1 : -1;
        return (a.added_at ?? '').localeCompare(b.added_at ?? '') * direction
          || manualCompare(a, b, order);
      }
      case 'alphabetical':
        return a.content.localeCompare(b.content);
      case 'estimate-asc':
      case 'estimate-desc': {
        const direction = sort === 'estimate-asc' ? 1 : -1;
        const ea = estimate(a);
        const eb = estimate(b);
        if (ea === null && eb === null) return manualCompare(a, b, order);
        if (ea === null) return 1;
        if (eb === null) return -1;
        return (ea - eb) * direction || manualCompare(a, b, order);
      }
      case 'label': {
        const [bucketA, positionA, unknownA] = labelRank(a);
        const [bucketB, positionB, unknownB] = labelRank(b);
        return bucketA - bucketB
          || positionA - positionB
          || unknownA.localeCompare(unknownB)
          || manualCompare(a, b, order);
      }
      case 'manual':
      default:
        return manualCompare(a, b, order);
    }
  };

  /* A completed task never competes with an open one for its place -- it
     sinks to the bottom of whatever list or group it's in, the way a
     finished item always does, whichever of the sorts above is asking.
     Only a project's own "show completed" toggle (ProjectView) ever hands
     this a checked item at all; everywhere else sorts only open tasks,
     where every comparison here falls through unchanged. */
  return copy.sort((a, b) => (
    a.checked !== b.checked ? (a.checked ? 1 : -1) : compare(a, b)
  ));
}

export interface Group {
  key: string;
  /** Already-translated title, or a translation key the caller resolves. */
  title: string;
  items: Item[];
}

export function groupItems(
  items: Item[],
  group: GroupKey,
  snapshot: Snapshot,
  labels: {
    none: string;
    noProject: string;
    noSection: string;
    noEstimate: string;
    noLabel: string;
    priority: (p: number) => string;
    day: (d: Date | null) => string;
    scheduled: string;
    available: string;
  },
): Group[] {
  if (group === 'none') return [{ key: 'all', title: '', items }];

  const labelOrder = group === 'label' ? labelOrderByName(snapshot) : null;
  const buckets = new Map<string, { title: string; items: Item[] }>();
  const push = (key: string, title: string, item: Item) => {
    const bucket = buckets.get(key);
    if (bucket) bucket.items.push(item);
    else buckets.set(key, { title, items: [item] });
  };

  for (const item of items) {
    switch (group) {
      case 'project': {
        const project: Project | undefined = snapshot.projects[item.project_id];
        push(item.project_id, project?.name ?? labels.noProject, item);
        break;
      }
      case 'section': {
        const section = item.section_id ? snapshot.sections[item.section_id] : undefined;
        push(item.section_id ?? 'none', section?.name ?? labels.noSection, item);
        break;
      }
      case 'workspace': {
        const workspaceId = snapshot.projects[item.project_id]?.workspace_id ?? 'personal';
        const workspace = snapshot.workspaces[workspaceId ?? ''];
        push(workspaceId ?? 'personal', workspace?.name ?? labels.none, item);
        break;
      }
      case 'priority': {
        const p = toDisplayPriority(item.priority);
        push(`p${p}`, labels.priority(p), item);
        break;
      }
      case 'scheduled':
        push(item.due ? 'scheduled' : 'available', item.due ? labels.scheduled : labels.available, item);
        break;
      case 'label': {
        const own = item.labels.filter((l) => !l.startsWith('est-'));
        if (own.length === 0) push('none', labels.noLabel, item);
        else for (const label of own) push(label, label, item);
        break;
      }
      case 'estimate': {
        const minutes = estimateOf(item);
        push(minutes === null ? 'none' : String(minutes), minutes === null ? labels.noEstimate : `${minutes} min`, item);
        break;
      }
      case 'day':
      case 'week':
      case 'month': {
        const d = dueDate(item);
        const key = d ? bucketDateKey(d, group) : 'none';
        push(key, labels.day(d), item);
        break;
      }
      default:
        push('all', '', item);
    }
  }

  const result = [...buckets.entries()].map(([key, value]) => ({ key, ...value }));
  // Date groups read chronologically; tag groups follow the order maintained in Todoist.
  if (group === 'day' || group === 'week' || group === 'month') {
    result.sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.key.localeCompare(b.key)));
  } else if (group === 'label') {
    result.sort((a, b) => {
      if (a.key === 'none') return 1;
      if (b.key === 'none') return -1;
      const aOrder = labelOrder?.get(a.key.toLowerCase()) ?? Number.POSITIVE_INFINITY;
      const bOrder = labelOrder?.get(b.key.toLowerCase()) ?? Number.POSITIVE_INFINITY;
      return aOrder - bOrder || a.title.localeCompare(b.title);
    });
  } else if (group === 'estimate') {
    result.sort((a, b) => {
      if (a.key === 'none') return 1;
      if (b.key === 'none') return -1;
      return Number(a.key) - Number(b.key);
    });
  }
  return result;
}

function bucketDateKey(date: Date, group: 'day' | 'week' | 'month'): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  if (group === 'month') return `${y}-${m}`;
  if (group === 'week') {
    const week = Math.ceil((date.getDate() + new Date(y, date.getMonth(), 1).getDay()) / 7);
    return `${y}-${m}-w${week}`;
  }
  return `${y}-${m}-${String(date.getDate()).padStart(2, '0')}`;
}

/** A project and whatever sits inside it, so folders can nest their contents. */
export interface ProjectNode {
  project: Project;
  children: ProjectNode[];
}

export interface WorkspaceGroup {
  workspaceId: string | null;
  name: string | null;
  roots: ProjectNode[];
}

/**
 * The sidebar's project tree.
 *
 * Todoist nests projects inside folders and inside other projects, so the
 * sidebar is built as a tree rather than a flat list, grouped by workspace.
 */
export function projectTree(snapshot: Snapshot): WorkspaceGroup[] {
  const visible = Object.values(snapshot.projects).filter(
    (p) => !p.is_archived && !p.is_deleted && !p.inbox_project,
  );

  const nodes = new Map<string, ProjectNode>(
    visible.map((project) => [project.id, { project, children: [] }]),
  );

  const groups = new Map<string, ProjectNode[]>();

  for (const project of visible) {
    const node = nodes.get(project.id)!;
    const parent = project.parent_id ? nodes.get(project.parent_id) : undefined;
    if (parent) {
      parent.children.push(node);
      continue;
    }
    const key = project.workspace_id ?? 'personal';
    const bucket = groups.get(key);
    if (bucket) bucket.push(node);
    else groups.set(key, [node]);
  }

  const byOrder = (a: ProjectNode, b: ProjectNode) =>
    a.project.child_order - b.project.child_order;
  for (const node of nodes.values()) node.children.sort(byOrder);

  return [...groups.entries()]
    .map(([key, roots]) => ({
      workspaceId: key === 'personal' ? null : key,
      name: key === 'personal' ? null : (snapshot.workspaces[key]?.name ?? null),
      roots: roots.sort(byOrder),
    }))
    // The personal workspace leads, matching Todoist's own ordering.
    .sort((a, b) => (a.workspaceId === null ? -1 : b.workspaceId === null ? 1 : 0));
}

/** How many open tasks each project holds, for the sidebar counters. */
export function projectCounts(items: Item[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.project_id, (counts.get(item.project_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * The projects that sit beside this one, in the order the sidebar shows them.
 *
 * Siblings share a parent and a workspace, because `child_order` only means
 * anything inside one list. A project at the root of a workspace and a project
 * at the root of the personal space are not in the same list, however alike
 * their rows look.
 */
export function siblingOrder(snapshot: Snapshot, projectId: string): string[] {
  const project = snapshot.projects[projectId];
  if (!project) return [];
  return Object.values(snapshot.projects)
    .filter((other) =>
      !other.is_archived &&
      !other.is_deleted &&
      !other.inbox_project &&
      (other.parent_id ?? null) === (project.parent_id ?? null) &&
      (other.workspace_id ?? null) === (project.workspace_id ?? null))
    .sort((a, b) => a.child_order - b.child_order)
    .map((other) => other.id);
}
