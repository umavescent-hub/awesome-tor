/**
 * Shared text analysis for search and recommendations.
 *
 * Index text and query text go through the same pipeline, so every transformation here is
 * symmetric: whatever a document's word becomes, the same word typed in a query becomes too.
 */

/** Small English stopword list: function words that carry no topical signal. */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'has', 'have',
  'he', 'her', 'his', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'not', 'of', 'on', 'or', 'our',
  'she', 'so', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'to', 'was', 'we', 'were', 'which', 'who', 'will', 'with', 'you', 'your',
]);

/** Letters that NFKD leaves intact but readers treat as accented Latin letters. */
const LETTER_FOLDS: Readonly<Record<string, string>> = {
  ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', đ: 'd', ð: 'd', ł: 'l', þ: 'th', ı: 'i',
};

const COMBINING_MARKS = /\p{M}+/gu;
const FOLDABLE_LETTERS = /[øæœßđðłþı]/g;
const POSSESSIVE = /['’]s(?![\p{L}\p{N}])/gu;
const APOSTROPHES = /['’]/g;
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/u;
const ALPHANUMERIC_END = /[\p{L}\p{N}]$/u;

/** Lowercase, compatibility-decompose and strip diacritics: "Adrià" → "adria". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(FOLDABLE_LETTERS, (letter) => LETTER_FOLDS[letter] ?? letter);
}

/**
 * Normalised words, in order, with possessive "'s" removed and inner apostrophes joined
 * ("Keller's" → "keller", "don't" → "dont"). No stopword removal, no stemming.
 */
export function tokenize(text: string): string[] {
  return normalize(text)
    .replace(POSSESSIVE, '')
    .replace(APOSTROPHES, '')
    .split(NON_ALPHANUMERIC)
    .filter((token) => token.length > 0);
}

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}

/**
 * Light, conservative plural stripping. Only suffixes whose removal is almost always right:
 * "studies" → "study", "glasses" → "glass", "boxes" → "box", "papers" → "paper".
 * "-ses"/"-zes" lose only the "s" unless doubled ("cases" → "case", "buzzes" → "buzz"),
 * and "-ss", "-us", "-is" words are left alone ("process", "corpus", "analysis").
 */
export function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && /(?:ss|zz|x|ch|sh)es$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !/(?:ss|us|is)$/.test(token)) {
    return token.slice(0, -1);
  }
  return token;
}

/** Index/query terms: tokenize, drop stopwords, stem. */
export function analyze(text: string): string[] {
  return tokenize(text)
    .filter((token) => !isStopword(token))
    .map(stem);
}

/** Code-point order, independent of device locale, for deterministic tie-breaks. */
export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** True when the text ends mid-word (its last character is a letter or digit). */
export function endsMidWord(text: string): boolean {
  return ALPHANUMERIC_END.test(text);
}
