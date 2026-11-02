/**
 * Folio search — public API. Pure, in-memory, BM25F + prefix + typo tolerance.
 * CONTRACT: signatures here are fixed; UI code depends on them.
 */
import type { ID, Material, MaterialKind, Progress, SearchFilters, SearchHit } from '@/domain/types';

/** Opaque prebuilt index. Build once per materials change (memoise on the materials record). */
export interface SearchIndex {
  readonly size: number;
}

export interface ParsedQuery {
  /** Free-text terms, normalised. */
  terms: string[];
  /** Exact phrases from "double quotes", normalised. */
  phrases: string[];
  /** Terms prefixed with '-', normalised; any match excludes the material. */
  excluded: string[];
  /** author:keller  → matched against authors only. */
  authors: string[];
  /** tag:fermentation → matched against tags only. */
  tags: string[];
  /** kind:paper (unknown kinds ignored). */
  kinds: MaterialKind[];
  /** year:2011 | year:2005..2015 | year:>2010 | year:<2000 */
  yearFrom?: number;
  yearTo?: number;
}

export function parseQuery(raw: string): ParsedQuery {
  throw new Error('not implemented');
}

export function buildSearchIndex(materials: Material[]): SearchIndex {
  throw new Error('not implemented');
}

export interface SearchOptions {
  filters?: SearchFilters;
  /** Needed to apply `filters.statuses` (missing progress = 'queued'). */
  progress?: Record<ID, Progress>;
  /** Default 50. */
  limit?: number;
}

/**
 * Empty query + no filters → [].
 * Empty query + filters/operators → every match, newest year first (score 0).
 * Otherwise ranked by score desc, ties broken by title.
 */
export function search(index: SearchIndex, query: string, opts?: SearchOptions): SearchHit[] {
  throw new Error('not implemented');
}

/** Autocomplete: vocabulary terms starting with the last partial word, most frequent first. */
export function suggestTerms(index: SearchIndex, partial: string, limit?: number): string[] {
  throw new Error('not implemented');
}
