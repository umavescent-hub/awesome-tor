/**
 * Settings defaults and normalisation, shared by the reducer and persistence.
 */
import type { Settings } from '@/domain/types';
import { clamp } from './util';

export const DEFAULT_SETTINGS: Readonly<Settings> = { dailyMinutes: 60, displayName: 'Chef' };

export const DAILY_MINUTES_MIN = 5;
export const DAILY_MINUTES_MAX = 600;

/** Whole minutes within [DAILY_MINUTES_MIN, DAILY_MINUTES_MAX]. */
export function clampDailyMinutes(minutes: number): number {
  return Math.round(clamp(minutes, DAILY_MINUTES_MIN, DAILY_MINUTES_MAX));
}
