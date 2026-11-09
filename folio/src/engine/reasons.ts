/**
 * Human explanations for a recommendation. Each builder returns a reason only when its signal
 * is meaningful; the reason's weight is that signal's contribution to the score.
 */
import { analyze, contentWords, stem } from '@/domain/text';
import type { Material, Progress, Reason, ScoreBreakdown } from '@/domain/types';

import { descending } from './order';
import { contribution } from './scoring';
import type { SparseVector } from './vectors';

const MAX_REASONS = 3;
const MAX_INTEREST_TERMS = 2;
const UNLOCK_WINDOW_DAYS = 14;
/** Cosine at which content counts as like your reading: "affinity" needs it, "fresh" less. */
const INTEREST_SIMILARITY = 0.1;
const MIN_STRETCH_FOR_REASON = 0.5;

export interface StudyFacts {
  material: Material;
  progress: Progress | undefined;
  breakdown: ScoreBreakdown;
  /** Most recently completed prerequisite, present only when every known prerequisite is done. */
  latestPrerequisite?: { title: string; daysAgo: number | undefined };
  /** Unfinished materials that transitively build on this one. */
  dependentCount: number;
  /** Shared profile terms for display, strongest first. */
  interests: readonly string[];
  /**
   * Cosine to everything being read (this material included while in progress); undefined
   * before anything has been read.
   */
  readingSimilarity: number | undefined;
  playlist?: { name: string; rank: number };
  dailyMinutes: number;
  recentLevel: number | undefined;
  /** Diversity bonus weight, present only when MMR moved this above its relevance rank. */
  freshWeight?: number;
}

export function quoted(title: string): string {
  return `“${title}”`;
}

const ORDINAL_SUFFIXES: Readonly<Record<number, string>> = { 1: 'st', 2: 'nd', 3: 'rd' };

function ordinal(n: number): string {
  const lastTwo = n % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th' : (ORDINAL_SUFFIXES[n % 10] ?? 'th');
  return `${n}${suffix}`;
}

function continueReason(facts: StudyFacts): Reason | undefined {
  if (facts.progress?.status !== 'in_progress') return undefined;
  const percent = Math.round(facts.progress.percent * 100);
  const text =
    percent > 0
      ? `You're ${percent}% through — finish what you started`
      : 'You started this — pick up where you left off';
  return { code: 'continue', text, weight: contribution(facts.breakdown, 'momentum') };
}

function prerequisiteReason(facts: StudyFacts): Reason | undefined {
  const latest = facts.latestPrerequisite;
  if (latest === undefined) return undefined;
  const weight = contribution(facts.breakdown, 'readiness');
  if (latest.daysAgo !== undefined && latest.daysAgo <= UNLOCK_WINDOW_DAYS) {
    return { code: 'unlocked', text: `Unlocked — you finished ${quoted(latest.title)}`, weight };
  }
  return {
    code: 'prereq_ready',
    text: `Builds on ${quoted(latest.title)}, which you've completed`,
    weight,
  };
}

function foundationReason(facts: StudyFacts): Reason | undefined {
  const n = facts.dependentCount;
  if (n === 0) return undefined;
  const text = n === 1 ? '1 queued material builds on this' : `${n} queued materials build on this`;
  return { code: 'foundation', text, weight: contribution(facts.breakdown, 'foundation') };
}

function affinityReason(facts: StudyFacts): Reason | undefined {
  if (facts.breakdown.affinity < INTEREST_SIMILARITY || facts.interests.length === 0) {
    return undefined;
  }
  return {
    code: 'affinity',
    text: `Matches your interest in ${facts.interests.join(', ')}`,
    weight: contribution(facts.breakdown, 'affinity'),
  };
}

function playlistReason(facts: StudyFacts): Reason | undefined {
  if (facts.playlist === undefined) return undefined;
  const { name, rank } = facts.playlist;
  const text = rank === 0 ? `Next up in ${quoted(name)}` : `${ordinal(rank + 1)} in line in ${quoted(name)}`;
  return { code: 'playlist_order', text, weight: contribution(facts.breakdown, 'sequence') };
}

function effortReason(facts: StudyFacts): Reason | undefined {
  if (facts.breakdown.effortFit < 1) return undefined;
  return {
    code: 'effort_fit',
    text: `Fits your ${Math.round(facts.dailyMinutes)}-minute daily budget`,
    weight: contribution(facts.breakdown, 'effortFit'),
  };
}

function stretchReason(facts: StudyFacts): Reason | undefined {
  const { recentLevel, breakdown, material } = facts;
  if (recentLevel === undefined || material.difficulty <= recentLevel) return undefined;
  if (breakdown.stretch < MIN_STRETCH_FOR_REASON) return undefined;
  return {
    code: 'stretch',
    text: 'A step up from your recent level',
    weight: contribution(breakdown, 'stretch'),
  };
}

/**
 * MMR only knows the item differs from the picks above it; the text also claims it differs from
 * the reader's own reading, so that is checked here (and never alongside an affinity reason).
 */
function freshReason(facts: StudyFacts): Reason | undefined {
  const { freshWeight, readingSimilarity, breakdown } = facts;
  if (freshWeight === undefined || readingSimilarity === undefined) return undefined;
  if (Math.max(readingSimilarity, breakdown.affinity) >= INTEREST_SIMILARITY) return undefined;
  return {
    code: 'fresh',
    text: 'Something different from your recent reading',
    weight: freshWeight,
  };
}

/** The strongest meaningful reasons, highest weight first. */
export function studyReasons(facts: StudyFacts): Reason[] {
  return [
    continueReason(facts),
    prerequisiteReason(facts),
    foundationReason(facts),
    affinityReason(facts),
    playlistReason(facts),
    effortReason(facts),
    stretchReason(facts),
    freshReason(facts),
  ]
    .filter((reason): reason is Reason => reason !== undefined && reason.weight > 0)
    .sort((a, b) => descending(a.weight, b.weight))
    .slice(0, MAX_REASONS);
}

function finishedAgo(days: number): string {
  if (days === 0) return 'finished today';
  if (days === 1) return 'finished yesterday';
  return `finished ${days} days ago`;
}

export function reviewReason(daysSinceCompleted: number | undefined, weight: number): Reason {
  const text =
    daysSinceCompleted === undefined ? 'Review due' : `Review due — ${finishedAgo(Math.floor(daysSinceCompleted))}`;
  return { code: 'review_due', text, weight };
}

/**
 * Up to two profile terms this candidate shares, strongest first. Whole tags are preferred
 * ("lactic acid" reads better than "acid"); author and venue words are never shown.
 */
export function sharedInterests(profile: SparseVector, candidate: SparseVector, material: Material): string[] {
  const overlap = (term: string): number => Math.max(0, (profile.get(term) ?? 0) * (candidate.get(term) ?? 0));
  const byScore = (labels: Iterable<string>, score: (label: string) => number): string[] =>
    [...labels]
      .map((label) => ({ label, score: score(label) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => descending(a.score, b.score))
      .map((entry) => entry.label);

  // A tag is named only when all of its words are in the profile: someone who read about
  // "amino acids" has not shown an interest in "lactic acid".
  const tags = byScore(new Set(material.tags), (tag) => {
    const overlaps = analyze(tag).map(overlap);
    if (!overlaps.every((value) => value > 0)) return 0;
    return overlaps.reduce((sum, value) => sum + value, 0);
  });
  const hidden = new Set([...material.tags, ...material.authors, material.venue ?? ''].flatMap(analyze));
  const surface = surfaceForms(`${material.title} ${material.abstract}`);
  const words = byScore(
    [...candidate.keys()].filter((term) => !hidden.has(term) && surface.has(term)),
    overlap,
  ).map((term) => surface.get(term) ?? term);
  return [...tags, ...words].slice(0, MAX_INTEREST_TERMS);
}

/** Stem → the first real word in `text` that produced it ("gastrophysic" → "gastrophysics"). */
function surfaceForms(text: string): Map<string, string> {
  const forms = new Map<string, string>();
  for (const word of contentWords(text)) {
    const key = stem(word);
    if (!forms.has(key)) forms.set(key, word);
  }
  return forms;
}
