import { describe, expect, it } from 'vitest';
import { defaultConflictSettings, detectConflicts, detectIncomplete } from './conflicts';
import { weekLabel } from './types';
import { due, item } from '@/test/items';

const noChildren = () => [];
const kinds = (items: Parameters<typeof detectConflicts>[0], childrenOf = noChildren) =>
  detectConflicts(items, childrenOf).map((conflict) => conflict.kind);

describe('detectConflicts', () => {
  it('finds nothing wrong with an ordinary task', () => {
    expect(kinds([item({ labels: ['est-30'] })])).toEqual([]);
  });

  it('flags a "quick" task estimated at 40 minutes', () => {
    expect(kinds([item({ labels: ['quick', 'est-40'] })])).toEqual(['quick-too-long']);
  });

  it('flags a task both dated and labelled for the week', () => {
    expect(kinds([item({ due: due('2026-09-24'), labels: [weekLabel()] })]))
      .toEqual(['date-and-week']);
  });

  it('flags two estimates, recommending the first', () => {
    const [conflict] = detectConflicts([item({ labels: ['est-30', 'est-45'] })], noChildren);
    expect(conflict.kind).toBe('multiple-estimates');
    expect(conflict.options.find((option) => option.recommended)?.payload)
      .toEqual({ label: 'est-30' });
  });

  it('flags an estimate that cannot be read', () => {
    expect(kinds([item({ labels: ['est-soon'] })])).toEqual(['invalid-estimate']);
  });

  it('flags a parent estimated alongside its estimated subtasks', () => {
    const parent = item({ id: 'parent', labels: ['est-60'] });
    const child = item({ id: 'child', parent_id: 'parent', labels: ['est-30'] });
    const [conflict] = detectConflicts([parent], (id) => (id === 'parent' ? [child] : []));
    expect(conflict.kind).toBe('parent-and-children-estimated');
    expect(conflict.messageValues).toEqual({ parent: 60, children: 30 });
  });

  it('leaves a kind alone once it is turned off', () => {
    const settings = { ...defaultConflictSettings(), quickTooLong: false };
    expect(detectConflicts([item({ labels: ['quick', 'est-40'] })], noChildren, settings))
      .toEqual([]);
  });
});

describe('detectIncomplete', () => {
  it('lists the tasks with no estimate', () => {
    const estimated = item({ id: 'estimated', labels: ['est-15'] });
    const bare = item({ id: 'bare' });
    expect(detectIncomplete([estimated, bare]).map((task) => task.id)).toEqual(['bare']);
  });
});
