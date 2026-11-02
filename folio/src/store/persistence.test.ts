import { describe, expect, it } from 'vitest';

import type { LibraryState } from '@/domain/types';
import { loadLibrary, migrate, saveLibrary, STORAGE_KEY, type KeyValueStorage } from './persistence';
import { category, library, material, playlist, progress, T0 } from './testFixtures';

class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  async getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  async removeItem(key: string) {
    this.items.delete(key);
  }
}

const valid = (): LibraryState =>
  library({
    categories: [category('cat_a', { description: 'A' })],
    materials: [
      material('m1', { venue: 'Science', doi: '10.1/x' }),
      material('m2', { prerequisites: ['m1'], kind: 'book' }),
    ],
    playlists: [playlist('p1', ['m2', 'm1'], { pinned: true })],
    progress: [
      progress('m1', {
        status: 'completed',
        percent: 1,
        completedAt: T0,
        rating: 5,
        sessions: 3,
        review: { ease: 2.5, intervalDays: 1, reps: 0, dueAt: T0 },
      }),
    ],
  });

/** A valid JSON-shaped library with some fields replaced by arbitrary values. */
function withRaw(edit: (raw: Record<string, any>) => void): unknown {
  const raw = JSON.parse(JSON.stringify(valid())) as Record<string, any>;
  edit(raw);
  return raw;
}

describe('migrate: envelope', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', '{"version":1}'],
    ['an array', []],
    ['an empty object', {}],
  ])('rejects %s', (_label, raw) => {
    expect(migrate(raw)).toBeNull();
  });

  it('rejects other versions and non-object collections or settings', () => {
    expect(migrate(withRaw((r) => (r.version = 2)))).toBeNull();
    expect(migrate(withRaw((r) => (r.version = '1')))).toBeNull();
    for (const key of ['materials', 'categories', 'playlists', 'progress', 'settings']) {
      expect(migrate(withRaw((r) => delete r[key]))).toBeNull();
      expect(migrate(withRaw((r) => (r[key] = [])))).toBeNull();
      expect(migrate(withRaw((r) => (r[key] = null)))).toBeNull();
    }
  });

  it('accepts a valid library unchanged', () => {
    expect(migrate(JSON.parse(JSON.stringify(valid())))).toStrictEqual(valid());
  });

  it('never throws, even on exotic input', () => {
    const hostile = {
      version: 1,
      get materials(): never {
        throw new Error('boom');
      },
    };
    expect(migrate(hostile)).toBeNull();
  });
});

describe('migrate: materials', () => {
  it.each<[string, (m: Record<string, any>) => void]>([
    ['missing id', (m) => delete m.id],
    ['non-string title', (m) => (m.title = 7)],
    ['missing categoryId', (m) => delete m.categoryId],
    ['non-array authors', (m) => (m.authors = 'McGee')],
    ['non-array tags', (m) => (m.tags = null)],
    ['non-array prerequisites', (m) => (m.prerequisites = {})],
    ['unknown kind', (m) => (m.kind = 'scroll')],
    ['non-numeric year', (m) => (m.year = 'soon')],
    ['missing minutes', (m) => delete m.minutes],
    ['missing difficulty', (m) => delete m.difficulty],
    ['invalid addedAt', (m) => (m.addedAt = 'yesterday-ish')],
    ['no fields at all', (m) => Object.keys(m).forEach((key) => delete m[key])],
  ])('drops only the material with %s, and everything that referenced it', (_label, edit) => {
    const migrated = migrate(withRaw((r) => edit(r.materials.m1)));
    expect(Object.keys(migrated?.materials ?? {})).toEqual(['m2']);
    expect(migrated?.materials.m2?.prerequisites).toEqual([]);
    expect(migrated?.playlists.p1?.materialIds).toEqual(['m2']);
    expect(migrated?.progress).toEqual({});
  });

  it('coerces and clamps numbers and filters non-string list items', () => {
    const migrated = migrate(
      withRaw((r) => {
        Object.assign(r.materials.m1, {
          year: '1953',
          minutes: -20,
          difficulty: 9,
          authors: ['Hodge', 3, null],
          tags: ['maillard', 'maillard', false],
        });
        r.materials.m2.minutes = 44.6;
        r.materials.m2.difficulty = '0';
      }),
    );
    expect(migrated?.materials.m1).toMatchObject({
      year: 1953,
      minutes: 1,
      difficulty: 5,
      authors: ['Hodge'],
      tags: ['maillard'],
    });
    expect(migrated?.materials.m2).toMatchObject({ minutes: 45, difficulty: 1 });
  });

  it('drops dangling and self prerequisites, keeps optional fields absent, defaults the abstract', () => {
    const migrated = migrate(
      withRaw((r) => {
        r.materials.m2.prerequisites = ['m1', 'ghost', 'm2', 'm1'];
        r.materials.m2.venue = 12;
        delete r.materials.m2.abstract;
      }),
    );
    const m2 = migrated?.materials.m2;
    expect(m2?.prerequisites).toEqual(['m1']);
    expect(m2?.abstract).toBe('');
    expect(m2 && 'venue' in m2).toBe(false);
    expect(migrated?.materials.m1).toMatchObject({ venue: 'Science', doi: '10.1/x' });
  });

  it('re-keys entries by their own id', () => {
    const migrated = migrate(
      withRaw((r) => {
        r.materials.wrongKey = r.materials.m1;
        delete r.materials.m1;
      }),
    );
    expect(Object.keys(migrated?.materials ?? {}).sort()).toEqual(['m1', 'm2']);
  });
});

describe('migrate: categories, playlists, progress, settings', () => {
  it('drops malformed categories and defaults their description', () => {
    const migrated = migrate(
      withRaw((r) => {
        r.categories.bad = { id: 'bad', name: 'Bad' };
        r.categories.cat_b = { id: 'cat_b', name: 'B', color: '#000000', icon: 'leaf-outline' };
      }),
    );
    expect(Object.keys(migrated?.categories ?? {})).toEqual(['cat_a', 'cat_b']);
    expect(migrated?.categories.cat_b?.description).toBe('');
  });

  it('cleans playlists: dangling and duplicate ids, pinned coercion, updatedAt fallback', () => {
    const migrated = migrate(
      withRaw((r) => {
        Object.assign(r.playlists.p1, { materialIds: ['m1', 'ghost', 'm1', 5], pinned: 'yes', updatedAt: 'never' });
        r.playlists.noIds = { id: 'noIds', name: 'x', createdAt: T0, materialIds: 'm1' };
        r.playlists.noDate = { id: 'noDate', name: 'x', materialIds: [] };
      }),
    );
    expect(Object.keys(migrated?.playlists ?? {})).toEqual(['p1']);
    expect(migrated?.playlists.p1).toMatchObject({ materialIds: ['m1'], pinned: false, updatedAt: T0 });
  });

  it('cleans progress: unknown materials or statuses, clamping, completion and review cards', () => {
    const migrated = migrate(
      withRaw((r) => {
        r.progress.ghost = { materialId: 'ghost', status: 'queued', percent: 0, sessions: 0 };
        r.progress.m2 = { materialId: 'm2', status: 'reading', percent: 0.5, sessions: 1 };
        Object.assign(r.progress.m1, { percent: 0.2, sessions: -4, rating: 11, lastOpenedAt: 42 });
        r.progress.m1.review.ease = 0.4;
      }),
    );
    expect(Object.keys(migrated?.progress ?? {})).toEqual(['m1']);
    const m1 = migrated?.progress.m1;
    expect(m1).toMatchObject({ status: 'completed', percent: 1, sessions: 0, rating: 5 });
    expect(m1?.review?.ease).toBe(1.3);
    expect(m1 && 'lastOpenedAt' in m1).toBe(false);
  });

  it('clamps percent, defaults sessions and drops unusable review cards', () => {
    const migrated = migrate(
      withRaw((r) => {
        r.progress.m2 = { materialId: 'm2', status: 'in_progress', percent: 7, review: { ease: 2.5 } };
      }),
    );
    expect(migrated?.progress.m2).toStrictEqual({ materialId: 'm2', status: 'in_progress', percent: 1, sessions: 0 });
  });

  it('fills, clamps and trims settings', () => {
    expect(migrate(withRaw((r) => (r.settings = {})))?.settings).toEqual({ dailyMinutes: 60, displayName: 'Chef' });
    expect(migrate(withRaw((r) => (r.settings = { dailyMinutes: 9000, displayName: '  Ana ' })))?.settings).toEqual({
      dailyMinutes: 600,
      displayName: 'Ana',
    });
    expect(migrate(withRaw((r) => (r.settings = { dailyMinutes: '1', displayName: '   ' })))?.settings).toEqual({
      dailyMinutes: 5,
      displayName: 'Chef',
    });
  });
});

describe('loadLibrary / saveLibrary', () => {
  it('round-trips through storage under STORAGE_KEY', async () => {
    const storage = new MemoryStorage();
    await saveLibrary(storage, valid());
    expect([...storage.items.keys()]).toEqual([STORAGE_KEY]);
    expect(await loadLibrary(storage)).toStrictEqual(valid());
  });

  it('returns null when nothing is stored, the JSON is corrupt or the payload unusable', async () => {
    const storage = new MemoryStorage();
    expect(await loadLibrary(storage)).toBeNull();
    storage.items.set(STORAGE_KEY, '{"version":1,');
    expect(await loadLibrary(storage)).toBeNull();
    storage.items.set(STORAGE_KEY, '{"version":1}');
    expect(await loadLibrary(storage)).toBeNull();
  });

  it('returns null when storage fails', async () => {
    const failing: KeyValueStorage = {
      getItem: () => Promise.reject(new Error('disk')),
      setItem: () => Promise.resolve(),
      removeItem: () => Promise.resolve(),
    };
    expect(await loadLibrary(failing)).toBeNull();
  });

  it('lets save failures reach the caller', async () => {
    const failing: KeyValueStorage = {
      getItem: () => Promise.resolve(null),
      setItem: () => Promise.reject(new Error('full')),
      removeItem: () => Promise.resolve(),
    };
    await expect(saveLibrary(failing, valid())).rejects.toThrow('full');
  });
});
