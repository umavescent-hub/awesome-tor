/**
 * Small pure helpers shared by the reducer, selectors and persistence.
 */
import type { ID } from '@/domain/types';

export const DAY_MS = 86_400_000;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/**
 * Own-property lookup. Plain `record[id]` would also find inherited keys such as
 * "constructor", which must never resolve to an entity.
 */
export function lookup<T>(record: Readonly<Record<ID, T>>, id: ID): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, id) ? record[id] : undefined;
}

/** Copy of `record` without `key`. */
export function omitKey<T>(record: Readonly<Record<ID, T>>, key: ID): Record<ID, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

/** Same own keys with `Object.is`-equal values; lets reducers return the old state for no-op updates. */
export function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]));
}

export function mapValues<T, U>(record: Readonly<Record<ID, T>>, fn: (value: T) => U): Record<ID, U> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fn(value)]));
}

/** Epoch ms of an ISO string; -Infinity when missing or unparsable, so it sorts last. */
export function timeOf(iso: string | undefined): number {
  const time = iso === undefined ? Number.NaN : Date.parse(iso);
  return Number.isNaN(time) ? -Infinity : time;
}

/** Comparator: most recent ISO timestamp first, missing ones last. */
export function byNewest(a: string | undefined, b: string | undefined): number {
  const ta = timeOf(a);
  const tb = timeOf(b);
  if (ta === tb) return 0;
  return tb > ta ? 1 : -1;
}
