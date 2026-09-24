import { describe, expect, it } from 'vitest';
import { dueForDate, readRecurrence } from './recurrence';

describe('readRecurrence', () => {
  it('finds an English rule inside a title', () => {
    expect(readRecurrence('Water plants every monday')).toEqual({
      matched: 'every monday', index: 13, string: 'every monday', lang: 'en', fromCompletion: false,
    });
  });

  it('finds a French rule', () => {
    expect(readRecurrence('Arroser tous les lundis')).toMatchObject({
      string: 'tous les lundis', lang: 'fr',
    });
  });

  it('reads every! as counted from completion', () => {
    expect(readRecurrence('every! 2 weeks')).toMatchObject({ fromCompletion: true });
  });

  it.each(['every day at 9am', 'every other week'])('reads %j', (text) => {
    expect(readRecurrence(text)?.string).toBe(text);
  });

  it('leaves ordinary text alone', () => {
    expect(readRecurrence('buy milk')).toBeNull();
  });

  it('refuses rules that need a holiday calendar', () => {
    expect(readRecurrence('every workday after holidays')).toBeNull();
  });
});

describe('dueForDate', () => {
  it('moves one occurrence without ending the series', () => {
    const rule = {
      date: '2026-09-21', timezone: null, string: 'every monday', lang: 'en', is_recurring: true,
    };
    expect(dueForDate(rule, '2026-09-30')).toEqual({ ...rule, date: '2026-09-30' });
  });

  it('writes a plain date for a task that does not repeat', () => {
    expect(dueForDate(null, '2026-09-30')).toEqual({
      date: '2026-09-30', timezone: null, string: '2026-09-30', lang: 'en', is_recurring: false,
    });
  });
});
