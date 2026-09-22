import { create } from 'zustand';
import { auth } from '@/api/auth';
import { ApiError, NotConnectedError } from '@/api/client';
import { applySync, sync } from '@/api/sync';
import {
  sendCommands, command, type Command,
  addItem, completeItem, deleteItem, moveItem, newUuid, reorderItems,
  uncompleteItem, updateItem,
} from '@/api/commands';
import * as idb from '@/db/idb';
import {
  emptySnapshot, isUncompletable, setWeekLabel, toTodoistPriority,
  type DisplayPriority, type Item, type Snapshot, type ViewPrefs,
} from '@/domain/types';
import { withEstimate } from '@/domain/estimates';
import { toApiDate } from '@/domain/dates';
import type { RecurrenceReading } from '@/domain/recurrence';
import { detectLocale, translate, type Locale } from '@/i18n';
import { dropMutation, moveArgs, type DropTarget } from '@/domain/dnd';
import { patchParent } from '@/domain/order';
import { buildDemoSnapshot } from '@/demo/demoData';
import {
  defaultPreferences, hydratePreferences, viewPrefs as readViewPrefs,
  PREFERENCES_TASK_CONTENT,
  type Preferences,
} from './prefs';

/**
 * A due the rest of the app can read.
 *
 * A recurrence is sent to Todoist as a rule with no date on it, on purpose.
 * The row the app draws in the meantime still has to have one, so today fills
 * in until the sync response says where the rule actually landed. Nothing is
 * sent anywhere from here: this value never leaves the local snapshot.
 */
const provisionalDue = (due: Item['due'] | undefined): Item['due'] => {
  if (!due) return null;
  if (due.date) return due;
  return { ...due, date: toApiDate(new Date()), timezone: due.timezone ?? null };
};

/**
 * The position a new task takes among the ones it is joining.
 *
 * Todoist appends, so the optimistic row has to append too — a row that draws
 * itself at the top and is corrected a moment later reads as a bug even when
 * the result is right.
 */
function nextChildOrder(
  snapshot: Snapshot,
  parentId: string | null,
  projectId: string,
  sectionId: string | null,
): number {
  const siblings = Object.values(snapshot.items).filter((item) => {
    if (item.is_deleted) return false;
    if (parentId) return item.parent_id === parentId;
    return !item.parent_id && item.project_id === projectId
      && (item.section_id ?? null) === sectionId;
  });
  return siblings.reduce((top, item) => Math.max(top, item.child_order), 0) + 1;
}

const PREFS_KEY = 'preferences';
/** How often the app asks Todoist what changed while the tab is in the foreground. */
const POLL_INTERVAL_MS = 45_000;
let preferencesWriteTimer: number | null = null;
let creatingPreferencesTask = false;
let tourSnapshotBackup: Snapshot | null = null;

function schedulePreferencesWrite(get: () => AppState) {
  if (!get().connected || get().demo) return;
  if (preferencesWriteTimer) window.clearTimeout(preferencesWriteTimer);
  preferencesWriteTimer = window.setTimeout(() => {
    preferencesWriteTimer = null;
    void get().ensurePreferencesTask();
  }, 300);
}

function remotePreferences(snapshot: Snapshot, locale: Locale): Preferences | null {
  const marker = Object.values(snapshot.items).find(
    (item) => !item.is_deleted && item.content === PREFERENCES_TASK_CONTENT,
  );
  if (!marker?.description.trim()) return null;
  try {
    return hydratePreferences(JSON.parse(marker.description), locale);
  } catch {
    return null;
  }
}

/** Demo data cannot ask Todoist to resolve recurrence, so cover the ordinary
 * daily and weekly rules used by the demo without inventing a general parser. */
function advanceDemoRecurrence(snapshot: Snapshot, id: string): Snapshot {
  const item = snapshot.items[id];
  if (!item?.due?.is_recurring) return snapshot;
  const current = new Date(`${item.due.date.slice(0, 10)}T12:00:00`);
  const rule = item.due.string.toLowerCase();
  const days = /(?:every day|daily|chaque jour|quotidien)/.test(rule) ? 1
    : /(?:every week|weekly|every (?:mon|tue|wed|thu|fri|sat|sun)|chaque semaine|tous les|hebdomadaire)/.test(rule) ? 7
      : 1;
  current.setDate(current.getDate() + days);
  return patchItem(snapshot, id, {
    due: { ...item.due, date: current.toISOString().slice(0, 10) },
    checked: false,
  });
}

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

const UNDO_DEPTH = 25;

interface AppState {
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
  ensurePreferencesTask: () => Promise<void>;
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
  removeTask: (id: string) => Promise<void>;
  /** Deletes several tasks as one act, with one undo that puts them all back. */
  removeTasks: (ids: string[]) => Promise<void>;
  /** Writes deleted tasks back, subtrees included. They come back under new ids. */
  restoreTasks: (items: Item[]) => Promise<void>;
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

/** Writes the snapshot to the device without blocking the interface. */
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(snapshot: Snapshot) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void idb.saveSnapshot(snapshot), 400);
}


/**
 * What to say when Todoist refuses a change.
 *
 * Nearly every refusal a person will meet here is an account limit: a free
 * plan allows five active projects, and the caps on sections, tags,
 * collaborators and comments work the same way. Todoist answers with a short
 * English sentence, which is accurate and says nothing about what to do, so a
 * limit gets the sentence plus the one thing worth knowing — that the change
 * did not happen, and where the limit lives. Anything else is passed through
 * as Todoist worded it rather than guessed at.
 */
function explainFailure(error: string, locale: Locale): string {
  const limit = /limit|maximum|quota|exceed|reached|too many/i.test(error);
  const said = error.trim() || (locale === 'fr' ? 'Todoist a refusé' : 'Todoist refused it');
  if (!limit) {
    return locale === 'fr'
      ? `Todoist a refusé : ${said}. La modification n’a pas été enregistrée.`
      : `Todoist refused this: ${said}. The change was not saved.`;
  }
  return locale === 'fr'
    ? `${said} — c’est une limite de votre compte ou de votre espace de travail Todoist, pas de cette application. La modification n’a pas été enregistrée.`
    : `${said} — this is a limit on your Todoist account or workspace, not on this app. The change was not saved.`;
}

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  connected: false,
  walkthrough: false,
  snapshot: emptySnapshot(),
  prefs: defaultPreferences(detectLocale()),
  syncState: 'idle',
  syncError: null,
  pendingCount: 0,
  toasts: [],
  undoStack: [],
  draggingTaskId: null,
  draggingSectionId: null,
  nesting: false,
  outdenting: false,
  draggingProjectId: null,
  draggingTag: null,
  selection: [],
  selectionAnchor: null,
  demo: false,

  async init() {
    const [storedPrefs, snapshot, queue] = await Promise.all([
      idb.loadPrefs<Preferences>(PREFS_KEY),
      idb.loadSnapshot(),
      idb.readQueue(),
    ]);

    const prefs = hydratePreferences(storedPrefs, detectLocale());
    /* The rules that read the week tag are pure functions called from
       everywhere; they are told the name once, here, rather than being handed
       preferences they have no other use for. */
    setWeekLabel(prefs.weekLabel);
    const connected = auth.isConnected();
    const resumeDemo = !connected && sessionStorage.getItem('demo') === '1';

    // Show the cached copy immediately, then reconcile with Todoist.
    set({
      prefs,
      snapshot: resumeDemo ? buildDemoSnapshot(prefs.locale) : snapshot,
      connected: connected || resumeDemo,
      demo: resumeDemo,
      ready: true,
      pendingCount: queue.length,
    });

    if (connected) {
      void get().refresh(snapshot.syncToken === '*');
    }
  },

  async connect(token: string) {
    set({ syncState: 'loading', syncError: null });
    await auth.set(token);
    try {
      const response = await sync('*');
      const snapshot = applySync(emptySnapshot(), response);
      const canonical = remotePreferences(snapshot, get().prefs.locale);
      if (canonical) setWeekLabel(canonical.weekLabel);
      set({ connected: true, snapshot, prefs: canonical ?? get().prefs, syncState: 'idle' });
      void idb.saveSnapshot(snapshot);
      if (canonical) void idb.savePrefs(PREFS_KEY, canonical);
      else window.setTimeout(() => void get().ensurePreferencesTask(), 0);
      return true;
    } catch (error) {
      await auth.disconnect();
      set({
        connected: false,
        syncState: 'error',
        syncError: error instanceof ApiError && error.isAuthError ? 'invalid' : 'offline',
      });
      return false;
    }
  },

  startDemo() {
    sessionStorage.setItem('demo', '1');
    set({
      demo: true,
      connected: true,
      ready: true,
      syncState: 'idle',
      snapshot: buildDemoSnapshot(get().prefs.locale),
      pendingCount: 0,
    });
  },

  async disconnect() {
    sessionStorage.removeItem('demo');
    await auth.disconnect();
    await idb.clearAll();
    set({
      connected: false,
      demo: false,
      snapshot: emptySnapshot(),
      prefs: defaultPreferences(get().prefs.locale),
      pendingCount: 0,
      syncState: 'idle',
    });
  },

  async refresh(full = false) {
    if (get().demo) return;
    if (tourSnapshotBackup) return;
    if (!auth.isConnected()) return;
    if (get().syncState === 'syncing') return;

    set({ syncState: 'syncing', syncError: null });

    try {
      // Anything queued offline goes out first, so the server state the app
      // reads back already includes it and cannot overwrite it.
      await flushQueue(get, set);

      const token = full ? '*' : get().snapshot.syncToken;
      const response = await sync(token);
      const snapshot = applySync(full ? emptySnapshot() : get().snapshot, response);
      const canonical = preferencesWriteTimer
        ? null
        : remotePreferences(snapshot, get().prefs.locale);
      if (canonical) setWeekLabel(canonical.weekLabel);
      set({ snapshot, prefs: canonical ?? get().prefs, syncState: 'idle' });
      schedulePersist(snapshot);
      if (canonical) void idb.savePrefs(PREFS_KEY, canonical);
      else window.setTimeout(() => void get().ensurePreferencesTask(), 0);
    } catch (error) {
      if (error instanceof NotConnectedError) {
        set({ connected: false, syncState: 'idle' });
        return;
      }
      const offline = !navigator.onLine || !(error instanceof ApiError);
      set({
        syncState: offline ? 'offline' : 'error',
        syncError: error instanceof Error ? error.message : 'unknown',
      });
      if (error instanceof ApiError && error.isAuthError) {
        set({ connected: false });
        await auth.disconnect();
      }
    }
  },

  startPolling() {
    const tick = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void get().refresh();
    };
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    // Coming back to the tab or back online is the moment the user most
    // expects to see fresh data, so both trigger an immediate read.
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('online', tick);
    window.addEventListener('focus', tick);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('online', tick);
      window.removeEventListener('focus', tick);
    };
  },

  setPrefs(patch) {
    const prefs = { ...get().prefs, ...patch };
    if (patch.weekLabel !== undefined) setWeekLabel(prefs.weekLabel);
    set({ prefs });
    void idb.savePrefs(PREFS_KEY, prefs);
    schedulePreferencesWrite(get);
  },

  setViewPrefs(viewKey, patch) {
    const current = readViewPrefs(get().prefs, viewKey);
    const prefs = {
      ...get().prefs,
      views: { ...get().prefs.views, [viewKey]: { ...current, ...patch } },
    };
    set({ prefs });
    void idb.savePrefs(PREFS_KEY, prefs);
    schedulePreferencesWrite(get);
  },

  setLocale(locale) {
    get().setPrefs({ locale });
    document.documentElement.lang = locale;
    // The demo account is written in the interface language, so switching
    // language rebuilds it rather than leaving half the screen translated.
    if (get().demo) set({ snapshot: buildDemoSnapshot(locale) });
  },

  async ensurePreferencesTask() {
    if (!get().connected || get().demo || creatingPreferencesTask) return;
    creatingPreferencesTask = true;
    try {
      const description = JSON.stringify(get().prefs, null, 2);
      const inbox = get().snapshot.user?.inbox_project_id;
      if (!inbox) return;

      const marker = Object.values(get().snapshot.items).find(
        (item) => !item.is_deleted && item.content === PREFERENCES_TASK_CONTENT,
      );
      if (marker) {
        if (marker.project_id !== inbox) {
          await get().moveTask(marker.id, { project_id: inbox });
        }
        if (marker.description !== description) {
          await get().updateTask(marker.id, { description });
        }
      } else {
        await get().createTask({
          content: PREFERENCES_TASK_CONTENT,
          description,
          project_id: inbox,
        });
      }
    } finally {
      creatingPreferencesTask = false;
    }
  },

  beginTourPreview() {
    if (get().demo || tourSnapshotBackup) return;
    tourSnapshotBackup = get().snapshot;
    set({ snapshot: buildDemoSnapshot(get().prefs.locale) });
  },

  endTourPreview() {
    if (!tourSnapshotBackup) return;
    const snapshot = tourSnapshotBackup;
    tourSnapshotBackup = null;
    set({ snapshot });
  },

  /**
   * Applies a change everywhere at once: on screen immediately, in the outbox
   * so it survives a reload, and at Todoist. A failure rolls the screen back
   * rather than leaving it showing something Todoist never accepted.
   */
  async apply(commands, optimistic) {
    const before = get().snapshot;
    const after = optimistic(before);

    if (get().demo) {
      // A demo account is a sandbox: changes show, and stop there.
      set({ snapshot: after });
      return {};
    }

    set({ snapshot: after });
    schedulePersist(after);

    await idb.enqueue(commands);
    set({ pendingCount: get().pendingCount + commands.length });

    if (!navigator.onLine) {
      set({ syncState: 'offline' });
      return {};
    }

    try {
      const { response, failures } = await sendCommands(after.syncToken, commands);
      let merged = applySync(get().snapshot, response);

      // Todoist returns the real id for each temp id it accepted. The
      // placeholder must go, or the created task shows twice.
      const mapping = response.temp_id_mapping ?? {};
      const tempIds = Object.keys(mapping);
      if (tempIds.length > 0) {
        const items = { ...merged.items };
        const projects = { ...merged.projects };
        const sections = { ...merged.sections };
        const labels = { ...merged.labels };
        for (const tempId of tempIds) {
          delete items[tempId];
          delete projects[tempId];
          // Sections and labels are created under a temp id too, and a
          // placeholder left behind is a second copy on screen.
          delete sections[tempId];
          delete labels[tempId];
        }
        merged = { ...merged, items, projects, sections, labels };
      }

      set({ snapshot: merged, syncState: 'idle' });
      schedulePersist(merged);

      await idb.dequeue(commands.map((c) => c.uuid));
      set({ pendingCount: Math.max(0, get().pendingCount - commands.length) });

      if (failures.length > 0) {
        set({ snapshot: before });
        schedulePersist(before);
        get().toast(explainFailure(failures[0].error, get().prefs.locale));
        return {};
      }
      return mapping;
    } catch (error) {
      if (error instanceof ApiError && error.isRefusal) {
        /* Todoist refused the change outright. The screen must not keep it,
           the queue must not keep retrying it, and — the part that was missing
           — the person who asked for it has to be told. A change that vanishes
           without a word is indistinguishable from one that never registered
           the click. */
        set({ snapshot: before, syncState: 'idle' });
        schedulePersist(before);
        await idb.dequeue(commands.map((c) => c.uuid));
        set({ pendingCount: Math.max(0, get().pendingCount - commands.length) });
        get().toast(explainFailure(error.detail, get().prefs.locale));
      } else {
        // Network trouble: the change stays queued and goes out on the next sync.
        set({ syncState: 'offline' });
      }
      return {};
    }
  },

  setWalkthrough(open) { set({ walkthrough: open }); },

  async updateTask(id, args) {
    await get().apply([updateItem(id, args)], (snapshot) => patchItem(snapshot, id, args));
  },

  /**
   * Gives a task a repeat rule.
   *
   * Two different objects, deliberately. What goes to Todoist is the rule and
   * nothing else, because Todoist resolves where the rule lands and a date
   * sent from here would pin the first occurrence to this device's guess at
   * it. What goes into the local snapshot has to be a complete due all the
   * same — every list in the app reads `due.date`, and one without it takes
   * the page down — so it keeps the date the task is already sitting on until
   * the sync response arrives with the one the rule really resolves to.
   */
  async setRecurrence(id, rule) {
    const item = get().snapshot.items[id];
    if (!item) return;

    const due = { string: rule.string, lang: rule.lang, is_recurring: true };
    const local = {
      due: {
        ...due,
        date: item.due?.date ?? toApiDate(new Date()),
        timezone: item.due?.timezone ?? null,
      },
    };

    await get().apply([updateItem(id, { due })], (snapshot) => patchItem(snapshot, id, local));
    // Only Todoist knows the date the rule resolves to; this is how it arrives.
    await get().refresh();
  },

  async setEstimates(entries) {
    const snapshot = get().snapshot;
    const changes = entries
      .map(({ id, minutes }) => {
        const item = snapshot.items[id];
        return item ? { id, labels: withEstimate(item.labels, minutes) } : null;
      })
      .filter((change): change is { id: string; labels: string[] } => change !== null);

    if (changes.length === 0) return;

    await get().apply(
      changes.map(({ id, labels }) => updateItem(id, { labels })),
      (current) =>
        changes.reduce((acc, { id, labels }) => patchItem(acc, id, { labels }), current),
    );
  },

  async toggleTask(id) {
    const item = get().snapshot.items[id];
    if (!item || isUncompletable(item)) return;

    /* `item_close` is Todoist's official recurrence-aware completion command.
       Todoist computes the next date from the rule; sending the current due
       back through item_update_date_complete made the old occurrence bounce
       between dates and occasionally remain checked. */
    if (!item.checked && item.due?.is_recurring) {
      const demo = get().demo;
      await get().apply([command('item_close', { id })], (snapshot) =>
        demo ? advanceDemoRecurrence(snapshot, id) : patchItem(snapshot, id, { checked: true }));
      await get().refresh(true);
      return;
    }
    const checked = !item.checked;
    const cmd = checked ? completeItem(id) : uncompleteItem(id);
    await get().apply([cmd], (snapshot) => patchItem(snapshot, id, { checked }));

    /* No toast: ticking something off is the most common act in the app and a
       message after every one would be a message after everything. It is still
       the thing people most often wish they could take back, so the step is
       recorded and Cmd+Z reaches it. */
    get().pushUndo(item.content, async () => {
      const back = checked ? uncompleteItem(id) : completeItem(id);
      await get().apply([back], (snapshot) => patchItem(snapshot, id, { checked: !checked }));
    });
  },

  async removeTask(id) {
    await get().removeTasks([id]);
  },

  /**
   * Deletes tasks, and offers them back.
   *
   * Todoist has no undelete: the only way back is to write the task again, so
   * everything worth keeping is read out of the snapshot before the delete
   * goes out. Subtasks go with their parent when Todoist deletes it, so they
   * are captured and rebuilt too — a restored task with its children missing
   * would be a worse answer than no undo at all. The rebuilt tasks carry new
   * ids, which is the one thing an undo here cannot preserve.
   */
  async removeTasks(ids) {
    const snapshot = get().snapshot;
    const wanted = ids.filter((id) => snapshot.items[id]);
    if (wanted.length === 0) return;

    // Every descendant, so the whole branch comes back rather than its top.
    const doomed: Item[] = [];
    const walk = (parentId: string) => {
      for (const item of Object.values(snapshot.items)) {
        if (item.parent_id === parentId && !item.is_deleted) {
          doomed.push(item);
          walk(item.id);
        }
      }
    };
    for (const id of wanted) {
      doomed.push(snapshot.items[id]);
      walk(id);
    }

    await get().apply(wanted.map(deleteItem), (current) => {
      const items = { ...current.items };
      for (const item of doomed) delete items[item.id];
      return { ...current, items };
    });

    const label = wanted.length === 1
      ? translate(get().prefs.locale, 'task.deletedOne', { name: snapshot.items[wanted[0]].content })
      : translate(get().prefs.locale, 'task.deletedMany', { count: wanted.length });

    get().toast(label, () => void get().restoreTasks(doomed));
  },

  async restoreTasks(items) {
    if (items.length === 0) return;

    /* Parents first, so a child's new parent id is known — or at least sent as
       a temp id in the same call, which Todoist resolves inside one request. */
    const tempIds = new Map(items.map((item) => [item.id, newUuid()]));
    const ordered = [...items].sort((a, b) => {
      if (a.parent_id === b.id) return 1;
      if (b.parent_id === a.id) return -1;
      return 0;
    });

    const commands = ordered.map((item) => addItem({
      content: item.content,
      description: item.description || undefined,
      project_id: item.project_id,
      section_id: item.section_id ?? undefined,
      parent_id: item.parent_id ? (tempIds.get(item.parent_id) ?? item.parent_id) : undefined,
      priority: item.priority,
      labels: item.labels,
      due: item.due ?? undefined,
      deadline: item.deadline ?? undefined,
      child_order: item.child_order,
    }, tempIds.get(item.id)!));

    await get().apply(commands, (current) => {
      const restored = { ...current.items };
      for (const item of ordered) {
        const tempId = tempIds.get(item.id)!;
        restored[tempId] = {
          ...item,
          id: tempId,
          parent_id: item.parent_id ? (tempIds.get(item.parent_id) ?? item.parent_id) : null,
        };
      }
      return { ...current, items: restored };
    });
  },

  async sendTo(id, target, destination) {
    const item = get().snapshot.items[id];
    if (!item) return;
    const mutation = dropMutation(item, target);
    if (!mutation) return;

    // Captured before the change so the undo can put every field back.
    const before = {
      due: item.due,
      labels: item.labels,
      project_id: item.project_id,
      section_id: item.section_id,
    };
    const patch = (fields: Record<string, unknown>) => (snapshot: Snapshot): Snapshot => {
      const current = snapshot.items[id];
      if (!current) return snapshot;
      return { ...snapshot, items: { ...snapshot.items, [id]: { ...current, ...fields } } };
    };

    if (mutation.update) {
      await get().apply([updateItem(id, mutation.update)], patch(mutation.update));
    } else if (mutation.move) {
      await get().apply([moveItem(id, mutation.move)], patch(mutation.move));
    }

    /* A null destination asks for no toast. In a review the row answering the
       question is the feedback — it leaves the list, or its button lights up —
       and a message about a change you can see is a message in the way. */
    if (destination === null) return;
    get().toast(
      translate(get().prefs.locale, 'task.movedTo', { destination }),
      () => void get().apply([updateItem(id, before)], patch(before)),
    );
  },

  /**
   * The same destination, for a set of tasks.
   *
   * One request, one toast and one undo: a selection you moved on purpose is a
   * single decision, and taking it back a task at a time would be absurd.
   */
  async sendManyTo(ids, target, destination) {
    const snapshot = get().snapshot;
    const changes = ids
      .map((id) => {
        const item = snapshot.items[id];
        if (!item) return null;
        const mutation = dropMutation(item, target);
        if (!mutation?.update) return null;
        return {
          id,
          update: mutation.update,
          before: { due: item.due, labels: item.labels },
        };
      })
      .filter((change): change is NonNullable<typeof change> => change !== null);

    if (changes.length === 0) return;

    const patchAll = (
      fields: (change: (typeof changes)[number]) => Record<string, unknown>,
    ) => (current: Snapshot): Snapshot =>
      changes.reduce((acc, change) => patchItem(acc, change.id, fields(change)), current);

    await get().apply(
      changes.map((change) => updateItem(change.id, change.update)),
      patchAll((change) => change.update),
    );

    if (destination === null) return;
    get().toast(
      translate(get().prefs.locale, 'task.movedManyTo', {
        count: changes.length, destination,
      }),
      () => void get().apply(
        changes.map((change) => updateItem(change.id, change.before)),
        patchAll((change) => change.before as unknown as Record<string, unknown>),
      ),
    );
  },

  async updateMany(ids, fieldsFor, message) {
    const snapshot = get().snapshot;
    const changes = ids
      .map((id) => {
        const item = snapshot.items[id];
        if (!item) return null;
        const update = fieldsFor(item);
        if (!update) return null;
        // Only the keys being written, so the undo puts back what was taken
        // and touches nothing a sync may have changed in the meantime.
        const before = Object.fromEntries(
          Object.keys(update).map((key) => [key, (item as unknown as Record<string, unknown>)[key]]),
        );
        return { id, update, before };
      })
      .filter((change): change is NonNullable<typeof change> => change !== null);

    if (changes.length === 0) return;

    const patchAll = (
      fields: (change: (typeof changes)[number]) => Record<string, unknown>,
    ) => (current: Snapshot): Snapshot =>
      changes.reduce((acc, change) => patchItem(acc, change.id, fields(change)), current);

    await get().apply(
      changes.map((change) => updateItem(change.id, change.update)),
      patchAll((change) => change.update),
    );

    get().toast(message, () => void get().apply(
      changes.map((change) => updateItem(change.id, change.before)),
      patchAll((change) => change.before),
    ));
  },

  /**
   * A selection, into a project.
   *
   * `item_move` rather than `item_update`: a project is where a task lives,
   * not a field on it, and the section has to go with it — a section id from
   * the old project would leave the task in a place its new project has no
   * name for.
   */
  async moveMany(ids, target, destination) {
    const snapshot = get().snapshot;
    const changes = ids
      .map((id) => {
        const item = snapshot.items[id];
        if (!item || (item.project_id === target.project_id
          && (item.section_id ?? null) === target.section_id)) return null;
        return {
          id,
          before: { project_id: item.project_id, section_id: item.section_id },
        };
      })
      .filter((change): change is NonNullable<typeof change> => change !== null);

    if (changes.length === 0) return;

    const patchAll = (
      fields: (change: (typeof changes)[number]) => Record<string, unknown>,
    ) => (current: Snapshot): Snapshot =>
      changes.reduce((acc, change) => patchItem(acc, change.id, fields(change)), current);

    await get().apply(
      changes.map((change) => moveItem(change.id, moveArgs(target))),
      patchAll(() => ({
        project_id: target.project_id,
        section_id: target.section_id,
      })),
    );

    get().toast(
      translate(get().prefs.locale, 'task.movedManyTo', {
        count: changes.length, destination,
      }),
      () => void get().apply(
        changes.map((change) => moveItem(change.id, {
          project_id: change.before.project_id,
          section_id: change.before.section_id,
        })),
        patchAll((change) => change.before as unknown as Record<string, unknown>),
      ),
    );
  },

  async createTask(args) {
    const tempId = newUuid();
    // The task appears at once under a temporary id; the sync response that
    // follows carries the real one and replaces it.
    const optimisticItem: Item = {
      id: tempId,
      user_id: get().snapshot.user?.id ?? '',
      project_id: String(args.project_id ?? get().snapshot.user?.inbox_project_id ?? ''),
      section_id: (args.section_id as string) ?? null,
      parent_id: (args.parent_id as string) ?? null,
      content: String(args.content ?? ''),
      description: String(args.description ?? ''),
      priority: (args.priority as 1 | 2 | 3 | 4) ?? 1,
      /* A task created from a repeat rule is sent without a date, so that
         Todoist resolves it — but the row drawn a moment later still has to
         have one to read. Today stands in until the real one comes back. */
      due: provisionalDue(args.due as Item['due']),
      deadline: (args.deadline as Item['deadline']) ?? null,
      duration: null,
      labels: (args.labels as string[]) ?? [],
      /* Last among its siblings, which is where a task just added belongs and
         where the server is about to put it. Left at 0 the row appeared at the
         top of its parent for the half second before the sync answered, and
         then jumped. */
      child_order: nextChildOrder(
        get().snapshot,
        (args.parent_id as string) ?? null,
        String(args.project_id ?? get().snapshot.user?.inbox_project_id ?? ''),
        (args.section_id as string) ?? null,
      ),
      day_order: -1,
      collapsed: false,
      checked: false,
      is_deleted: false,
      added_at: new Date().toISOString(),
      completed_at: null,
      updated_at: new Date().toISOString(),
      responsible_uid: (args.responsible_uid as string) ?? null,
    };

    /* Subtasks go out in the same batch, pointing at the parent's temp id.
       Todoist resolves a temp id used as an argument inside one call, so the
       whole tree is created in a single round trip and can never half-exist. */
    const subtasks = (args.subtasks as string[] | undefined) ?? [];
    const { subtasks: _ignored, ...parentArgs } = args;

    const children = subtasks.map((content) => ({
      tempId: newUuid(),
      args: {
        content,
        project_id: parentArgs.project_id,
        parent_id: tempId,
      },
    }));

    const optimisticChildren: Record<string, Item> = {};
    for (const child of children) {
      optimisticChildren[child.tempId] = {
        ...optimisticItem,
        id: child.tempId,
        parent_id: tempId,
        content: String(child.args.content),
        description: '',
        priority: 1,
        due: null,
        deadline: null,
        labels: [],
      };
    }

    await get().apply(
      [addItem(parentArgs, tempId), ...children.map((c) => addItem(c.args, c.tempId))],
      (snapshot) => ({
        ...snapshot,
        items: { ...snapshot.items, [tempId]: optimisticItem, ...optimisticChildren },
      }),
    );
  },

  /**
   * Sends a task to one place.
   *
   * `item_move` takes a project or a section, never both, and the one it is
   * given settles the other: a task sent to a project is no longer in any of
   * its sections, and a task sent to a section is in that section's project.
   * The command carries the destination alone, so the snapshot has to say the
   * rest or the task keeps drawing where it used to be until the next sync
   * quietly puts it back.
   */
  async moveTask(id, target) {
    const { sections } = get().snapshot;
    const settled = target.section_id
      ? { ...target, project_id: sections[target.section_id]?.project_id ?? target.project_id }
      : { ...target, section_id: null };
    await get().apply([moveItem(id, target)], (snapshot) => patchItem(snapshot, id, settled));
  },

  async setTaskLabels(id, labels) {
    await get().updateTask(id, { labels });
  },

  async setTaskPriority(id, priority) {
    await get().updateTask(id, { priority: toTodoistPriority(priority) });
  },

  /**
   * Advances a recurring task to its next occurrence.
   *
   * Todoist has no skip command: closing a recurring task is what rolls the
   * series forward, which is exactly what the menu offers here.
   */
  async skipOccurrence(id) {
    const item = get().snapshot.items[id];
    if (!item?.due?.is_recurring) return;
    const demo = get().demo;
    await get().apply([command('item_close', { id })], (snapshot) =>
      demo ? advanceDemoRecurrence(snapshot, id) : patchItem(snapshot, id, { checked: true }));
    await get().refresh(true);
  },

  async skipOccurrences(ids) {
    const recurring = [...new Set(ids)].filter(
      (id) => get().snapshot.items[id]?.due?.is_recurring,
    );
    if (recurring.length === 0) return 0;
    const demo = get().demo;
    await get().apply(
      recurring.map((id) => command('item_close', { id })),
      (snapshot) => recurring.reduce(
        (current, id) => demo
          ? advanceDemoRecurrence(current, id)
          : patchItem(current, id, { checked: true }),
        snapshot,
      ),
    );
    await get().refresh(true);
    return recurring.length;
  },

  async createLabel(name, color = 'charcoal') {
    const trimmed = name.trim();
    if (!trimmed) return;

    // Todoist tag names carry no spaces, and neither does the @ syntax.
    const clean = trimmed.replace(/\s+/g, '-');
    const existing = Object.values(get().snapshot.labels).find(
      (label) => label.name.toLowerCase() === clean.toLowerCase(),
    );
    if (existing) return;

    const tempId = newUuid();
    const order = Object.keys(get().snapshot.labels).length + 1;
    await get().apply(
      [{ type: 'label_add', uuid: newUuid(), temp_id: tempId, args: { name: clean, color } }],
      (snapshot) => ({
        ...snapshot,
        labels: {
          ...snapshot.labels,
          [tempId]: {
            id: tempId, name: clean, color,
            item_order: order, is_favorite: false, is_deleted: false,
          },
        },
      }),
    );
  },

  async setLabelFavourite(id, favourite) {
    await get().apply(
      [command('label_update', { id, is_favorite: favourite })],
      (snapshot) => {
        const label = snapshot.labels[id];
        if (!label) return snapshot;
        return {
          ...snapshot,
          labels: { ...snapshot.labels, [id]: { ...label, is_favorite: favourite } },
        };
      },
    );
  },

  async reorderLabels(ids) {
    const order = Object.fromEntries(ids.map((id, index) => [id, index + 1]));
    await get().apply(
      [command('label_update_orders', { id_order_mapping: order })],
      (snapshot) => {
        const labels = { ...snapshot.labels };
        for (const [id, item_order] of Object.entries(order)) {
          if (labels[id]) labels[id] = { ...labels[id], item_order };
        }
        return { ...snapshot, labels };
      },
    );
  },

  async reorderProjects(ids) {
    const projects = get().snapshot.projects;
    const moved = ids
      .map((id, index) => ({ id, child_order: index + 1 }))
      .filter(({ id, child_order }) => projects[id] && projects[id].child_order !== child_order);

    if (moved.length === 0) return;

    await get().apply([command('project_reorder', { projects: moved })], (snapshot) => {
      const next = { ...snapshot.projects };
      for (const { id, child_order } of moved) {
        if (next[id]) next[id] = { ...next[id], child_order };
      }
      return { ...snapshot, projects: next };
    });
  },

  async reorderSubtasks(ids) {
    const items = get().snapshot.items;
    const moved = ids
      .map((id, index) => ({ id, child_order: index + 1 }))
      .filter(({ id, child_order }) => items[id] && items[id].child_order !== child_order);

    if (moved.length === 0) return;

    await get().apply([reorderItems(moved)], (snapshot) => {
      const next = { ...snapshot.items };
      for (const { id, child_order } of moved) {
        if (next[id]) next[id] = { ...next[id], child_order };
      }
      return { ...snapshot, items: next };
    });
  },

  async nestProject(id, parentId) {
    const projects = get().snapshot.projects;
    const project = projects[id];
    if (!project) return;
    if ((project.parent_id ?? null) === parentId) return;

    /* A project cannot be moved inside itself or inside something it already
       contains: Todoist would refuse it, and the sidebar would be drawing a
       branch with no root while it waited to find out. */
    if (parentId) {
      const parent = projects[parentId];
      /* A folder is a perfectly good parent — holding projects is the whole of
         what a folder is — but it cannot itself be filed inside something. */
      if (!parent || project.is_folder) return;
      if ((parent.workspace_id ?? null) !== (project.workspace_id ?? null)) return;
      for (let at: string | null = parentId; at; at = projects[at]?.parent_id ?? null) {
        if (at === id) return;
      }
    }

    const before = project.parent_id ?? null;
    const patch = (to: string | null) => (snapshot: Snapshot): Snapshot => {
      if (!snapshot.projects[id]) return snapshot;
      return { ...snapshot, projects: patchParent(snapshot.projects, id, to) };
    };

    /* Todoist reads a missing parent_id as "leave it where it is" and an
       explicit null as "move it to the top", so null is sent rather than omitted. */
    await get().apply([command('project_move', { id, parent_id: parentId })], patch(parentId));

    get().toast(
      parentId
        ? translate(get().prefs.locale, 'project.nestedIn', {
            name: project.name, parent: projects[parentId]?.name ?? '',
          })
        : translate(get().prefs.locale, 'project.movedToTop', { name: project.name }),
      () => void get().apply(
        [command('project_move', { id, parent_id: before })],
        patch(before),
      ),
    );
  },

  async createProject(name, color, workspaceId = null, anchor = null, extra = {}) {
    const tempId = newUuid();
    const snapshot = get().snapshot;
    const sibling = anchor ? snapshot.projects[anchor.siblingId] : undefined;

    /* Todoist reads the absence of workspace_id as the personal space, so the
       key is left off entirely rather than sent as null. */
    const args: Record<string, unknown> = { name, color };
    if (workspaceId) args.workspace_id = workspaceId;
    if (sibling?.parent_id) args.parent_id = sibling.parent_id;
    if (extra.description) args.description = extra.description;
    if (extra.favourite) args.is_favorite = true;

    const commands: Command[] = [];

    /* "Above" and "below" mean a position among the siblings, which is a
       child_order. The new project is given the one it should hold, and every
       sibling from there down is pushed one place to make room — with their
       real ids, so no command has to resolve a temp id to do its work. */
    let childOrder = Object.keys(snapshot.projects).length;
    if (sibling) {
      const siblings = Object.values(snapshot.projects)
        .filter((project) =>
          !project.is_archived &&
          !project.is_deleted &&
          !project.inbox_project &&
          (project.parent_id ?? null) === (sibling.parent_id ?? null) &&
          (project.workspace_id ?? null) === (sibling.workspace_id ?? null))
        .sort((a, b) => a.child_order - b.child_order);

      const at = siblings.findIndex((project) => project.id === sibling.id);
      const insertAt = anchor?.position === 'above' ? at : at + 1;
      childOrder = insertAt + 1;

      const shifted = siblings.slice(insertAt).map((project, offset) => ({
        id: project.id,
        child_order: insertAt + offset + 2,
      }));
      if (shifted.length > 0) {
        commands.push(command('project_reorder', { projects: shifted }));
      }
    }
    args.child_order = childOrder;

    commands.unshift({ type: 'project_add', uuid: newUuid(), args, temp_id: tempId });

    const mapping = await get().apply(commands, (current) => ({
      ...current,
      projects: {
        ...current.projects,
        [tempId]: {
          id: tempId, name, color,
          parent_id: (sibling?.parent_id ?? null),
          child_order: childOrder,
          description: extra.description ?? '',
          is_archived: false, is_deleted: false,
          is_favorite: extra.favourite ?? false,
          workspace_id: sibling ? (sibling.workspace_id ?? null) : workspaceId,
        },
      },
    }));
    return mapping[tempId] ?? tempId;
  },

  async archiveProject(id) {
    const project = get().snapshot.projects[id];
    if (!project) return;
    await get().apply([command('project_archive', { id })], (snapshot) => ({
      ...snapshot,
      projects: { ...snapshot.projects, [id]: { ...project, is_archived: true } },
    }));
    get().toast(translate(get().prefs.locale, 'project.archived', { name: project.name }));
  },

  async deleteProject(id) {
    const snapshot = get().snapshot;
    const project = snapshot.projects[id];
    if (!project) return;

    await get().apply([command('project_delete', { id })], (current) => {
      const projects = { ...current.projects };
      const sections = { ...current.sections };
      const items = { ...current.items };
      delete projects[id];
      // The tasks and sections go with it, so the screen must not keep them.
      for (const section of Object.values(sections)) {
        if (section.project_id === id) delete sections[section.id];
      }
      for (const item of Object.values(items)) {
        if (item.project_id === id) delete items[item.id];
      }
      return { ...current, projects, sections, items };
    });
    get().toast(translate(get().prefs.locale, 'project.deleted', { name: project.name }));
  },

  async duplicateProject(id, name) {
    const snapshot = get().snapshot;
    const source = snapshot.projects[id];
    if (!source) return;

    const projectTempId = newUuid();
    const commands: Command[] = [{
      type: 'project_add',
      uuid: newUuid(),
      temp_id: projectTempId,
      args: {
        name,
        color: source.color,
        ...(source.workspace_id ? { workspace_id: source.workspace_id } : {}),
        ...(source.description ? { description: source.description } : {}),
      },
    }];

    /* Sections first, so the tasks that belong to one have somewhere to land.
       Todoist resolves a temp id used as an argument inside the same call, so
       the whole copy is one round trip and can never half-exist. */
    const sectionTempIds = new Map<string, string>();
    for (const section of Object.values(snapshot.sections)
      .filter((s) => s.project_id === id && !s.is_archived && !s.is_deleted)
      .sort((a, b) => a.section_order - b.section_order)) {
      const tempId = newUuid();
      sectionTempIds.set(section.id, tempId);
      commands.push({
        type: 'section_add',
        uuid: newUuid(),
        temp_id: tempId,
        args: { name: section.name, project_id: projectTempId },
      });
    }

    for (const item of Object.values(snapshot.items)
      .filter((i) => i.project_id === id && !i.checked && !i.is_deleted)
      .sort((a, b) => a.child_order - b.child_order)) {
      commands.push({
        type: 'item_add',
        uuid: newUuid(),
        temp_id: newUuid(),
        args: {
          content: item.content,
          description: item.description || undefined,
          project_id: projectTempId,
          section_id: item.section_id ? sectionTempIds.get(item.section_id) : undefined,
          priority: item.priority,
          labels: item.labels,
          due: item.due ?? undefined,
        },
      });
    }

    await get().apply(commands, (current) => ({
      ...current,
      projects: {
        ...current.projects,
        [projectTempId]: {
          ...source,
          id: projectTempId,
          name,
          is_favorite: false,
          child_order: source.child_order + 1,
        },
      },
    }));
    get().toast(translate(get().prefs.locale, 'project.duplicated', { name }));
  },

  async updateProjectFields(id, args) {
    await get().apply([command('project_update', { id, ...args })], (snapshot) => {
      const project = snapshot.projects[id];
      if (!project) return snapshot;
      return { ...snapshot, projects: { ...snapshot.projects, [id]: { ...project, ...args } } };
    });
  },

  async createSection(projectId, index) {
    const tempId = newUuid();

    /* The new section takes the clicked position, and everything from there
       down moves one place. Giving it the same order as an existing section
       and hoping the sort works it out is how it ended up at the bottom. */
    const existing = Object.values(get().snapshot.sections)
      .filter((s) => s.project_id === projectId && !s.is_archived && !s.is_deleted)
      .sort((a, b) => a.section_order - b.section_order);

    const shifted = existing.slice(index);
    const commands = [
      {
        type: 'section_add',
        uuid: newUuid(),
        temp_id: tempId,
        args: { name: '', project_id: projectId, section_order: index },
      },
      ...shifted.map((section, offset) =>
        command('section_update', { id: section.id, section_order: index + offset + 1 })),
    ];

    await get().apply(commands, (snapshot) => {
      const sections = { ...snapshot.sections };
      shifted.forEach((section, offset) => {
        sections[section.id] = { ...section, section_order: index + offset + 1 };
      });
      sections[tempId] = {
        id: tempId, project_id: projectId, name: '',
        section_order: index, is_archived: false, is_deleted: false,
      };
      return { ...snapshot, sections };
    });

    return tempId;
  },

  async moveSection(id, index) {
    const snapshot = get().snapshot;
    const section = snapshot.sections[id];
    if (!section) return;

    const others = Object.values(snapshot.sections)
      .filter((s) => s.project_id === section.project_id && s.id !== id
        && !s.is_archived && !s.is_deleted)
      .sort((a, b) => a.section_order - b.section_order);

    // The order the list should end up in, then one command per section that
    // actually moved — a whole-list rewrite would churn every row.
    const ordered = [...others.slice(0, index), section, ...others.slice(index)];
    const changed = ordered
      .map((s, order) => ({ section: s, order }))
      .filter(({ section: s, order }) => s.section_order !== order);
    if (changed.length === 0) return;

    await get().apply(
      changed.map(({ section: s, order }) =>
        command('section_update', { id: s.id, section_order: order })),
      (snap) => {
        const sections = { ...snap.sections };
        for (const { section: s, order } of changed) {
          sections[s.id] = { ...sections[s.id], section_order: order };
        }
        return { ...snap, sections };
      },
    );
  },

  async removeSection(id) {
    /* Todoist deletes a section's tasks with it. The tasks are moved to the
       project's root first, in the same batch, so only the section goes. */
    const section = get().snapshot.sections[id];
    const orphans = Object.values(get().snapshot.items)
      .filter((item) => item.section_id === id && !item.is_deleted);
    const moves = section
      ? orphans.map((item) => moveItem(item.id, { project_id: section.project_id }))
      : [];
    await get().apply([...moves, command('section_delete', { id })], (snapshot) => {
      const sections = { ...snapshot.sections };
      delete sections[id];
      const items = { ...snapshot.items };
      for (const item of orphans) {
        items[item.id] = { ...items[item.id], section_id: null };
      }
      return { ...snapshot, sections, items };
    });
  },

  async updateSectionFields(id, args) {
    await get().apply([command('section_update', { id, ...args })], (snapshot) => {
      const section = snapshot.sections[id];
      if (!section) return snapshot;
      return { ...snapshot, sections: { ...snapshot.sections, [id]: { ...section, ...args } } };
    });
  },

  toast(message, undo) {
    const id = newUuid();
    /* The toast's own button and Cmd+Z are two ways to the same single step,
       so they share one entry: using either takes it off the stack and the
       other one can no longer replay it. */
    if (undo) {
      set({
        undoStack: [...get().undoStack, { id, label: message, run: undo }].slice(-UNDO_DEPTH),
      });
    }
    const entry: Toast = {
      id,
      message,
      undo: undo ? () => { void get().consumeUndo(id); } : undefined,
    };
    set({ toasts: [...get().toasts, entry] });
    setTimeout(() => get().dismissToast(entry.id), undo ? 8000 : 4000);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  pushUndo(label, run) {
    set({
      undoStack: [...get().undoStack, { id: newUuid(), label, run }].slice(-UNDO_DEPTH),
    });
  },

  async undo() {
    const stack = get().undoStack;
    const entry = stack[stack.length - 1];
    if (!entry) return;
    set({ undoStack: stack.slice(0, -1), toasts: get().toasts.filter((t) => t.id !== entry.id) });
    await entry.run();
  },

  async consumeUndo(id) {
    const entry = get().undoStack.find((e) => e.id === id);
    set({ undoStack: get().undoStack.filter((e) => e.id !== id) });
    await entry?.run();
  },

  setDraggingSection(id) { set({ draggingSectionId: id }); },
  setDraggingTag(name) { set({ draggingTag: name }); },

  setNesting(nesting) {
    if (get().nesting !== nesting) set({ nesting });
  },

  setOutdenting(outdenting) {
    if (get().outdenting !== outdenting) set({ outdenting });
  },

  setDraggingProject(id) {
    if (get().draggingProjectId !== id) set({ draggingProjectId: id });
  },

  toggleSelection(id) {
    const current = get().selection;
    set({
      selection: current.includes(id)
        ? current.filter((other) => other !== id)
        : [...current, id],
      selectionAnchor: id,
    });
  },

  setSelectionAnchor(id) {
    if (get().selectionAnchor !== id) set({ selectionAnchor: id });
  },

  selectRange(ids, additive) {
    if (ids.length === 0) return;
    const next = additive ? [...new Set([...get().selection, ...ids])] : ids;
    set({ selection: next, selectionAnchor: ids[ids.length - 1] });
  },

  clearSelection() {
    if (get().selection.length > 0 || get().selectionAnchor) {
      set({ selection: [], selectionAnchor: null });
    }
  },

  setDragging(id) {
    set({ draggingTaskId: id });
  },
}));

/** Applies a field change to one task in the snapshot. */
function patchItem(snapshot: Snapshot, id: string, args: Record<string, unknown>): Snapshot {
  const item = snapshot.items[id];
  if (!item) return snapshot;
  return { ...snapshot, items: { ...snapshot.items, [id]: { ...item, ...args } as Item } };
}

/** Sends everything waiting in the outbox, oldest first. */
async function flushQueue(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
): Promise<void> {
  const queue = await idb.readQueue();
  if (queue.length === 0) return;

  const commands: Command[] = queue.map(({ queuedAt: _q, attempts: _a, ...cmd }) => cmd);
  try {
    const { response, failures } = await sendCommands(get().snapshot.syncToken, commands);
    const merged = applySync(get().snapshot, response);
    set({ snapshot: merged });
    await idb.dequeue(commands.map((c) => c.uuid));
    set({ pendingCount: 0 });
    if (failures.length > 0) {
      get().toast(explainFailure(failures[0].error, get().prefs.locale));
    }
  } catch (error) {
    /* A refusal will be refused again. Left in the queue it goes out on every
       sync for ever, holding a pending count that never falls and a change
       that never lands, so it is dropped here and reported once. */
    if (error instanceof ApiError && error.isRefusal) {
      await idb.dequeue(commands.map((c) => c.uuid));
      set({ pendingCount: 0 });
      get().toast(explainFailure(error.detail, get().prefs.locale));
      return;
    }
    // Still unreachable; the queue is left alone and retried later.
  }
}
