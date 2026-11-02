/**
 * What the reader has been studying: a weighted TF-IDF taste profile and their recent
 * difficulty level. Both are derived purely from progress records and the injected clock.
 */
import type { ID, LibraryState, Progress } from '@/domain/types';

import { compareIds, descending } from './order';
import { daysSince, halfLifeDecay, timeOrOldest } from './time';
import { addScaled, type Corpus, type SparseVector, vectorOf } from './vectors';

const TASTE_HALF_LIFE_DAYS = 21;
const SKIPPED_WEIGHT = -0.5;
const RECENT_LEVEL_WINDOW = 5;

export interface TasteProfile {
  readonly vector: SparseVector;
  /** Positive contributions only: the completed and in-progress work actually being read. */
  readonly reading: SparseVector;
  /** Weight each contributing material added, so a candidate can be scored without itself. */
  readonly weights: ReadonlyMap<ID, number>;
}

function tasteWeight(progress: Progress, now: Date): number {
  const lastTouched = progress.completedAt ?? progress.lastOpenedAt ?? progress.startedAt;
  const recency = halfLifeDecay(daysSince(lastTouched, now), TASTE_HALF_LIFE_DAYS);
  if (progress.status === 'skipped') return SKIPPED_WEIGHT * recency;
  // ★ -0.5 · ★★ 0 · ★★★ 0.5 · ★★★★ 1 · ★★★★★ 1.5: a poor rating steers away from similar work.
  const ratingFactor = progress.rating === undefined ? 1 : (progress.rating - 2) / 2;
  return ratingFactor * recency;
}

export function buildTasteProfile(state: LibraryState, corpus: Corpus, now: Date): TasteProfile {
  const vector = new Map<string, number>();
  const reading = new Map<string, number>();
  const weights = new Map<ID, number>();
  for (const id of Object.keys(state.progress).sort()) {
    const progress = state.progress[id];
    if (progress === undefined || progress.status === 'queued' || !state.materials[id]) continue;
    const weight = tasteWeight(progress, now);
    addScaled(vector, vectorOf(corpus, id), weight);
    if (weight > 0) addScaled(reading, vectorOf(corpus, id), weight);
    weights.set(id, weight);
  }
  return { vector, reading, weights };
}

/**
 * The profile minus one material's own contribution. An in-progress material is part of the
 * profile; without this it would always look like a perfect match for itself.
 */
export function profileWithout(profile: TasteProfile, id: ID, vector: SparseVector): SparseVector {
  const weight = profile.weights.get(id);
  if (weight === undefined) return profile.vector;
  const rest = new Map(profile.vector);
  addScaled(rest, vector, -weight);
  return rest;
}

/** Mean difficulty of the most recently completed materials; undefined on cold start. */
export function recentDifficulty(state: LibraryState): number | undefined {
  const recent = Object.values(state.progress)
    .filter((progress) => progress.status === 'completed' && state.materials[progress.materialId])
    .sort((a, b) =>
      descending(timeOrOldest(a.completedAt), timeOrOldest(b.completedAt), compareIds(a.materialId, b.materialId)),
    )
    .slice(0, RECENT_LEVEL_WINDOW)
    .flatMap((progress) => state.materials[progress.materialId]?.difficulty ?? []);
  if (recent.length === 0) return undefined;
  return recent.reduce((sum, difficulty) => sum + difficulty, 0) / recent.length;
}
