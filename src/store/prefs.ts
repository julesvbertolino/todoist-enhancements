import type { Locale } from '@/i18n';
import type { ViewId } from '@/domain/types';
import { DEFAULT_WEEK_LABEL, defaultViewPrefs, type ViewPrefs } from '@/domain/types';
import { defaultConflictSettings, type ConflictSettings } from '@/domain/conflicts';
import { defaultCapacity, type DailyCapacity } from '@/domain/load';
import { DATE_FORMATS, type DateFormat } from '@/domain/dates';

/** The Todoist task whose description is the canonical cross-device copy. */
export const PREFERENCES_TASK_CONTENT = '* Enhanced for Todoist settings';

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
    views: s.views ?? {},
  };
}
