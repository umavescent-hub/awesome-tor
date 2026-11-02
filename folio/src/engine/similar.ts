import { normalize } from '@/domain/text';
import type { ID, LibraryState } from '@/domain/types';

import { compareIds, descending } from './order';
import { corpusFor, dot, vectorOf } from './vectors';

const DEFAULT_LIMIT = 6;
const SAME_CATEGORY_BONUS = 0.1;
const SHARED_AUTHOR_BONUS = 0.05;
const MAX_AUTHOR_BONUS = 0.1;
const MIN_SIMILARITY = 0.05;

/** Case-, accent- and spacing-insensitive author identity ("Sörensen " = "sorensen"). */
function authorKey(author: string): string {
  return normalize(author).trim().replace(/\s+/g, ' ');
}

/**
 * TF-IDF cosine plus small metadata bonuses, clamped to 1 so it can be shown as a percentage.
 */
export function similarMaterials(
  state: LibraryState,
  materialId: ID,
  limit: number = DEFAULT_LIMIT,
): { materialId: ID; similarity: number }[] {
  const target = state.materials[materialId];
  if (target === undefined) return [];
  const corpus = corpusFor(state.materials, state.categories);
  const targetVector = vectorOf(corpus, materialId);
  const targetAuthors = new Set(target.authors.map(authorKey));

  return Object.values(state.materials)
    .filter((material) => material.id !== materialId)
    .map((material) => {
      const authors = new Set(material.authors.map(authorKey));
      const sharedAuthors = [...authors].filter((author) => targetAuthors.has(author));
      const bonus =
        (material.categoryId === target.categoryId ? SAME_CATEGORY_BONUS : 0) +
        Math.min(MAX_AUTHOR_BONUS, sharedAuthors.length * SHARED_AUTHOR_BONUS);
      const similarity = dot(targetVector, vectorOf(corpus, material.id)) + bonus;
      return { materialId: material.id, similarity: Math.min(1, similarity) };
    })
    .filter((entry) => entry.similarity > MIN_SIMILARITY)
    .sort((a, b) => descending(a.similarity, b.similarity, compareIds(a.materialId, b.materialId)))
    .slice(0, Math.max(0, limit));
}
