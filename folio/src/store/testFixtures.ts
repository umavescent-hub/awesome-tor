/**
 * Test-only builders for small, explicit LibraryState fixtures, and a deep-freeze helper used
 * to prove reducers never mutate their input.
 */
import type { Category, LibraryState, Material, Playlist, Progress } from '@/domain/types';

export const T0 = '2026-11-02T12:00:00.000Z';

/** ISO timestamp `minutes` after T0 (negative = before). */
export function at(minutes: number): string {
  return new Date(Date.parse(T0) + minutes * 60_000).toISOString();
}

export function category(id: string, overrides: Partial<Category> = {}): Category {
  return { id, name: id, color: '#2BB3A3', icon: 'book-outline', description: '', ...overrides };
}

/** The user-supplied part of a material (what `addMaterial` takes). */
export function materialInput(
  overrides: Partial<Omit<Material, 'id' | 'addedAt'>> = {},
): Omit<Material, 'id' | 'addedAt'> {
  return {
    title: 'Untitled',
    authors: ['Author'],
    year: 2000,
    kind: 'paper',
    abstract: '',
    tags: [],
    categoryId: 'cat_a',
    minutes: 60,
    difficulty: 3,
    prerequisites: [],
    ...overrides,
  };
}

export function material(id: string, overrides: Partial<Material> = {}): Material {
  return { ...materialInput({ title: `Title ${id}` }), id, addedAt: T0, ...overrides };
}

export function playlist(id: string, materialIds: string[], overrides: Partial<Playlist> = {}): Playlist {
  return { id, name: id, description: '', materialIds, pinned: false, createdAt: T0, updatedAt: T0, ...overrides };
}

export function progress(materialId: string, overrides: Partial<Progress> = {}): Progress {
  return { materialId, status: 'queued', percent: 0, sessions: 0, ...overrides };
}

export function library(
  parts: {
    categories?: Category[];
    materials?: Material[];
    playlists?: Playlist[];
    progress?: Progress[];
  } = {},
): LibraryState {
  const byId = <T>(items: T[], key: (item: T) => string) => Object.fromEntries(items.map((item) => [key(item), item]));
  return {
    version: 1,
    categories: byId(parts.categories ?? [category('cat_a')], (c) => c.id),
    materials: byId(parts.materials ?? [], (m) => m.id),
    playlists: byId(parts.playlists ?? [], (p) => p.id),
    progress: byId(parts.progress ?? [], (p) => p.materialId),
    settings: { dailyMinutes: 60, displayName: 'Chef' },
  };
}

/** Recursively freezes `value` so any mutation throws in strict-mode test code. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
