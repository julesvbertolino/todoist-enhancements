import { describe, expect, it } from 'vitest';
import { keyBetween, keysInOrder } from './orderKey';

describe('keyBetween', () => {
  it('starts somewhere when the list is empty', () => {
    expect(typeof keyBetween(null, null)).toBe('string');
  });

  it('lands strictly between its bounds', () => {
    const a = keyBetween(null, null);
    const c = keyBetween(a, null);
    const b = keyBetween(a, c);
    expect(a < b && b < c).toBe(true);
    expect(keyBetween(null, a) < a).toBe(true);
    expect(keyBetween(c, null) > c).toBe(true);
  });

  it('refuses bounds in the wrong order', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    expect(() => keyBetween(b, a)).toThrow();
    expect(() => keyBetween(a, a)).toThrow();
  });

  it('keeps 1000 insertions into the same gap sorted and unique', () => {
    const low = keyBetween(null, null);
    const high = keyBetween(low, null);
    const keys = [low, high];
    // Always into the gap just above `low`, the worst case for key length.
    let upper = high;
    for (let at = 0; at < 1000; at += 1) {
      upper = keyBetween(low, upper);
      keys.push(upper);
    }
    const sorted = [...keys].sort();
    expect(new Set(keys).size).toBe(keys.length);
    expect(sorted[0]).toBe(low);
    expect(sorted[sorted.length - 1]).toBe(high);
  });

  it('keeps 1000 appends at the end sorted', () => {
    const keys = keysInOrder(1000);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(1000);
  });
});
