/**
 * Pure Progress → Progress transitions behind the `progress/*` actions.
 * The reducer resolves the entry (creating a queued one when missing) and stores the result.
 */
import type { ID, ISODate, Progress, ReviewGrade } from '@/domain/types';
import { initialReviewCard, scheduleReview } from '@/engine';
import { clamp, timeOf } from './util';

/** Opens closer together than this belong to the same study session. */
export const SESSION_GAP_MS = 30 * 60_000;

export function emptyProgress(materialId: ID): Progress {
  return { materialId, status: 'queued', percent: 0, sessions: 0 };
}

/** Fraction of the material's effort already spent (completed always counts as 1). */
export function completionOf(progress: Progress): number {
  return progress.status === 'completed' ? 1 : progress.percent;
}

function startsNewSession(lastOpenedAt: ISODate | undefined, at: ISODate): boolean {
  return lastOpenedAt === undefined || timeOf(at) - timeOf(lastOpenedAt) > SESSION_GAP_MS;
}

/** Queued or skipped → in progress; any other status is left alone. */
function begin(progress: Progress, at: ISODate): Progress {
  if (progress.status !== 'queued' && progress.status !== 'skipped') return progress;
  return { ...progress, status: 'in_progress', startedAt: progress.startedAt ?? at };
}

/** Back to in progress, dropping the completion timestamp and review card. */
function reopen(progress: Progress): Progress {
  const next: Progress = { ...progress, status: 'in_progress' };
  delete next.completedAt;
  delete next.review;
  return next;
}

export function open(progress: Progress, at: ISODate): Progress {
  const sessions = startsNewSession(progress.lastOpenedAt, at) ? progress.sessions + 1 : progress.sessions;
  return { ...progress, sessions, lastOpenedAt: at };
}

export function start(progress: Progress, at: ISODate): Progress {
  return open(begin(progress, at), at);
}

export function complete(progress: Progress, at: ISODate): Progress {
  return {
    ...progress,
    status: 'completed',
    percent: 1,
    completedAt: at,
    startedAt: progress.startedAt ?? at,
    review: progress.review ?? initialReviewCard(new Date(at)),
  };
}

/** `percent` must not be NaN (the reducer treats NaN as a no-op). */
export function setPercent(progress: Progress, percent: number, at: ISODate): Progress {
  const clamped = clamp(percent, 0, 1);
  if (clamped >= 1) return complete(progress, at);
  const base = progress.status === 'completed' ? reopen(progress) : progress;
  const next = clamped > 0 ? begin(base, at) : base;
  return { ...next, percent: clamped, lastOpenedAt: at };
}

/**
 * Completed work stays completed: a skipped entry would keep its completedAt and review card,
 * and a later start would carry them into in-progress work.
 */
export function skip(progress: Progress): Progress {
  return progress.status === 'completed' ? progress : { ...progress, status: 'skipped' };
}

export function rate(progress: Progress, rating: 1 | 2 | 3 | 4 | 5): Progress {
  return { ...progress, rating };
}

/** Only completed materials carry a review card; anything else is returned unchanged. */
export function review(progress: Progress, grade: ReviewGrade, at: ISODate): Progress {
  if (progress.status !== 'completed') return progress;
  return { ...progress, review: scheduleReview(progress.review, grade, new Date(at)) };
}
