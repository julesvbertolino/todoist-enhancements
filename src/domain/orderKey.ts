/**
 * Todoist's `order_key`: where something sits among its siblings.
 *
 * Todoist is moving from position numbers (`child_order`, `section_order`,
 * `item_order`) to fractional-indexing keys — short strings such as `a0`,
 * `a1V` or `a5dMa` that sort by plain character comparison, and between any
 * two of which another always exists. A move is then one write to the thing
 * that moved, with no neighbour renumbered.
 *
 * Once a key has been written, Todoist stops keeping the old number for that
 * object (it drops to 0), so an app that sorts by the number alone shows an
 * order the official apps no longer agree with. Everything here sorts by the
 * key when both sides have one, and by the old number otherwise: objects not
 * migrated yet carry `order_key: null`.
 *
 * The keys follow the common base-62 fractional-indexing scheme, which is the
 * one Todoist's own keys are written in: a head letter giving the length of
 * an integer part (`a` = one digit), then that integer, then an optional
 * fraction that never ends in the zero digit.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0];
const SMALLEST_INTEGER = `A${ZERO.repeat(26)}`;

/* ---------- Sorting ---------- */

/** Plain code-unit comparison: keys are ASCII and must not be sorted by locale. */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareOrder(
  keyA: string | null | undefined, keyB: string | null | undefined,
  numberA: number, numberB: number,
): number {
  if (keyA && keyB) return compareKeys(keyA, keyB) || numberA - numberB;
  return numberA - numberB;
}

/** Tasks and projects among their siblings. */
export const byChildOrder = (
  a: { order_key?: string | null; child_order: number },
  b: { order_key?: string | null; child_order: number },
): number => compareOrder(a.order_key, b.order_key, a.child_order, b.child_order);

/** Sections within a project. */
export const bySectionOrder = (
  a: { order_key?: string | null; section_order: number },
  b: { order_key?: string | null; section_order: number },
): number => compareOrder(a.order_key, b.order_key, a.section_order, b.section_order);

/** Labels in the user's own order. */
export const byLabelOrder = (
  a: { order_key?: string | null; item_order: number },
  b: { order_key?: string | null; item_order: number },
): number => compareOrder(a.order_key, b.order_key, a.item_order, b.item_order);

/* ---------- Making keys ---------- */

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error(`Invalid order key head: ${head}`);
}

function integerPart(key: string): string {
  const length = integerLength(key[0]);
  if (length > key.length) throw new Error(`Invalid order key: ${key}`);
  return key.slice(0, length);
}

function validate(key: string): void {
  if (key === SMALLEST_INTEGER) throw new Error(`Invalid order key: ${key}`);
  const fraction = key.slice(integerPart(key).length);
  if (fraction.endsWith(ZERO)) throw new Error(`Invalid order key: ${key}`);
}

/** A fraction strictly between `a` and `b` (`b` null meaning "no upper bound"). */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a.endsWith(ZERO) || (b !== null && b.endsWith(ZERO))) throw new Error('Trailing zero');
  if (b !== null) {
    let shared = 0;
    while ((a[shared] ?? ZERO) === b[shared]) shared += 1;
    if (shared > 0) return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round((digitA + digitB) / 2)];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA] + midpoint(a.slice(1), null);
}

function increment(integer: string): string | null {
  const [head, ...digits] = integer.split('');
  let carry = true;
  for (let at = digits.length - 1; carry && at >= 0; at -= 1) {
    const next = DIGITS.indexOf(digits[at]) + 1;
    if (next === DIGITS.length) digits[at] = ZERO;
    else { digits[at] = DIGITS[next]; carry = false; }
  }
  if (!carry) return head + digits.join('');
  if (head === 'Z') return `a${ZERO}`;
  if (head === 'z') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') digits.push(ZERO); else digits.pop();
  return nextHead + digits.join('');
}

function decrement(integer: string): string | null {
  const [head, ...digits] = integer.split('');
  let borrow = true;
  for (let at = digits.length - 1; borrow && at >= 0; at -= 1) {
    const next = DIGITS.indexOf(digits[at]) - 1;
    if (next === -1) digits[at] = DIGITS[DIGITS.length - 1];
    else { digits[at] = DIGITS[next]; borrow = false; }
  }
  if (!borrow) return head + digits.join('');
  if (head === 'a') return `Z${DIGITS[DIGITS.length - 1]}`;
  if (head === 'A') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (nextHead < 'Z') digits.push(DIGITS[DIGITS.length - 1]); else digits.pop();
  return nextHead + digits.join('');
}

/**
 * A key that sorts strictly between `a` and `b`. Either may be null, for "the
 * start" and "the end". Throws when the two are out of order or malformed —
 * callers fall back to writing position numbers when it does.
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) validate(a);
  if (b !== null) validate(b);
  if (a !== null && b !== null && a >= b) throw new Error(`${a} >= ${b}`);

  if (a === null) {
    if (b === null) return `a${ZERO}`;
    const intB = integerPart(b);
    const fracB = b.slice(intB.length);
    if (intB === SMALLEST_INTEGER) return intB + midpoint('', fracB);
    if (intB < b) return intB;
    const lower = decrement(intB);
    if (lower === null) throw new Error('Cannot go below the smallest key');
    return lower;
  }

  if (b === null) {
    const intA = integerPart(a);
    const fracA = a.slice(intA.length);
    const higher = increment(intA);
    return higher === null ? intA + midpoint(fracA, null) : higher;
  }

  const intA = integerPart(a);
  const fracA = a.slice(intA.length);
  const intB = integerPart(b);
  const fracB = b.slice(intB.length);
  if (intA === intB) return intA + midpoint(fracA, fracB);
  const higher = increment(intA);
  if (higher === null) throw new Error('Cannot go above the largest key');
  if (higher < b) return higher;
  return intA + midpoint(fracA, null);
}

/**
 * `count` increasing keys, for drawing a list renumbered the old way.
 *
 * When a reorder is written as position numbers, the screen gives every
 * object in the list a fresh run of keys so the list still sorts one way
 * until Todoist's own keys come back with the answer.
 */
export function keysInOrder(count: number): string[] {
  const keys: string[] = [];
  let previous: string | null = null;
  for (let at = 0; at < count; at += 1) {
    previous = keyBetween(previous, null);
    keys.push(previous);
  }
  return keys;
}
