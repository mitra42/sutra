// Positions are short sortable codes, not 1, 2, 3. A new one is chosen to fall between its
// neighbours, so inserting or moving one item never renumbers the others, and two devices
// reordering the same List rarely collide.
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// A code that sorts after `before` and ahead of `after`. Either may be empty, meaning "the end".
export function between(before, after) {
  const a = before || '';
  let b = after || null;
  let result = '';
  for (let i = 0; ; i += 1) {
    const low = i < a.length ? DIGITS.indexOf(a[i]) : 0;
    const high = b !== null && i < b.length ? DIGITS.indexOf(b[i]) : DIGITS.length;
    if (high - low > 1) return result + DIGITS[Math.floor((low + high) / 2)];
    result += DIGITS[low];
    // One apart: keep the lower digit, after which anything at all sorts ahead of `after`.
    if (high - low === 1) b = null;
  }
}
