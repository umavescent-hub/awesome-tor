import type { Progress, ReviewCard, ReviewGrade } from '@/domain/types';

import { addDays } from './time';

const INITIAL_EASE = 2.5;
const MIN_EASE = 1.3;
const HARD_INTERVAL_FACTOR = 0.6;
const EASY_INTERVAL_FACTOR = 1.3;

/** SM-2 response quality (0..5) for each grade. */
const QUALITY: Readonly<Record<ReviewGrade, number>> = { again: 1, hard: 3, good: 4, easy: 5 };

export function initialReviewCard(now: Date): ReviewCard {
  return { ease: INITIAL_EASE, intervalDays: 1, reps: 0, dueAt: addDays(now, 1) };
}

/**
 * SM-2 ease update. Every possible delta is a multiple of 0.01, so rounding to two decimals
 * removes float drift without changing the schedule.
 */
function nextEase(ease: number, grade: ReviewGrade): number {
  const lapse = 5 - QUALITY[grade];
  const updated = ease + 0.1 - lapse * (0.08 + lapse * 0.02);
  return Math.max(MIN_EASE, Math.round(updated * 100) / 100);
}

/** Classic SM-2 spacing for a successful review: 1 day, then 6, then interval × ease. */
function successInterval(reps: number, previousInterval: number, ease: number): number {
  if (reps === 1) return 1;
  if (reps === 2) return 6;
  return Math.round(previousInterval * ease);
}

function gradeAdjusted(interval: number, grade: ReviewGrade): number {
  if (grade === 'hard') return Math.max(1, Math.round(interval * HARD_INTERVAL_FACTOR));
  if (grade === 'easy') return Math.round(interval * EASY_INTERVAL_FACTOR);
  return interval;
}

export function scheduleReview(card: ReviewCard | undefined, grade: ReviewGrade, now: Date): ReviewCard {
  const current = card ?? initialReviewCard(now);
  const ease = nextEase(current.ease, grade);
  const reps = grade === 'again' ? 0 : current.reps + 1;
  const intervalDays = grade === 'again' ? 1 : gradeAdjusted(successInterval(reps, current.intervalDays, ease), grade);
  return {
    ease,
    intervalDays,
    reps,
    dueAt: addDays(now, intervalDays),
    lastReviewedAt: now.toISOString(),
  };
}

export function isReviewDue(progress: Progress | undefined, now: Date): boolean {
  if (progress?.status !== 'completed' || progress.review === undefined) return false;
  return Date.parse(progress.review.dueAt) <= now.getTime();
}
