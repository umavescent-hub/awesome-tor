import { describe, expect, it } from 'vitest';

import type { LibraryState, Recommendation } from '@/domain/types';

import { recommend } from './index';
import {
  category,
  daysAgo,
  fermentationLibrary,
  library,
  material,
  NOW,
  playlist,
  progress,
} from './testing';

const ids = (recommendations: Recommendation[]): string[] =>
  recommendations.map((recommendation) => recommendation.materialId);

const reasonOf = (recommendation: Recommendation | undefined, code: string) =>
  recommendation?.reasons.find((reason) => reason.code === code);

const find = (recommendations: Recommendation[], id: string) =>
  recommendations.find((recommendation) => recommendation.materialId === id);

describe('recommend — study lane', () => {
  it('on cold start prefers the easy foundational item and sinks blocked ones', () => {
    const result = recommend(fermentationLibrary(), { now: NOW });

    expect(result[0]?.materialId).toBe('intro');
    expect(result[0]?.breakdown.foundation).toBeGreaterThan(0);
    expect(reasonOf(result[0], 'foundation')?.text).toBe('4 queued materials build on this');
    // Ready items (intro, stars) come before every blocked one.
    expect(ids(result).slice(0, 2).sort()).toEqual(['intro', 'stars']);
    for (const blocked of result.slice(2)) expect(blocked.breakdown.blocked).toBeLessThan(0);
  });

  it('ranks the in-progress item first with a continue reason', () => {
    const state = fermentationLibrary([
      progress('intro', 'completed', { completedAt: daysAgo(30) }),
      progress('koji', 'in_progress', {
        percent: 0.4,
        startedAt: daysAgo(5),
        lastOpenedAt: daysAgo(1),
      }),
    ]);
    const [first] = recommend(state, { now: NOW });

    expect(first?.materialId).toBe('koji');
    expect(first?.breakdown.momentum).toBeGreaterThan(0.6);
    expect(reasonOf(first, 'continue')?.text).toBe("You're 40% through — finish what you started");
  });

  it('never puts completed or skipped materials in the study lane', () => {
    const state = fermentationLibrary([
      progress('intro', 'completed', { completedAt: daysAgo(2) }),
      progress('stars', 'skipped', { lastOpenedAt: daysAgo(2) }),
    ]);
    const result = recommend(state, { now: NOW });

    expect(ids(result)).not.toContain('intro');
    expect(ids(result)).not.toContain('stars');
  });

  it('still returns everything when the whole library is blocked', () => {
    const state = fermentationLibrary([
      progress('intro', 'skipped', { lastOpenedAt: daysAgo(1) }),
      progress('stars', 'completed', { completedAt: daysAgo(1) }),
    ]);
    const result = recommend(state, { now: NOW });

    expect(ids(result).sort()).toEqual(['koji', 'lacto', 'miso', 'yeast']);
    for (const recommendation of result) expect(recommendation.breakdown.blocked).toBeLessThan(0);
  });

  it('says a material was unlocked when its last prerequisite was finished recently', () => {
    const recent = recommend(
      fermentationLibrary([progress('intro', 'completed', { completedAt: daysAgo(3) })]),
      { now: NOW },
    );
    const old = recommend(
      fermentationLibrary([progress('intro', 'completed', { completedAt: daysAgo(30) })]),
      { now: NOW },
    );

    expect(reasonOf(find(recent, 'lacto'), 'unlocked')?.text).toBe(
      'Unlocked — you finished “Introduction to Fermentation”',
    );
    expect(reasonOf(find(old, 'lacto'), 'unlocked')).toBeUndefined();
    expect(reasonOf(find(old, 'lacto'), 'prereq_ready')?.text).toBe(
      "Builds on “Introduction to Fermentation”, which you've completed",
    );
  });

  it('explains taste matches with the shared tags', () => {
    const state = fermentationLibrary([
      progress('intro', 'completed', { completedAt: daysAgo(30) }),
      progress('koji', 'in_progress', { percent: 0.4, lastOpenedAt: daysAgo(1) }),
    ]);
    const miso = find(recommend(state, { now: NOW }), 'miso');

    expect(reasonOf(miso, 'affinity')?.text).toBe('Matches your interest in koji, fermentation');
  });

  it('honours playlist order and restricts to playlist members', () => {
    const base = fermentationLibrary([progress('intro', 'completed', { completedAt: daysAgo(30) })]);
    const state: LibraryState = {
      ...base,
      playlists: { weekend: playlist('weekend', 'Weekend Ferments', ['koji', 'lacto', 'stars']) },
    };
    const result = recommend(state, { now: NOW, playlistId: 'weekend' });

    expect(ids(result)).toEqual(['koji', 'lacto', 'stars']);
    expect(result.map((recommendation) => recommendation.breakdown.sequence)).toEqual([1, 0.5, 1 / 3]);
    expect(reasonOf(result[0], 'playlist_order')?.text).toBe('Next up in “Weekend Ferments”');
    expect(recommend(state, { now: NOW, playlistId: 'missing' })).toEqual([]);
  });

  it('filters by category', () => {
    const result = recommend(fermentationLibrary(), { now: NOW, categoryId: 'astro' });

    expect(ids(result)).toEqual(['stars']);
  });

  it('respects the limit and reports scores as the base score', () => {
    const result = recommend(fermentationLibrary(), { now: NOW, limit: 2 });

    expect(result).toHaveLength(2);
    const intro = result[0];
    const expected = 0.12 * 1 + 0.1 * (intro?.breakdown.foundation ?? 0) + 0.08 + 0.12 * Math.exp(-0.5);
    expect(intro?.score).toBeCloseTo(expected, 10);
  });

  it('gives confidence as a softmax over the whole candidate set', () => {
    const result = recommend(fermentationLibrary(), { now: NOW });
    const total = result.reduce((sum, recommendation) => sum + recommendation.confidence, 0);

    expect(total).toBeCloseTo(1, 10);
    const [a, b] = result;
    expect(a && b && a.confidence / b.confidence).toBeCloseTo(
      Math.exp(((a?.score ?? 0) - (b?.score ?? 0)) / 0.15),
      10,
    );
  });

  it('does not inflate confidence when the list is cut short', () => {
    const state = fermentationLibrary([progress('intro', 'completed', { completedAt: daysAgo(3) })]);
    const [top] = recommend(state, { now: NOW, limit: 1 });
    const [sameTop] = recommend(state, { now: NOW, limit: 10 });

    expect(top?.materialId).toBe(sameTop?.materialId);
    expect(top?.confidence).toBeLessThan(1);
    expect(top?.confidence).toBeCloseTo(sameTop?.confidence ?? Number.NaN, 10);
  });

  it('limits reasons to three, strongest first, with titles in curly quotes', () => {
    const state = fermentationLibrary([progress('intro', 'completed', { completedAt: daysAgo(3) })]);
    for (const recommendation of recommend(state, { now: NOW })) {
      expect(recommendation.reasons.length).toBeLessThanOrEqual(3);
      const weights = recommendation.reasons.map((reason) => reason.weight);
      expect(weights).toEqual([...weights].sort((a, b) => b - a));
    }
    const lacto = find(recommend(state, { now: NOW }), 'lacto');
    expect(lacto?.reasons[0]?.text).toContain('“Introduction to Fermentation”');
  });
});

describe('recommend — diversity', () => {
  const sourdough = (id: string, title: string) =>
    material(id, {
      title,
      tags: ['sourdough', 'fermentation'],
      abstract: 'Sourdough starters, wild yeast and lactic fermentation of bread dough.',
      categoryId: 'bread',
    });
  const state = library({
    categories: [category('bread', 'Bread'), category('astro', 'Astronomy')],
    materials: [
      sourdough('done', 'Sourdough Fermentation Basics'),
      sourdough('f1', 'Sourdough Fermentation Science'),
      sourdough('f2', 'Sourdough Fermentation Techniques'),
      sourdough('f3', 'Sourdough Fermentation Troubleshooting'),
      material('stars', {
        title: 'Stellar Nucleosynthesis',
        tags: ['stars'],
        abstract: 'How stars forge heavy elements.',
        categoryId: 'astro',
      }),
      material('blocked', { title: 'Advanced Crumb Structure', categoryId: 'bread', prerequisites: ['f1'] }),
    ],
    progress: [progress('done', 'completed', { completedAt: daysAgo(2), rating: 5 })],
  });

  it('keeps pure relevance order at diversity 1', () => {
    expect(ids(recommend(state, { now: NOW, diversity: 1 }))).toEqual([
      'f1',
      'f2',
      'f3',
      'stars',
      'blocked',
    ]);
  });

  it('pushes a different-topic item up by default and says why', () => {
    const result = recommend(state, { now: NOW });

    expect(ids(result).slice(0, 2)).toEqual(['f1', 'stars']);
    expect(reasonOf(find(result, 'stars'), 'fresh')?.text).toBe(
      'Something different from your recent reading',
    );
    expect(reasonOf(find(result, 'f2'), 'fresh')).toBeUndefined();
    // Order changes, scores do not: they stay the base score.
    expect(find(result, 'stars')?.score).toBe(
      find(recommend(state, { now: NOW, diversity: 1 }), 'stars')?.score,
    );
  });

  it('treats a NaN diversity as the default instead of inverting the ranking', () => {
    expect(recommend(state, { now: NOW, diversity: Number.NaN })).toEqual(recommend(state, { now: NOW }));
  });

  it('never calls something you are reading right now "different from your recent reading"', () => {
    const reading: LibraryState = {
      ...state,
      progress: {
        ...state.progress,
        stars: progress('stars', 'in_progress', { percent: 0.3, lastOpenedAt: daysAgo(1) }),
      },
    };
    const stars = find(recommend(reading, { now: NOW }), 'stars');

    expect(reasonOf(stars, 'continue')).toBeDefined();
    expect(reasonOf(stars, 'fresh')).toBeUndefined();
  });

  it('never claims a material both matches your interests and differs from your reading', () => {
    const rye = material('rye', {
      title: 'Rye Bread Chemistry',
      tags: ['rye', 'baking'],
      abstract: 'Rye flour, pentosans and the lactic fermentation of rye dough.',
      categoryId: 'bread',
    });
    const withRye: LibraryState = { ...state, materials: { ...state.materials, rye } };

    for (const recommendation of recommend(withRye, { now: NOW })) {
      const codes = recommendation.reasons.map((reason) => reason.code);
      expect(codes.includes('fresh') && codes.includes('affinity'), recommendation.materialId).toBe(false);
    }
  });

  it('says nothing about "your recent reading" before anything has been read', () => {
    const coldStart: LibraryState = { ...state, progress: {} };

    for (const recommendation of recommend(coldStart, { now: NOW })) {
      expect(reasonOf(recommendation, 'fresh'), recommendation.materialId).toBeUndefined();
    }
  });
});

describe('recommend — affinity reason', () => {
  it('names a multi-word tag only when every word of it is in your profile', () => {
    const state = library({
      materials: [
        material('done', {
          title: 'Browning Chemistry',
          tags: ['amino acids'],
          abstract: 'Amino acids and reducing sugars.',
        }),
        material('pickles', {
          title: 'Pickling Vegetables',
          tags: ['lactic acid'],
          abstract: 'Brines and acid.',
        }),
      ],
      progress: [progress('done', 'completed', { completedAt: daysAgo(2) })],
    });
    const affinity = reasonOf(find(recommend(state, { now: NOW }), 'pickles'), 'affinity');

    expect(affinity?.text ?? '').not.toContain('lactic');
  });
});

describe('recommend — review lane', () => {
  const reviewState = (): LibraryState =>
    fermentationLibrary([
      progress('intro', 'completed', {
        completedAt: daysAgo(12),
        review: { ease: 2.5, intervalDays: 6, reps: 2, dueAt: daysAgo(6) },
      }),
      progress('lacto', 'completed', {
        completedAt: daysAgo(4),
        review: { ease: 2.5, intervalDays: 1, reps: 1, dueAt: daysAgo(1) },
      }),
      progress('stars', 'completed', {
        completedAt: daysAgo(2),
        review: { ease: 2.5, intervalDays: 6, reps: 2, dueAt: daysAgo(-4) },
      }),
    ]);

  it('includes only due reviews, most overdue first, with a dated reason', () => {
    const reviews = recommend(reviewState(), { now: NOW }).filter((r) => r.lane === 'review');

    expect(ids(reviews)).toEqual(['intro', 'lacto']);
    expect(reviews[0]?.score).toBeCloseTo(0.55 + 0.08 * Math.log(7), 10);
    expect(reviews[0]?.reasons).toEqual([
      { code: 'review_due', text: 'Review due — finished 12 days ago', weight: reviews[0]?.score },
    ]);
  });

  it('caps reviews at a third of the limit', () => {
    const result = recommend(reviewState(), { now: NOW, limit: 3 });

    expect(result).toHaveLength(3);
    expect(result.filter((r) => r.lane === 'review').map((r) => r.materialId)).toEqual(['intro']);
  });

  it('returns review breakdowns the caller can change without affecting later results', () => {
    const [review] = recommend(reviewState(), { now: NOW }).filter((r) => r.lane === 'review');
    if (review) review.breakdown.affinity = 1;
    const [next] = recommend(reviewState(), { now: NOW }).filter((r) => r.lane === 'review');

    expect(next?.breakdown.affinity).toBe(0);
  });

  it('can be turned off and respects the category filter', () => {
    expect(recommend(reviewState(), { now: NOW, includeReviews: false }).some((r) => r.lane === 'review')).toBe(
      false,
    );
    expect(recommend(reviewState(), { now: NOW, categoryId: 'astro' })).toEqual([]);
  });

  it('merges lanes by score while keeping each lane in order', () => {
    const result = recommend(reviewState(), { now: NOW });
    const lanes = (lane: string) => result.filter((r) => r.lane === lane);

    expect(ids(lanes('review'))).toEqual(['intro', 'lacto']);
    expect(result[0]?.lane).toBe('review');
    expect(ids(lanes('study'))).toEqual(ids(recommend(reviewState(), { now: NOW, includeReviews: false })).slice(0, 8));
  });
});

describe('recommend — determinism', () => {
  it('returns identical output for identical input, regardless of record order', () => {
    const state = fermentationLibrary([
      progress('intro', 'completed', { completedAt: daysAgo(3), rating: 4 }),
      progress('koji', 'in_progress', { percent: 0.2, lastOpenedAt: daysAgo(2) }),
    ]);
    const reversed: LibraryState = {
      ...state,
      materials: Object.fromEntries(Object.entries(state.materials).reverse()),
      progress: Object.fromEntries(Object.entries(state.progress).reverse()),
    };

    const first = recommend(state, { now: NOW });
    expect(recommend(state, { now: NOW })).toEqual(first);
    expect(recommend(reversed, { now: NOW })).toEqual(first);
  });

  it('breaks exact ties by id', () => {
    const twins = library({ materials: [material('b'), material('a'), material('c')] });

    expect(ids(recommend(twins, { now: NOW, diversity: 1 }))).toEqual(['a', 'b', 'c']);
  });
});
