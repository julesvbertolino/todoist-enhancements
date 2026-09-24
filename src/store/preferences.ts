/** The preferences, and the settings comment that carries them across devices. */
import { request } from '@/api/client';
import { command, type Command, deleteItem, newUuid } from '@/api/commands';
import * as idb from '@/db/idb';
import { setWeekLabel, type Note, type Snapshot } from '@/domain/types';
import { detectLocale } from '@/i18n';
import { buildDemoSnapshot } from '@/demo/demoData';
import { defaultPreferences, hydratePreferences, viewPrefs as readViewPrefs, PREFERENCES_TASK_CONTENT, SETTINGS_COMMENT_MARKER, mergeSynced, readSettingsComment, settingsCommentContent, settingsCommentMatches, syncedPreferences, type Preferences } from './prefs';
import { schedulePersist } from './helpers';
import type { AppState } from './types';
import { hasOnboarded, markOnboarded } from '@/domain/onboarding';
import type { Slice, PreferencesSlice } from './types';

export const PREFS_KEY = 'preferences';

export let preferencesWriteTimer: number | null = null;

export let creatingPreferencesTask = false;

export let tourSnapshotBackup: Snapshot | null = null;

export function schedulePreferencesWrite(get: () => AppState) {
  if (!get().connected || get().demo) return;
  if (preferencesWriteTimer) window.clearTimeout(preferencesWriteTimer);
  preferencesWriteTimer = window.setTimeout(() => {
    preferencesWriteTimer = null;
    void get().ensurePreferencesTask(true);
  }, 300);
}

/** Every settings comment on the Inbox, the current one first. */
export function settingsComments(snapshot: Snapshot): Note[] {
  const inbox = snapshot.user?.inbox_project_id;
  if (!inbox) return [];
  const stamp = (note: Note) => readSettingsComment(note.content)?.savedAt ?? 0;
  return Object.values(snapshot.notes)
    .filter((note) => !note.is_deleted && note.project_id === inbox && !note.item_id
      && note.content.startsWith(SETTINGS_COMMENT_MARKER))
    /* Todoist keeps no edit date on a comment, so the settings carry their
       own; a comment written before they did falls back to when it was posted. */
    .sort((a, b) => stamp(b) - stamp(a) || b.posted_at.localeCompare(a.posted_at));
}

/** The settings task of 1.12 and before, if the account still has one. */
export function legacySettingsTask(snapshot: Snapshot) {
  return Object.values(snapshot.items).find(
    (item) => !item.is_deleted && item.content === PREFERENCES_TASK_CONTENT,
  );
}

/**
 * The account's settings, laid over this device's.
 *
 * From the current Inbox comment, or — on an account not moved over yet —
 * from the old settings task. Null when the snapshot shows neither.
 */
export function remotePreferences(snapshot: Snapshot, local: Preferences): Preferences | null {
  const comment = settingsComments(snapshot)[0];
  const remote = comment ? readSettingsComment(comment.content) : null;
  if (remote) return mergeSynced(local, remote, local.locale);
  const legacy = legacySettingsTask(snapshot);
  if (legacy?.description.trim()) {
    try {
      const old = hydratePreferences(JSON.parse(legacy.description), local.locale);
      return mergeSynced(local, syncedPreferences(old), local.locale);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Whether this account has been through the first run, carried both ways
 * between the device and the account's settings.
 *
 * Signing in on a second browser showed the walkthrough again even though the
 * settings it offers were already there: the "done" mark lived only in the
 * first browser's storage. Settings that say so, and settings written before
 * the mark existed (only an account that used the app has any), mark this
 * device; a device that already knows marks the settings, so the next browser
 * learns it too. A new account has neither and still gets its walkthrough.
 */
export function withOnboarding(snapshot: Snapshot, prefs: Preferences): Preferences {
  const userId = snapshot.user?.id;
  if (!userId) return prefs;
  const comment = settingsComments(snapshot)[0];
  const stored = comment ? readSettingsComment(comment.content) : null;
  const setUpElsewhere = stored ? stored.onboarded !== false : Boolean(legacySettingsTask(snapshot));
  if (setUpElsewhere || prefs.onboarded) markOnboarded(userId);
  return hasOnboarded(userId) && !prefs.onboarded ? { ...prefs, onboarded: true } : prefs;
}

/**
 * The Inbox's settings comments as Todoist has them right now.
 *
 * Asked before a comment is ever created. A snapshot kept from an older
 * version, or from before the comment existed, is read incrementally and
 * never learns of a comment that has not changed since — which is how an
 * account ended up with a new settings comment on every connection.
 */
export async function fetchSettingsComments(inbox: string): Promise<Note[] | null> {
  try {
    const found: Note[] = [];
    let cursor: string | undefined;
    do {
      const page = await request<{ results: Note[]; next_cursor?: string | null }>(
        '/comments', { query: { project_id: inbox, limit: 100, cursor } },
      );
      found.push(...page.results.filter((note) => note.content.startsWith(SETTINGS_COMMENT_MARKER)));
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    return found;
  } catch {
    return null;
  }
}

export const createPreferencesSlice: Slice<PreferencesSlice> = (set, get) => ({
  walkthrough: false,
  prefs: defaultPreferences(detectLocale()),
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
  /**
   * Writes the settings to their Inbox comment, creating it the first time.
   *
   * Nothing is sent when the comment already says the same. Before creating
   * one, Todoist is asked whether it already has one: if so, that comment is
   * brought into the snapshot and its settings are read, not overwritten.
   * Duplicates — from before this check existed — are removed, keeping the
   * most recently written. An account that still has the settings task from
   * 1.12 gets the comment and loses the task.
   */
  async ensurePreferencesTask(localChange = false) {
    if (!get().connected || get().demo || creatingPreferencesTask || tourSnapshotBackup) return;
    creatingPreferencesTask = true;
    try {
      let snapshot = get().snapshot;
      const inbox = snapshot.user?.inbox_project_id;
      if (!inbox) return;

      let comments = settingsComments(snapshot);
      if (comments.length === 0) {
        const fetched = await fetchSettingsComments(inbox);
        if (fetched === null) return; // unreachable: try again on the next sync
        if (fetched.length > 0) {
          const notes = { ...get().snapshot.notes };
          for (const note of fetched) notes[note.id] = note;
          set({ snapshot: { ...get().snapshot, notes } });
          snapshot = get().snapshot;
          comments = settingsComments(snapshot);
          /* Found after the fact. If this call follows a change made here,
             that change is what gets written; otherwise the comment is the
             account's settings and this device takes them. */
          const canonical = localChange ? null : remotePreferences(snapshot, get().prefs);
          if (canonical) {
            setWeekLabel(canonical.weekLabel);
            set({ prefs: canonical });
            void idb.savePrefs(PREFS_KEY, canonical);
          }
          schedulePersist(snapshot);
        }
      }

      const [current, ...duplicates] = comments;
      const prefs = get().prefs;
      const content = settingsCommentContent(prefs);
      const commands: Command[] = [];
      let tempId: string | null = null;

      if (!current) {
        tempId = newUuid();
        commands.push({
          type: 'note_add', uuid: newUuid(), temp_id: tempId,
          args: { project_id: inbox, content },
        });
      } else if (!settingsCommentMatches(current.content, prefs)) {
        commands.push(command('note_update', { id: current.id, content }));
      }
      for (const duplicate of duplicates) commands.push(command('note_delete', { id: duplicate.id }));
      const legacy = legacySettingsTask(snapshot);
      if (legacy) commands.push(deleteItem(legacy.id));
      if (commands.length === 0) return;

      const written = commands.some((cmd) => cmd.type === 'note_add' || cmd.type === 'note_update');
      await get().apply(commands, (state) => {
        const notes = { ...state.notes };
        if (current && written) notes[current.id] = { ...current, content };
        if (tempId) {
          notes[tempId] = {
            id: tempId, item_id: null, project_id: inbox, content,
            posted_at: new Date().toISOString(), posted_uid: state.user?.id ?? '',
            is_deleted: false, file_attachment: null,
          } as Note;
        }
        for (const duplicate of duplicates) delete notes[duplicate.id];
        const items = { ...state.items };
        if (legacy) delete items[legacy.id];
        return { ...state, notes, items };
      });
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
  setWalkthrough(open) { set({ walkthrough: open }); },
});
