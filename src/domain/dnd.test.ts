import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropMutation, moveArgs, placementFor } from './dnd';
import { weekLabel } from './types';
import { due, item } from '@/test/items';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-24T09:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('moveArgs', () => {
  /* Regression #64/#65: Todoist's item_move takes exactly one destination,
     and sending both moved nothing. */
  it('sends only the section when there is one', () => {
    expect(moveArgs({ project_id: 'p', section_id: 's' })).toEqual({ section_id: 's' });
  });

  it('sends only the project otherwise', () => {
    expect(moveArgs({ project_id: 'p', section_id: null })).toEqual({ project_id: 'p' });
    expect(moveArgs({ project_id: 'p' })).toEqual({ project_id: 'p' });
  });
});

describe('placementFor', () => {
  it('dates Today and Quick for today, and tags Quick', () => {
    expect(placementFor({ kind: 'today' })).toEqual({ date: '2026-09-24' });
    expect(placementFor({ kind: 'quick' })).toEqual({ date: '2026-09-24', labels: ['quick'] });
  });

  it('labels Anytime this week, and carries nothing into Someday', () => {
    expect(placementFor({ kind: 'anytime' })).toEqual({ labels: [weekLabel()] });
    expect(placementFor({ kind: 'someday' })).toEqual({});
  });

  it('places into a project, and a section inside it', () => {
    expect(placementFor({ kind: 'section', projectId: 'p', sectionId: 's' }))
      .toEqual({ projectId: 'p', sectionId: 's' });
    expect(placementFor({ kind: 'section', projectId: 'p', sectionId: null }))
      .toEqual({ projectId: 'p' });
  });
});

describe('dropMutation', () => {
  it('dates a task for today and drops the week label', () => {
    const task = item({ labels: [weekLabel(), 'home'] });
    expect(dropMutation(task, { kind: 'today' })?.update).toMatchObject({
      due: { date: '2026-09-24', is_recurring: false },
      labels: ['home'],
    });
  });

  it('keeps the rule of a repeating task dropped on another day', () => {
    const task = item({ due: due('2026-09-21', { string: 'every monday', is_recurring: true }) });
    const update = dropMutation(task, { kind: 'day', date: new Date('2026-09-30T00:00:00') })?.update;
    expect(update?.due).toEqual({
      date: '2026-09-30', timezone: null, string: 'every monday', lang: 'en', is_recurring: true,
    });
  });

  it('keeps the time of day when moving to another day', () => {
    const task = item({ due: due('2026-09-24T09:30:00') });
    const update = dropMutation(task, { kind: 'day', date: new Date('2026-09-25T00:00:00') })?.update;
    expect((update?.due as { date: string }).date).toBe('2026-09-25T09:30:00');
  });

  it('takes the date off and tags the week for Anytime', () => {
    const task = item({ due: due('2026-09-24') });
    expect(dropMutation(task, { kind: 'anytime' })).toEqual({
      update: { due: null, labels: [weekLabel()] },
    });
  });

  it('does nothing for a task dropped where it already is', () => {
    const task = item({ project_id: 'p', section_id: 's' });
    expect(dropMutation(task, { kind: 'project', projectId: 'p' })).toBeNull();
    expect(dropMutation({ ...task, section_id: null }, { kind: 'project', projectId: 'p' }))
      .toBeNull();
    expect(dropMutation(task, { kind: 'section', projectId: 'p', sectionId: 's' })).toBeNull();
  });

  it('lifts a subtask out when dropped on its own project', () => {
    const task = item({ project_id: 'p', parent_id: 'parent' });
    expect(dropMutation(task, { kind: 'project', projectId: 'p' }))
      .toEqual({ move: { project_id: 'p' } });
  });

  it('adds a label without replacing the others, and only once', () => {
    const task = item({ labels: ['home'] });
    expect(dropMutation(task, { kind: 'label', label: 'errand' }))
      .toEqual({ update: { labels: ['home', 'errand'] } });
    expect(dropMutation(task, { kind: 'label', label: 'Home' })).toBeNull();
  });

  it('never makes a task a favourite', () => {
    expect(dropMutation(item(), { kind: 'favourites' })).toBeNull();
  });
});
