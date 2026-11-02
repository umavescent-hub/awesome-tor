import { describe, expect, it } from 'vitest';

import { prerequisiteStatus, wouldCreateCycle } from './index';
import { fermentationLibrary, library, material, progress } from './testing';

describe('prerequisiteStatus', () => {
  it('counts completed and missing prerequisites', () => {
    const state = fermentationLibrary([progress('lacto', 'completed'), progress('koji', 'in_progress')]);

    expect(prerequisiteStatus(state, 'yeast')).toEqual({ total: 2, completed: 1, missing: ['koji'] });
    expect(prerequisiteStatus(state, 'intro')).toEqual({ total: 0, completed: 0, missing: [] });
  });

  it('ignores unknown ids and duplicates', () => {
    const state = library({
      materials: [material('a'), material('b', { prerequisites: ['a', 'ghost', 'a'] })],
    });

    expect(prerequisiteStatus(state, 'b')).toEqual({ total: 1, completed: 0, missing: ['a'] });
    expect(prerequisiteStatus(state, 'nope')).toEqual({ total: 0, completed: 0, missing: [] });
  });
});

describe('wouldCreateCycle', () => {
  const { materials } = fermentationLibrary();

  it('detects direct and transitive cycles', () => {
    expect(wouldCreateCycle(materials, 'intro', ['lacto'])).toBe(true);
    expect(wouldCreateCycle(materials, 'intro', ['yeast'])).toBe(true);
    expect(wouldCreateCycle(materials, 'koji', ['miso'])).toBe(true);
  });

  it('treats self-reference as a cycle', () => {
    expect(wouldCreateCycle(materials, 'stars', ['stars'])).toBe(true);
  });

  it('accepts acyclic edges, including unknown ids', () => {
    expect(wouldCreateCycle(materials, 'stars', ['yeast', 'intro'])).toBe(false);
    expect(wouldCreateCycle(materials, 'yeast', ['miso', 'ghost'])).toBe(false);
    expect(wouldCreateCycle(materials, 'intro', [])).toBe(false);
  });
});
