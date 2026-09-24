import { describe, expect, it } from 'vitest';
import {
  patchParent, relativePositionFromCenters, reorderAtSlot, reorderRelative,
} from './order';

/* Ported from scripts/verify-reordering.mjs. */

describe('reorderRelative', () => {
  it('puts one project before another', () => {
    expect(reorderRelative(['vermilion', 'slate'], 'slate', 'vermilion', 'before'))
      .toEqual(['slate', 'vermilion']);
  });

  it('puts one after another', () => {
    expect(reorderRelative(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
  });
});

describe('reorderAtSlot', () => {
  it('moves to the end', () => {
    expect(reorderAtSlot(['todo', 'doing', 'review'], 'todo', 3))
      .toEqual(['doing', 'review', 'todo']);
  });

  it('moves to the start', () => {
    expect(reorderAtSlot(['todo', 'doing', 'review'], 'review', 0))
      .toEqual(['review', 'todo', 'doing']);
  });
});

describe('relativePositionFromCenters', () => {
  it('reads before and after from the centres', () => {
    expect(relativePositionFromCenters(1, 0, 100, 100)).toBe('before');
    expect(relativePositionFromCenters(0, 1, 100, 100)).toBe('after');
    expect(relativePositionFromCenters(1, 0, 80, 100)).toBe('before');
    expect(relativePositionFromCenters(0, 1, 120, 100)).toBe('after');
  });
});

describe('patchParent', () => {
  const project = (id: string, child_order: number, parent_id: string | null = null) => ({
    id, name: id, color: 'grey', parent_id, child_order,
    is_archived: false, is_deleted: false, is_favorite: false, workspace_id: null,
  });
  const childrenOf = (projects: Record<string, ReturnType<typeof project>>, parentId: string) =>
    Object.values(projects)
      .filter((entry) => entry.parent_id === parentId)
      .sort((a, b) => a.child_order - b.child_order)
      .map((entry) => entry.id);

  it('nests a project and brings it back out', () => {
    let projects: Record<string, ReturnType<typeof project>> = {
      missions: { ...project('missions', 1), is_folder: true } as ReturnType<typeof project>,
      vermilion: project('vermilion', 2, 'missions'),
      slate: project('slate', 1, 'missions'),
    };
    expect(childrenOf(projects, 'missions')).toEqual(['slate', 'vermilion']);

    projects = patchParent(projects, 'slate', 'vermilion');
    expect(childrenOf(projects, 'vermilion')).toEqual(['slate']);

    projects = patchParent(projects, 'slate', 'missions');
    expect(childrenOf(projects, 'missions')).toEqual(['slate', 'vermilion']);
  });
});
