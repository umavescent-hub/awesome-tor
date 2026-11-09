import { describe, expect, it } from 'vitest';

import type { Material } from '@/domain/types';
import { material } from '@/engine/testing';

import { buildSearchIndex, search } from './index';

const DOCUMENTS = 5_000;
const BUDGET_MS = 50;

/** Deterministic pseudo-random numbers (32-bit LCG), so the corpus is identical on every run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

function syntheticLibrary(count: number): Material[] {
  const random = seededRandom(42);
  const syllables = ['fer', 'men', 'ta', 'tion', 'ko', 'ji', 'kel', 'ler', 'mi', 'so', 'lac', 'to', 'ba', 'cil'];
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const vocabulary = Array.from({ length: 3_000 }, () =>
    Array.from({ length: 2 + Math.floor(random() * 3) }, () => pick(syllables)).join(''),
  );
  vocabulary.push('fermentation', 'koji', 'keller');
  const words = (n: number): string => Array.from({ length: n }, () => pick(vocabulary)).join(' ');
  return Array.from({ length: count }, (_, i) =>
    material(`m${i}`, {
      title: words(5),
      abstract: words(50),
      tags: [pick(vocabulary), pick(vocabulary)],
      authors: [words(2)],
      year: 1990 + (i % 35),
    }),
  );
}

/** A pasted paragraph: many distinct words, most of them unknown to the index. */
function pastedText(words: number): string {
  const random = seededRandom(7);
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return Array.from({ length: words }, () =>
    Array.from({ length: 4 + Math.floor(random() * 8) }, () => letters[Math.floor(random() * 26)]).join(''),
  ).join(' ');
}

describe('search performance', () => {
  const index = buildSearchIndex(syntheticLibrary(DOCUMENTS));

  it(`answers typical queries over ${DOCUMENTS} documents in under ${BUDGET_MS} ms`, () => {
    const queries = [
      'fermentaton',
      'fermentation koji',
      'kel',
      'fermentaton koji kel',
      'author:ko tag:fer mi',
      '"kojikel tation" -lacto',
    ];
    search(index, queries[0] ?? ''); // warm up the JIT once

    for (const query of queries) {
      const started = performance.now();
      search(index, query);
      expect(performance.now() - started, query).toBeLessThan(BUDGET_MS);
    }
  });

  it(`answers a pasted 1,000-word query in under ${BUDGET_MS} ms`, () => {
    const query = pastedText(1_000);
    search(index, query); // warm up the JIT once

    const started = performance.now();
    search(index, query);
    expect(performance.now() - started).toBeLessThan(BUDGET_MS);
  });
});
