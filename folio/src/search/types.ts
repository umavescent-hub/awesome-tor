import type { ID, MaterialKind, Progress, SearchFilters } from '@/domain/types';

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

export interface SearchOptions {
  filters?: SearchFilters;
  /** Needed to apply `filters.statuses` (missing progress = 'queued'). */
  progress?: Record<ID, Progress>;
  /** Default 50. */
  limit?: number;
}
