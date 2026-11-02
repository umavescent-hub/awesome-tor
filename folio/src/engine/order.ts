import type { ID } from '@/domain/types';

/** Code-point order, independent of locale, so results are identical on every device. */
export function compareIds(a: ID, b: ID): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Higher first; equal values fall through to `tieBreak`. Safe for ±Infinity. */
export function descending(a: number, b: number, tieBreak = 0): number {
  if (a === b) return tieBreak;
  return a > b ? -1 : 1;
}
