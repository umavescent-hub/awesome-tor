import { compareText, endsMidWord, stem, tokenize } from '@/domain/text';

import { asBuiltIndex } from './build';
import { documentFrequency, wordsWithPrefix } from './expand';
import type { SearchIndex } from './types';

const DEFAULT_SUGGESTIONS = 5;

/**
 * Autocomplete: vocabulary terms starting with the last partial word, most frequent first.
 * One suggestion per indexed term, spelled as its most frequent matching word, so the user
 * sees "thomas" rather than the stem "thoma". A word already typed in full is not suggested.
 */
export function suggestTerms(
  index: SearchIndex,
  partial: string,
  limit: number = DEFAULT_SUGGESTIONS,
): string[] {
  const built = asBuiltIndex(index);
  const typed = endsMidWord(partial) ? tokenize(partial).at(-1) : undefined;
  if (typed === undefined) return [];
  const finished = built.wordFrequency.has(typed) ? stem(typed) : undefined;
  const frequency = (word: string): number => built.wordFrequency.get(word) ?? 0;

  const spellings = new Map<string, string>();
  for (const word of wordsWithPrefix(built, typed)) {
    const term = stem(word);
    const current = spellings.get(term);
    if (term !== finished && (current === undefined || frequency(word) > frequency(current))) {
      spellings.set(term, word);
    }
  }
  return [...spellings]
    .sort(
      ([termA, wordA], [termB, wordB]) =>
        documentFrequency(built, termB) - documentFrequency(built, termA) ||
        compareText(wordA, wordB),
    )
    .slice(0, Math.max(0, limit))
    .map(([, word]) => word);
}
