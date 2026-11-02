import { describe, expect, it } from 'vitest';

import { similarMaterials } from './index';
import { fermentationLibrary, library, material } from './testing';

describe('similarMaterials', () => {
  const state = fermentationLibrary();

  it('ranks content neighbours first and excludes the material itself', () => {
    const similar = similarMaterials(state, 'koji');
    const neighbours = similar.map((entry) => entry.materialId);

    expect(neighbours[0]).toBe('miso');
    expect(neighbours).not.toContain('koji');
    expect(neighbours).not.toContain('stars');
    const scores = similar.map((entry) => entry.similarity);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    for (const score of scores) expect(score).toBeGreaterThan(0.05);
  });

  it('adds a bonus for shared authors, insensitive to case and accents', () => {
    const authored = library({
      materials: [
        material('a', { title: 'Alpha', authors: ['Ana Sörensen'], categoryId: 'x' }),
        material('b', { title: 'Beta', authors: ['ana sorensen'], categoryId: 'y' }),
        material('c', { title: 'Gamma', authors: ['Someone Else'], categoryId: 'z' }),
      ],
    });
    const [best] = similarMaterials(authored, 'a');

    expect(best?.materialId).toBe('b');
    expect(best?.similarity).toBeGreaterThanOrEqual(0.05);
  });

  it('honours the limit and returns nothing for an unknown id', () => {
    expect(similarMaterials(state, 'intro', 2)).toHaveLength(2);
    expect(similarMaterials(state, 'ghost')).toEqual([]);
  });
});
