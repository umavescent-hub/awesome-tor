import { describe, expect, it } from 'vitest';

import {
  completed,
  createId,
  inProgress,
  libraryStats,
  materialsInCategory,
  playlistMaterials,
  playlistStats,
  progressOf,
  sortedCategories,
  sortedPlaylists,
} from './selectors';
import { at, category, library, material, playlist, progress, T0 } from './testFixtures';

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe('progressOf', () => {
  it('returns stored progress, or a queued default', () => {
    const stored = progress('m1', { status: 'in_progress', percent: 0.5 });
    const state = library({ materials: [material('m1'), material('m2')], progress: [stored] });
    expect(progressOf(state, 'm1')).toBe(stored);
    expect(progressOf(state, 'm2')).toEqual({ materialId: 'm2', status: 'queued', percent: 0, sessions: 0 });
  });

  it('never resolves inherited object keys', () => {
    expect(progressOf(library(), 'constructor')).toEqual(progress('constructor'));
  });
});

describe('playlistMaterials / playlistStats', () => {
  const state = library({
    materials: [material('a', { minutes: 100 }), material('b', { minutes: 50 }), material('c', { minutes: 50 })],
    playlists: [playlist('p', ['c', 'ghost', 'a', 'b'])],
    progress: [
      progress('a', { status: 'completed', percent: 1 }),
      progress('b', { status: 'in_progress', percent: 0.5 }),
    ],
  });

  it('lists materials in playlist order, skipping dangling ids', () => {
    expect(ids(playlistMaterials(state, 'p'))).toEqual(['c', 'a', 'b']);
    expect(playlistMaterials(state, 'nope')).toEqual([]);
  });

  it('weights completion by minutes, counting partial progress', () => {
    expect(playlistStats(state, 'p')).toEqual({
      count: 3,
      completed: 1,
      totalMinutes: 200,
      remainingMinutes: 75,
      percent: 125 / 200,
    });
  });

  it('is all zeros for an unknown or empty playlist', () => {
    const zero = { count: 0, completed: 0, totalMinutes: 0, remainingMinutes: 0, percent: 0 };
    expect(playlistStats(state, 'nope')).toEqual(zero);
    expect(playlistStats(library({ playlists: [playlist('e', [])] }), 'e')).toEqual(zero);
  });
});

describe('sortedPlaylists', () => {
  it('puts pinned first, then most recently updated, then by name', () => {
    const state = library({
      playlists: [
        playlist('old', [], { updatedAt: at(-10) }),
        playlist('pinnedOld', [], { pinned: true, updatedAt: at(-20) }),
        playlist('new', [], { updatedAt: at(5) }),
        playlist('pinnedNew', [], { pinned: true, updatedAt: at(1) }),
        playlist('alsoNew', [], { updatedAt: at(5) }),
      ],
    });
    expect(ids(sortedPlaylists(state))).toEqual(['pinnedNew', 'pinnedOld', 'alsoNew', 'new', 'old']);
  });
});

describe('inProgress / completed', () => {
  const state = library({
    materials: ['a', 'b', 'c', 'd', 'e'].map((id) => material(id)),
    progress: [
      progress('a', { status: 'in_progress', lastOpenedAt: at(-60) }),
      progress('b', { status: 'in_progress', lastOpenedAt: at(-5) }),
      progress('c', { status: 'completed', percent: 1, completedAt: at(-300) }),
      progress('d', { status: 'completed', percent: 1, completedAt: at(-30) }),
      progress('e', { status: 'skipped' }),
      progress('ghost', { status: 'in_progress', lastOpenedAt: T0 }),
    ],
  });

  it('lists in-progress materials, most recently opened first', () => {
    expect(ids(inProgress(state))).toEqual(['b', 'a']);
  });

  it('lists completed materials, most recently completed first', () => {
    expect(ids(completed(state))).toEqual(['d', 'c']);
  });
});

describe('sortedCategories / materialsInCategory', () => {
  const state = library({
    categories: [category('c1', { name: 'Zymology' }), category('c2', { name: 'Agronomy' })],
    materials: [
      material('old', { categoryId: 'c1', year: 1903 }),
      material('new', { categoryId: 'c1', year: 2020 }),
      material('tieB', { categoryId: 'c1', year: 2010, title: 'B' }),
      material('tieA', { categoryId: 'c1', year: 2010, title: 'A' }),
      material('other', { categoryId: 'c2', year: 2030 }),
    ],
  });

  it('sorts categories by name', () => {
    expect(ids(sortedCategories(state))).toEqual(['c2', 'c1']);
  });

  it('lists a category newest year first, ties by title', () => {
    expect(ids(materialsInCategory(state, 'c1'))).toEqual(['new', 'tieA', 'tieB', 'old']);
    expect(materialsInCategory(state, 'nope')).toEqual([]);
  });
});

describe('libraryStats', () => {
  const now = new Date('2026-11-10T09:00:00.000Z');
  const day = (date: string) => `${date}T18:30:00.000Z`;

  it('counts statuses and minutes studied over existing materials only', () => {
    const state = library({
      materials: [material('a', { minutes: 600 }), material('b', { minutes: 90 }), material('c')],
      progress: [
        progress('a', { status: 'completed', percent: 1 }),
        progress('b', { status: 'in_progress', percent: 1 / 3 }),
        progress('ghost', { status: 'completed', percent: 1 }),
      ],
    });
    expect(libraryStats(state, now)).toEqual({
      materials: 3,
      completed: 1,
      inProgress: 1,
      minutesStudied: 630,
      streakDays: 0,
    });
  });

  it('counts consecutive UTC days ending today', () => {
    const state = library({
      materials: ['a', 'b', 'c'].map((id) => material(id)),
      progress: [
        progress('a', { lastOpenedAt: '2026-11-10T01:00:00.000Z' }),
        progress('b', { completedAt: day('2026-11-09'), lastOpenedAt: day('2026-11-08'), status: 'completed' }),
        progress('c', { lastOpenedAt: day('2026-11-06') }),
      ],
    });
    expect(libraryStats(state, now).streakDays).toBe(3);
  });

  it('lets the streak end yesterday when today has no activity', () => {
    const state = library({
      materials: [material('a'), material('b')],
      progress: [
        progress('a', { lastOpenedAt: day('2026-11-09') }),
        progress('b', { lastOpenedAt: day('2026-11-08') }),
      ],
    });
    expect(libraryStats(state, now).streakDays).toBe(2);
  });

  it('is zero when the last activity was before yesterday', () => {
    const state = library({
      materials: [material('a')],
      progress: [progress('a', { lastOpenedAt: day('2026-11-08') })],
    });
    expect(libraryStats(state, now).streakDays).toBe(0);
  });
});

describe('createId', () => {
  it('formats as prefix, base-36 time and six random base-36 characters', () => {
    const before = Date.now();
    const id = createId('m');
    const match = /^m_([0-9a-z]+)([0-9a-z]{6})$/.exec(id);
    expect(match).not.toBeNull();
    expect(parseInt(match?.[1] ?? '', 36)).toBeGreaterThanOrEqual(before);
  });

  it('does not collide across many calls', () => {
    const generated = new Set(Array.from({ length: 2000 }, () => createId('p')));
    expect(generated.size).toBe(2000);
  });
});
