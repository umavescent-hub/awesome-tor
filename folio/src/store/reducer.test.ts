import { describe, expect, it } from 'vitest';

import type { LibraryState } from '@/domain/types';
import { initialReviewCard, scheduleReview } from '@/engine';
import type { Action } from './actions';
import { libraryReducer, moveItem } from './reducer';
import { at, deepFreeze, library, material, playlist, progress, T0 } from './testFixtures';

/** Reduces over a deep-frozen state, so any mutation of the input throws. */
function reduce(state: LibraryState, action: Action): LibraryState {
  return libraryReducer(deepFreeze(state), action);
}

function expectNoOp(state: LibraryState, action: Action): void {
  expect(reduce(state, action)).toBe(state);
}

const base = () =>
  library({
    materials: [material('m1'), material('m2', { prerequisites: ['m1'] }), material('m3', { prerequisites: ['m1', 'm2'] })],
    playlists: [playlist('p1', ['m1', 'm2']), playlist('p2', ['m3'])],
  });

describe('material/add', () => {
  it('inserts a new material', () => {
    const next = reduce(base(), { type: 'material/add', material: material('m9') });
    expect(next.materials.m9).toEqual(material('m9'));
    expect(Object.keys(next.materials)).toHaveLength(4);
  });

  it('is a no-op when the id already exists', () => {
    expectNoOp(base(), { type: 'material/add', material: material('m1', { title: 'Other' }) });
  });
});

describe('material/update', () => {
  it('shallow-merges the patch and keeps everything else', () => {
    const state = base();
    const next = reduce(state, { type: 'material/update', id: 'm2', patch: { title: 'New', tags: ['x'] } });
    expect(next.materials.m2).toEqual({ ...state.materials.m2, title: 'New', tags: ['x'] });
    expect(next.materials.m1).toBe(state.materials.m1);
  });

  it('is a no-op for an unknown id', () => {
    expectNoOp(base(), { type: 'material/update', id: 'nope', patch: { title: 'x' } });
  });

  it('is a no-op when the patch changes nothing', () => {
    expectNoOp(base(), { type: 'material/update', id: 'm1', patch: {} });
    expectNoOp(base(), { type: 'material/update', id: 'm1', patch: { title: 'Title m1', year: 2000 } });
  });
});

describe('material/remove', () => {
  it('removes the material, its progress, playlist entries and prerequisite links', () => {
    const state = { ...base(), progress: { m1: progress('m1', { status: 'in_progress', percent: 0.5 }) } };
    const next = reduce(state, { type: 'material/remove', id: 'm1' });

    expect(next.materials.m1).toBeUndefined();
    expect(next.progress.m1).toBeUndefined();
    expect(next.playlists.p1?.materialIds).toEqual(['m2']);
    expect(next.materials.m2?.prerequisites).toEqual([]);
    expect(next.materials.m3?.prerequisites).toEqual(['m2']);
  });

  it('keeps playlist updatedAt and the identity of untouched entities', () => {
    const state = base();
    const next = reduce(state, { type: 'material/remove', id: 'm3' });
    expect(next.playlists.p2).toEqual({ ...state.playlists.p2, materialIds: [] });
    expect(next.playlists.p2?.updatedAt).toBe(T0);
    expect(next.playlists.p1).toBe(state.playlists.p1);
    expect(next.materials.m1).toBe(state.materials.m1);
  });

  it('is a no-op for an unknown id', () => {
    expectNoOp(base(), { type: 'material/remove', id: 'nope' });
  });
});

describe('progress/open', () => {
  it('creates a queued entry and counts the first session', () => {
    const state = base();
    const next = reduce(state, { type: 'progress/open', id: 'm1', at: T0 });
    expect(next.progress.m1).toEqual(progress('m1', { sessions: 1, lastOpenedAt: T0 }));
    expect(next.materials).toBe(state.materials);
  });

  it('counts a new session only when the previous open is more than 30 minutes earlier', () => {
    const state = { ...base(), progress: { m1: progress('m1', { sessions: 3, lastOpenedAt: at(0) }) } };
    const within = reduce(state, { type: 'progress/open', id: 'm1', at: at(30) });
    expect(within.progress.m1).toMatchObject({ sessions: 3, lastOpenedAt: at(30) });

    const after = reduce(state, { type: 'progress/open', id: 'm1', at: at(31) });
    expect(after.progress.m1).toMatchObject({ sessions: 4, lastOpenedAt: at(31) });
  });

  it('leaves the status unchanged', () => {
    const state = { ...base(), progress: { m1: progress('m1', { status: 'completed', percent: 1 }) } };
    expect(reduce(state, { type: 'progress/open', id: 'm1', at: T0 }).progress.m1?.status).toBe('completed');
  });

  it('is a no-op for an unknown material', () => {
    expectNoOp(base(), { type: 'progress/open', id: 'nope', at: T0 });
  });
});

describe('progress/start', () => {
  it('moves a queued material to in progress and opens it', () => {
    const next = reduce(base(), { type: 'progress/start', id: 'm1', at: T0 });
    expect(next.progress.m1).toEqual(
      progress('m1', { status: 'in_progress', startedAt: T0, sessions: 1, lastOpenedAt: T0 }),
    );
  });

  it('resumes a skipped material and keeps its original startedAt', () => {
    const state = { ...base(), progress: { m1: progress('m1', { status: 'skipped', startedAt: at(-600) }) } };
    expect(reduce(state, { type: 'progress/start', id: 'm1', at: T0 }).progress.m1).toMatchObject({
      status: 'in_progress',
      startedAt: at(-600),
    });
  });

  it('keeps a completed material completed but still counts the open', () => {
    const done = progress('m1', { status: 'completed', percent: 1, sessions: 2, lastOpenedAt: at(-120) });
    const next = reduce({ ...base(), progress: { m1: done } }, { type: 'progress/start', id: 'm1', at: T0 });
    expect(next.progress.m1).toEqual({ ...done, sessions: 3, lastOpenedAt: T0 });
  });

  it('is a no-op for an unknown material', () => {
    expectNoOp(base(), { type: 'progress/start', id: 'nope', at: T0 });
  });
});

describe('progress/set', () => {
  it('moves a queued material to in progress when percent > 0', () => {
    const next = reduce(base(), { type: 'progress/set', id: 'm1', percent: 0.4, at: T0 });
    expect(next.progress.m1).toEqual(
      progress('m1', { status: 'in_progress', percent: 0.4, startedAt: T0, lastOpenedAt: T0 }),
    );
  });

  it('clamps below zero and leaves a queued material queued at 0', () => {
    const next = reduce(base(), { type: 'progress/set', id: 'm1', percent: -3, at: T0 });
    expect(next.progress.m1).toEqual(progress('m1', { percent: 0, lastOpenedAt: T0 }));
  });

  it('treats percent >= 1 exactly like complete', () => {
    const state = { ...base(), progress: { m1: progress('m1', { status: 'in_progress', percent: 0.9, rating: 4 }) } };
    const viaSet = reduce(state, { type: 'progress/set', id: 'm1', percent: 1.7, at: T0 });
    const viaComplete = reduce(state, { type: 'progress/complete', id: 'm1', at: T0 });
    expect(viaSet).toEqual(viaComplete);
  });

  it('reopens a completed material below 100%, dropping completedAt and review', () => {
    const done = progress('m1', {
      status: 'completed',
      percent: 1,
      startedAt: at(-600),
      completedAt: at(-60),
      review: initialReviewCard(new Date(at(-60))),
      rating: 5,
      sessions: 4,
    });
    const next = reduce({ ...base(), progress: { m1: done } }, { type: 'progress/set', id: 'm1', percent: 0.5, at: T0 });
    expect(next.progress.m1).toEqual(
      progress('m1', { status: 'in_progress', percent: 0.5, startedAt: at(-600), rating: 5, sessions: 4, lastOpenedAt: T0 }),
    );
  });

  it('does not count a session', () => {
    const next = reduce(base(), { type: 'progress/set', id: 'm1', percent: 0.2, at: T0 });
    expect(next.progress.m1?.sessions).toBe(0);
  });

  it('is a no-op for NaN or an unknown material', () => {
    expectNoOp(base(), { type: 'progress/set', id: 'm1', percent: Number.NaN, at: T0 });
    expectNoOp(base(), { type: 'progress/set', id: 'nope', percent: 0.5, at: T0 });
  });
});

describe('progress/complete', () => {
  it('completes with a fresh review card', () => {
    const next = reduce(base(), { type: 'progress/complete', id: 'm1', at: T0 });
    expect(next.progress.m1).toEqual(
      progress('m1', {
        status: 'completed',
        percent: 1,
        startedAt: T0,
        completedAt: T0,
        review: initialReviewCard(new Date(T0)),
      }),
    );
  });

  it('keeps an existing startedAt, review card and rating', () => {
    const review = scheduleReview(undefined, 'good', new Date(at(-1440)));
    const state = {
      ...base(),
      progress: { m1: progress('m1', { status: 'in_progress', startedAt: at(-600), rating: 3, review }) },
    };
    expect(reduce(state, { type: 'progress/complete', id: 'm1', at: T0 }).progress.m1).toMatchObject({
      startedAt: at(-600),
      completedAt: T0,
      rating: 3,
      review,
    });
  });

  it('is a no-op for an unknown material', () => {
    expectNoOp(base(), { type: 'progress/complete', id: 'nope', at: T0 });
  });
});

describe('progress/skip', () => {
  it('creates a skipped entry when missing and skips an in-progress one', () => {
    expect(reduce(base(), { type: 'progress/skip', id: 'm1', at: T0 }).progress.m1).toEqual(
      progress('m1', { status: 'skipped' }),
    );
    const state = { ...base(), progress: { m1: progress('m1', { status: 'in_progress', percent: 0.3 }) } };
    expect(reduce(state, { type: 'progress/skip', id: 'm1', at: T0 }).progress.m1).toEqual(
      progress('m1', { status: 'skipped', percent: 0.3 }),
    );
  });

  it('is a no-op for an unknown material or one already skipped', () => {
    expectNoOp(base(), { type: 'progress/skip', id: 'nope', at: T0 });
    expectNoOp({ ...base(), progress: { m1: progress('m1', { status: 'skipped' }) } }, { type: 'progress/skip', id: 'm1', at: T0 });
  });

  it('leaves completed work completed, so a later start cannot revive its review card', () => {
    const done = progress('m1', {
      status: 'completed',
      percent: 1,
      completedAt: at(-60),
      review: initialReviewCard(new Date(at(-60))),
    });
    const state = { ...base(), progress: { m1: done } };
    expectNoOp(state, { type: 'progress/skip', id: 'm1', at: T0 });
    const started = reduce(reduce(state, { type: 'progress/skip', id: 'm1', at: T0 }), {
      type: 'progress/start',
      id: 'm1',
      at: T0,
    });
    expect(started.progress.m1?.status).toBe('completed');
  });
});

describe('progress state machine', () => {
  it('complete → set(0.5) → complete leaves one fresh review card from the second completion', () => {
    const steps: Action[] = [
      { type: 'progress/complete', id: 'm1', at: at(-1440) },
      { type: 'progress/review', id: 'm1', grade: 'good', at: at(-60) },
      { type: 'progress/set', id: 'm1', percent: 0.5, at: at(-30) },
      { type: 'progress/complete', id: 'm1', at: T0 },
    ];
    const done = steps.reduce(reduce, base()).progress.m1;
    expect(done).toMatchObject({ status: 'completed', percent: 1, completedAt: T0, startedAt: at(-1440) });
    expect(done?.review).toEqual(initialReviewCard(new Date(T0)));
  });

  it('skip → start resumes in progress with the original percent', () => {
    const steps: Action[] = [
      { type: 'progress/set', id: 'm1', percent: 0.3, at: at(-60) },
      { type: 'progress/skip', id: 'm1', at: at(-30) },
      { type: 'progress/start', id: 'm1', at: T0 },
    ];
    expect(steps.reduce(reduce, base()).progress.m1).toMatchObject({
      status: 'in_progress',
      percent: 0.3,
      startedAt: at(-60),
    });
  });

  it('reset → review is a no-op: a material without progress has nothing to review', () => {
    const done = reduce(base(), { type: 'progress/complete', id: 'm1', at: at(-60) });
    const reset = reduce(done, { type: 'progress/reset', id: 'm1' });
    expectNoOp(reset, { type: 'progress/review', id: 'm1', grade: 'easy', at: T0 });
  });
});

describe('progress/reset', () => {
  it('deletes the entry', () => {
    const state = { ...base(), progress: { m1: progress('m1', { status: 'completed', percent: 1 }) } };
    expect(reduce(state, { type: 'progress/reset', id: 'm1' }).progress).toEqual({});
  });

  it('is a no-op when there is no entry', () => {
    expectNoOp(base(), { type: 'progress/reset', id: 'm1' });
  });
});

describe('progress/rate', () => {
  it('creates a queued entry carrying the rating', () => {
    expect(reduce(base(), { type: 'progress/rate', id: 'm1', rating: 4 }).progress.m1).toEqual(
      progress('m1', { rating: 4 }),
    );
  });

  it('merges into an existing entry', () => {
    const done = progress('m1', { status: 'completed', percent: 1, rating: 2 });
    const next = reduce({ ...base(), progress: { m1: done } }, { type: 'progress/rate', id: 'm1', rating: 5 });
    expect(next.progress.m1).toEqual({ ...done, rating: 5 });
  });

  it('is a no-op for an unknown material or an unchanged rating', () => {
    expectNoOp(base(), { type: 'progress/rate', id: 'nope', rating: 3 });
    expectNoOp({ ...base(), progress: { m1: progress('m1', { rating: 3 }) } }, { type: 'progress/rate', id: 'm1', rating: 3 });
  });
});

describe('progress/review', () => {
  it('reschedules the review card of a completed material', () => {
    const card = initialReviewCard(new Date(at(-1440)));
    const state = { ...base(), progress: { m1: progress('m1', { status: 'completed', percent: 1, review: card }) } };
    const next = reduce(state, { type: 'progress/review', id: 'm1', grade: 'good', at: T0 });
    expect(next.progress.m1?.review).toEqual(scheduleReview(card, 'good', new Date(T0)));
  });

  it('is a no-op unless the material is completed', () => {
    expectNoOp(base(), { type: 'progress/review', id: 'm1', grade: 'good', at: T0 });
    const inProgress = { ...base(), progress: { m1: progress('m1', { status: 'in_progress', percent: 0.5 }) } };
    expectNoOp(inProgress, { type: 'progress/review', id: 'm1', grade: 'easy', at: T0 });
    expectNoOp(base(), { type: 'progress/review', id: 'nope', grade: 'good', at: T0 });
  });
});

describe('playlist/create', () => {
  it('inserts the playlist, dropping unknown and duplicate material ids', () => {
    const next = reduce(base(), { type: 'playlist/create', playlist: playlist('p9', ['m2', 'ghost', 'm1', 'm2']) });
    expect(next.playlists.p9).toEqual(playlist('p9', ['m2', 'm1']));
  });

  it('is a no-op when the id already exists', () => {
    expectNoOp(base(), { type: 'playlist/create', playlist: playlist('p1', []) });
  });
});

describe('playlist/update', () => {
  it('merges the patch and bumps updatedAt', () => {
    const next = reduce(base(), {
      type: 'playlist/update',
      id: 'p1',
      patch: { name: 'Renamed', pinned: true },
      at: at(5),
    });
    expect(next.playlists.p1).toEqual(playlist('p1', ['m1', 'm2'], { name: 'Renamed', pinned: true, updatedAt: at(5) }));
  });

  it('is a no-op for an unknown id', () => {
    expectNoOp(base(), { type: 'playlist/update', id: 'nope', patch: { name: 'x' }, at: T0 });
  });

  it('is a no-op, without bumping updatedAt, when the patch changes nothing', () => {
    expectNoOp(base(), { type: 'playlist/update', id: 'p1', patch: {}, at: at(5) });
    expectNoOp(base(), { type: 'playlist/update', id: 'p1', patch: { name: 'p1', description: '' }, at: at(5) });
  });
});

describe('playlist/delete', () => {
  it('deletes the playlist', () => {
    expect(Object.keys(reduce(base(), { type: 'playlist/delete', id: 'p1' }).playlists)).toEqual(['p2']);
  });

  it('is a no-op for an unknown id', () => {
    expectNoOp(base(), { type: 'playlist/delete', id: 'nope' });
  });
});

describe('playlist/add', () => {
  it('appends the material and bumps updatedAt', () => {
    const next = reduce(base(), { type: 'playlist/add', id: 'p2', materialId: 'm1', at: at(1) });
    expect(next.playlists.p2).toEqual(playlist('p2', ['m3', 'm1'], { updatedAt: at(1) }));
  });

  it('is a no-op for duplicates, unknown materials and unknown playlists', () => {
    expectNoOp(base(), { type: 'playlist/add', id: 'p1', materialId: 'm1', at: T0 });
    expectNoOp(base(), { type: 'playlist/add', id: 'p1', materialId: 'ghost', at: T0 });
    expectNoOp(base(), { type: 'playlist/add', id: 'nope', materialId: 'm1', at: T0 });
  });
});

describe('playlist/remove', () => {
  it('removes the material and bumps updatedAt', () => {
    const next = reduce(base(), { type: 'playlist/remove', id: 'p1', materialId: 'm1', at: at(1) });
    expect(next.playlists.p1).toEqual(playlist('p1', ['m2'], { updatedAt: at(1) }));
  });

  it('is a no-op when the material is not in the playlist or the playlist is unknown', () => {
    expectNoOp(base(), { type: 'playlist/remove', id: 'p1', materialId: 'm3', at: T0 });
    expectNoOp(base(), { type: 'playlist/remove', id: 'nope', materialId: 'm1', at: T0 });
  });
});

describe('playlist/move', () => {
  const withThree = () => ({ ...base(), playlists: { p1: playlist('p1', ['m1', 'm2', 'm3']) } });

  it('moves an item forward and backward with array-move semantics', () => {
    const forward = reduce(withThree(), { type: 'playlist/move', id: 'p1', from: 0, to: 2, at: at(1) });
    expect(forward.playlists.p1).toEqual(playlist('p1', ['m2', 'm3', 'm1'], { updatedAt: at(1) }));
    const backward = reduce(withThree(), { type: 'playlist/move', id: 'p1', from: 2, to: 0, at: at(1) });
    expect(backward.playlists.p1?.materialIds).toEqual(['m3', 'm1', 'm2']);
  });

  it('is a no-op when out of range, not an integer, from === to, or the playlist is unknown', () => {
    for (const [from, to] of [[0, 3], [-1, 0], [0, -1], [0.5, 1], [1, 1]] as const) {
      expectNoOp(withThree(), { type: 'playlist/move', id: 'p1', from, to, at: T0 });
    }
    expectNoOp(withThree(), { type: 'playlist/move', id: 'nope', from: 0, to: 1, at: T0 });
  });
});

describe('moveItem', () => {
  it('moves between adjacent and distant positions', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 1, 2)).toEqual(['a', 'c', 'b', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('returns null for invalid moves', () => {
    expect(moveItem([], 0, 0)).toBeNull();
    expect(moveItem(['a'], 0, 0)).toBeNull();
    expect(moveItem(['a', 'b'], Number.NaN, 1)).toBeNull();
  });
});

describe('settings/update', () => {
  it('trims the display name and ignores a blank one', () => {
    expect(reduce(base(), { type: 'settings/update', patch: { displayName: '  Ana  ' } }).settings.displayName).toBe(
      'Ana',
    );
    expect(reduce(base(), { type: 'settings/update', patch: { displayName: '   ' } }).settings.displayName).toBe('Chef');
  });

  it('clamps and rounds dailyMinutes, ignoring NaN', () => {
    const minutes = (value: number) =>
      reduce(base(), { type: 'settings/update', patch: { dailyMinutes: value } }).settings.dailyMinutes;
    expect(minutes(2)).toBe(5);
    expect(minutes(1000)).toBe(600);
    expect(minutes(42.6)).toBe(43);
    expect(minutes(Number.NaN)).toBe(60);
  });

  it('is a no-op when nothing changes', () => {
    expectNoOp(base(), { type: 'settings/update', patch: {} });
    expectNoOp(base(), { type: 'settings/update', patch: { displayName: 'Chef', dailyMinutes: 60 } });
    expectNoOp(base(), { type: 'settings/update', patch: { displayName: '  Chef ', dailyMinutes: Number.NaN } });
  });

  it('leaves fields absent from the patch alone', () => {
    expect(reduce(base(), { type: 'settings/update', patch: { dailyMinutes: 90 } }).settings).toEqual({
      dailyMinutes: 90,
      displayName: 'Chef',
    });
  });
});

describe('library/replace', () => {
  it('returns the given state', () => {
    const replacement = library({ materials: [material('x')] });
    expect(reduce(base(), { type: 'library/replace', state: replacement })).toBe(replacement);
  });
});
