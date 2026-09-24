/** The shape of the store, shared by the slices that build it (see store.ts). */
import type { StateCreator } from 'zustand';
import type { Command } from '@/api/commands';
import type { DisplayPriority, Item, Note, Snapshot, ViewPrefs } from '@/domain/types';
import type { RecurrenceReading } from '@/domain/recurrence';
import type { Locale } from '@/i18n';
import type { DropTarget } from '@/domain/dnd';
import type { Preferences } from './prefs';

export type SyncState = 'idle' | 'loading' | 'syncing' | 'error' | 'offline';

export interface Toast {
  id: string;
  message: string;
  /** When set, the toast offers an undo that runs this. */
  undo?: () => void;
}

/**
 * One step backwards.
 *
 * Every change that could already be undone from its toast is also kept here,
 * so the keyboard reaches what the mouse could: a toast lives eight seconds
 * and a regret often takes longer than that. The stack is shallow on purpose —
 * this is "that was wrong", not a document history — and it is never written
 * to disk, because an undo that outlives the session would be undoing
 * something Todoist may have changed twice over since.
 */
export interface UndoEntry {
  id: string;
  label: string;
  run: () => void | Promise<void>;
}

export interface AppState {
  ready: boolean;
  connected: boolean;
  snapshot: Snapshot;
  prefs: Preferences;
  syncState: SyncState;
  syncError: string | null;
  pendingCount: number;
  toasts: Toast[];
  /** The most recent reversible changes, newest last. */
  undoStack: UndoEntry[];
  /** The task currently being dragged, so empty drop zones can reveal themselves. */
  draggingTaskId: string | null;
  /** True while a made-up account is loaded; nothing is sent to Todoist. */
  demo: boolean;
  /**
   * Every temporary id Todoist has resolved this session, to the real one.
   *
   * Things created before Todoist answered are drawn under a temporary id, and
   * a panel or an address may still be holding it when the answer lands —
   * after reconnecting, most of all. They look the real one up here.
   */
  resolvedIds: Record<string, string>;
  /** Why the last "Continue with Todoist" did not end signed in, for the connect screen. */
  signInError: 'denied' | 'failed' | null;

  /* Lifecycle */
  init: () => Promise<void>;
  connect: (token: string) => Promise<boolean>;
  startDemo: () => void;
  disconnect: () => Promise<void>;
  refresh: (full?: boolean) => Promise<void>;
  startPolling: () => () => void;

  /* Preferences */
  setPrefs: (patch: Partial<Preferences>) => void;
  setViewPrefs: (viewKey: string, patch: Partial<ViewPrefs>) => void;
  setLocale: (locale: Locale) => void;
  /** Creates or updates the hidden Todoist task that is canonical for preferences. */
  /**
   * Writes the settings to their Inbox comment. `localChange` says the call
   * follows a change made here, which then wins over a comment found late.
   */
  ensurePreferencesTask: (localChange?: boolean) => Promise<void>;
  beginTourPreview: () => void;
  endTourPreview: () => void;

  /* Mutations */
  /**
   * Returns the id each temp id it sent resolved to — empty in demo mode, in
   * offline mode, and on refusal, where nothing was ever assigned one.
   */
  apply: (
    commands: Command[], optimistic: (snapshot: Snapshot) => Snapshot,
  ) => Promise<Record<string, string>>;
  /**
   * Whether the first-run dialog is up.
   *
   * In the store rather than in App because two very different things open
   * it: connecting an account that has never seen it, and asking for it again
   * from Settings, which is three components away.
   */
  walkthrough: boolean;
  setWalkthrough: (open: boolean) => void;
  updateTask: (id: string, args: Record<string, unknown>) => Promise<void>;
  /** Gives a task a repeat rule, leaving the date for Todoist to resolve. */
  /* Takes the rule and the language it was written in, which is all Todoist
     needs: where the reading came from is the caller's business. */
  setRecurrence: (id: string, rule: Pick<RecurrenceReading, 'string' | 'lang'>) => Promise<void>;
  /**
   * Writes several estimates at once, as one request.
   *
   * Filling in a page's missing estimates is a single act, so it costs a
   * single round trip and undoes as a single mistake.
   */
  setEstimates: (entries: Array<{ id: string; minutes: number }>) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  /**
   * Ticks several tasks off as one act: one request, one toast and one undo
   * that puts them all back. A recurring task rolls on to its next date.
   */
  completeTasks: (ids: string[]) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  /** Deletes several tasks as one act, with one undo that puts them all back. */
  removeTasks: (ids: string[]) => Promise<void>;
  /**
   * Writes deleted tasks back, subtrees included, with their comments. They
   * come back under new ids: this is the undo for a deletion already sent.
   */
  restoreTasks: (items: Item[], notes?: Note[]) => Promise<void>;
  /** Sends several tasks to the same destination, as one change and one undo. */
  sendManyTo: (ids: string[], target: DropTarget, destination: string | null) => Promise<void>;
  /**
   * The same field change across a selection.
   *
   * The fields are computed per task rather than passed once, because the
   * useful bulk edits are relative to what each task already carries —
   * dropping a tag is a different list for every task in the set. What is
   * overwritten is read back first, so the whole pass is one undo.
   */
  updateMany: (
    ids: string[],
    fieldsFor: (item: Item) => Record<string, unknown> | null,
    message: string,
  ) => Promise<void>;
  /** Moves a selection into a project or one of its sections, as one change and one undo. */
  moveMany: (
    ids: string[],
    target: { project_id: string; section_id: string | null },
    destination: string,
  ) => Promise<void>;
  createTask: (args: Record<string, unknown>) => Promise<void>;
  moveTask: (id: string, target: { project_id?: string; section_id?: string | null }) => Promise<void>;
  /**
   * Sends a task to a destination, by the same table drag and drop uses.
   *
   * One rule for "make this today" wherever it is asked for, and one undo.
   */
  sendTo: (id: string, target: DropTarget, destination: string | null) => Promise<void>;
  setTaskLabels: (id: string, labels: string[]) => Promise<void>;
  setTaskPriority: (id: string, priority: DisplayPriority) => Promise<void>;
  setLabelFavourite: (id: string, favourite: boolean) => Promise<void>;
  /**
   * Creates a tag.
   *
   * Todoist will accept a label name on a task it has never seen, but the tag
   * only becomes a thing you can find, colour and favourite once it exists as
   * a label of its own — so it is created outright rather than left implied.
   */
  createLabel: (name: string, color?: string) => Promise<void>;
  /** Puts the tags in this order, which is also the order of the sidebar's favourites. */
  reorderLabels: (ids: string[]) => Promise<void>;
  /**
   * Puts these projects in this order.
   *
   * The ids are one set of siblings — the same parent, the same workspace —
   * because child_order only means anything inside one. Moving a project to a
   * different parent or workspace is a different act and is not this.
   */
  reorderProjects: (ids: string[]) => Promise<void>;
  /** Puts a parent's subtasks in the given order. */
  reorderSubtasks: (ids: string[]) => Promise<void>;
  /**
   * Puts a project inside another one, or back at the top level.
   *
   * Todoist nests projects, and the sidebar has always drawn the nesting; what
   * was missing was any way to make it from here. Passing null lifts the
   * project back out to the root of its workspace.
   */
  nestProject: (id: string, parentId: string | null) => Promise<void>;
  skipOccurrence: (id: string) => Promise<void>;
  /** Advances every recurring task in a mixed selection, leaving one-off tasks alone. */
  skipOccurrences: (ids: string[]) => Promise<number>;
  /**
   * Creates a project, in a workspace when one is named and personal when
   * not. Returns the id it ends up under once the round trip settles — the
   * temp id it was optimistically created with, resolved to Todoist's real
   * one where a sync happened at all.
   */
  createProject: (
    name: string,
    color: string,
    workspaceId?: string | null,
    /** Places the new project next to an existing one instead of at the end. */
    anchor?: { siblingId: string; position: 'above' | 'below' } | null,
    /** The rest of what the sheet asks for, so creating and editing match. */
    extra?: { description?: string; favourite?: boolean },
  ) => Promise<string>;
  /** Puts a project out of sight without destroying it. Todoist keeps the tasks. */
  archiveProject: (id: string) => Promise<void>;
  /** Deletes a project and everything in it. Todoist holds it for seven days. */
  deleteProject: (id: string) => Promise<void>;
  /**
   * Copies a project: its sections, and the open tasks inside them.
   *
   * Completed tasks, comments and history stay with the original — a copy is a
   * new start on the same shape of work, not a second record of the old one.
   */
  duplicateProject: (id: string, name: string) => Promise<void>;
  updateProjectFields: (id: string, args: Record<string, unknown>) => Promise<void>;
  updateSectionFields: (id: string, args: Record<string, unknown>) => Promise<void>;
  /** Creates a section at `index` and hands back its id, so the caller can focus its name. */
  createSection: (projectId: string, index: number) => Promise<string>;
  /** Moves a section, and the tasks in it, to a new position in its project. */
  moveSection: (id: string, index: number) => Promise<void>;
  /** Deletes a section. Todoist deletes the tasks inside it with it. */
  removeSection: (id: string) => Promise<void>;

  /* Toasts */
  toast: (message: string, undo?: () => void) => void;
  dismissToast: (id: string) => void;

  /* Undo */
  /** Records a step backwards without showing a toast for it. */
  pushUndo: (label: string, run: () => void | Promise<void>) => void;
  /** Runs the newest undoable change backwards. Does nothing when there is none. */
  undo: () => Promise<void>;
  /** Runs one particular entry, by id, and takes it off the stack. */
  consumeUndo: (id: string) => Promise<void>;
  setDragging: (id: string | null) => void;
  /** True while a dragged sidebar project or task would nest rather than reorder. */
  nesting: boolean;
  setNesting: (nesting: boolean) => void;
  /** True while a dragged subtask has been pulled out far enough to leave its parent. */
  outdenting: boolean;
  setOutdenting: (outdenting: boolean) => void;
  /** The sidebar project in flight, so folders can offer themselves. */
  draggingProjectId: string | null;
  setDraggingProject: (id: string | null) => void;
  /** The tag being carried, by name, or null. */
  draggingTag: string | null;
  setDraggingTag: (name: string | null) => void;

  /**
   * The tasks picked out for a change made to all of them at once.
   *
   * Held in the store rather than in a page, because the bar that acts on the
   * selection is part of the shell and the rows that join it are several
   * components deep inside a view.
   */
  selection: string[];
  /** The endpoint the next Shift selection starts from. */
  selectionAnchor: string | null;
  toggleSelection: (id: string) => void;
  setSelectionAnchor: (id: string) => void;
  selectRange: (ids: string[], additive: boolean) => void;
  clearSelection: () => void;
  /** The section currently in flight, so the slots between sections can open up. */
  draggingSectionId: string | null;
  setDraggingSection: (id: string | null) => void;
}

/** One slice of the store: its part of the state, built with the whole store's `set` and `get`. */
export type Slice<T> = StateCreator<AppState, [], [], T>;

export type SyncSlice = Pick<AppState, 'ready' | 'connected' | 'snapshot' | 'syncState' | 'syncError' | 'pendingCount' | 'demo' | 'resolvedIds' | 'signInError' | 'init' | 'connect' | 'startDemo' | 'disconnect' | 'refresh' | 'startPolling' | 'apply'>;
export type PreferencesSlice = Pick<AppState, 'prefs' | 'walkthrough' | 'setPrefs' | 'setViewPrefs' | 'setLocale' | 'ensurePreferencesTask' | 'beginTourPreview' | 'endTourPreview' | 'setWalkthrough'>;
export type TasksSlice = Pick<AppState, 'updateTask' | 'setRecurrence' | 'setEstimates' | 'toggleTask' | 'completeTasks' | 'removeTask' | 'removeTasks' | 'restoreTasks' | 'createTask' | 'setTaskLabels' | 'setTaskPriority' | 'skipOccurrence' | 'skipOccurrences' | 'reorderSubtasks'>;
export type TasksMoveSlice = Pick<AppState, 'sendTo' | 'sendManyTo' | 'updateMany' | 'moveMany' | 'moveTask'>;
export type StructureSlice = Pick<AppState, 'createLabel' | 'setLabelFavourite' | 'reorderLabels' | 'reorderProjects' | 'nestProject' | 'createProject' | 'archiveProject' | 'deleteProject' | 'duplicateProject' | 'updateProjectFields' | 'createSection' | 'moveSection' | 'removeSection' | 'updateSectionFields'>;
export type UiSlice = Pick<AppState, 'toasts' | 'undoStack' | 'draggingTaskId' | 'draggingSectionId' | 'nesting' | 'outdenting' | 'draggingProjectId' | 'draggingTag' | 'selection' | 'selectionAnchor' | 'toast' | 'dismissToast' | 'pushUndo' | 'undo' | 'consumeUndo' | 'setDraggingSection' | 'setDraggingTag' | 'setNesting' | 'setOutdenting' | 'setDraggingProject' | 'toggleSelection' | 'setSelectionAnchor' | 'selectRange' | 'clearSelection' | 'setDragging'>;
