import { ApiError, request } from './client';
import type { CompletedItem } from '@/domain/types';
import { addDays, differenceInCalendarDays, min as earliest } from 'date-fns';
import { toApiDate } from '@/domain/dates';

/**
 * Reading history, for Insights.
 *
 * Todoist caps how wide a single completed-tasks query may be, so a long
 * period is walked in windows and stitched back together. Each window is also
 * paginated by cursor.
 */

/**
 * How wide one completed-tasks query is.
 *
 * The v1 docs allow a range of "up to 3 months". Eighty-nine days stays inside
 * that whichever three months are meant, and makes a year five windows
 * instead of the nine it took at 42.
 */
const WINDOW_DAYS = 89;
/** The narrowest a window is halved to before a refusal is taken as final. */
const MIN_WINDOW_DAYS = 7;
const PAGE_LIMIT = 200;
/**
 * How many windows are in the air at once.
 *
 * A year is nine windows and was nine round trips end to end, each waiting for
 * the one before it to finish — which is most of why a year of Insights took
 * as long as it did. Four at a time is several times faster and still well
 * short of anything Todoist rate-limits.
 */
const CONCURRENT_WINDOWS = 4;

interface CompletedResponse {
  items: CompletedItem[];
  next_cursor?: string | null;
}

async function fetchWindow(
  since: Date,
  until: Date,
  signal?: AbortSignal,
): Promise<CompletedItem[]> {
  const out: CompletedItem[] = [];
  let cursor: string | undefined;

  do {
    const page = await request<CompletedResponse>('/tasks/completed/by_completion_date', {
      query: {
        since: toApiDate(since),
        until: toApiDate(until),
        limit: PAGE_LIMIT,
        cursor,
      },
      signal,
    });
    out.push(...(page.items ?? []));
    cursor = page.next_cursor ?? undefined;
  } while (cursor);

  return out;
}

/** Cuts a period into consecutive windows of at most `days`, sharing no day. */
function windowsOf(since: Date, until: Date, days: number): Array<{ since: Date; until: Date }> {
  const windows: Array<{ since: Date; until: Date }> = [];
  let cursorDate = since;
  while (cursorDate < until) {
    const windowEnd = earliest([addDays(cursorDate, days), until]);
    windows.push({ since: cursorDate, until: windowEnd });
    cursorDate = addDays(windowEnd, 1);
  }
  return windows;
}

/**
 * One window, narrowed if Todoist says it is too wide.
 *
 * The range the endpoint accepts is a documented number that has already
 * moved once. If it moves again, a refusal about the range halves the window
 * and tries again, so the page gets slower rather than empty.
 */
async function fetchRange(
  since: Date,
  until: Date,
  days: number,
  signal?: AbortSignal,
): Promise<CompletedItem[]> {
  try {
    return await fetchWindow(since, until, signal);
  } catch (error) {
    const narrower = Math.floor(days / 2);
    if (!(error instanceof ApiError) || error.status !== 400 || narrower < MIN_WINDOW_DAYS) throw error;
    const results: CompletedItem[] = [];
    for (const window of windowsOf(since, until, narrower)) {
      results.push(...await fetchRange(window.since, window.until, narrower, signal));
    }
    return results;
  }
}

export async function fetchCompleted(
  since: Date,
  until: Date,
  signal?: AbortSignal,
): Promise<CompletedItem[]> {
  const span = differenceInCalendarDays(until, since);
  if (span <= WINDOW_DAYS) return fetchRange(since, until, WINDOW_DAYS, signal);

  // Work out every window first, then fetch them a few at a time.
  const windows = windowsOf(since, until, WINDOW_DAYS);

  const results: CompletedItem[] = [];
  for (let at = 0; at < windows.length; at += CONCURRENT_WINDOWS) {
    const batch = windows.slice(at, at + CONCURRENT_WINDOWS);
    const pages = await Promise.all(
      batch.map((window) => fetchRange(window.since, window.until, WINDOW_DAYS, signal)),
    );
    for (const page of pages) results.push(...page);
  }

  // Windows share no boundary day, but a defensive de-duplication costs nothing.
  const seen = new Set<string>();
  return results.filter((item) => {
    const key = `${item.id}:${item.completed_at}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
