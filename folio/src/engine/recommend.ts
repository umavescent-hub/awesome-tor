/**
 * recommend(): a study lane (scored, then diversity re-ranked with MMR) merged with a capped
 * lane of due spaced-repetition reviews.
 */
import type {
  ID,
  LibraryState,
  Material,
  ProgressStatus,
  Recommendation,
  RecommendOptions,
  ScoreBreakdown,
} from '@/domain/types';

import { mmrRerank, normalizeToUnit } from './mmr';
import { compareIds, descending } from './order';
import {
  dependentsIndex,
  knownPrerequisites,
  prerequisiteStatus,
  type PrerequisiteStatus,
  transitiveDependents,
} from './prerequisites';
import { buildTasteProfile, profileWithout, recentDifficulty, type TasteProfile } from './profile';
import { reviewReason, sharedInterests, type StudyFacts, studyReasons } from './reasons';
import { isReviewDue } from './review';
import * as score from './scoring';
import { daysSince, timeOrOldest } from './time';
import { type Corpus, corpusFor, dot, type SparseVector, vectorOf } from './vectors';

const DEFAULT_LIMIT = 10;
const DEFAULT_DIVERSITY = 0.75;
const CONFIDENCE_TEMPERATURE = 0.15;
const REVIEW_BASE_SCORE = 0.55;
const REVIEW_OVERDUE_SCALE = 0.08;

const ZERO_BREAKDOWN: ScoreBreakdown = {
  affinity: 0,
  readiness: 0,
  momentum: 0,
  foundation: 0,
  effortFit: 0,
  stretch: 0,
  sequence: 0,
  blocked: 0,
};

function statusOf(state: LibraryState, id: ID): ProgressStatus {
  return state.progress[id]?.status ?? 'queued';
}

function isUnfinished(status: ProgressStatus): boolean {
  return status === 'queued' || status === 'in_progress';
}

/** Category and playlist filters, shared by both lanes. An unknown playlist matches nothing. */
function scopeFilter(state: LibraryState, opts: RecommendOptions): (material: Material) => boolean {
  const members =
    opts.playlistId === undefined
      ? undefined
      : new Set(state.playlists[opts.playlistId]?.materialIds ?? []);
  return (material) =>
    (opts.categoryId === undefined || material.categoryId === opts.categoryId) &&
    (members === undefined || members.has(material.id));
}

function materialsById(state: LibraryState): Material[] {
  return Object.keys(state.materials)
    .sort()
    .flatMap((id) => state.materials[id] ?? []);
}

/* ─────────────────────────────── Study lane ─────────────────────────────── */

interface StudyContext {
  state: LibraryState;
  now: Date;
  corpus: Corpus;
  profile: TasteProfile;
  recentLevel: number | undefined;
  dependents: ReadonlyMap<ID, readonly ID[]>;
  unfinished: ReadonlySet<ID>;
  playlist?: { name: string; ranks: ReadonlyMap<ID, number> };
}

interface Candidate {
  material: Material;
  vector: SparseVector;
  score: number;
  facts: StudyFacts;
}

function playlistContext(
  state: LibraryState,
  playlistId: ID | undefined,
  unfinished: ReadonlySet<ID>,
): StudyContext['playlist'] {
  const playlist = playlistId === undefined ? undefined : state.playlists[playlistId];
  if (playlist === undefined) return undefined;
  const queue = [...new Set(playlist.materialIds)].filter((id) => unfinished.has(id));
  return { name: playlist.name, ranks: new Map(queue.map((id, rank) => [id, rank])) };
}

function studyContext(state: LibraryState, opts: RecommendOptions): StudyContext {
  const corpus = corpusFor(state.materials, state.categories);
  const unfinished = new Set(
    Object.keys(state.materials).filter((id) => isUnfinished(statusOf(state, id))),
  );
  return {
    state,
    now: opts.now,
    corpus,
    profile: buildTasteProfile(state, corpus, opts.now),
    recentLevel: recentDifficulty(state),
    dependents: dependentsIndex(state.materials),
    unfinished,
    playlist: playlistContext(state, opts.playlistId, unfinished),
  };
}

/** The most recently completed prerequisite, when every known prerequisite is completed. */
function latestPrerequisite(
  context: StudyContext,
  prerequisites: PrerequisiteStatus,
  materialId: ID,
): StudyFacts['latestPrerequisite'] {
  if (prerequisites.total === 0 || prerequisites.missing.length > 0) return undefined;
  const { materials, progress } = context.state;
  const latest = knownPrerequisites(materials, materialId)
    .map((id) => ({ id, completedAt: progress[id]?.completedAt }))
    .sort((a, b) =>
      descending(timeOrOldest(a.completedAt), timeOrOldest(b.completedAt), compareIds(a.id, b.id)),
    )[0];
  const title = latest && materials[latest.id]?.title;
  if (latest === undefined || title === undefined) return undefined;
  return { title, daysAgo: daysSince(latest.completedAt, context.now) };
}

function scoreCandidate(context: StudyContext, material: Material): Candidate {
  const { state, now, profile } = context;
  const progress = state.progress[material.id];
  const vector = vectorOf(context.corpus, material.id);
  const taste = profileWithout(profile, material.id, vector);
  const prerequisites = prerequisiteStatus(state, material.id);
  const dependentCount = [...transitiveDependents(context.dependents, material.id)].filter((id) =>
    context.unfinished.has(id),
  ).length;
  const playlistRank = context.playlist?.ranks.get(material.id);

  const breakdown: ScoreBreakdown = {
    affinity: score.affinity(taste, vector),
    readiness: score.readiness(prerequisites),
    momentum: score.momentum(progress, now),
    foundation: score.foundation(dependentCount, context.unfinished.size),
    effortFit: score.effortFit(score.remainingMinutes(material, progress), state.settings.dailyMinutes),
    stretch: score.stretch(material.difficulty, context.recentLevel),
    sequence: score.sequence(playlistRank),
    blocked: score.blockedPenalty(prerequisites),
  };
  const facts: StudyFacts = {
    material,
    progress,
    breakdown,
    latestPrerequisite: latestPrerequisite(context, prerequisites, material.id),
    dependentCount,
    interests: sharedInterests(taste, vector, material),
    playlist:
      context.playlist && playlistRank !== undefined
        ? { name: context.playlist.name, rank: playlistRank }
        : undefined,
    dailyMinutes: state.settings.dailyMinutes,
    recentLevel: context.recentLevel,
  };
  return { material, vector, score: score.baseScore(breakdown), facts };
}

function byScoreThenId<T extends { score: number }>(id: (item: T) => ID) {
  return (a: T, b: T): number => descending(a.score, b.score, compareIds(id(a), id(b)));
}

function studyLane(
  state: LibraryState,
  opts: RecommendOptions,
  inScope: (material: Material) => boolean,
  count: number,
): Recommendation[] {
  if (count <= 0) return [];
  const candidates = materialsById(state).filter(
    (material) => isUnfinished(statusOf(state, material.id)) && inScope(material),
  );
  if (candidates.length === 0) return [];

  const context = studyContext(state, opts);
  const ranked = candidates
    .map((material) => scoreCandidate(context, material))
    .sort(byScoreThenId((candidate) => candidate.material.id));
  const relevance = normalizeToUnit(ranked.map((candidate) => candidate.score));
  const lambda = Math.min(1, Math.max(0, opts.diversity ?? DEFAULT_DIVERSITY));
  const picks = mmrRerank(
    ranked.map((candidate, rank) => ({
      ...candidate,
      id: candidate.material.id,
      relevance: relevance[rank] ?? 0,
    })),
    (a, b) => dot(a.vector, b.vector),
    lambda,
    count,
  );

  return picks.map(({ item, rank, maxSimilarity }, position) => {
    // Promoted above its pure-relevance rank: the diversity term earned it this slot.
    const freshWeight = position < rank ? (1 - lambda) * (1 - maxSimilarity) : undefined;
    return {
      materialId: item.id,
      lane: 'study',
      score: item.score,
      confidence: 0,
      reasons: studyReasons({ ...item.facts, freshWeight }),
      breakdown: item.facts.breakdown,
    };
  });
}

/* ─────────────────────────────── Review lane ────────────────────────────── */

/**
 * Due reviews, most overdue first. Review items carry no study components, so their
 * breakdown is all zeros; their score comes from how overdue they are.
 */
function reviewLane(
  state: LibraryState,
  inScope: (material: Material) => boolean,
  now: Date,
): Recommendation[] {
  return materialsById(state)
    .filter((material) => inScope(material) && isReviewDue(state.progress[material.id], now))
    .map((material) => {
      const progress = state.progress[material.id];
      const overdueDays = daysSince(progress?.review?.dueAt, now) ?? 0;
      const reviewScore = REVIEW_BASE_SCORE + REVIEW_OVERDUE_SCALE * Math.log(1 + overdueDays);
      return {
        materialId: material.id,
        lane: 'review' as const,
        score: reviewScore,
        confidence: 0,
        reasons: [reviewReason(daysSince(progress?.completedAt, now), reviewScore)],
        breakdown: ZERO_BREAKDOWN,
      };
    })
    .sort(byScoreThenId((recommendation) => recommendation.materialId));
}

/* ──────────────────────────────── Assembly ──────────────────────────────── */

const byRecommendationRank = byScoreThenId((recommendation: Recommendation) => recommendation.materialId);

/** Merge two lanes by score, preserving each lane's own order (merge sort's merge step). */
function mergeLanes(
  study: readonly Recommendation[],
  reviews: readonly Recommendation[],
): Recommendation[] {
  const merged: Recommendation[] = [];
  let s = 0;
  let r = 0;
  for (let a = study[s], b = reviews[r]; a && b; a = study[s], b = reviews[r]) {
    if (byRecommendationRank(a, b) <= 0) {
      merged.push(a);
      s += 1;
    } else {
      merged.push(b);
      r += 1;
    }
  }
  return [...merged, ...study.slice(s), ...reviews.slice(r)];
}

/** Softmax of score / temperature over the returned list. */
function withConfidence(recommendations: Recommendation[]): Recommendation[] {
  const max = Math.max(...recommendations.map((recommendation) => recommendation.score));
  const weights = recommendations.map((recommendation) =>
    Math.exp((recommendation.score - max) / CONFIDENCE_TEMPERATURE),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return recommendations.map((recommendation, index) => ({
    ...recommendation,
    confidence: (weights[index] ?? 0) / total,
  }));
}

export function recommend(state: LibraryState, opts: RecommendOptions): Recommendation[] {
  const limit = Math.max(0, Math.floor(opts.limit ?? DEFAULT_LIMIT));
  if (limit === 0) return [];
  const inScope = scopeFilter(state, opts);
  // Due reviews get reserved slots (up to a third of the list) so study items cannot crowd them out.
  const reviews =
    (opts.includeReviews ?? true)
      ? reviewLane(state, inScope, opts.now).slice(0, Math.ceil(limit / 3))
      : [];
  const study = studyLane(state, opts, inScope, limit - reviews.length);
  return withConfidence(mergeLanes(study, reviews));
}
