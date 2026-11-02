/**
 * Ranking. A query becomes clauses — one per free term, phrase, author: value and tag: value —
 * each scored per document with BM25F. Free terms take the best of their exact, prefix and
 * typo expansions; the document score is Σ clause scores × coverage². Only free-text clauses
 * (terms and phrases) make a document a candidate: operators narrow and boost, never match alone.
 */
import { compareText } from '@/domain/text';
import type { Material, SearchField, SearchHit } from '@/domain/types';

import {
  asBuiltIndex,
  BM25,
  buildIndex,
  type BuiltIndex,
  FIELD_BOOSTS,
  FIELD_COUNT,
  fieldIndex,
  FIELDS,
  type IndexedDoc,
  type Posting,
} from './build';
import { createExpander, type Expander, type Expansion } from './expand';
import { documentFilter, hasConstraints } from './filters';
import { planQuery, type QueryPlan } from './query';
import type { ParsedQuery, SearchIndex, SearchOptions } from './types';

const DEFAULT_LIMIT = 50;
/**
 * Free-text terms considered per query, in typed order. Each unknown term costs a typo scan of
 * the vocabulary, so a pasted paragraph would otherwise stall the UI. Sixteen content words
 * (stopwords do not count) covers any typed query and a pasted title.
 */
const MAX_QUERY_TERMS = 16;

/** One index term matched inside a document. */
interface TermMatch {
  term: string;
  /** Entry of the term's posting list that holds this document. */
  position: number;
  score: number;
}

/** A clause's match in one document. */
interface ClauseMatch {
  score: number;
  /** Matched only through typo tolerance. */
  fuzzy: boolean;
  terms: TermMatch[];
}

interface Clause {
  /** Field index the clause is restricted to (author:, tag:); undefined scores all fields. */
  field?: number;
  /** Normalised free-text term, for reporting typo-only matches. */
  queryTerm?: string;
  matches: ReadonlyMap<number, ClauseMatch>;
}

export function buildSearchIndex(materials: Material[]): SearchIndex {
  return buildIndex(materials);
}

/* ─────────────────────────────── Scoring ─────────────────────────────── */

function fieldTf(posting: Posting, position: number, field: number): number {
  return (FIELD_BOOSTS[field] ?? 0) * (posting.normalizedTf[position * FIELD_COUNT + field] ?? 0);
}

/** BM25F pseudo-frequency: boosted, length-normalised tf summed over fields (or one field). */
function boostedTf(posting: Posting, position: number, field: number | undefined): number {
  if (field !== undefined) return fieldTf(posting, position, field);
  let sum = 0;
  for (let f = 0; f < FIELD_COUNT; f += 1) sum += fieldTf(posting, position, f);
  return sum;
}

function bm25(posting: Posting, position: number, field: number | undefined, idf: number): number {
  const tf = boostedTf(posting, position, field);
  return tf === 0 ? 0 : (idf * tf * (BM25.k1 + 1)) / (tf + BM25.k1);
}

/**
 * Per document, the single strongest expansion (best of exact / prefix / typo). All expansions
 * share the IDF of the most common one (Lucene's blended frequency): otherwise a rare completion
 * or misspelling would outrank an exact match on rarity alone, whatever its kind's weight.
 */
function bestMatches(index: BuiltIndex, expansions: readonly Expansion[], field?: number): Map<number, ClauseMatch> {
  const known = expansions.flatMap((expansion) => {
    const posting = index.postings.get(expansion.term);
    return posting === undefined ? [] : [{ ...expansion, posting }];
  });
  const idf = known.reduce((lowest, { posting }) => Math.min(lowest, posting.idf), Infinity);
  const best = new Map<number, ClauseMatch>();
  for (const { term, kind, weight, posting } of known) {
    posting.docs.forEach((doc, position) => {
      const score = weight * bm25(posting, position, field, idf);
      if (score > (best.get(doc)?.score ?? 0)) {
        best.set(doc, { score, fuzzy: kind === 'fuzzy', terms: [{ term, position, score }] });
      }
    });
  }
  return best;
}

/** Per document, the sum over a multi-token clause's tokens (phrases, operator values). */
function summedMatches(perToken: readonly Map<number, ClauseMatch>[]): Map<number, ClauseMatch> {
  const sum = new Map<number, ClauseMatch>();
  for (const matches of perToken) {
    for (const [doc, match] of matches) {
      const previous = sum.get(doc);
      sum.set(doc, {
        score: (previous?.score ?? 0) + match.score,
        fuzzy: false,
        terms: [...(previous?.terms ?? []), ...match.terms],
      });
    }
  }
  return sum;
}

function clausesFor(index: BuiltIndex, { query, partial }: QueryPlan, expand: Expander): Clause[] {
  const prefixFor = (term: string): string | undefined => (partial?.term === term ? partial.prefix : undefined);
  const freeTerms = query.terms.slice(0, MAX_QUERY_TERMS).map((term) => ({
    queryTerm: term,
    matches: bestMatches(index, expand(term, { prefix: prefixFor(term) })),
  }));
  const phrases = query.phrases.map((phrase) => ({
    matches: summedMatches(phrase.split(' ').map((token) => bestMatches(index, expand(token, { typos: false })))),
  }));
  // Operator values match their own field only, exactly or as a prefix.
  const fieldValues = (values: readonly string[], fieldName: SearchField): Clause[] => {
    const field = fieldIndex(fieldName);
    return values.map((value) => ({
      field,
      matches: summedMatches(
        value.split(' ').map((token) => {
          const expansions = expand(token, { prefix: token, typos: false });
          return bestMatches(index, expansions, field);
        }),
      ),
    }));
  };
  return [...freeTerms, ...phrases, ...fieldValues(query.authors, 'authors'), ...fieldValues(query.tags, 'tags')];
}

/* ──────────────────────────────── Hits ───────────────────────────────── */

/** Fields that contributed to the document's score, strongest first. */
function matchedFields(index: BuiltIndex, clauses: readonly Clause[], doc: number): SearchField[] {
  const contributions = new Array<number>(FIELD_COUNT).fill(0);
  for (const clause of clauses) {
    for (const { term, position, score } of clause.matches.get(doc)?.terms ?? []) {
      const posting = index.postings.get(term);
      if (posting === undefined) continue;
      const total = boostedTf(posting, position, clause.field);
      for (let field = 0; field < FIELD_COUNT; field += 1) {
        if (clause.field !== undefined && clause.field !== field) continue;
        const share = fieldTf(posting, position, field) / total;
        contributions[field] = (contributions[field] ?? 0) + score * share;
      }
    }
  }
  return FIELDS.map((field, i) => ({ field, weight: contributions[i] ?? 0 }))
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((entry) => entry.field);
}

function fuzzyTerms(clauses: readonly Clause[], doc: number): string[] {
  return clauses.flatMap((clause) =>
    clause.queryTerm !== undefined && clause.matches.get(doc)?.fuzzy ? [clause.queryTerm] : [],
  );
}

function byTitleThenId(a: IndexedDoc, b: IndexedDoc): number {
  return compareText(a.sortTitle, b.sortTitle) || compareText(a.material.id, b.material.id);
}

function rank(index: BuiltIndex, plan: QueryPlan, accept: (doc: number) => boolean, limit: number): SearchHit[] {
  const clauses = clausesFor(index, plan, createExpander(index));
  const freeText = clauses.filter((clause) => clause.field === undefined);
  const candidates = new Set(freeText.flatMap((clause) => [...clause.matches.keys()]));
  return [...candidates]
    .filter(accept)
    .flatMap((doc) => {
      const indexed = index.docs[doc];
      if (indexed === undefined) return [];
      const matches = clauses.flatMap((clause) => clause.matches.get(doc) ?? []);
      const coverage = matches.length / clauses.length;
      const total = matches.reduce((sum, match) => sum + match.score, 0);
      return [{ doc, indexed, score: total * coverage ** 2 }];
    })
    .sort((a, b) => b.score - a.score || byTitleThenId(a.indexed, b.indexed))
    .slice(0, limit)
    .map(({ doc, score, indexed }) => ({
      materialId: indexed.material.id,
      score,
      matchedFields: matchedFields(index, clauses, doc),
      fuzzyTerms: fuzzyTerms(clauses, doc),
    }));
}

/** No free text: every document passing the constraints, newest first, unscored. */
function browse(index: BuiltIndex, query: ParsedQuery, accept: (doc: number) => boolean, limit: number): SearchHit[] {
  const operatorValues: Partial<Record<SearchField, readonly string[]>> = {
    tags: query.tags,
    authors: query.authors,
  };
  const operatorFields = FIELDS.filter((field) => (operatorValues[field]?.length ?? 0) > 0);
  return index.docs
    .filter((_, doc) => accept(doc))
    .sort((a, b) => b.material.year - a.material.year || byTitleThenId(a, b))
    .slice(0, limit)
    .map((doc) => ({
      materialId: doc.material.id,
      score: 0,
      matchedFields: [...operatorFields],
      fuzzyTerms: [],
    }));
}

/**
 * Empty query + no filters → [].
 * Empty query + filters/operators → every match, newest year first (score 0).
 * Otherwise ranked by score desc, ties broken by title.
 */
export function search(index: SearchIndex, query: string, opts: SearchOptions = {}): SearchHit[] {
  const built = asBuiltIndex(index);
  const plan = planQuery(query);
  const limit = Math.max(0, opts.limit ?? DEFAULT_LIMIT);
  const accept = documentFilter(built, plan.query, opts);
  if (plan.query.terms.length === 0 && plan.query.phrases.length === 0) {
    return hasConstraints(plan.query, opts.filters) ? browse(built, plan.query, accept, limit) : [];
  }
  return rank(built, plan, accept, limit);
}
