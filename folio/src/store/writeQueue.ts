/**
 * The debounced writer behind LibraryProvider's persistence, free of React and React Native so it
 * can be unit-tested. The provider owns one per mount.
 */

export interface WriteQueue<T> {
  /** Records `value` as the latest state and restarts the quiet-period timer. */
  schedule(value: T): void;
  /** Writes the latest scheduled value now, unless it has already been handed to `write`. */
  flush(): void;
}

/**
 * Writes run one at a time, in the order they were issued, so a slow older write can never land
 * after a newer one. A failed write is retried on the next flush, but only while it is still the
 * latest value: an older state must never replace a newer one in storage.
 */
export function createWriteQueue<T>(write: (value: T) => Promise<void>, delayMs: number): WriteQueue<T> {
  /** Boxed so each schedule has its own identity, even when the same value is scheduled twice. */
  let latest: { value: T } | null = null;
  let unwritten = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tail: Promise<void> = Promise.resolve();

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const entry = latest;
    if (!unwritten || entry === null) return;
    unwritten = false;
    tail = tail
      .then(() => write(entry.value))
      .catch(() => {
        if (latest === entry) unwritten = true;
      });
  };

  return {
    schedule(value) {
      latest = { value };
      unwritten = true;
      clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flush,
  };
}
