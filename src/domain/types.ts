/**
 * Todoist resource shapes as returned by the v1 Sync API, plus the product-level
 * types layered on top of them.
 *
 * Naming follows the mapping fixed in the spec:
 *   product "list"    -> Todoist project
 *   product "group"   -> Todoist section
 *   product "context" -> Todoist workspace
 *   product "tag"     -> Todoist label
 */

/** Todoist stores priority inverted: 4 is the most urgent (P1), 1 the least (P4). */
export type TodoistPriority = 1 | 2 | 3 | 4;
/** The product speaks in P1..P4, which is what the user sees everywhere. */
export type DisplayPriority = 1 | 2 | 3 | 4;

export interface TodoistDue {
  date: string; // "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ss(Z)"
  timezone: string | null;
  string: string;
  lang: string;
  is_recurring: boolean;
}

export interface TodoistDeadline {
  date: string; // always a plain "YYYY-MM-DD"
  lang: string;
}

export interface TodoistDuration {
  amount: number;
  unit: 'minute' | 'day';
}

export interface Item {
  id: string;
  user_id: string;
  project_id: string;
  section_id: string | null;
  parent_id: string | null;
  content: string;
  description: string;
  priority: TodoistPriority;
  due: TodoistDue | null;
  deadline: TodoistDeadline | null;
  duration: TodoistDuration | null;
  labels: string[];
  child_order: number;
  /** Fractional-indexing position among siblings; null until Todoist migrates the task. */
  order_key?: string | null;
  day_order: number;
  collapsed: boolean;
  checked: boolean;
  is_deleted: boolean;
  added_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
  responsible_uid: string | null;
  note_count?: number;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  color: string;
  parent_id: string | null;
  child_order: number;
  /** Fractional-indexing position among siblings; null until migrated, and for workspace projects. */
  order_key?: string | null;
  is_archived: boolean;
  is_deleted: boolean;
  is_favorite: boolean;
  inbox_project?: boolean;
  view_style?: string;
  workspace_id?: string | null;
  /** Todoist folders are projects that hold others rather than tasks. */
  is_folder?: boolean;
  collapsed?: boolean;
}

export interface Section {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  section_order: number;
  /** Fractional-indexing position within the project; null until migrated. */
  order_key?: string | null;
  is_archived: boolean;
  is_deleted: boolean;
  collapsed?: boolean;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  item_order: number;
  /** Fractional-indexing position among labels; null until migrated. */
  order_key?: string | null;
  is_deleted: boolean;
  is_favorite: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  logo_big?: string | null;
}

export interface Collaborator {
  id: string;
  email: string;
  full_name: string;
  image_id: string | null;
}

export interface Note {
  id: string;
  item_id: string | null;
  project_id: string | null;
  content: string;
  posted_at: string;
  posted_uid: string;
  is_deleted: boolean;
  file_attachment: {
    file_name?: string;
    file_type?: string;
    file_url?: string;
    file_size?: number;
  } | null;
}

export interface Reminder {
  id: string;
  item_id: string;
  type: 'relative' | 'absolute' | 'location';
  due: TodoistDue | null;
  minute_offset?: number;
  is_deleted: boolean;
}

export interface TodoistUser {
  id: string;
  email: string;
  full_name: string;
  inbox_project_id: string;
  tz_info: { timezone: string; hours: number; minutes: number; is_dst: number };
  start_day: number; // 1 = Monday .. 7 = Sunday
  premium_status?: string;
  is_premium?: boolean;
  lang?: string;
  image_id?: string | null;
  avatar_big?: string | null;
  karma?: number | null;
  karma_trend?: string | null;
}

/** A completed task as returned by the completed-tasks endpoints. */
export interface CompletedItem {
  id: string;
  task_id?: string;
  user_id: string;
  project_id: string;
  section_id: string | null;
  content: string;
  completed_at: string;
  labels?: string[];
  priority?: TodoistPriority;
  note_count?: number;
}

/** Everything the app keeps about the account, kept in memory and mirrored to IndexedDB. */
export interface Snapshot {
  items: Record<string, Item>;
  projects: Record<string, Project>;
  sections: Record<string, Section>;
  labels: Record<string, Label>;
  workspaces: Record<string, Workspace>;
  collaborators: Record<string, Collaborator>;
  notes: Record<string, Note>;
  reminders: Record<string, Reminder>;
  user: TodoistUser | null;
  syncToken: string;
  syncedAt: number | null;
}

export const emptySnapshot = (): Snapshot => ({
  items: {},
  projects: {},
  sections: {},
  labels: {},
  workspaces: {},
  collaborators: {},
  notes: {},
  reminders: {},
  user: null,
  syncToken: '*',
  syncedAt: null,
});

/** Todoist priority 4 means P1. This converts in both directions. */
export const toDisplayPriority = (p: TodoistPriority): DisplayPriority =>
  (5 - p) as DisplayPriority;
export const toTodoistPriority = (p: DisplayPriority): TodoistPriority =>
  (5 - p) as TodoistPriority;

/**
 * The prefix that makes a task uncompletable in Todoist.
 *
 * https://www.todoist.com/help/todoist/features/create-an-uncompletable-task-in-todoist
 * The main app and website drop the checkbox entirely for a task typed this
 * way, since there is nothing a click on it could do.
 */
export const UNCOMPLETABLE_PREFIX = '* ';

export const isUncompletable = (item: Pick<Item, 'content'>): boolean =>
  item.content.startsWith(UNCOMPLETABLE_PREFIX);

/** Keep the Todoist marker in stored content, but never show it as title text. */
export const displayTaskContent = (item: Pick<Item, 'content'>): string =>
  isUncompletable(item) ? item.content.slice(UNCOMPLETABLE_PREFIX.length) : item.content;

/** The technical labels the product reads. These are never translated. */
export const SYSTEM_LABELS = {
  quick: 'quick',
  automation: 'automation',
  waiting: 'waiting',
} as const;

export const DEFAULT_WEEK_LABEL = 'week';

/**
 * The tag that means "committed to this week, but to no particular day".
 *
 * It is the one system label a board may already be using under another name —
 * plenty of people wrote `this_week` long before this app existed — so it is a
 * value rather than a constant. It lives here, next to the labels it belongs
 * with, instead of being threaded through every pure function that reads it:
 * `bucketOf` is called from a dozen places and none of them has any business
 * knowing about preferences. The store sets it once when preferences load and
 * again whenever the setting changes.
 */
let weekLabelName: string = DEFAULT_WEEK_LABEL;

export const weekLabel = (): string => weekLabelName;

export const setWeekLabel = (name: string): void => {
  weekLabelName = name.trim() || DEFAULT_WEEK_LABEL;
};

export const ESTIMATE_PREFIX = 'est-';

/** The bucket a task falls into, decided by the display-priority rules in the spec. */
export type Bucket = 'overdue' | 'today' | 'upcoming' | 'anytime' | 'someday';

export type ViewId =
  | 'inbox'
  | 'week'
  /** Today on its own, when the sidebar is set to separate it from the week. */
  | 'today'
  | 'upcoming'
  | 'someday'
  | 'review'
  | 'dashboard'
  | 'settings'
  | 'project'
  | 'label'
  | 'labels'
  | 'matrix'
  | 'insights';

export type DisplayMode = 'list' | 'board' | 'focus';

export type GroupKey =
  /** What the page groups by when the user has chosen nothing: sections in a
   *  project, the fixed week layout in My week, flat elsewhere. */
  | 'none'
  | 'scheduled'
  | 'day'
  | 'week'
  | 'month'
  | 'workspace'
  | 'project'
  | 'section'
  | 'priority'
  | 'label'
  | 'estimate';

export type SortKey =
  | 'manual'
  | 'priority'
  | 'due'
  | 'added-desc'
  | 'added-asc'
  | 'alphabetical'
  | 'estimate-asc'
  | 'estimate-desc'
  | 'label';

export interface ViewFilters {
  workspaces: string[];
  projects: string[];
  labels: string[];
  priorities: DisplayPriority[];
  /** null = no estimate filter, true = estimated only, false = unestimated only */
  estimated: boolean | null;
  includeScheduled: boolean;
  showSubtasks: boolean;
  /** A project page only: also lists the project's completed tasks. */
  showCompleted: boolean;
}

export const defaultFilters = (): ViewFilters => ({
  workspaces: [],
  projects: [],
  labels: [],
  priorities: [],
  estimated: null,
  includeScheduled: true,
  showSubtasks: true,
  showCompleted: false,
});

export interface ViewPrefs {
  mode: DisplayMode;
  group: GroupKey;
  sort: SortKey;
  filters: ViewFilters;
}

/**
 * What a page groups by before anyone has chosen anything.
 *
 * `none` is not "flat": in a project it is that project's own sections, which
 * is the grouping a project already has and the one it should open in. The
 * pages that draw from every project have no such structure of their own, and
 * on those the project is the thing a reader is actually looking for — which
 * of my projects is this backlog, this tag, about.
 */
const defaultGroup = (viewKey?: string): GroupKey => {
  if (!viewKey) return 'none';
  if (viewKey === 'someday' || viewKey.startsWith('label:')) return 'project';
  return 'none';
};

/**
 * What a view opens as.
 *
 * Not manual order. Manual is Todoist's `child_order`, and on a list nobody
 * has deliberately arranged that is not an order at all — it is whatever order
 * things were added in, which puts a p1 below three p4s on a page opened to
 * decide what to do next. A view opens by priority; a sort set by hand on a
 * view stays set, and so does the manual order of a page that has been
 * arranged by hand, because dropping a task into a place is itself the act of
 * asking for one.
 */
export const defaultViewPrefs = (viewKey?: string): ViewPrefs => ({
  mode: 'list',
  group: defaultGroup(viewKey),
  sort: 'priority',
  filters: defaultFilters(),
});
