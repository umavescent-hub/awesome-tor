/**
 * Readers that turn untrusted JSON values into typed values, or `undefined` when unusable.
 */
import { MATERIAL_KINDS, type MaterialKind, type ProgressStatus } from '@/domain/types';
import { clamp } from './util';

const PROGRESS_STATUSES: readonly ProgressStatus[] = ['queued', 'in_progress', 'completed', 'skipped'];

/** A plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function readString(value: unknown): string | undefined {
  return isString(value) ? value : undefined;
}

/** Finite numbers, or numeric strings coerced to one. */
export function readNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
}

/**
 * A calendar date, or a date-time with an explicit offset, in the ECMAScript subset of ISO-8601
 * (e.g. "2026-11-02", "2026-11-02T13:00Z", "2026-11-02T13:00:00.000+05:30").
 * Only this subset is parsed the same way by every JS engine; looser strings that V8 accepts may
 * be NaN on Hermes, and offset-less times depend on the device time zone.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?(Z|[+-]\d{2}:\d{2}))?$/;

/** A valid ISO-8601 string (see ISO_DATE), returned unchanged. */
export function readIsoDate(value: unknown): string | undefined {
  return isString(value) && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

/** Array of strings (non-strings dropped), or undefined when not an array at all. */
export function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter(isString) : undefined;
}

/** Rounds and clamps to the 1..5 scale used by difficulty and rating. */
export function readScale5(value: unknown): 1 | 2 | 3 | 4 | 5 | undefined {
  const number = readNumber(value);
  // Rounded and clamped to 1..5, so the cast is exact.
  return number === undefined ? undefined : (Math.round(clamp(number, 1, 5)) as 1 | 2 | 3 | 4 | 5);
}

export function isMaterialKind(value: unknown): value is MaterialKind {
  return MATERIAL_KINDS.includes(value as MaterialKind);
}

export function isProgressStatus(value: unknown): value is ProgressStatus {
  return PROGRESS_STATUSES.includes(value as ProgressStatus);
}

/** Drops `undefined` values so absent optional fields stay absent instead of becoming `key: undefined`. */
export function definedOnly<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<T>;
}
