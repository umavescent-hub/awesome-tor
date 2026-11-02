import type { ID } from '@/domain/types';

import { compareIds } from './order';

export interface MmrItem {
  id: ID;
  /** Relevance already normalised to 0..1 across the candidate set. */
  relevance: number;
}

export interface MmrPick<T> {
  item: T;
  /** The item's position in the input, i.e. its pure-relevance rank when input is sorted. */
  rank: number;
  /** Highest similarity to any earlier pick at the moment this one was chosen. */
  maxSimilarity: number;
}

/** Min-max scale to 0..1. A set with no spread is uniformly relevant (all 1). */
export function normalizeToUnit(values: readonly number[]): number[] {
  const min = Math.min(...values);
  const spread = Math.max(...values) - min;
  return values.map((value) => (spread > 0 ? (value - min) / spread : 1));
}

/**
 * Greedy Maximal Marginal Relevance: repeatedly pick argmax λ·relevance − (1−λ)·maxSim(picked).
 * Exact objective ties go to the smaller id, so the order is fully deterministic.
 */
export function mmrRerank<T extends MmrItem>(
  items: readonly T[],
  similarity: (a: T, b: T) => number,
  lambda: number,
  count: number,
): MmrPick<T>[] {
  const pending = items.map((item, rank) => ({ item, rank, maxSimilarity: 0 }));
  type Pending = (typeof pending)[number];
  const objective = (entry: Pending): number =>
    lambda * entry.item.relevance - (1 - lambda) * entry.maxSimilarity;
  const better = (a: Pending, b: Pending): Pending => {
    const difference = objective(a) - objective(b);
    if (difference !== 0) return difference > 0 ? a : b;
    return compareIds(a.item.id, b.item.id) <= 0 ? a : b;
  };

  const picks: MmrPick<T>[] = [];
  while (picks.length < count && pending.length > 0) {
    const best = pending.reduce(better);
    pending.splice(pending.indexOf(best), 1);
    picks.push({ ...best });
    for (const entry of pending) {
      entry.maxSimilarity = Math.max(entry.maxSimilarity, similarity(entry.item, best.item));
    }
  }
  return picks;
}
