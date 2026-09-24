import { describe, expect, it } from 'vitest';
import {
  effectiveEstimate, formatDuration, parseDurationInput, readEstimate, withEstimate,
} from './estimates';
import { item } from '@/test/items';

describe('parseDurationInput', () => {
  it.each([
    ['45', 45],
    ['45 min', 45],
    ['45m', 45],
    ['90 min', 90],
    ['1h', 60],
    ['2 h', 120],
    ['1h15', 75],
    ['1 h 15', 75],
    ['1:30', 90],
    ['1.5h', 90],
    ['1,5 h', 90],
    ['1 heure', 60],
  ])('reads %j as %i minutes', (typed, minutes) => {
    expect(parseDurationInput(typed)).toBe(minutes);
  });

  it.each(['', '   ', 'soon', '0', '0 min', '1h75', '-5'])('refuses %j', (typed) => {
    expect(parseDurationInput(typed)).toBeNull();
  });
});

describe('readEstimate', () => {
  it('finds no estimate on a task without one', () => {
    expect(readEstimate(['week', 'quick'])).toEqual({
      minutes: null, raw: [], multiple: false, invalid: false,
    });
  });

  it('reads est-<minutes>', () => {
    expect(readEstimate(['week', 'est-30']).minutes).toBe(30);
  });

  it('reports two estimates rather than choosing silently', () => {
    const reading = readEstimate(['est-30', 'est-45']);
    expect(reading.multiple).toBe(true);
    expect(reading.minutes).toBe(30);
  });

  it('reports an estimate that is not a positive whole number', () => {
    expect(readEstimate(['est-abc'])).toMatchObject({ minutes: null, invalid: true });
    expect(readEstimate(['est-0'])).toMatchObject({ minutes: null, invalid: true });
  });
});

describe('withEstimate', () => {
  it('replaces every estimate with a single one', () => {
    expect(withEstimate(['week', 'est-10', 'est-20'], 45)).toEqual(['week', 'est-45']);
  });

  it('strips estimates when given null', () => {
    expect(withEstimate(['week', 'est-10'], null)).toEqual(['week']);
  });
});

describe('formatDuration', () => {
  it.each([
    [45, '45 min'],
    [60, '1 h'],
    [75, '1 h 15'],
    [125, '2 h 05'],
  ])('%i minutes reads %j', (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });
});

describe('effectiveEstimate', () => {
  const parent = item({ id: 'parent' });
  const children = [
    item({ id: 'a', parent_id: 'parent', labels: ['est-20'] }),
    item({ id: 'b', parent_id: 'parent', labels: ['est-25'] }),
    item({ id: 'done', parent_id: 'parent', labels: ['est-60'], checked: true }),
  ];
  const childrenOf = (id: string) => (id === 'parent' ? children : []);

  it("prefers the task's own estimate", () => {
    expect(effectiveEstimate({ ...parent, labels: ['est-90'] }, childrenOf))
      .toEqual({ minutes: 90, computed: false });
  });

  it('otherwise sums the open children', () => {
    expect(effectiveEstimate(parent, childrenOf)).toEqual({ minutes: 45, computed: true });
  });
});
