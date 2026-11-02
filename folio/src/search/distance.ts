/**
 * Bounded optimal-string-alignment distance (Damerau-Levenshtein with adjacent transpositions,
 * each substring edited at most once). Returns early once every alignment exceeds `max`.
 */
export function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const width = b.length + 1;
  let beforePrevious = new Array<number>(width).fill(0);
  let previous = Array.from({ length: width }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let distance = Math.min(
        (previous[j] ?? Infinity) + 1,
        (current[j - 1] ?? Infinity) + 1,
        (previous[j - 1] ?? Infinity) + substitution,
      );
      const transposed =
        i > 1 &&
        j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1);
      if (transposed) distance = Math.min(distance, (beforePrevious[j - 2] ?? Infinity) + 1);
      current.push(distance);
      rowMin = Math.min(rowMin, distance);
    }
    if (rowMin > max) return false;
    beforePrevious = previous;
    previous = current;
  }
  return (previous[b.length] ?? Infinity) <= max;
}
