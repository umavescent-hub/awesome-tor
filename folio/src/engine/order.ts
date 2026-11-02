import { compareText } from '@/domain/text';
import type { ID } from '@/domain/types';

/** Locale-independent id order, so results are identical on every device. */
export const compareIds: (a: ID, b: ID) => number = compareText;

/** Higher first; equal values fall through to `tieBreak`. Safe for ±Infinity. */
export function descending(a: number, b: number, tieBreak = 0): number {
  if (a === b) return tieBreak;
  return a > b ? -1 : 1;
}
