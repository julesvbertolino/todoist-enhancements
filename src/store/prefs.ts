import type { Locale } from '@/i18n';
import type { ViewId } from '@/domain/types';
import { DEFAULT_WEEK_LABEL, defaultViewPrefs, type ViewPrefs } from '@/domain/types';
import { defaultConflictSettings, type ConflictSettings } from '@/domain/conflicts';
import { defaultCapacity, type DailyCapacity } from '@/domain/load';
import { DATE_FORMATS, type DateFormat } from '@/domain/dates';

/**
 * The Todoist task that held the settings up to 1.12.
 *
 * Still recognised so an account that has one is moved over to the comment
 * (and the task removed), and so it is never drawn in a list meanwhile.
 */
export const PREFERENCES_TASK_CONTENT = '* Enhanced for Todoist settings';

/**
 * The first line of the Inbox comment that holds the settings.
 *
 * A comment on the Inbox rather than a task in it: it follows the account to
 * every browser, but it is not a task — it is not in the Inbox count, in
 * Todoist's search, in filters, or in the way of an empty Inbox.
 */
export const SETTINGS_COMMENT_MARKER = 'Enhanced for Todoist · settings (edited by the app, please leave as is)';

/**
 * What a project's Display control shares across devices: list or board,
 * grouping, sorting, and whether subtasks and completed tasks show. The
 * filters (priorities, tags, estimates…) are a look at the moment and stay
 * where they were set.
 */
export interface SyncedView {
  mode: ViewPrefs['mode'];
  group: ViewPrefs['group'];
  sort: ViewPrefs['sort'];
  showSubtasks: boolean;
  showCompleted: boolean;
}

/**
 * The preferences that follow the account.
 *
 * Everything in the Settings panel — the general ones, the matrix, the look
 * (accent, theme, density) — and part of each project's Display control (see
 * SyncedView). Not whether the sidebar is folded, which is a matter of the
 * window in front of you, nor the display of pages other than projects.
 */
export type SyncedPreferences = Omit<Preferences, 'sidebarCollapsed' | 'views'> & {
  views: Record<string, SyncedView>;
};

export function syncedPreferences(prefs: Preferences): SyncedPreferences {
  const { sidebarCollapsed: _local, views, ...rest } = prefs;
  /* Sorted, so two devices holding the same settings write the same text
     and never take turns rewriting the comment. */
  const projectViews = Object.entries(views)
    .filter(([key]) => key.startsWith('project:'))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, view]): [string, SyncedView] => [key, {
      mode: view.mode,
      group: view.group,
      sort: view.sort,
      showSubtasks: view.filters.showSubtasks,
      showCompleted: view.filters.showCompleted,
    }]);
  return { ...rest, views: Object.fromEntries(projectViews) };
}

/** The settings as the comment holds them: what travels, and when it was written. */
type StoredSettings = SyncedPreferences & { savedAt?: number };

/**
 * The comment's text: the marker line, then the settings as one line of JSON,
 * stamped with the time they were written. Todoist keeps no edit date on a
 * comment, and the stamp is what says which of two comments is the current
 * one if an account ever ends up with more than one.
 */
export function settingsCommentContent(prefs: Preferences, savedAt = Date.now()): string {
  const stored: StoredSettings = { ...syncedPreferences(prefs), savedAt };
  return `${SETTINGS_COMMENT_MARKER}\n\n${JSON.stringify(stored)}`;
}

/** The settings a comment carries, with their stamp, or null if it is not ours. */
export function readSettingsComment(
  content: string,
): (Partial<SyncedPreferences> & { savedAt?: number }) | null {
  if (!content.startsWith(SETTINGS_COMMENT_MARKER)) return null;
  const json = content.slice(SETTINGS_COMMENT_MARKER.length).trim();
  try {
    const value = JSON.parse(json);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Whether a comment already says what these preferences would write, stamp
 * aside — so nothing is sent when nothing changed.
 */
export function settingsCommentMatches(content: string, prefs: Preferences): boolean {
  const stored = readSettingsComment(content);
  if (!stored) return false;
  const { savedAt: _stamp, ...rest } = stored;
  return JSON.stringify(rest) === JSON.stringify(syncedPreferences(prefs));
}

/**
 * Settings from the account laid over the ones on this device: the device
 * keeps what does not travel (the folded sidebar, the display of pages other
 * than projects), the account decides the rest.
 */
export function mergeSynced(
  local: Preferences,
  remote: Partial<SyncedPreferences> & { savedAt?: number },
  locale: Locale,
): Preferences {
  const { views: remoteViews, savedAt: _stamp, ...settings } = remote;
  const hydrated = hydratePreferences({ ...local, ...settings, views: undefined }, locale);
  const views = { ...local.views };
  for (const [key, shared] of Object.entries(remoteViews ?? {})) {
    if (!key.startsWith('project:') || !shared) continue;
    const mine = local.views[key] ?? defaultViewPrefs(key);
    views[key] = {
      ...mine,
      mode: shared.mode ?? mine.mode,
      group: shared.group ?? mine.group,
      sort: shared.sort ?? mine.sort,
      filters: {
        ...mine.filters,
        showSubtasks: shared.showSubtasks ?? mine.filters.showSubtasks,
        showCompleted: shared.showCompleted ?? mine.filters.showCompleted,
      },
    };
  }
  return { ...hydrated, sidebarCollapsed: local.sidebarCollapsed, views };
}

/** The views that make sense as a landing page: no view that needs an id. */
export const HOME_VIEWS = [
  'week', 'today', 'inbox', 'upcoming', 'someday', 'dashboard', 'insights', 'labels',
] as const satisfies readonly ViewId[];

export type HomeView = (typeof HOME_VIEWS)[number];

/**
 * How much room a list gives each task.
 *
 * Comfortable is the layout the product was designed at. Compact tightens the
 * space around things without touching the things themselves: the same type at
 * the same size, the same information on every row, and the same targets to
 * press. It is a shorter page, not a smaller one.
 */
export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export const isDensity = (value: unknown): value is Density =>
  typeof value === 'string' && (DENSITIES as readonly string[]).includes(value);

/**
 * Light, dark, or whatever the device is set to.
 *
 * "system" is a standing instruction rather than a value: the app resolves it
 * against the device every time the device changes its mind, which is why the
 * concrete scheme is never what gets stored here.
 */
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const isTheme = (value: unknown): value is Theme =>
  typeof value === 'string' && (THEMES as readonly string[]).includes(value);

/**
 * The brand colour.
 *
 * A name, not a hex value: a theme is a family of nine tokens in two schemes,
 * and the stylesheet is the only thing that should know what any of them are.
 */
export const ACCENTS = [
  'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink',
] as const;
export type Accent = (typeof ACCENTS)[number] | 'custom';

export const isAccent = (value: unknown): value is Accent =>
  typeof value === 'string'
  && (value === 'custom' || (ACCENTS as readonly string[]).includes(value));

/** A hex colour, as typed or picked. Only the hue and saturation are used. */
export const isHexColour = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

export const isHomeView = (value: unknown): value is HomeView =>
  typeof value === 'string' && (HOME_VIEWS as readonly string[]).includes(value);

/**
 * How the week is split in the sidebar.
 *
 * 'unified' is the product's own answer: one page holding today and the rest of
 * the week, because deciding what today is means seeing what the week still
 * owes. Some people want the older separation back, and there are two honest
 * ways to draw it — a week that excludes today, or a week that still contains
 * it — so both are offered rather than one being guessed at.
 */
export const WEEK_LAYOUTS = ['unified', 'split'] as const;
export type WeekLayout = (typeof WEEK_LAYOUTS)[number];

export const MATRIX_LAYOUTS = ['list', 'matrix'] as const;
export type MatrixLayout = (typeof MATRIX_LAYOUTS)[number];

export const EISENHOWER_URGENCY_RULES = [
  'overdue', 'today', 'tomorrow', 'after-tomorrow', 'next-seven', 'week',
] as const;
export type EisenhowerUrgencyRule = (typeof EISENHOWER_URGENCY_RULES)[number];

export const EISENHOWER_PRIORITIES = [1, 2, 3, 4] as const;
export type EisenhowerPriority = (typeof EISENHOWER_PRIORITIES)[number];

export const isMatrixLayout = (value: unknown): value is MatrixLayout =>
  typeof value === 'string' && (MATRIX_LAYOUTS as readonly string[]).includes(value);

const isEisenhowerUrgencyRule = (value: unknown): value is EisenhowerUrgencyRule =>
  typeof value === 'string'
  && (EISENHOWER_URGENCY_RULES as readonly string[]).includes(value);

const isEisenhowerPriority = (value: unknown): value is EisenhowerPriority =>
  typeof value === 'number'
  && (EISENHOWER_PRIORITIES as readonly number[]).includes(value);

export const isWeekLayout = (value: unknown): value is WeekLayout =>
  typeof value === 'string' && (WEEK_LAYOUTS as readonly string[]).includes(value);

/** Everything the user can tune. Stored on the device, never on a server. */
export interface Preferences {
  locale: Locale;
  /** Where the app opens when no destination is in the address bar. */
  homepage: HomeView;
  /**
   * Reads a date out of a task's name as you type it.
   *
   * Only the date: `#project`, `p1` and `@tag` are explicit syntax the user
   * typed on purpose, and they keep working whatever this is set to.
   */
  naturalDates: boolean;
  hour12: boolean;
  /** The order the parts of a written-out date appear in. */
  dateFormat: DateFormat;
  dailyCapacity: DailyCapacity;
  weeklyCapacityOverride: number | null;
  showQuickGroup: boolean;
  conflicts: ConflictSettings;
  sidebarCollapsed: boolean;
  /** How much room a list gives each task. */
  density: Density;
  /** The colour scheme; "system" follows the device. */
  theme: Theme;
  /** The brand colour. Every accent exists in both schemes. */
  accent: Accent;
  /**
   * The colour behind `accent: 'custom'`.
   *
   * Kept even while a named accent is selected, so going back to Custom
   * returns to the colour that was chosen rather than to a default.
   */
  accentCustom: string;
  /** Filters, grouping, sorting and mode are remembered per view. */
  views: Record<string, ViewPrefs>;
  upcomingHorizonDays: number;
  /** Whether Today has a page of its own beside My week. */
  weekLayout: WeekLayout;
  /**
   * The tag that means "anytime this week".
   *
   * A board that already says `this_week` should not have to be relabelled to
   * use this app. Anything else the product reads — `quick`, `est-*` — is
   * either rare enough or structural enough not to need the same courtesy.
   */
  weekLabel: string;
  /**
   * How long a project may go untouched before the weekly review mentions it.
   *
   * Fourteen days is a fair default and a poor constant: on a fast-moving board
   * it is permanent noise, and on a slow one the warning never arrives at all.
   * Either way the step gets ignored after three passes, which is worse than
   * not asking.
   */
  quietAfterDays: number;
  /** Sections stay out of the global palette until explicitly requested. */
  includeSectionsInSearch: boolean;
  /** The Matrix is an optional decision lens, never a default data mutation. */
  eisenhowerEnabled: boolean;
  /** The Matrix remembers its own presentation independently of task views. */
  eisenhowerLayout: MatrixLayout;
  /** Independent date/week buckets that count as urgent. */
  eisenhowerUrgent: EisenhowerUrgencyRule[];
  /** Displayed Todoist priorities that count as important. */
  eisenhowerImportant: EisenhowerPriority[];
  /** Whether tasks dated after today are included in the matrix. */
  eisenhowerShowFuture: boolean;
  /** Whether the undated Someday backlog is included in the matrix. */
  eisenhowerIncludeSomeday: boolean;
  /** Narrows the matrix to one workspace's projects; null is every workspace. */
  eisenhowerWorkspace: string | null;
  /**
   * The account has been through the first run (walkthrough finished or
   * skipped). Kept with the settings so a second browser does not ask again;
   * the device also remembers it on its own (domain/onboarding.ts).
   */
  onboarded: boolean;
}

export const defaultPreferences = (locale: Locale): Preferences => ({
  locale,
  homepage: 'week',
  naturalDates: true,
  hour12: false,
  dateFormat: 'dmy',
  dailyCapacity: defaultCapacity(),
  weeklyCapacityOverride: null,
  showQuickGroup: true,
  conflicts: defaultConflictSettings(),
  sidebarCollapsed: false,
  density: 'comfortable',
  theme: 'system',
  accent: 'red',
  accentCustom: '#d1453b',
  views: {},
  upcomingHorizonDays: 15,
  weekLayout: 'unified',
  weekLabel: DEFAULT_WEEK_LABEL,
  quietAfterDays: 14,
  includeSectionsInSearch: false,
  eisenhowerEnabled: false,
  eisenhowerLayout: 'matrix',
  eisenhowerUrgent: ['overdue', 'today'],
  eisenhowerImportant: [1, 2],
  eisenhowerShowFuture: false,
  eisenhowerIncludeSomeday: false,
  eisenhowerWorkspace: null,
  onboarded: false,
});

/**
 * Reads the preferences for one view, falling back to the defaults.
 *
 * The defaults are the view's own: what a page opens grouped by depends on
 * what the page is, so the key goes with the question.
 */
export const viewPrefs = (prefs: Preferences, viewKey: string): ViewPrefs =>
  prefs.views[viewKey] ?? defaultViewPrefs(viewKey);

/**
 * Merges stored preferences over the defaults so a version that adds a new
 * setting does not lose the user's existing choices or crash on a missing key.
 */
export function hydratePreferences(stored: unknown, locale: Locale): Preferences {
  const base = defaultPreferences(locale);
  if (!stored || typeof stored !== 'object') return base;
  const s = stored as Partial<Preferences>;
  const storedWeekLayout = (stored as Record<string, unknown>).weekLayout;
  return {
    ...base,
    ...s,
    dailyCapacity: Array.isArray(s.dailyCapacity) && s.dailyCapacity.length === 7
      ? (s.dailyCapacity as DailyCapacity)
      : base.dailyCapacity,
    conflicts: { ...base.conflicts, ...(s.conflicts ?? {}) },
    // A homepage stored by an older build may name a view that no longer exists.
    homepage: isHomeView(s.homepage) ? s.homepage : base.homepage,
    density: isDensity(s.density) ? s.density : base.density,
    theme: isTheme(s.theme) ? s.theme : base.theme,
    accent: isAccent(s.accent) ? s.accent : base.accent,
    accentCustom: isHexColour(s.accentCustom) ? s.accentCustom : base.accentCustom,
    dateFormat: (DATE_FORMATS as readonly string[]).includes(s.dateFormat as string)
      ? (s.dateFormat as DateFormat)
      : base.dateFormat,
    weekLayout: storedWeekLayout === 'splitWithToday'
      ? 'split'
      : isWeekLayout(s.weekLayout) ? s.weekLayout : base.weekLayout,
    weekLabel: typeof s.weekLabel === 'string' && s.weekLabel.trim()
      ? s.weekLabel.trim()
      : base.weekLabel,
    quietAfterDays: Number.isFinite(s.quietAfterDays) && (s.quietAfterDays as number) > 0
      ? Math.round(s.quietAfterDays as number)
      : base.quietAfterDays,
    includeSectionsInSearch: s.includeSectionsInSearch === true,
    eisenhowerEnabled: s.eisenhowerEnabled === true,
    eisenhowerLayout: isMatrixLayout(s.eisenhowerLayout)
      ? s.eisenhowerLayout
      : base.eisenhowerLayout,
    eisenhowerUrgent: Array.isArray(s.eisenhowerUrgent)
      ? s.eisenhowerUrgent.filter(isEisenhowerUrgencyRule)
      : base.eisenhowerUrgent,
    eisenhowerImportant: Array.isArray(s.eisenhowerImportant)
      ? s.eisenhowerImportant.filter(isEisenhowerPriority)
      : base.eisenhowerImportant,
    eisenhowerShowFuture: s.eisenhowerShowFuture === true,
    eisenhowerIncludeSomeday: s.eisenhowerIncludeSomeday === true,
    eisenhowerWorkspace: typeof s.eisenhowerWorkspace === 'string' ? s.eisenhowerWorkspace : null,
    onboarded: s.onboarded === true,
    views: s.views ?? {},
  };
}
