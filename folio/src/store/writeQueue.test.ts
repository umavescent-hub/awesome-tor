import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWriteQueue } from './writeQueue';

const DELAY = 400;

/** A write function whose calls can be resolved or rejected one by one, in any order. */
function controlledWriter() {
  const calls: { value: string; resolve: () => void; reject: (error: Error) => void }[] = [];
  const write = vi.fn(
    (value: string) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ value, resolve, reject });
      }),
  );
  return { calls, write, written: () => write.mock.calls.map(([value]) => value) };
}

/** Lets queued promise callbacks run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createWriteQueue', () => {
  it('writes only the latest value, once the quiet period after the last schedule has passed', async () => {
    const { write, written, calls } = controlledWriter();
    const queue = createWriteQueue(write, DELAY);
    queue.schedule('a');
    await vi.advanceTimersByTimeAsync(DELAY - 1);
    queue.schedule('b');
    await vi.advanceTimersByTimeAsync(DELAY - 1);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(written()).toEqual(['b']);
    calls[0]?.resolve();
    await vi.advanceTimersByTimeAsync(DELAY * 10);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('flush writes immediately, cancels the timer, and does nothing when nothing is pending', async () => {
    const { write, written } = controlledWriter();
    const queue = createWriteQueue(write, DELAY);
    queue.flush();
    await settle();
    expect(write).not.toHaveBeenCalled();

    queue.schedule('a');
    queue.flush();
    await settle();
    expect(written()).toEqual(['a']);
    queue.flush();
    await vi.advanceTimersByTimeAsync(DELAY * 10);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('never runs two writes at once, so they land in the order they were issued', async () => {
    const { write, written, calls } = controlledWriter();
    const queue = createWriteQueue(write, DELAY);
    queue.schedule('old');
    queue.flush();
    queue.schedule('new');
    queue.flush();
    await settle();
    expect(written()).toEqual(['old']);
    calls[0]?.resolve();
    await settle();
    expect(written()).toEqual(['old', 'new']);
  });

  it('retries a failed write on the next flush when nothing newer was scheduled', async () => {
    const { written, write, calls } = controlledWriter();
    const queue = createWriteQueue(write, DELAY);
    queue.schedule('a');
    queue.flush();
    await settle();
    calls[0]?.reject(new Error('disk full'));
    await settle();
    queue.flush();
    await settle();
    expect(written()).toEqual(['a', 'a']);
  });

  it('does not let a failed older write overwrite a newer one later', async () => {
    const { written, write, calls } = controlledWriter();
    const queue = createWriteQueue(write, DELAY);
    queue.schedule('old');
    queue.flush();
    queue.schedule('new');
    queue.flush();
    await settle();
    calls[0]?.reject(new Error('disk full'));
    await settle();
    calls[1]?.resolve();
    await settle();

    queue.flush();
    await vi.advanceTimersByTimeAsync(DELAY * 10);
    expect(written()).toEqual(['old', 'new']);
  });

  it('survives a write function that throws synchronously', async () => {
    const write = vi.fn((value: string): Promise<void> => {
      if (value === 'bad') throw new Error('sync');
      return Promise.resolve();
    });
    const queue = createWriteQueue(write, DELAY);
    queue.schedule('bad');
    queue.flush();
    await settle();
    queue.schedule('good');
    queue.flush();
    await settle();
    expect(write.mock.calls.map(([value]) => value)).toEqual(['bad', 'good']);
  });
});
