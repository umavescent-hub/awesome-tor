import { describe, expect, it } from 'vitest';

import type { ReviewCard, ReviewGrade } from '@/domain/types';

import { initialReviewCard, isReviewDue, scheduleReview } from './index';
import { daysAgo, NOW, progress } from './testing';
import { MS_PER_DAY } from './time';

const inDays = (days: number): string => new Date(NOW.getTime() + days * MS_PER_DAY).toISOString();

function replay(grades: ReviewGrade[], start?: ReviewCard): ReviewCard[] {
  const cards: ReviewCard[] = [];
  let card = start;
  for (const grade of grades) {
    card = scheduleReview(card, grade, NOW);
    cards.push(card);
  }
  return cards;
}

describe('initialReviewCard', () => {
  it('starts at ease 2.5, due one day later', () => {
    expect(initialReviewCard(NOW)).toEqual({ ease: 2.5, intervalDays: 1, reps: 0, dueAt: inDays(1) });
  });
});

describe('scheduleReview (SM-2)', () => {
  it('spaces good, good, good at 1, 6 and 15 days with ease unchanged', () => {
    const cards = replay(['good', 'good', 'good']);

    expect(cards.map((card) => card.intervalDays)).toEqual([1, 6, 15]);
    expect(cards.map((card) => card.reps)).toEqual([1, 2, 3]);
    expect(cards.every((card) => card.ease === 2.5)).toBe(true);
  });

  it('sets dueAt and lastReviewedAt from the injected clock', () => {
    const [card] = replay(['good', 'good']).slice(1);

    expect(card?.dueAt).toBe(inDays(6));
    expect(card?.lastReviewedAt).toBe(NOW.toISOString());
  });

  it('resets reps and interval on again, and never lets ease fall below 1.3', () => {
    const cards = replay(['good', 'good', 'again', 'again', 'again', 'again']);

    expect(cards[2]).toMatchObject({ reps: 0, intervalDays: 1, ease: 1.96 });
    expect(cards.map((card) => card.ease)).toEqual([2.5, 2.5, 1.96, 1.42, 1.3, 1.3]);
  });

  it('shrinks intervals on hard and stretches them on easy', () => {
    const mature: ReviewCard = { ease: 2.5, intervalDays: 10, reps: 3, dueAt: NOW.toISOString() };

    const hard = scheduleReview(mature, 'hard', NOW);
    expect(hard.ease).toBe(2.36);
    expect(hard.intervalDays).toBe(Math.round(Math.round(10 * 2.36) * 0.6));

    const easy = scheduleReview(mature, 'easy', NOW);
    expect(easy.ease).toBe(2.6);
    expect(easy.intervalDays).toBe(Math.round(Math.round(10 * 2.6) * 1.3));

    expect(scheduleReview(undefined, 'hard', NOW).intervalDays).toBe(1);
  });
});

describe('isReviewDue', () => {
  const review = (dueAt: string): ReviewCard => ({ ease: 2.5, intervalDays: 1, reps: 1, dueAt });

  it('is due only for completed materials whose card is at or past due', () => {
    expect(isReviewDue(progress('a', 'completed', { review: review(daysAgo(1)) }), NOW)).toBe(true);
    expect(isReviewDue(progress('a', 'completed', { review: review(NOW.toISOString()) }), NOW)).toBe(true);
    expect(isReviewDue(progress('a', 'completed', { review: review(inDays(1)) }), NOW)).toBe(false);
    expect(isReviewDue(progress('a', 'in_progress', { review: review(daysAgo(1)) }), NOW)).toBe(false);
    expect(isReviewDue(progress('a', 'completed'), NOW)).toBe(false);
    expect(isReviewDue(undefined, NOW)).toBe(false);
  });
});
