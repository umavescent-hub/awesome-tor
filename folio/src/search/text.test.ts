import { describe, expect, it } from 'vitest';

import { analyze, endsMidWord, normalize, stem, tokenize } from '@/domain/text';

describe('normalize / tokenize', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalize('Adrià Sörensen')).toBe('adria sorensen');
    expect(normalize('Ørsted Œuvre Straße')).toBe('orsted oeuvre strasse');
    expect(tokenize('Crème Brûlée')).toEqual(['creme', 'brulee']);
  });

  it('splits on non-alphanumerics, keeping digits and non-Latin scripts', () => {
    expect(tokenize('lacto-fermentation (2nd ed., 2011)')).toEqual(['lacto', 'fermentation', '2nd', 'ed', '2011']);
    expect(tokenize('発酵 и квас')).toEqual(['発酵', 'и', 'квас']);
  });

  it("drops possessive 's and joins inner apostrophes", () => {
    expect(tokenize("Keller's notes")).toEqual(['keller', 'notes']);
    expect(tokenize('Keller’s notes')).toEqual(['keller', 'notes']);
    expect(tokenize("don't")).toEqual(['dont']);
  });
});

describe('stem', () => {
  it.each([
    ['studies', 'study'],
    ['glasses', 'glass'],
    ['boxes', 'box'],
    ['churches', 'church'],
    ['dishes', 'dish'],
    ['buzzes', 'buzz'],
    ['papers', 'paper'],
    ['cases', 'case'],
    ['ties', 'tie'],
    ['1990s', '1990'],
  ])('%s → %s', (word, expected) => {
    expect(stem(word)).toBe(expected);
  });

  it.each(['process', 'corpus', 'analysis', 'bus', 'koji', 'fermentation'])('leaves %s alone', (word) => {
    expect(stem(word)).toBe(word);
  });
});

describe('analyze', () => {
  it('drops stopwords and stems what remains', () => {
    expect(analyze('The Art of Fermentation and Other Studies')).toEqual(['art', 'fermentation', 'other', 'study']);
  });

  it('is symmetric for index and query spellings', () => {
    expect(analyze('Sörensen’s Papers')).toEqual(analyze('sorensen paper'));
  });
});

describe('endsMidWord', () => {
  it('is true only when the text ends with a letter or digit', () => {
    expect(endsMidWord('kel')).toBe(true);
    expect(endsMidWord('adrià')).toBe(true);
    expect(endsMidWord('kel ')).toBe(false);
    expect(endsMidWord('kel,')).toBe(false);
    expect(endsMidWord('')).toBe(false);
  });
});
