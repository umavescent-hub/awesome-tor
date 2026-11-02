/**
 * Inverted index for BM25F. Term frequencies are length-normalised per field at build time,
 * so a query only has to apply field boosts, IDF and the k1 saturation.
 */
import { analyze, normalize } from '@/domain/text';
import type { Material, SearchField } from '@/domain/types';

import type { SearchIndex } from './types';

/** Field order used for every per-field array in the index. */
export const FIELDS = ['title', 'tags', 'authors', 'venue', 'abstract'] as const satisfies readonly SearchField[];
export const FIELD_COUNT = FIELDS.length;

const BOOST: Readonly<Record<SearchField, number>> = {
  title: 3.0,
  tags: 2.5,
  authors: 2.0,
  venue: 1.0,
  abstract: 1.0,
};
export const FIELD_BOOSTS: readonly number[] = FIELDS.map((field) => BOOST[field]);
export const fieldIndex = (field: SearchField): number => FIELDS.indexOf(field);

export const BM25 = { k1: 1.2, b: 0.75 } as const;

export interface IndexedDoc {
  readonly material: Material;
  /** Normalised title, for locale-independent tie-breaks. */
  readonly sortTitle: string;
  /** Analysed tokens in reading order, for phrase matching. */
  readonly titleTokens: readonly string[];
  readonly abstractTokens: readonly string[];
  /** Analysed tokens per author and per tag, for the author: and tag: operators. */
  readonly authorTokens: readonly (readonly string[])[];
  readonly tagTokens: readonly (readonly string[])[];
}

export interface Posting {
  /** Ascending indices of the documents containing the term. */
  readonly docs: readonly number[];
  /** FIELD_COUNT values per entry of `docs`: tf / (1 − b + b·len/avgLen), before boosts. */
  readonly normalizedTf: readonly number[];
  readonly idf: number;
}

export interface BuiltIndex extends SearchIndex {
  readonly docs: readonly IndexedDoc[];
  readonly postings: ReadonlyMap<string, Posting>;
  /** Every indexed term in code-point order, for prefix range scans. */
  readonly vocabulary: readonly string[];
  /** Terms grouped by length, so typo lookup only visits plausible candidates. */
  readonly termsByLength: ReadonlyMap<number, readonly string[]>;
}

export function asBuiltIndex(index: SearchIndex): BuiltIndex {
  if (!('postings' in index)) throw new TypeError('search: pass an index from buildSearchIndex()');
  return index as BuiltIndex;
}

function indexDoc(material: Material): IndexedDoc {
  return {
    material,
    sortTitle: normalize(material.title),
    titleTokens: analyze(material.title),
    abstractTokens: analyze(material.abstract),
    authorTokens: material.authors.map(analyze),
    tagTokens: material.tags.map(analyze),
  };
}

/** Tokens of each field, in FIELDS order. */
function fieldTokens(doc: IndexedDoc): readonly (readonly string[])[] {
  return [
    doc.titleTokens,
    doc.tagTokens.flat(),
    doc.authorTokens.flat(),
    analyze(doc.material.venue ?? ''),
    doc.abstractTokens,
  ];
}

/** Robertson-Spärck Jones IDF with the +1 that keeps it positive for very common terms. */
function idf(documentCount: number, documentFrequency: number): number {
  return Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
}

export function buildIndex(materials: readonly Material[]): BuiltIndex {
  const docs = materials.map(indexDoc);
  const tokensByDoc = docs.map(fieldTokens);
  const averageLength = FIELDS.map((_, field) => {
    const total = tokensByDoc.reduce((sum, fields) => sum + (fields[field]?.length ?? 0), 0);
    return docs.length === 0 ? 0 : total / docs.length;
  });

  const growing = new Map<string, { docs: number[]; normalizedTf: number[] }>();
  tokensByDoc.forEach((fields, doc) => {
    const counts = new Map<string, number[]>();
    fields.forEach((tokens, field) => {
      for (const token of tokens) {
        const perField = counts.get(token) ?? new Array<number>(FIELD_COUNT).fill(0);
        perField[field] = (perField[field] ?? 0) + 1;
        counts.set(token, perField);
      }
    });
    for (const [term, perField] of counts) {
      const posting = growing.get(term) ?? { docs: [], normalizedTf: [] };
      posting.docs.push(doc);
      perField.forEach((tf, field) => {
        const average = averageLength[field] ?? 0;
        const length = fields[field]?.length ?? 0;
        const lengthNorm = average > 0 ? 1 - BM25.b + (BM25.b * length) / average : 1;
        posting.normalizedTf.push(tf / lengthNorm);
      });
      growing.set(term, posting);
    }
  });

  const postings = new Map<string, Posting>();
  const termsByLength = new Map<number, string[]>();
  for (const [term, posting] of growing) {
    postings.set(term, { ...posting, idf: idf(docs.length, posting.docs.length) });
    const bucket = termsByLength.get(term.length);
    if (bucket) bucket.push(term);
    else termsByLength.set(term.length, [term]);
  }
  return {
    size: docs.length,
    docs,
    postings,
    vocabulary: [...postings.keys()].sort(),
    termsByLength,
  };
}
