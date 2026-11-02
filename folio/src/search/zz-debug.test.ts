import { it } from 'vitest';
import { buildSearchIndex, parseQuery, search, suggestTerms } from './index';
import { material } from '../engine/testing';

const docs = [
  material('ferm', { title: 'The Art of Fermentation', authors: ['Sandor Ellix Katz'], tags: ['fermentation', 'preservation'], abstract: 'An in-depth exploration of fermentation concepts and processes.', year: 2012, kind: 'book', venue: 'Chelsea Green' }),
  material('keller', { title: 'The French Laundry Cookbook', authors: ['Thomas Keller'], tags: ['cooking', 'technique'], abstract: 'Recipes and techniques from the French Laundry.', year: 1999, kind: 'book' }),
  material('kelp', { title: 'Kelp Forest Ecology', authors: ['Jane Doe'], tags: ['ocean', 'ecology'], abstract: 'Kelp ecosystems and their fermentation potential.', year: 2018 }),
  material('noma', { title: 'The Noma Guide to Fermentation', authors: ['René Redzepi', 'David Zilber'], tags: ['fermentation', 'koji'], abstract: 'Koji, kombucha, shoyu, miso, vinegars, garums and black fruits.', year: 2018, kind: 'book' }),
  material('maillard', { title: 'The Maillard Reaction', authors: ['Adrià Ferran'], tags: ['chemistry'], abstract: 'Browning reactions between amino acids and reducing sugars.', year: 2005, kind: 'paper', venue: 'Food Chemistry' }),
];
const index = buildSearchIndex(docs);
it('debug', () => {
  for (const q of ['fermentation', 'fermentaton', 'kel', 'kel ', 'keller', 'author:kel', 'tag:koji fermentation', '"art of fermentation"', 'fermentation -koji', 'kind:books', 'year:>2010', 'year:2005..2012', 'adria', 'koji miso', 'foo:bar', 'the']) {
    console.log(JSON.stringify(q), JSON.stringify(parseQuery(q)), search(index, q).map(h => `${h.materialId}:${h.score.toFixed(3)}[${h.matchedFields}]{${h.fuzzyTerms}}`).join(' '));
  }
  console.log(suggestTerms(index, 'fer'), suggestTerms(index, 'k'), suggestTerms(index, 'koji'), suggestTerms(index, 'ko '));
});
