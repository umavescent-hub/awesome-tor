/**
 * Query language: free words, "exact phrases", -excluded words, and the operators
 * author:, tag:, kind:, year: (an operator value may be quoted: author:"thomas keller").
 * Unknown operators are plain text; an unclosed quote is plain text (the user is mid-typing).
 */
import { analyze, endsMidWord, isStopword, stem, tokenize } from '@/domain/text';
import { MATERIAL_KINDS, type MaterialKind } from '@/domain/types';

import type { ParsedQuery } from './types';

/** The parsed query plus what live, as-you-type matching needs. */
export interface QueryPlan {
  query: ParsedQuery;
  /**
   * The final word while it is still being typed: `term` is its analysed form (one of
   * query.terms) and `prefix` its raw normalised spelling, used for prefix matching.
   */
  partial?: { term: string; prefix: string };
}

const MIN_PREFIX_LENGTH = 2;
const OPERATOR = /^([a-z]+):(.*)$/i;
/** `prefix"quoted text"` (prefix may be empty, "-" or "op:") or a bare word. */
const CHUNK = /(\S*?)"([^"]*)"|(\S+)/g;

interface Chunk {
  word: string;
  quoted?: string;
}

function chunks(raw: string): Chunk[] {
  return [...raw.matchAll(CHUNK)].map(([, prefix, quoted, bare]) =>
    bare === undefined ? { word: prefix ?? '', quoted: quoted ?? '' } : { word: bare },
  );
}

type YearRange = { from?: number; to?: number };

/** 2011 | 2005..2015 | 2005.. | ..2015 | >2010 | >=2010 | <2000 | <=2000 (bounds inclusive). */
function parseYears(value: string): YearRange | undefined {
  const exact = /^(\d{1,4})$/.exec(value);
  if (exact) return { from: Number(exact[1]), to: Number(exact[1]) };
  const range = /^(\d{1,4})?\.\.(\d{1,4})?$/.exec(value);
  if (range && (range[1] || range[2])) {
    const from = range[1] ? Number(range[1]) : undefined;
    const to = range[2] ? Number(range[2]) : undefined;
    const reversed = from !== undefined && to !== undefined && from > to;
    return reversed ? { from: to, to: from } : { from, to };
  }
  const comparison = /^([<>]=?)(\d{1,4})$/.exec(value);
  if (!comparison) return undefined;
  const [, operator, digits] = comparison;
  const year = Number(digits);
  if (operator === '>') return { from: year + 1 };
  if (operator === '>=') return { from: year };
  if (operator === '<') return { to: year - 1 };
  return { to: year };
}

function isKind(word: string): word is MaterialKind {
  return (MATERIAL_KINDS as readonly string[]).includes(word);
}

class QueryBuilder {
  readonly terms: string[] = [];
  readonly phrases: string[] = [];
  readonly excluded: string[] = [];
  readonly authors: string[] = [];
  readonly tags: string[] = [];
  readonly kinds: MaterialKind[] = [];
  yearFrom: number | undefined;
  yearTo: number | undefined;

  text(text: string): void {
    this.terms.push(...analyze(text));
  }

  phrase(text: string): void {
    const tokens = analyze(text);
    if (tokens.length > 0) this.phrases.push(tokens.join(' '));
  }

  exclude(text: string): void {
    this.excluded.push(...analyze(text));
  }

  /** Applies a known operator (true); an unknown one is left alone (false) to be read as text. */
  tryOperator(name: string, value: string): boolean {
    switch (name.toLowerCase()) {
      case 'author':
        return this.fieldValue(this.authors, value);
      case 'tag':
        return this.fieldValue(this.tags, value);
      case 'kind':
        this.kinds.push(...analyze(value).filter(isKind));
        return true;
      case 'year':
        this.years(value);
        return true;
      default:
        return false;
    }
  }

  build(): ParsedQuery {
    const unique = <T>(values: T[]): T[] => [...new Set(values)];
    return {
      terms: unique(this.terms),
      phrases: unique(this.phrases),
      excluded: unique(this.excluded),
      authors: unique(this.authors),
      tags: unique(this.tags),
      kinds: unique(this.kinds),
      ...(this.yearFrom !== undefined && { yearFrom: this.yearFrom }),
      ...(this.yearTo !== undefined && { yearTo: this.yearTo }),
    };
  }

  private fieldValue(target: string[], value: string): true {
    const tokens = analyze(value);
    if (tokens.length > 0) target.push(tokens.join(' '));
    return true;
  }

  /** Several year: operators narrow the range (intersection). */
  private years(value: string): void {
    const range = parseYears(value.trim());
    if (range?.from !== undefined) this.yearFrom = Math.max(this.yearFrom ?? -Infinity, range.from);
    if (range?.to !== undefined) this.yearTo = Math.min(this.yearTo ?? Infinity, range.to);
  }
}

/** The bare word's last token, if the raw query ends inside it and it can be prefix-matched. */
function partialOf(word: string, raw: string): QueryPlan['partial'] {
  const prefix = tokenize(word).at(-1);
  if (!endsMidWord(raw) || prefix === undefined) return undefined;
  if (prefix.length < MIN_PREFIX_LENGTH || isStopword(prefix)) return undefined;
  return { term: stem(prefix), prefix };
}

/** Adds one chunk to the query; returns the partial word when the chunk is free text. */
function addChunk(
  builder: QueryBuilder,
  { word, quoted }: Chunk,
  raw: string,
): QueryPlan['partial'] {
  const operator = OPERATOR.exec(word);
  if (quoted !== undefined) {
    if (word === '-') {
      builder.exclude(quoted);
    } else if (!(operator?.[2] === '' && builder.tryOperator(operator[1] ?? '', quoted))) {
      builder.text(word);
      builder.phrase(quoted);
    }
    return undefined;
  }
  if (word.length > 1 && word.startsWith('-')) {
    builder.exclude(word.slice(1));
    return undefined;
  }
  if (operator && builder.tryOperator(operator[1] ?? '', operator[2] ?? '')) return undefined;
  builder.text(word);
  return partialOf(word, raw);
}

export function planQuery(raw: string): QueryPlan {
  const builder = new QueryBuilder();
  let partial: QueryPlan['partial'];
  // Only the final chunk can be a word still being typed, so each chunk overwrites the last.
  for (const chunk of chunks(raw)) partial = addChunk(builder, chunk, raw);
  return { query: builder.build(), ...(partial && { partial }) };
}

export function parseQuery(raw: string): ParsedQuery {
  return planQuery(raw).query;
}
