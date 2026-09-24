import type { Item, TodoistDue } from '@/domain/types';

/**
 * A task with every field filled in, for tests: only what a test is about
 * needs saying, and everything else is the plainest value Todoist sends.
 */
export function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'task',
    user_id: 'me',
    project_id: 'inbox',
    section_id: null,
    parent_id: null,
    content: 'A task',
    description: '',
    priority: 1,
    due: null,
    deadline: null,
    duration: null,
    labels: [],
    child_order: 1,
    day_order: -1,
    collapsed: false,
    checked: false,
    is_deleted: false,
    added_at: null,
    completed_at: null,
    updated_at: null,
    responsible_uid: null,
    ...overrides,
  };
}

/** A due date as Todoist sends one, from "YYYY-MM-DD" or a local date-time. */
export function due(date: string, overrides: Partial<TodoistDue> = {}): TodoistDue {
  return { date, timezone: null, string: date, lang: 'en', is_recurring: false, ...overrides };
}
