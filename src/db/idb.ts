import { openDB, type IDBPDatabase } from 'idb';
import { emptySnapshot, type Snapshot } from '@/domain/types';
import type { Command } from '@/api/commands';

/**
 * The local store.
 *
 * Everything lives on the device: the Todoist mirror so the app opens
 * instantly and works offline, the preferences, and the queue of changes that
 * have not reached Todoist yet. No server holds any of it.
 */

const DB_NAME = 'todoist-enhancements';
const DB_VERSION = 1;

const STORE_SNAPSHOT = 'snapshot';
const STORE_PREFS = 'prefs';
const STORE_QUEUE = 'queue';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE_SNAPSHOT)) {
          database.createObjectStore(STORE_SNAPSHOT);
        }
        if (!database.objectStoreNames.contains(STORE_PREFS)) {
          database.createObjectStore(STORE_PREFS);
        }
        if (!database.objectStoreNames.contains(STORE_QUEUE)) {
          database.createObjectStore(STORE_QUEUE, { keyPath: 'uuid' });
        }
      },
    });
  }
  return dbPromise;
}

export async function loadSnapshot(): Promise<Snapshot> {
  try {
    const stored = await (await db()).get(STORE_SNAPSHOT, 'current');
    return (stored as Snapshot | undefined) ?? emptySnapshot();
  } catch {
    // A blocked or corrupt database must never stop the app from starting.
    return emptySnapshot();
  }
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  try {
    await (await db()).put(STORE_SNAPSHOT, snapshot, 'current');
  } catch {
    /* the app keeps working from memory */
  }
}

export async function clearSnapshot(): Promise<void> {
  try {
    await (await db()).delete(STORE_SNAPSHOT, 'current');
  } catch {
    /* nothing to clear */
  }
}

export async function loadPrefs<T>(key: string): Promise<T | null> {
  try {
    return ((await (await db()).get(STORE_PREFS, key)) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function savePrefs<T>(key: string, value: T): Promise<void> {
  try {
    await (await db()).put(STORE_PREFS, value, key);
  } catch {
    /* preferences fall back to defaults next time */
  }
}

/* ---------- The outbox of changes waiting for Todoist ---------- */

export interface QueuedCommand extends Command {
  queuedAt: number;
  attempts: number;
}

export async function enqueue(commands: Command[]): Promise<void> {
  try {
    const database = await db();
    const tx = database.transaction(STORE_QUEUE, 'readwrite');
    for (const cmd of commands) {
      await tx.store.put({ ...cmd, queuedAt: Date.now(), attempts: 0 } satisfies QueuedCommand);
    }
    await tx.done;
  } catch {
    /* the change was already applied in memory and sent optimistically */
  }
}

export async function readQueue(): Promise<QueuedCommand[]> {
  try {
    const all = (await (await db()).getAll(STORE_QUEUE)) as QueuedCommand[];
    return all.sort((a, b) => a.queuedAt - b.queuedAt);
  } catch {
    return [];
  }
}

/**
 * Rewrites queued commands in place, keeping their place in the queue.
 *
 * Used when part of the queue went out and resolved ids that the rest names:
 * the rest is written back with the real ids, in the order it was queued.
 */
export async function updateQueued(commands: Command[]): Promise<void> {
  try {
    const database = await db();
    const tx = database.transaction(STORE_QUEUE, 'readwrite');
    for (const cmd of commands) {
      const existing = (await tx.store.get(cmd.uuid)) as QueuedCommand | undefined;
      await tx.store.put({
        ...cmd,
        queuedAt: existing?.queuedAt ?? Date.now(),
        attempts: (existing?.attempts ?? 0) + 1,
      } satisfies QueuedCommand);
    }
    await tx.done;
  } catch {
    /* the commands are still queued under their old arguments, which Todoist can resolve */
  }
}

export async function dequeue(uuids: string[]): Promise<void> {
  try {
    const database = await db();
    const tx = database.transaction(STORE_QUEUE, 'readwrite');
    for (const uuid of uuids) await tx.store.delete(uuid);
    await tx.done;
  } catch {
    /* a stale entry is retried, which is safe: commands are idempotent by uuid */
  }
}

export async function clearAll(): Promise<void> {
  try {
    const database = await db();
    await Promise.all([
      database.clear(STORE_SNAPSHOT),
      database.clear(STORE_PREFS),
      database.clear(STORE_QUEUE),
    ]);
  } catch {
    /* nothing to clear */
  }
}
