import { describe, expect, it } from 'vitest';

import type { SearchHit } from '@/domain/types';
import { material, progress } from '@/engine/testing';

import { buildSearchIndex, search, suggestTerms } from './index';

const ids = (hits: SearchHit[]): string[] => hits.map((hit) => hit.materialId);

const library = [
  material('art', {
    title: 'The Art of Fermentation',
    authors: ['Sandor Ellix Katz'],
    tags: ['fermentation', 'preservation'],
    abstract: 'An in-depth exploration of fermentation concepts and processes from around the world.',
    year: 2012,
    kind: 'book',
    venue: 'Chelsea Green',
    categoryId: 'ferment',
  }),
  material('noma', {
    title: 'The Noma Guide to Fermentation',
    authors: ['René Redzepi', 'David Zilber'],
    tags: ['fermentation', 'koji'],
    abstract: 'Koji, kombucha, shoyu, miso, vinegars, garums and black fruits.',
    year: 2018,
    kind: 'book',
    categoryId: 'ferment',
  }),
  material('laundry', {
    title: 'The French Laundry Cookbook',
    authors: ['Thomas Keller'],
    tags: ['cooking', 'technique'],
    abstract: 'Recipes and techniques from the French Laundry kitchen.',
    year: 1999,
    kind: 'book',
    categoryId: 'cooking',
  }),
  material('sous', {
    title: 'Under Pressure',
    authors: ['Thomas Keller'],
    tags: ['sous vide', 'technique'],
    abstract: 'Cooking sous vide at precise, low temperatures.',
    year: 2008,
    kind: 'book',
    categoryId: 'cooking',
  }),
  material('maillard', {
    title: 'The Maillard Reaction in Foods',
    authors: ['Ferran Adrià'],
    tags: ['chemistry', 'browning'],
    abstract: 'Browning reactions between amino acids and reducing sugars.',
    year: 2005,
    kind: 'paper',
    venue: 'Food Chemistry',
    categoryId: 'science',
  }),
  material('lecture', {
    title: 'Microbes and Fermentation',
    authors: ['Rachel Dutton'],
    tags: ['microbiology', 'cheese'],
    abstract: 'A lecture on microbial communities in cheese rinds and their fermentation.',
    year: 2016,
    kind: 'lecture',
    categoryId: 'science',
  }),
];
const index = buildSearchIndex(library);

describe('buildSearchIndex', () => {
  it('reports its size and rejects foreign indexes', () => {
    expect(index.size).toBe(6);
    expect(() => search({ size: 0 }, 'koji')).toThrow(TypeError);
  });
});

describe('search — term matching', () => {
  const notes = buildSearchIndex([
    material('keller', { title: 'Keller Notes' }),
    material('kellerman', { title: 'Kellerman Notes' }),
    material('kelp', { title: 'Kelp Notes' }),
  ]);

  it('scores an exact match above a prefix match of the word being typed', () => {
    const [exact, prefix] = search(notes, 'keller');

    expect([exact?.materialId, prefix?.materialId]).toEqual(['keller', 'kellerman']);
    expect((prefix?.score ?? 0) / (exact?.score ?? 1)).toBeCloseTo(0.75, 10);
  });

  it('prefix-matches real spellings, not just stems', () => {
    const studies = buildSearchIndex([material('cases', { title: 'Case Studies in Brewing' })]);

    expect(ids(search(studies, 'studie'))).toEqual(['cases']);
    expect(ids(search(studies, 'studies '))).toEqual(['cases']);
  });

  it('stops prefix matching once the word is finished', () => {
    expect(ids(search(notes, 'keller '))).toEqual(['keller']);
  });

  it('scores prefix matches above typo matches and reports typo-only terms', () => {
    const hits = search(notes, 'kell');

    expect(ids(hits)).toEqual(['keller', 'kellerman', 'kelp']);
    expect(hits.map((hit) => hit.fuzzyTerms)).toEqual([[], [], ['kell']]);
    expect((hits[2]?.score ?? 0) / (hits[0]?.score ?? 1)).toBeCloseTo(0.5 / 0.75, 10);
  });

  it('ranks exact matches of a typed word above rarer prefix completions of it', () => {
    const salts = buildSearchIndex([
      ...['a', 'b', 'c', 'd', 'e'].map((id) => material(id, { title: `Salt ${id}` })),
      material('saltpeter', { title: 'Saltpeter' }),
      ...['f', 'g', 'h', 'i'].map((id) => material(id, { title: `Other ${id}` })),
    ]);

    expect(ids(search(salts, 'salt')).at(-1)).toBe('saltpeter');
  });

  it('ranks prefix completions above rarer typo matches', () => {
    const kellers = buildSearchIndex([
      ...['a', 'b', 'c', 'd', 'e'].map((id) => material(id, { title: `Keller ${id}` })),
      material('kelp', { title: 'Kelp' }),
      ...['f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'].map((id) => material(id, { title: `Other ${id}` })),
    ]);

    expect(ids(search(kellers, 'kell')).at(-1)).toBe('kelp');
  });

  it('matches singular and plural spellings exactly, not as typos', () => {
    const pantry = buildSearchIndex([
      material('tomato', { title: 'The Tomato' }),
      material('cookie', { title: 'One Perfect Cookie' }),
    ]);

    expect(search(pantry, 'tomatoes ')).toEqual([
      { materialId: 'tomato', score: expect.any(Number), matchedFields: ['title'], fuzzyTerms: [] },
    ]);
    expect(ids(search(pantry, 'cookies '))).toEqual(['cookie']);
  });

  it('tolerates typos: "fermentaton" finds fermentation', () => {
    const hits = search(index, 'fermentaton');

    expect(ids(hits).sort()).toEqual(['art', 'lecture', 'noma']);
    for (const hit of hits) expect(hit.fuzzyTerms).toEqual(['fermentaton']);
  });

  it('allows two typos only for long terms', () => {
    expect(ids(search(index, 'fermantaton'))).toHaveLength(3);
    expect(search(index, 'kojii')).toHaveLength(1);
    expect(search(index, 'kojjii')).toEqual([]);
  });

  it('matches as you type: "kel" finds Keller', () => {
    const hits = search(index, 'kel');

    expect(ids(hits).sort()).toEqual(['laundry', 'sous']);
    expect(hits[0]?.matchedFields).toEqual(['authors']);
    expect(hits[0]?.fuzzyTerms).toEqual([]);
  });

  it('matches accent-insensitively', () => {
    expect(ids(search(index, 'adria'))).toEqual(['maillard']);
    expect(ids(search(index, 'Redzepí'))).toEqual(['noma']);
  });

  it('lists matched fields strongest first', () => {
    const [art] = search(index, 'fermentation art');

    expect(art?.materialId).toBe('art');
    expect(art?.matchedFields).toEqual(['title', 'tags', 'abstract']);
  });

  it('favours documents covering more of the query', () => {
    expect(search(index, 'fermentation cheese')[0]?.materialId).toBe('lecture');
  });

  it('breaks score ties by title', () => {
    const twins = buildSearchIndex([material('z', { title: 'Beta Koji' }), material('y', { title: 'Alpha Koji' })]);

    expect(ids(search(twins, 'koji'))).toEqual(['y', 'z']);
  });
});

describe('search — operators', () => {
  it('author: matches the authors field only, by prefix', () => {
    expect(ids(search(index, 'author:keller'))).toEqual(['sous', 'laundry']);
    expect(ids(search(index, 'author:kel'))).toEqual(['sous', 'laundry']);
    expect(search(index, 'author:fermentation')).toEqual([]);
    expect(search(index, 'author:keller')[0]).toEqual({
      materialId: 'sous',
      score: 0,
      matchedFields: ['authors'],
      fuzzyTerms: [],
    });
  });

  it('author: values must match within a single author', () => {
    expect(ids(search(index, 'author:"thomas keller"'))).toEqual(['sous', 'laundry']);
    expect(search(index, 'author:"thomas katz"')).toEqual([]);
  });

  it('operators filter and add to the score of free-text matches', () => {
    const hits = search(index, 'author:keller technique');

    expect(ids(hits).sort()).toEqual(['laundry', 'sous']);
    expect(hits[0]?.score).toBeGreaterThan(0);
    expect(hits[0]?.matchedFields).toContain('authors');
  });

  it('operators narrow free text; they never stand in for words that do not match', () => {
    expect(search(index, 'author:keller fermentation')).toEqual([]);
    expect(ids(search(index, 'author:keller sous'))).toEqual(['sous']);
    expect(ids(search(index, 'tag:koji miso'))).toEqual(['noma']);
  });

  it('operator values keep matching at every step of typing them', () => {
    const studies = buildSearchIndex([
      material('davies', { title: 'Bread', authors: ['Ruth Davies'], tags: ['case studies'] }),
    ]);
    const typing = (word: string): string[] => Array.from({ length: word.length - 1 }, (_, i) => word.slice(0, i + 2));

    for (const partial of typing('studies')) {
      expect(ids(search(studies, `tag:${partial}`)), partial).toEqual(['davies']);
    }
    for (const partial of typing('davies')) {
      expect(ids(search(studies, `author:${partial}`)), partial).toEqual(['davies']);
    }
  });

  it('tag: matches tags only, by prefix', () => {
    expect(ids(search(index, 'tag:koji'))).toEqual(['noma']);
    expect(ids(search(index, 'tag:sous'))).toEqual(['sous']);
    expect(ids(search(index, 'tag:koji fermentation'))).toEqual(['noma']);
  });

  it('kind: and year: filter', () => {
    expect(ids(search(index, 'kind:lecture'))).toEqual(['lecture']);
    expect(ids(search(index, 'kind:book fermentation')).sort()).toEqual(['art', 'noma']);
    expect(ids(search(index, 'year:2005..2012'))).toEqual(['art', 'sous', 'maillard']);
    expect(ids(search(index, 'year:<2005 technique'))).toEqual(['laundry']);
    expect(ids(search(index, 'year:>2012 fermentation')).sort()).toEqual(['lecture', 'noma']);
  });

  it('phrases must appear contiguously in the title or abstract', () => {
    expect(ids(search(index, '"art of fermentation"'))).toEqual(['art']);
    expect(search(index, '"fermentation art"')).toEqual([]);
    expect(ids(search(index, '"amino acids"'))).toEqual(['maillard']);
    expect(search(index, '"microbiology"')).toEqual([]);
  });

  it('excluded terms remove documents', () => {
    expect(ids(search(index, 'fermentation -koji')).sort()).toEqual(['art', 'lecture']);
    expect(ids(search(index, '-koji -keller'))).toEqual(['lecture', 'art', 'maillard']);
  });

  it('treats unknown operators as plain text', () => {
    expect(ids(search(index, 'venue:chelsea'))).toEqual(['art']);
  });
});

describe('search — filters', () => {
  const progressRecord = {
    art: progress('art', 'completed'),
    sous: progress('sous', 'in_progress'),
  };

  it('filters by status, treating missing progress as queued', () => {
    const completed = search(index, 'fermentation', {
      filters: { statuses: ['completed'] },
      progress: progressRecord,
    });
    const queued = search(index, '', { filters: { statuses: ['queued'] }, progress: progressRecord });

    expect(ids(completed)).toEqual(['art']);
    expect(ids(queued)).toEqual(['noma', 'lecture', 'maillard', 'laundry']);
    expect(search(index, '', { filters: { statuses: ['queued'] } })).toHaveLength(6);
  });

  it('intersects option filters with query operators', () => {
    expect(search(index, 'kind:book', { filters: { kinds: ['paper'] } })).toEqual([]);
    expect(ids(search(index, 'technique', { filters: { categoryIds: ['cooking'] } })).sort()).toEqual([
      'laundry',
      'sous',
    ]);
    expect(ids(search(index, 'year:>2000', { filters: { yearTo: 2012 } }))).toEqual(['art', 'sous', 'maillard']);
  });
});

describe('search — empty query rules', () => {
  it('returns nothing for an empty query without filters', () => {
    expect(search(index, '')).toEqual([]);
    expect(search(index, '   ')).toEqual([]);
    expect(search(index, 'the of and')).toEqual([]);
    expect(search(index, '', { filters: { kinds: [], statuses: [] } })).toEqual([]);
  });

  it('lists every match newest first with score 0 when only filters apply', () => {
    const hits = search(index, '', { filters: { kinds: ['book'] } });

    expect(ids(hits)).toEqual(['noma', 'art', 'sous', 'laundry']);
    expect(hits.every((hit) => hit.score === 0 && hit.matchedFields.length === 0)).toBe(true);
  });

  it('honours the limit', () => {
    expect(search(index, '', { filters: { kinds: ['book'] }, limit: 2 })).toHaveLength(2);
    expect(search(index, 'fermentation', { limit: 1 })).toHaveLength(1);
  });
});

describe('suggestTerms', () => {
  it('completes the last partial word, most frequent first', () => {
    expect(suggestTerms(index, 'fer')).toEqual(['fermentation', 'ferran']);
    expect(suggestTerms(index, 'black fer', 1)).toEqual(['fermentation']);
    expect(suggestTerms(index, 'Adri')).toEqual(['adria']);
  });

  it('shows real words, not stems', () => {
    expect(suggestTerms(index, 'tho')).toEqual(['thomas']);
    expect(suggestTerms(index, 'techn')).toEqual(['technique']);
  });

  it('excludes a partial that is already a complete term, and finished words', () => {
    expect(suggestTerms(index, 'koji')).toEqual([]);
    expect(suggestTerms(index, 'ko ')).toEqual([]);
    expect(suggestTerms(index, '')).toEqual([]);
  });

  it('orders equally frequent terms alphabetically and respects the limit', () => {
    expect(suggestTerms(index, 'k')).toEqual(['keller', 'katz', 'kitchen', 'koji', 'kombucha']);
    expect(suggestTerms(index, 'k', 2)).toEqual(['keller', 'katz']);
  });
});
