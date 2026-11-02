/**
 * Inverted index for BM25F. Term frequencies are length-normalised per field at build time,
 * so a query only has to apply field boosts, IDF and the k1 saturation.
 *
 * Postings are keyed by stemmed terms. The unstemmed words are kept as well: prefix matching
 * scans them (typing "studie" should reach "study") and suggestions show them ("thomas",
 * never the stem "thoma").
 */
import { contentWords, normalize, stem } from '@/domain/text';
import type { Material, SearchField } from '@/domain/types';

import type { SearchIndex } from './types';

/** Field order used for every per-field array in the index. */
export const FIELDS = [
  'title',
  'tags',
  'authors',
  'venue',
  'abstract',
] as const satisfies readonly SearchField[];
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
  /** Stemmed terms in reading order, for phrase matching. */
  readonly titleTokens: readonly string[];
  readonly abstractTokens: readonly string[];
  /**
   * Per author and per tag, its stemmed terms and its unstemmed words, for the author: and tag:
   * operators. Both forms are needed for prefix matching while typing: "studi" is a prefix of
   * the word "studies" but not of its stem "study".
   */
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
  /** Stemmed term → posting list. */
  readonly postings: ReadonlyMap<string, Posting>;
  /** Stemmed terms grouped by length, so typo lookup only visits plausible candidates. */
  readonly termsByLength: ReadonlyMap<number, readonly string[]>;
  /** Every distinct unstemmed word, in code-point order, for prefix range scans. */
  readonly words: readonly string[];
  /** Occurrences of each unstemmed word, to show the most familiar spelling of a term. */
  readonly wordFrequency: ReadonlyMap<string, number>;
}

export function asBuiltIndex(index: SearchIndex): BuiltIndex {
  if (!('postings' in index)) throw new TypeError('search: pass an index from buildSearchIndex()');
  return index as BuiltIndex;
}

const stems = (words: readonly string[]): string[] => words.map(stem);
const stemsAndWords = (words: readonly string[]): string[] => [
  ...new Set([...stems(words), ...words]),
];

/** The document record plus its content words per field, in FIELDS order. */
function prepare(material: Material): { doc: IndexedDoc; fields: readonly (readonly string[])[] } {
  const title = contentWords(material.title);
  const abstract = contentWords(material.abstract);
  const authors = material.authors.map(contentWords);
  const tags = material.tags.map(contentWords);
  return {
    doc: {
      material,
      sortTitle: normalize(material.title),
      titleTokens: stems(title),
      abstractTokens: stems(abstract),
      authorTokens: authors.map(stemsAndWords),
      tagTokens: tags.map(stemsAndWords),
    },
    fields: [title, tags.flat(), authors.flat(), contentWords(material.venue ?? ''), abstract],
  };
}

/** Robertson-Spärck Jones IDF with the +1 that keeps it positive for very common terms. */
function idf(documentCount: number, documentFrequency: number): number {
  return Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
}

function averageFieldLengths(fieldsByDoc: readonly (readonly (readonly string[])[])[]): number[] {
  return FIELDS.map((_, field) => {
    const total = fieldsByDoc.reduce((sum, fields) => sum + (fields[field]?.length ?? 0), 0);
    return fieldsByDoc.length === 0 ? 0 : total / fieldsByDoc.length;
  });
}

export function buildIndex(materials: readonly Material[]): BuiltIndex {
  const prepared = materials.map(prepare);
  const fieldsByDoc = prepared.map((entry) => entry.fields);
  const averageLength = averageFieldLengths(fieldsByDoc);
  const wordFrequency = new Map<string, number>();
  const growing = new Map<string, { docs: number[]; normalizedTf: number[] }>();

  fieldsByDoc.forEach((fields, doc) => {
    const counts = new Map<string, number[]>();
    fields.forEach((words, field) => {
      for (const word of words) {
        wordFrequency.set(word, (wordFrequency.get(word) ?? 0) + 1);
        const term = stem(word);
        const perField = counts.get(term) ?? new Array<number>(FIELD_COUNT).fill(0);
        perField[field] = (perField[field] ?? 0) + 1;
        counts.set(term, perField);
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
    postings.set(term, { ...posting, idf: idf(prepared.length, posting.docs.length) });
    const bucket = termsByLength.get(term.length);
    if (bucket) bucket.push(term);
    else termsByLength.set(term.length, [term]);
  }
  return {
    size: prepared.length,
    docs: prepared.map((entry) => entry.doc),
    postings,
    termsByLength,
    words: [...wordFrequency.keys()].sort(),
    wordFrequency,
  };
}
