import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withOnboarding } from './preferences';
import { defaultPreferences, SETTINGS_COMMENT_MARKER } from './prefs';
import { hasOnboarded } from '@/domain/onboarding';
import { emptySnapshot, type Note, type Snapshot } from '@/domain/types';

/** A browser's storage, fresh for each test. */
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  });
});

function account(settings: Record<string, unknown> | null): Snapshot {
  const notes: Record<string, Note> = {};
  if (settings) {
    notes.c1 = {
      id: 'c1', item_id: null, project_id: 'inbox', posted_at: '2026-09-01T00:00:00Z',
      posted_uid: 'me', is_deleted: false, file_attachment: null,
      content: `${SETTINGS_COMMENT_MARKER}\n\n${JSON.stringify(settings)}`,
    };
  }
  return {
    ...emptySnapshot(),
    user: { id: 'me', inbox_project_id: 'inbox' } as Snapshot['user'],
    notes,
  };
}

const prefs = defaultPreferences('en');

describe('withOnboarding', () => {
  it('counts settings saved before 1.14 as an account already set up', () => {
    const next = withOnboarding(account({ theme: 'dark', savedAt: 1 }), prefs);
    expect(hasOnboarded('me')).toBe(true);
    expect(next.onboarded).toBe(true);
  });

  it('takes "set up" from the account on a new browser', () => {
    withOnboarding(account({ onboarded: true, savedAt: 1 }), prefs);
    expect(hasOnboarded('me')).toBe(true);
  });

  it('leaves a new account to its walkthrough', () => {
    const next = withOnboarding(account({ onboarded: false, savedAt: 1 }), prefs);
    expect(hasOnboarded('me')).toBe(false);
    expect(next).toBe(prefs);
  });

  it('tells the account when this browser already knows', () => {
    localStorage.setItem('onboarded', JSON.stringify(['me']));
    const next = withOnboarding(account({ onboarded: false, savedAt: 1 }), prefs);
    expect(next.onboarded).toBe(true);
  });

  it('waits for the account to be known', () => {
    expect(withOnboarding({ ...emptySnapshot() }, prefs)).toBe(prefs);
  });
});
