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

interface Entry<T> extends MmrPick<T> {
  /** How many picks `maxSimilarity` already accounts for. */
  compared: number;
  /** Objective as of `compared` picks: an upper bound on the current one. */
  bound: number;
}

/** Heap order: higher bound first, then smaller id, then earlier input. */
function before<T extends MmrItem>(a: Entry<T>, b: Entry<T>): boolean {
  if (a.bound !== b.bound) return a.bound > b.bound;
  const byId = compareIds(a.item.id, b.item.id);
  return byId !== 0 ? byId < 0 : a.rank < b.rank;
}

/** Moves heap[index] down until both children belong below it. */
function siftDown<T extends MmrItem>(heap: Entry<T>[], index: number): void {
  let parent = index;
  for (;;) {
    let top = parent;
    for (const child of [2 * parent + 1, 2 * parent + 2]) {
      const candidate = heap[child];
      const current = heap[top];
      if (candidate !== undefined && current !== undefined && before(candidate, current)) {
        top = child;
      }
    }
    const moving = heap[parent];
    const replacing = heap[top];
    if (top === parent || moving === undefined || replacing === undefined) return;
    heap[parent] = replacing;
    heap[top] = moving;
    parent = top;
  }
}

/**
 * Greedy Maximal Marginal Relevance: repeatedly pick the item maximising
 *   λ·relevance − (1−λ)·maxSim(item, already picked).
 * Exact objective ties go to the smaller id, so the order is fully deterministic.
 *
 * Evaluated lazily: maxSim only grows, so an item's last computed objective bounds its current
 * one from above. Items wait in a max-heap by that bound and only the top is brought up to date;
 * once the top is current, nothing below it can beat it. The picks are those of rescanning every
 * item after every pick, for a small fraction of the similarity computations.
 */
export function mmrRerank<T extends MmrItem>(
  items: readonly T[],
  similarity: (a: T, b: T) => number,
  lambda: number,
  count: number,
): MmrPick<T>[] {
  const objective = (relevance: number, maxSimilarity: number): number =>
    lambda * relevance - (1 - lambda) * maxSimilarity;
  const heap: Entry<T>[] = items.map((item, rank) => ({
    item,
    rank,
    maxSimilarity: 0,
    compared: 0,
    bound: objective(item.relevance, 0),
  }));
  for (let index = Math.floor(heap.length / 2) - 1; index >= 0; index -= 1) siftDown(heap, index);

  const picks: MmrPick<T>[] = [];
  for (let top = heap[0]; top !== undefined && picks.length < count; top = heap[0]) {
    if (top.compared < picks.length) {
      for (const pick of picks.slice(top.compared)) {
        top.maxSimilarity = Math.max(top.maxSimilarity, similarity(top.item, pick.item));
      }
      top.compared = picks.length;
      top.bound = objective(top.item.relevance, top.maxSimilarity);
      siftDown(heap, 0);
      continue;
    }
    const last = heap.pop();
    if (last !== undefined && heap.length > 0) {
      heap[0] = last;
      siftDown(heap, 0);
    }
    picks.push({ item: top.item, rank: top.rank, maxSimilarity: top.maxSimilarity });
  }
  return picks;
}
