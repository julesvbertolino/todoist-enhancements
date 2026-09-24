import { describe, expect, it } from 'vitest';
import { resolveTempIds } from './sync';
import { emptySnapshot, type Snapshot } from '@/domain/types';
import { item } from '@/test/items';

const section = (id: string, project_id: string) => ({
  id, project_id, name: id, section_order: 1, is_archived: false, is_deleted: false,
});

describe('resolveTempIds', () => {
  it('returns the snapshot untouched when nothing was mapped', () => {
    const snapshot = emptySnapshot();
    expect(resolveTempIds(snapshot, {})).toBe(snapshot);
  });

  it('renames a placeholder and points everything at the real id', () => {
    const snapshot: Snapshot = {
      ...emptySnapshot(),
      items: {
        'tmp-parent': item({ id: 'tmp-parent', project_id: 'p', section_id: 'tmp-section' }),
        'tmp-child': item({ id: 'tmp-child', parent_id: 'tmp-parent', project_id: 'p' }),
      },
      sections: { 'tmp-section': section('tmp-section', 'p') },
    };
    const next = resolveTempIds(snapshot, {
      'tmp-parent': 'real-parent', 'tmp-child': 'real-child', 'tmp-section': 'real-section',
    });
    expect(Object.keys(next.items).sort()).toEqual(['real-child', 'real-parent']);
    expect(next.items['real-child'].parent_id).toBe('real-parent');
    expect(next.items['real-parent'].section_id).toBe('real-section');
    expect(Object.keys(next.sections)).toEqual(['real-section']);
  });

  it('drops the placeholder when the real copy has already arrived', () => {
    const snapshot: Snapshot = {
      ...emptySnapshot(),
      items: {
        tmp: item({ id: 'tmp', content: 'placeholder' }),
        real: item({ id: 'real', content: 'from Todoist' }),
      },
    };
    const next = resolveTempIds(snapshot, { tmp: 'real' });
    expect(Object.keys(next.items)).toEqual(['real']);
    expect(next.items.real.content).toBe('from Todoist');
  });
});
