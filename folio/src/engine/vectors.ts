/**
 * TF-IDF content space shared by recommendations and "similar materials".
 * Vectors are unit length, so a dot product between two of them is their cosine.
 */
import { analyze } from '@/domain/text';
import type { Category, ID, Material } from '@/domain/types';

export type SparseVector = ReadonlyMap<string, number>;

export interface Corpus {
  /** Unit TF-IDF vector per material id. */
  readonly vectors: ReadonlyMap<ID, SparseVector>;
}

const EMPTY_VECTOR: SparseVector = new Map();

/** How many times each field's tokens count towards term frequency. */
const FIELD_WEIGHTS = { title: 2, tags: 2, category: 1, authors: 1, venue: 1, abstract: 1 } as const;

function weightedTermCounts(material: Material, categoryName: string): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (text: string, weight: number): void => {
    for (const term of analyze(text)) counts.set(term, (counts.get(term) ?? 0) + weight);
  };
  add(material.title, FIELD_WEIGHTS.title);
  add(material.tags.join(' '), FIELD_WEIGHTS.tags);
  add(categoryName, FIELD_WEIGHTS.category);
  add(material.authors.join(' '), FIELD_WEIGHTS.authors);
  add(material.venue ?? '', FIELD_WEIGHTS.venue);
  add(material.abstract, FIELD_WEIGHTS.abstract);
  return counts;
}

function unitLength(vector: Map<string, number>): SparseVector {
  const length = norm(vector);
  if (length === 0) return EMPTY_VECTOR;
  for (const [term, value] of vector) vector.set(term, value / length);
  return vector;
}

function buildCorpus(materials: Record<ID, Material>, categories: Record<ID, Category>): Corpus {
  const ids = Object.keys(materials).sort();
  const counts = new Map<ID, Map<string, number>>();
  const documentFrequency = new Map<string, number>();
  for (const id of ids) {
    const material = materials[id];
    if (material === undefined) continue;
    const termCounts = weightedTermCounts(material, categories[material.categoryId]?.name ?? '');
    counts.set(id, termCounts);
    for (const term of termCounts.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  // Smoothed IDF: always positive, so terms shared by every document still count a little.
  const idf = (term: string): number =>
    Math.log((1 + ids.length) / (1 + (documentFrequency.get(term) ?? 0))) + 1;
  const vectors = new Map<ID, SparseVector>();
  for (const [id, termCounts] of counts) {
    const weighted = new Map<string, number>();
    for (const [term, count] of termCounts) weighted.set(term, count * idf(term));
    vectors.set(id, unitLength(weighted));
  }
  return { vectors };
}

const cache = new WeakMap<Record<ID, Material>, WeakMap<Record<ID, Category>, Corpus>>();

/** Corpus for a library, memoised on the (immutable) materials and categories records. */
export function corpusFor(materials: Record<ID, Material>, categories: Record<ID, Category>): Corpus {
  let byCategories = cache.get(materials);
  if (byCategories === undefined) {
    byCategories = new WeakMap();
    cache.set(materials, byCategories);
  }
  let corpus = byCategories.get(categories);
  if (corpus === undefined) {
    corpus = buildCorpus(materials, categories);
    byCategories.set(categories, corpus);
  }
  return corpus;
}

export function vectorOf(corpus: Corpus, id: ID): SparseVector {
  return corpus.vectors.get(id) ?? EMPTY_VECTOR;
}

export function dot(a: SparseVector, b: SparseVector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [term, value] of small) sum += value * (large.get(term) ?? 0);
  return sum;
}

export function norm(vector: SparseVector): number {
  let sum = 0;
  for (const value of vector.values()) sum += value * value;
  return Math.sqrt(sum);
}

/** Cosine similarity; 0 when either vector is empty. */
export function cosine(a: SparseVector, b: SparseVector): number {
  const lengths = norm(a) * norm(b);
  return lengths === 0 ? 0 : dot(a, b) / lengths;
}

/** target += vector × weight, in place. */
export function addScaled(target: Map<string, number>, vector: SparseVector, weight: number): void {
  for (const [term, value] of vector) target.set(term, (target.get(term) ?? 0) + value * weight);
}
