import type { ISODate } from '@/domain/types';

export const MS_PER_DAY = 86_400_000;

/** Fractional days from `iso` to `now`, clamped at 0. Undefined for a missing or invalid date. */
export function daysSince(iso: ISODate | undefined, now: Date): number | undefined {
  if (iso === undefined) return undefined;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return undefined;
  return Math.max(0, (now.getTime() - time) / MS_PER_DAY);
}

/** Epoch ms of an ISO date; a missing or invalid date sorts as the oldest possible (−∞). */
export function timeOrOldest(iso: ISODate | undefined): number {
  const time = Date.parse(iso ?? '');
  return Number.isNaN(time) ? -Infinity : time;
}

export function addDays(now: Date, days: number): ISODate {
  return new Date(now.getTime() + days * MS_PER_DAY).toISOString();
}

/** 0.5^(days / halfLife). An unknown age counts as fresh (1): there is nothing to decay from. */
export function halfLifeDecay(days: number | undefined, halfLifeDays: number): number {
  return days === undefined ? 1 : Math.pow(0.5, days / halfLifeDays);
}
