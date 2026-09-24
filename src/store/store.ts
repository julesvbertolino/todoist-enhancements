import { create } from 'zustand';
import type { AppState } from './types';
import { createSyncSlice } from './sync';
import { createPreferencesSlice } from './preferences';
import { createTasksSlice } from './tasks';
import { createTasksMoveSlice } from './tasks-move';
import { createStructureSlice } from './structure';
import { createUiSlice } from './ui';
import * as idb from '@/db/idb';
import { pendingDeletes } from './helpers';

/**
 * The app's one store, built from slices — one file per area:
 * sync.ts (Todoist, the queue, the demo), preferences.ts (settings and the
 * settings comment), tasks.ts and tasks-move.ts (tasks), structure.ts
 * (projects, sections, labels) and ui.ts (toasts, undo, drag, selection).
 * Shared helpers are in helpers.ts and the types in types.ts. Components
 * import `useStore` from here, as before.
 */
export const useStore = create<AppState>()((...a) => ({
  ...createSyncSlice(...a),
  ...createPreferencesSlice(...a),
  ...createTasksSlice(...a),
  ...createTasksMoveSlice(...a),
  ...createStructureSlice(...a),
  ...createUiSlice(...a),
}));

export type { AppState, SyncState, Toast, UndoEntry } from './types';

/*
 * Leaving the page must not forget a deletion. The moment the page is hidden
 * — a tab closed or switched, the app sent to the background — every pending
 * deletion is written to the offline queue, which goes out on the next sync
 * even if that is the next launch. It stays pending in memory: coming back
 * inside the window and undoing still works, and takes it back off the queue.
 */
if (typeof document !== 'undefined') {
  const queuePending = () => {
    // A demo deletes nothing, and nothing of it may reach the queue.
    if (useStore.getState().demo) return;
    for (const pending of pendingDeletes.values()) {
      if (pending.queued) continue;
      pending.queued = true;
      void idb.enqueue(pending.commands);
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') queuePending();
  });
  window.addEventListener('pagehide', queuePending);
}
