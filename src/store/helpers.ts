/** What more than one slice of the store needs: pure helpers, and the module state they share. */
import type { Command } from '@/api/commands';
import * as idb from '@/db/idb';
import type { Item, Snapshot } from '@/domain/types';
import type { Locale } from '@/i18n';
import type { AppState } from './types';

/** Demo data cannot ask Todoist to resolve recurrence, so cover the ordinary
 * daily and weekly rules used by the demo without inventing a general parser. */
export function advanceDemoRecurrence(snapshot: Snapshot, id: string): Snapshot {
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

/**
 * Makes sure a change only Todoist can finish has come back finished.
 *
 * Closing a recurring task, or giving one a rule, leaves the date to Todoist.
 * Its answer to the write already carries the task as it now stands, because
 * every write is sent as an incremental sync. So nothing more is asked for
 * unless that answer did not bring the task back: then one incremental sync
 * fetches it, never a full one.
 */
export async function settleFromServer(
  get: () => AppState,
  id: string,
  unsettled: (item: Item) => boolean,
): Promise<void> {
  const state = get();
  if (state.demo || !navigator.onLine) return;
  const item = state.snapshot.items[id];
  if (item && unsettled(item)) await state.refresh();
}

/** How long a toast with an undo stays up, and so how long a deletion waits. */
export const UNDO_TOAST_MS = 8000;

/**
 * Deletions that have not been sent yet.
 *
 * Todoist has no undelete, so a deletion is held back for as long as its
 * toast offers to undo it: the rows leave the screen at once, and the
 * `item_delete` only goes out when the toast does. Undoing inside that window
 * cancels a command that was never sent, which gives back the very same task
 * — its id, its comments, its reminders, its assignee, its history — instead
 * of a copy rebuilt from memory.
 */
export interface PendingDelete {
  timer: ReturnType<typeof setTimeout>;
  commands: Command[];
  /** The removed tasks, subtasks included, exactly as they were. */
  items: Item[];

  /** Written to the offline queue because the page was being left. */
  queued: boolean;
}
export const pendingDeletes = new Map<string, PendingDelete>();

/** Every task id a pending deletion is holding off the screen. */
export function pendingIds(): Set<string> {
  const ids = new Set<string>();
  for (const pending of pendingDeletes.values()) {
    for (const item of pending.items) ids.add(item.id);
  }
  return ids;
}

/**
 * Keeps pending deletions off the screen whatever a sync says.
 *
 * Todoist still has those tasks until the deletion goes out, so any sync in
 * the meantime — a poll, a write's answer, a full read — would bring them
 * straight back without this.
 */
export function hidePending(snapshot: Snapshot): Snapshot {
  if (pendingDeletes.size === 0) return snapshot;
  const hidden = pendingIds();
  if (!Object.keys(snapshot.items).some((id) => hidden.has(id))) return snapshot;
  const items = { ...snapshot.items };
  for (const id of hidden) delete items[id];
  return { ...snapshot, items };
}

/**
 * What goes to disk puts pending deletions back.
 *
 * If the page closes before a deletion is sent and before it reaches the
 * queue, the copy on disk must still have the tasks: Todoist does, and an
 * incremental sync would never bring back something that did not change.
 */
export function withPending(snapshot: Snapshot): Snapshot {
  if (pendingDeletes.size === 0) return snapshot;
  const items = { ...snapshot.items };
  for (const pending of pendingDeletes.values()) {
    for (const item of pending.items) items[item.id] = item;
  }
  return { ...snapshot, items };
}

/** Writes the snapshot to the device without blocking the interface. */
export let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function schedulePersist(snapshot: Snapshot) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void idb.saveSnapshot(withPending(snapshot)), 400);
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
export function explainFailure(error: string, locale: Locale): string {
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

/**
 * What to say when Todoist refused some of a batch.
 *
 * All of it refused reads as before. Part of it refused says how much was
 * kept, so a bulk edit that half worked is not mistaken for one that did
 * nothing or one that did everything.
 */
export function explainFailures(
  failures: Array<{ error: string }>,
  total: number,
  locale: Locale,
): string {
  const reason = explainFailure(failures[0].error, locale);
  const saved = total - failures.length;
  if (saved <= 0) return reason;
  return locale === 'fr'
    ? `${saved} modification${saved > 1 ? 's' : ''} sur ${total} enregistrée${saved > 1 ? 's' : ''}. ${reason}`
    : `${saved} of ${total} changes saved. ${reason}`;
}

/** The collection a command acts on, read from its type. */
export function collectionOf(type: string): 'items' | 'projects' | 'sections' | 'labels' | 'notes' | null {
  if (type.startsWith('item_')) return 'items';
  if (type.startsWith('project_')) return 'projects';
  if (type.startsWith('section_')) return 'sections';
  if (type.startsWith('label_')) return 'labels';
  if (type.startsWith('note_')) return 'notes';
  return null;
}

/** Every id a command changes, whatever shape its arguments take. */
export function idsTouchedBy(cmd: Command): string[] {
  const args = cmd.args as Record<string, unknown>;
  const ids: string[] = [];
  if (typeof args.id === 'string') ids.push(args.id);
  for (const key of ['items', 'projects', 'sections']) {
    const list = args[key];
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (entry && typeof (entry as { id?: unknown }).id === 'string') ids.push((entry as { id: string }).id);
      }
    }
  }
  for (const key of ['ids_to_orders', 'id_order_mapping']) {
    const map = args[key];
    if (map && typeof map === 'object') ids.push(...Object.keys(map));
  }
  return ids;
}

/**
 * Takes back, on screen, exactly what Todoist refused.
 *
 * A refused change used to roll the whole screen back to before the batch,
 * the accepted part with it. Now each refused command gives back only the
 * objects it touched, as they were before, and a refused creation takes its
 * placeholder away. Everything Todoist accepted stays as Todoist returned it.
 */
export function revertRefused(
  current: Snapshot,
  before: Snapshot,
  commands: Command[],
  failures: Array<{ uuid: string }>,
): Snapshot {
  const refused = new Set(failures.map((failure) => failure.uuid));
  const next: Snapshot = {
    ...current,
    items: { ...current.items },
    projects: { ...current.projects },
    sections: { ...current.sections },
    labels: { ...current.labels },
    notes: { ...current.notes },
  };
  for (const cmd of commands) {
    if (!refused.has(cmd.uuid)) continue;
    const collection = collectionOf(cmd.type);
    if (!collection) continue;
    const target = next[collection] as Record<string, unknown>;
    const was = before[collection] as Record<string, unknown>;
    if (cmd.temp_id) delete target[cmd.temp_id];
    for (const id of idsTouchedBy(cmd)) {
      if (was[id]) target[id] = was[id];
      else delete target[id];
    }
  }
  return next;
}

/** Applies a field change to one task in the snapshot. */
export function patchItem(snapshot: Snapshot, id: string, args: Record<string, unknown>): Snapshot {
  const item = snapshot.items[id];
  if (!item) return snapshot;
  return { ...snapshot, items: { ...snapshot.items, [id]: { ...item, ...args } as Item } };
}
