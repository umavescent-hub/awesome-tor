/**
 * Folio search — public API. Pure, in-memory, BM25F + prefix + typo tolerance.
 * CONTRACT: signatures here are fixed; UI code depends on them.
 */
export type { ParsedQuery, SearchIndex, SearchOptions } from './types';
export { parseQuery } from './query';
export { buildSearchIndex, search, suggestTerms } from './search';
