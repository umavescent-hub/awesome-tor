/**
 * Folio selectors — pure reads over LibraryState.
 * CONTRACT: signatures fixed; UI depends on them.
 */
import type { Category, ID, LibraryState, Material, Playlist, Progress, ProgressStatus } from '@/domain/types';
import { completionOf, emptyProgress } from './progressTransitions';
import { byNewest, DAY_MS, lookup, timeOf } from './util';

/** Missing progress means 'queued', percent 0, sessions 0. */
export function progressOf(state: LibraryState, id: ID): Progress {
  return lookup(state.progress, id) ?? emptyProgress(id);
}

export interface PlaylistStats {
  count: number;
  completed: number;
  totalMinutes: number;
  remainingMinutes: number;
  /** 0..1, completion weighted by minutes (partial progress counts). */
  percent: number;
}

/** Unknown playlists yield all-zero stats. `remainingMinutes` is rounded to whole minutes. */
export function playlistStats(state: LibraryState, playlistId: ID): PlaylistStats {
  const materials = playlistMaterials(state, playlistId);
  let completedCount = 0;
  let totalMinutes = 0;
  let studiedMinutes = 0;
  for (const material of materials) {
    const progress = progressOf(state, material.id);
    if (progress.status === 'completed') completedCount += 1;
    totalMinutes += material.minutes;
    studiedMinutes += material.minutes * completionOf(progress);
  }
  return {
    count: materials.length,
    completed: completedCount,
    totalMinutes,
    remainingMinutes: Math.round(totalMinutes - studiedMinutes),
    percent: totalMinutes > 0 ? studiedMinutes / totalMinutes : 0,
  };
}

/** Playlist materials in order, skipping dangling ids. */
export function playlistMaterials(state: LibraryState, playlistId: ID): Material[] {
  const playlist = lookup(state.playlists, playlistId);
  if (!playlist) return [];
  return playlist.materialIds.flatMap((id) => lookup(state.materials, id) ?? []);
}

/** Pinned first, then most recently updated. */
export function sortedPlaylists(state: LibraryState): Playlist[] {
  return Object.values(state.playlists).sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || byNewest(a.updatedAt, b.updatedAt) || a.name.localeCompare(b.name),
  );
}

/** Materials whose progress has `status`, paired with that progress (dangling entries skipped). */
function withStatus(state: LibraryState, status: ProgressStatus): { material: Material; progress: Progress }[] {
  return Object.values(state.progress).flatMap((progress) => {
    const material = progress.status === status ? lookup(state.materials, progress.materialId) : undefined;
    return material ? [{ material, progress }] : [];
  });
}

/** In-progress materials, most recently opened first. */
export function inProgress(state: LibraryState): Material[] {
  return withStatus(state, 'in_progress')
    .sort(
      (a, b) =>
        byNewest(a.progress.lastOpenedAt, b.progress.lastOpenedAt) || a.material.title.localeCompare(b.material.title),
    )
    .map(({ material }) => material);
}

/** Completed materials, most recently completed first. */
export function completed(state: LibraryState): Material[] {
  return withStatus(state, 'completed')
    .sort(
      (a, b) =>
        byNewest(a.progress.completedAt, b.progress.completedAt) || a.material.title.localeCompare(b.material.title),
    )
    .map(({ material }) => material);
}

/** Sorted by name. */
export function sortedCategories(state: LibraryState): Category[] {
  return Object.values(state.categories).sort((a, b) => a.name.localeCompare(b.name));
}

/** Materials in a category, newest year first (ties by title). */
export function materialsInCategory(state: LibraryState, categoryId: ID): Material[] {
  return Object.values(state.materials)
    .filter((m) => m.categoryId === categoryId)
    .sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
}

export interface LibraryStats {
  materials: number;
  completed: number;
  inProgress: number;
  minutesStudied: number;
  /** Consecutive days (ending today or yesterday) with at least one lastOpenedAt/completedAt. */
  streakDays: number;
}

/**
 * Counts only progress whose material still exists. `minutesStudied` is Σ minutes × completion,
 * rounded to whole minutes. Days are UTC calendar days, so the result is deterministic.
 */
export function libraryStats(state: LibraryState, now: Date): LibraryStats {
  const tracked = Object.values(state.progress).flatMap((progress) => {
    const material = lookup(state.materials, progress.materialId);
    return material ? [{ material, progress }] : [];
  });
  const countStatus = (status: ProgressStatus) => tracked.filter(({ progress }) => progress.status === status).length;
  const minutesStudied = tracked.reduce(
    (sum, { material, progress }) => sum + material.minutes * completionOf(progress),
    0,
  );
  const activeDays = new Set(
    tracked.flatMap(({ progress }) => [progress.lastOpenedAt, progress.completedAt]).flatMap(utcDayOf),
  );
  return {
    materials: Object.keys(state.materials).length,
    completed: countStatus('completed'),
    inProgress: countStatus('in_progress'),
    minutesStudied: Math.round(minutesStudied),
    streakDays: streakLength(activeDays, Math.floor(now.getTime() / DAY_MS)),
  };
}

/** UTC day number (days since the epoch) of an ISO timestamp, as a 0/1-element list for flatMap. */
function utcDayOf(iso: string | undefined): number[] {
  const time = timeOf(iso);
  return Number.isFinite(time) ? [Math.floor(time / DAY_MS)] : [];
}

/** Length of the run of consecutive active days ending today, or yesterday if today is inactive. */
function streakLength(activeDays: ReadonlySet<number>, today: number): number {
  let day = activeDays.has(today) ? today : today - 1;
  let length = 0;
  while (activeDays.has(day)) {
    length += 1;
    day -= 1;
  }
  return length;
}

const ID_RANDOM_LENGTH = 6;

/** Collision-resistant id: `${prefix}_${time36}${random}`. */
export function createId(prefix: string): ID {
  const random = Array.from({ length: ID_RANDOM_LENGTH }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  return `${prefix}_${Date.now().toString(36)}${random}`;
}
