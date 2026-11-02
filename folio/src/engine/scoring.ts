/**
 * Per-candidate score components. Each returns a value in 0..1 (the blocked penalty is <= 0)
 * and is weighted by RECOMMENDATION_WEIGHTS into the base score.
 */
import type { Difficulty, Material, Progress, ScoreBreakdown } from '@/domain/types';

import type { PrerequisiteStatus } from './prerequisites';
import { daysSince, halfLifeDecay } from './time';
import { cosine, type SparseVector } from './vectors';

/**
 * Base score = Σ weight × component, plus the (already negative) blocked penalty.
 * `blocked` is the penalty scale: a fully blocked material loses 0.6, enough to sink it below
 * anything ready, yet the list never comes back empty when the whole library is blocked.
 */
export const RECOMMENDATION_WEIGHTS = {
  affinity: 0.28,
  readiness: 0.12,
  momentum: 0.22,
  foundation: 0.1,
  effortFit: 0.08,
  stretch: 0.12,
  sequence: 0.3,
  blocked: 0.6,
} as const;

export type WeightedComponent = Exclude<keyof ScoreBreakdown, 'blocked'>;

const WEIGHTED_COMPONENTS: readonly WeightedComponent[] = [
  'affinity',
  'readiness',
  'momentum',
  'foundation',
  'effortFit',
  'stretch',
  'sequence',
];

const MOMENTUM_HALF_LIFE_DAYS = 10;
/** Effort fit halves roughly every two extra "days" of remaining work beyond the budget. */
const EFFORT_OVERRUN_SCALE = 3;
const COLD_START_DIFFICULTY = 2;
const STRETCH_STEP = 0.5;

/** A component's share of the base score. */
export function contribution(breakdown: ScoreBreakdown, component: WeightedComponent): number {
  return RECOMMENDATION_WEIGHTS[component] * breakdown[component];
}

export function baseScore(breakdown: ScoreBreakdown): number {
  return WEIGHTED_COMPONENTS.reduce(
    (sum, component) => sum + contribution(breakdown, component),
    breakdown.blocked,
  );
}

export function affinity(profile: SparseVector, candidate: SparseVector): number {
  return Math.max(0, cosine(profile, candidate));
}

export function readiness(prerequisites: PrerequisiteStatus): number {
  return prerequisites.total === 0 ? 1 : prerequisites.completed / prerequisites.total;
}

export function blockedPenalty(prerequisites: PrerequisiteStatus): number {
  if (prerequisites.missing.length === 0) return 0;
  return (-RECOMMENDATION_WEIGHTS.blocked * prerequisites.missing.length) / prerequisites.total;
}

/** Started work pulls harder the further along it is, and fades as it goes untouched. */
export function momentum(progress: Progress | undefined, now: Date): number {
  if (progress?.status !== 'in_progress') return 0;
  const idleDays = daysSince(progress.lastOpenedAt ?? progress.startedAt, now);
  return (0.5 + 0.5 * progress.percent) * halfLifeDecay(idleDays, MOMENTUM_HALF_LIFE_DAYS);
}

/** Log-scaled share of the unfinished library that (transitively) builds on this material. */
export function foundation(dependentCount: number, unfinishedCount: number): number {
  if (unfinishedCount <= 1) return 0;
  return Math.log(1 + dependentCount) / Math.log(1 + unfinishedCount);
}

export function remainingMinutes(material: Material, progress: Progress | undefined): number {
  return material.minutes * (1 - (progress?.percent ?? 0));
}

/** 1 when the remaining work fits one day's budget, decaying smoothly beyond it. */
export function effortFit(remaining: number, dailyMinutes: number): number {
  const ratio = remaining / Math.max(1, dailyMinutes);
  return ratio <= 1 ? 1 : Math.exp(-(ratio - 1) / EFFORT_OVERRUN_SCALE);
}

/** Gaussian around half a level above recent work (level 2 when nothing is completed yet). */
export function stretch(difficulty: Difficulty, recentLevel: number | undefined): number {
  const target = recentLevel === undefined ? COLD_START_DIFFICULTY : recentLevel + STRETCH_STEP;
  return Math.exp(-((difficulty - target) ** 2) / 2);
}

/** 1, 1/2, 1/3 … by position among the playlist's unfinished items; 0 outside a playlist. */
export function sequence(playlistRank: number | undefined): number {
  return playlistRank === undefined ? 0 : 1 / (1 + playlistRank);
}
