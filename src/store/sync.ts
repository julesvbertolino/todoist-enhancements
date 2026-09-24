/** Talking to Todoist: signing in and out, reading, writing, the offline queue, the demo. */
import { auth } from '@/api/auth';
import { completeSignIn } from '@/api/oauth';
import { ApiError, NotConnectedError } from '@/api/client';
import { applySync, applyWrite, sync } from '@/api/sync';
import { sendCommands, type Command } from '@/api/commands';
import * as idb from '@/db/idb';
import { emptySnapshot, setWeekLabel } from '@/domain/types';
import { detectLocale } from '@/i18n';
import { buildDemoSnapshot } from '@/demo/demoData';
import { defaultPreferences, hydratePreferences, type Preferences } from './prefs';
import { explainFailure, explainFailures, hidePending, pendingDeletes, revertRefused, schedulePersist } from './helpers';
import {
  PREFS_KEY, preferencesWriteTimer, remotePreferences, tourSnapshotBackup, withOnboarding,
} from './preferences';
import type { AppState } from './types';
import type { Slice, SyncSlice } from './types';

/** How often the app asks Todoist what changed while the tab is in the foreground. */
export const POLL_INTERVAL_MS = 45_000;

/** Sends everything waiting in the outbox, oldest first. */
export async function flushQueue(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
): Promise<boolean> {
  const queue = await idb.readQueue();
  if (queue.length === 0) return false;

  /* A deletion written to the queue because the page was hidden is still
     pending while the page lives: it goes when its toast does, or never if it
     is undone. Only a relaunch, which has forgotten it, sends it from here. */
  const held = new Set<string>();
  for (const pending of pendingDeletes.values()) {
    for (const cmd of pending.commands) held.add(cmd.uuid);
  }
  const commands: Command[] = queue
    .filter((cmd) => !held.has(cmd.uuid))
    .map(({ queuedAt: _q, attempts: _a, ...cmd }) => cmd);
  if (commands.length === 0) return false;
  try {
    const result = await sendCommands(get().snapshot.syncToken, commands);
    let merged = applyWrite(get().snapshot, result.responses, result.mapping);

    /* A refused creation takes its placeholder with it. A refused edit is
       harder: the queue does not remember what the screen showed before it,
       sometimes several reloads ago, so only a full read of Todoist can say
       what was kept. */
    let stale = false;
    if (result.failures.length > 0) {
      const refused = new Set(result.failures.map((failure) => failure.uuid));
      const placeholders = commands.filter((cmd) => refused.has(cmd.uuid) && cmd.temp_id);
      if (placeholders.length > 0) {
        merged = revertRefused(merged, merged, placeholders, result.failures);
      }
      stale = commands.some((cmd) => refused.has(cmd.uuid) && !cmd.temp_id);
    }

    set({ snapshot: hidePending(merged), resolvedIds: { ...get().resolvedIds, ...result.mapping } });
    await idb.dequeue(result.delivered);
    if (result.undelivered.length > 0) await idb.updateQueued(result.undelivered);
    set({ pendingCount: result.undelivered.length });
    if (result.failures.length > 0) {
      get().toast(explainFailures(result.failures, result.delivered.length, get().prefs.locale));
    }
    // A full read would wipe the placeholders of what is still waiting to go.
    return stale && result.undelivered.length === 0;
  } catch (error) {
    /* A refusal will be refused again. Left in the queue it goes out on every
       sync for ever, holding a pending count that never falls and a change
       that never lands, so it is dropped here and reported once. */
    if (error instanceof ApiError && error.isRefusal) {
      await idb.dequeue(commands.map((c) => c.uuid));
      set({ pendingCount: 0 });
      get().toast(explainFailure(error.detail, get().prefs.locale));
      return true;
    }
    // Still unreachable; the queue is left alone and retried later.
    return false;
  }
}

export const createSyncSlice: Slice<SyncSlice> = (set, get) => ({
  ready: false,
  connected: false,
  snapshot: emptySnapshot(),
  syncState: 'idle',
  syncError: null,
  pendingCount: 0,
  demo: false,
  resolvedIds: {},
  signInError: null,
  async init() {
    /* A page load that is Todoist sending the person back from its consent
       page finishes the sign-in first, so what follows finds a connection. */
    const signIn = await completeSignIn();
    if (signIn === 'signed-in') sessionStorage.removeItem('demo');
    if (signIn === 'denied' || signIn === 'failed') set({ signInError: signIn });

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
      // A fresh sign-in reads the whole account, whatever the device held.
      void get().refresh(signIn === 'signed-in' || snapshot.syncToken === '*');
    }
  },
  async connect(token: string) {
    set({ syncState: 'loading', syncError: null });
    await auth.set(token);
    try {
      const response = await sync('*');
      const snapshot = applySync(emptySnapshot(), response);
      const canonical = remotePreferences(snapshot, get().prefs);
      if (canonical) setWeekLabel(canonical.weekLabel);
      const adopted = canonical ?? get().prefs;
      const prefs = withOnboarding(snapshot, adopted);
      set({ connected: true, snapshot, prefs, syncState: 'idle' });
      void idb.saveSnapshot(snapshot);
      if (canonical || prefs !== adopted) void idb.savePrefs(PREFS_KEY, prefs);
      window.setTimeout(() => void get().ensurePreferencesTask(), 0);
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
      resolvedIds: {},
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
      const stale = await flushQueue(get, set);

      const fromScratch = full || stale;
      const token = fromScratch ? '*' : get().snapshot.syncToken;
      const response = await sync(token);
      const snapshot = applySync(fromScratch ? emptySnapshot() : get().snapshot, response);
      const canonical = preferencesWriteTimer
        ? null
        : remotePreferences(snapshot, get().prefs);
      if (canonical) setWeekLabel(canonical.weekLabel);
      const adopted = canonical ?? get().prefs;
      const prefs = withOnboarding(snapshot, adopted);
      set({ snapshot: hidePending(snapshot), prefs, syncState: 'idle' });
      schedulePersist(snapshot);
      if (canonical || prefs !== adopted) void idb.savePrefs(PREFS_KEY, prefs);
      /* Always: writes nothing when the comment already says the same, and
         moves an account off the old settings task the first time. */
      window.setTimeout(() => void get().ensurePreferencesTask(), 0);
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
    } finally {
      /* Whatever happened above, this sync is over. A state left on
         "syncing" stops every later sync from starting. */
      if (get().syncState === 'syncing') set({ syncState: 'idle' });
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
      const result = await sendCommands(after.syncToken, commands);
      let merged = applyWrite(get().snapshot, result.responses, result.mapping);
      if (result.failures.length > 0) {
        merged = revertRefused(merged, before, commands, result.failures);
      }

      set({
        snapshot: hidePending(merged),
        syncState: result.error ? 'offline' : 'idle',
        resolvedIds: { ...get().resolvedIds, ...result.mapping },
      });
      schedulePersist(merged);

      /* Only what Todoist received leaves the queue. What the network lost
         part-way stays, with the ids resolved so far written into it. */
      await idb.dequeue(result.delivered);
      if (result.undelivered.length > 0) await idb.updateQueued(result.undelivered);
      set({ pendingCount: Math.max(0, get().pendingCount - result.delivered.length) });

      if (result.failures.length > 0) {
        get().toast(explainFailures(
          result.failures, result.delivered.length, get().prefs.locale,
        ));
      }
      return result.mapping;
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
});
