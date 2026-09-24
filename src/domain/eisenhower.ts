import { differenceInCalendarDays } from 'date-fns';
import { dueDate } from './dates';
import { toDisplayPriority, type Item } from './types';
import type {
  EisenhowerPriority, EisenhowerUrgencyRule,
} from '@/store/prefs';
import { byChildOrder } from './orderKey';

export type EisenhowerQuadrant =
  | 'urgent-important'
  | 'not-urgent-important'
  | 'urgent-not-important'
  | 'not-urgent-not-important';

export const EISENHOWER_QUADRANTS: EisenhowerQuadrant[] = [
  'urgent-important',
  'urgent-not-important',
  'not-urgent-important',
  'not-urgent-not-important',
];

/**
 * A transparent, configurable classification.
 *
 * Overdue dates are always urgent. A date is otherwise urgent through the
 * chosen local-calendar horizon; an undated task never becomes urgent by
 * accident. Importance follows Todoist priority, either P1 only or P1 + P2.
 */
export function eisenhowerQuadrant(
  item: Item,
  now = new Date(),
  urgentRules: EisenhowerUrgencyRule[] = ['overdue', 'today'],
  importantPriorities: EisenhowerPriority[] = [1, 2],
  weekLabel = 'week',
): EisenhowerQuadrant {
  const important = importantPriorities.includes(toDisplayPriority(item.priority));
  const rule = eisenhowerUrgencyRule(item, now, weekLabel);
  const urgent = rule !== null && urgentRules.includes(rule);

  if (urgent && important) return 'urgent-important';
  if (!urgent && important) return 'not-urgent-important';
  if (urgent) return 'urgent-not-important';
  return 'not-urgent-not-important';
}

/** The single, non-overlapping urgency bucket a task belongs to. */
export function eisenhowerUrgencyRule(
  item: Item,
  now = new Date(),
  weekLabel = 'week',
): EisenhowerUrgencyRule | null {
  const due = dueDate(item);
  if (due) {
    const days = differenceInCalendarDays(due, now);
    if (days < 0) return 'overdue';
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days === 2) return 'after-tomorrow';
    if (days <= 7) return 'next-seven';
    return null;
  }
  return item.labels.some((label) => label.toLowerCase() === weekLabel.toLowerCase())
    ? 'week'
    : null;
}

/** Due date, then displayed priority, then Todoist's existing manual order. */
export function sortEisenhower(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    const aDue = dueDate(a)?.getTime() ?? Number.POSITIVE_INFINITY;
    const bDue = dueDate(b)?.getTime() ?? Number.POSITIVE_INFINITY;
    return aDue - bDue
      || toDisplayPriority(a.priority) - toDisplayPriority(b.priority)
      || byChildOrder(a, b)
      || a.id.localeCompare(b.id);
  });
}
