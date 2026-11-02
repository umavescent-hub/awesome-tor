import { describe, expect, it } from 'vitest';

import { recommend } from './index';
import { daysAgo, library, material, NOW, progress } from './testing';

const MATERIALS = 5_000;

/** A large library: overlapping vocabulary, shallow prerequisite trees, 250 progress records. */
function largeLibrary(count: number) {
  const words = Array.from({ length: 2_000 }, (_, i) => `w${i.toString(36)}`);
  const word = (i: number): string => words[i % words.length] ?? '';
  const id = (i: number): string => `m${String(i).padStart(4, '0')}`;
  return library({
    materials: Array.from({ length: count }, (_, i) =>
      material(id(i), {
        title: `${word(i)} ${word(i * 7)}`,
        abstract: Array.from({ length: 40 }, (_, j) => word(i * 13 + j * 17)).join(' '),
        tags: [word(i * 3), word(i * 11)],
        prerequisites: i % 10 === 0 ? [] : [id(i - (i % 10))],
      }),
    ),
    progress: Array.from({ length: count / 20 }, (_, i) =>
      i % 5 === 0
        ? progress(id(i * 3), 'in_progress', { percent: 0.3, lastOpenedAt: daysAgo(i % 9) })
        : progress(id(i * 3), 'completed', { completedAt: daysAgo(i % 40) }),
    ),
  });
}

describe('recommend performance', () => {
  const state = largeLibrary(MATERIALS);

  // Diversity re-ranking used to cost O(limit × materials) similarity computations, and every
  // candidate re-measured the whole taste profile: 300 ms at limit 10, over 2 s at limit 200.
  it.each([
    [10, 150],
    [200, 400],
  ])(`ranks ${MATERIALS} materials with limit %i in under %i ms`, (limit, budgetMs) => {
    for (let i = 0; i < 3; i += 1) recommend(state, { now: NOW, limit }); // warm up the JIT and caches

    const started = performance.now();
    expect(recommend(state, { now: NOW, limit })).toHaveLength(limit);
    expect(performance.now() - started).toBeLessThan(budgetMs);
  });
});
