/**
 * Hard constraints on which documents may appear at all: SearchOptions.filters intersected
 * with the query's operators, phrases and exclusions.
 */
import type { SearchFilters } from '@/domain/types';

import type { BuiltIndex, IndexedDoc } from './build';
import type { ParsedQuery, SearchOptions } from './types';

type DocPredicate = (doc: IndexedDoc, docIndex: number) => boolean;

function isSet<T>(values: readonly T[] | undefined): values is readonly T[] {
  return values !== undefined && values.length > 0;
}

/** True when the filters or query constrain the result set beyond free text and phrases. */
export function hasConstraints(query: ParsedQuery, filters: SearchFilters = {}): boolean {
  return (
    isSet(filters.kinds) ||
    isSet(filters.categoryIds) ||
    isSet(filters.statuses) ||
    filters.yearFrom !== undefined ||
    filters.yearTo !== undefined ||
    isSet(query.kinds) ||
    isSet(query.authors) ||
    isSet(query.tags) ||
    isSet(query.excluded) ||
    query.yearFrom !== undefined ||
    query.yearTo !== undefined
  );
}

function containsSequence(tokens: readonly string[], sequence: readonly string[]): boolean {
  for (let start = 0; start + sequence.length <= tokens.length; start += 1) {
    if (sequence.every((token, offset) => tokens[start + offset] === token)) return true;
  }
  return false;
}

/** Every value token is a prefix of some term or word of the same entry (one author, one tag). */
function anyEntryMatches(entries: readonly (readonly string[])[], value: string): boolean {
  const valueTokens = value.split(' ');
  return entries.some((entry) =>
    valueTokens.every((token) => entry.some((entryToken) => entryToken.startsWith(token))),
  );
}

function excludedDocs(index: BuiltIndex, excluded: readonly string[]): ReadonlySet<number> {
  return new Set(excluded.flatMap((term) => index.postings.get(term)?.docs ?? []));
}

/** Year bounds from both sources; the tighter bound wins on each side. */
function yearBounds(query: ParsedQuery, filters: SearchFilters): { from: number; to: number } {
  return {
    from: Math.max(query.yearFrom ?? -Infinity, filters.yearFrom ?? -Infinity),
    to: Math.min(query.yearTo ?? Infinity, filters.yearTo ?? Infinity),
  };
}

export function documentFilter(
  index: BuiltIndex,
  query: ParsedQuery,
  opts: SearchOptions,
): (docIndex: number) => boolean {
  const filters = opts.filters ?? {};
  const predicates: DocPredicate[] = [];
  const { kinds, categoryIds, statuses } = filters;

  if (isSet(kinds)) predicates.push(({ material }) => kinds.includes(material.kind));
  if (isSet(query.kinds)) predicates.push(({ material }) => query.kinds.includes(material.kind));
  if (isSet(categoryIds)) {
    predicates.push(({ material }) => categoryIds.includes(material.categoryId));
  }
  if (isSet(statuses)) {
    predicates.push(({ material }) =>
      statuses.includes(opts.progress?.[material.id]?.status ?? 'queued'),
    );
  }
  const years = yearBounds(query, filters);
  if (Number.isFinite(years.from) || Number.isFinite(years.to)) {
    predicates.push(({ material }) => material.year >= years.from && material.year <= years.to);
  }
  if (isSet(query.excluded)) {
    const excluded = excludedDocs(index, query.excluded);
    predicates.push((_, docIndex) => !excluded.has(docIndex));
  }
  for (const phrase of query.phrases) {
    const sequence = phrase.split(' ');
    predicates.push(
      (doc) =>
        containsSequence(doc.titleTokens, sequence) ||
        containsSequence(doc.abstractTokens, sequence),
    );
  }
  for (const author of query.authors) {
    predicates.push((doc) => anyEntryMatches(doc.authorTokens, author));
  }
  for (const tag of query.tags) {
    predicates.push((doc) => anyEntryMatches(doc.tagTokens, tag));
  }

  return (docIndex) => {
    const doc = index.docs[docIndex];
    return doc !== undefined && predicates.every((predicate) => predicate(doc, docIndex));
  };
}
