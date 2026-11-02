import { describe, expect, it } from 'vitest';

import { parseQuery } from './index';
import { planQuery } from './query';

const empty = { terms: [], phrases: [], excluded: [], authors: [], tags: [], kinds: [] };

describe('parseQuery', () => {
  it('normalises free text and drops stopwords', () => {
    expect(parseQuery('The Fermentation of Vegetables')).toEqual({
      ...empty,
      terms: ['fermentation', 'vegetable'],
    });
  });

  it('extracts phrases, exclusions and field operators', () => {
    expect(parseQuery('"Art of Fermentation" -koji author:Keller tag:lactic-acid koji')).toEqual({
      ...empty,
      terms: ['koji'],
      phrases: ['art fermentation'],
      excluded: ['koji'],
      authors: ['keller'],
      tags: ['lactic acid'],
    });
  });

  it('accepts quoted operator values and excluded phrases', () => {
    expect(parseQuery('author:"Thomas Keller" -"sous vide"')).toEqual({
      ...empty,
      authors: ['thomas keller'],
      excluded: ['sous', 'vide'],
    });
  });

  it('keeps known kinds only, accepting plurals', () => {
    expect(parseQuery('kind:papers kind:podcast kind:zine').kinds).toEqual(['paper', 'podcast']);
  });

  it.each([
    ['year:2011', { yearFrom: 2011, yearTo: 2011 }],
    ['year:2005..2015', { yearFrom: 2005, yearTo: 2015 }],
    ['year:2015..2005', { yearFrom: 2005, yearTo: 2015 }],
    ['year:..1999', { yearTo: 1999 }],
    ['year:>2010', { yearFrom: 2011 }],
    ['year:>=2010', { yearFrom: 2010 }],
    ['year:<2000', { yearTo: 1999 }],
    ['year:<=2000', { yearTo: 2000 }],
    ['year:2000..2020 year:>2010', { yearFrom: 2011, yearTo: 2020 }],
    ['year:soon', {}],
  ])('parses %s', (raw, years) => {
    expect(parseQuery(raw)).toEqual({ ...empty, ...years });
  });

  it('treats unknown operators and unclosed quotes as plain text', () => {
    expect(parseQuery('venue:nature').terms).toEqual(['venue', 'nature']);
    expect(parseQuery('"art of ferm').terms).toEqual(['art', 'ferm']);
    expect(parseQuery('"art of ferm').phrases).toEqual([]);
  });

  it('deduplicates repeated terms', () => {
    expect(parseQuery('koji Koji KOJI').terms).toEqual(['koji']);
  });
});

describe('planQuery — live typing', () => {
  it('marks the last free word as a prefix while it is being typed', () => {
    expect(planQuery('lactic kel').partial).toEqual({ term: 'kel', prefix: 'kel' });
    expect(planQuery('glas').partial).toEqual({ term: 'gla', prefix: 'glas' });
  });

  it('does not prefix-match finished words, operators, stopwords or single letters', () => {
    expect(planQuery('kel ').partial).toBeUndefined();
    expect(planQuery('kel,').partial).toBeUndefined();
    expect(planQuery('koji author:kel').partial).toBeUndefined();
    expect(planQuery('art of').partial).toBeUndefined();
    expect(planQuery('k').partial).toBeUndefined();
    expect(planQuery('"koji"').partial).toBeUndefined();
  });
});
