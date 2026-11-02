/**
 * Query-term expansion: which indexed terms a query term may match, and how strongly.
 * Strength order is exact > prefix > typo; a vocabulary term keeps only its strongest kind.
 */
import { compareText } from '@/domain/text';

import type { BuiltIndex } from './build';
import { withinEditDistance } from './distance';

export type MatchKind = 'exact' | 'prefix' | 'fuzzy';

export const MATCH_WEIGHTS: Readonly<Record<MatchKind, number>> = {
  exact: 1,
  prefix: 0.75,
  fuzzy: 0.5,
};

export interface Expansion {
  term: string;
  kind: MatchKind;
  weight: number;
}

const MIN_PREFIX_LENGTH = 2;
/** Short prefixes can match hundreds of terms; keeping the most common bounds as-you-type cost. */
const MAX_PREFIX_EXPANSIONS = 50;

/** Edits tolerated for a term of this length: none below 4, one up to 7, two from 8. */
export function typoBudget(length: number): number {
  if (length >= 8) return 2;
  return length >= 4 ? 1 : 0;
}

function documentFrequency(index: BuiltIndex, term: string): number {
  return index.postings.get(term)?.docs.length ?? 0;
}

/** Most documents first, then alphabetical. */
export function byDocumentFrequency(index: BuiltIndex, terms: readonly string[]): string[] {
  return [...terms].sort(
    (a, b) => documentFrequency(index, b) - documentFrequency(index, a) || compareText(a, b),
  );
}

/** All vocabulary terms starting with `prefix`, via binary search on the sorted vocabulary. */
export function termsWithPrefix(index: BuiltIndex, prefix: string): string[] {
  const { vocabulary } = index;
  let low = 0;
  let high = vocabulary.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((vocabulary[middle] ?? '') < prefix) low = middle + 1;
    else high = middle;
  }
  const matches: string[] = [];
  for (let i = low; i < vocabulary.length; i += 1) {
    const term = vocabulary[i];
    if (term === undefined || !term.startsWith(prefix)) break;
    matches.push(term);
  }
  return matches;
}

function termsWithinTypos(index: BuiltIndex, term: string): string[] {
  const budget = typoBudget(term.length);
  if (budget === 0) return [];
  const matches: string[] = [];
  for (let length = term.length - budget; length <= term.length + budget; length += 1) {
    for (const candidate of index.termsByLength.get(length) ?? []) {
      if (withinEditDistance(term, candidate, budget)) matches.push(candidate);
    }
  }
  return matches.sort();
}

export interface ExpandOptions {
  /** Raw spelling to prefix-match (live typing); omitted means no prefix matches. */
  prefix?: string;
  /** Typo tolerance, on by default. */
  typos?: boolean;
}

function expand(index: BuiltIndex, term: string, { prefix, typos = true }: ExpandOptions): Expansion[] {
  const expansions = new Map<string, Expansion>();
  // Offered strongest kind first, so the first offer for a vocabulary term wins.
  const offer = (candidate: string, kind: MatchKind): void => {
    if (!expansions.has(candidate)) {
      expansions.set(candidate, { term: candidate, kind, weight: MATCH_WEIGHTS[kind] });
    }
  };
  const isKnown = index.postings.has(term);
  if (isKnown) offer(term, 'exact');
  if (prefix !== undefined && prefix.length >= MIN_PREFIX_LENGTH) {
    const prefixed = byDocumentFrequency(index, termsWithPrefix(index, prefix));
    for (const candidate of prefixed.slice(0, MAX_PREFIX_EXPANSIONS)) offer(candidate, 'prefix');
  }
  if (typos && !isKnown) {
    for (const candidate of termsWithinTypos(index, term)) offer(candidate, 'fuzzy');
  }
  return [...expansions.values()];
}

export type Expander = (term: string, options?: ExpandOptions) => Expansion[];

/** Expansion lookup memoised for the duration of one search call. */
export function createExpander(index: BuiltIndex): Expander {
  const cache = new Map<string, Expansion[]>();
  return (term, options = {}) => {
    const key = `${term}\u0000${options.prefix ?? ''}\u0000${options.typos ?? true}`;
    let expansions = cache.get(key);
    if (expansions === undefined) {
      expansions = expand(index, term, options);
      cache.set(key, expansions);
    }
    return expansions;
  };
}
