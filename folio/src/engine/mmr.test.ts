import { describe, expect, it } from 'vitest';

import { type MmrItem, type MmrPick, mmrRerank } from './mmr';
import { compareIds } from './order';

interface Item extends MmrItem {
  topic: number[];
}

/** Textbook greedy MMR: rescans every pending item after every pick. */
function referenceMmr(
  items: readonly Item[],
  similarity: (a: Item, b: Item) => number,
  lambda: number,
  count: number,
): MmrPick<Item>[] {
  const pending = items.map((item, rank) => ({ item, rank, maxSimilarity: 0 }));
  const objective = (entry: (typeof pending)[number]): number =>
    lambda * entry.item.relevance - (1 - lambda) * entry.maxSimilarity;
  const picks: MmrPick<Item>[] = [];
  while (picks.length < count && pending.length > 0) {
    const best = pending.reduce((a, b) => {
      const difference = objective(a) - objective(b);
      if (difference !== 0) return difference > 0 ? a : b;
      return compareIds(a.item.id, b.item.id) <= 0 ? a : b;
    });
    pending.splice(pending.indexOf(best), 1);
    picks.push({ ...best });
    for (const entry of pending) {
      entry.maxSimilarity = Math.max(entry.maxSimilarity, similarity(entry.item, best.item));
    }
  }
  return picks;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Coarse relevance and topics, so exact objective ties are common. */
function randomItems(random: () => number, count: number): Item[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `i${Math.floor(random() * 1_000)}-${i}`,
    relevance: Math.round(random() * 4) / 4,
    topic: Array.from({ length: 3 }, () => Math.round(random() * 2)),
  })).sort((a, b) => b.relevance - a.relevance || compareIds(a.id, b.id));
}

const overlap = (a: Item, b: Item): number =>
  a.topic.reduce((sum, value, i) => sum + (value === b.topic[i] ? 1 : 0), 0) / a.topic.length;

describe('mmrRerank', () => {
  it('picks exactly what textbook greedy MMR picks, ties included', () => {
    const random = seededRandom(11);
    for (let run = 0; run < 300; run += 1) {
      const items = randomItems(random, 1 + Math.floor(random() * 40));
      const lambda = [0, 0.25, 0.5, 0.75, 1][run % 5] ?? 0.75;
      const count = Math.floor(random() * (items.length + 2));

      expect(mmrRerank(items, overlap, lambda, count)).toEqual(referenceMmr(items, overlap, lambda, count));
    }
  });

  it('returns nothing for a zero count or empty input', () => {
    expect(mmrRerank([], overlap, 0.75, 5)).toEqual([]);
    expect(mmrRerank(randomItems(seededRandom(1), 5), overlap, 0.75, 0)).toEqual([]);
  });
});
