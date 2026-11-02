/**
 * Pure reducer. Unknown ids, and actions that would change nothing, are no-ops (return the same
 * state object), so they cause no re-render and no storage write.
 * CONTRACT: fixed signature.
 */
import type { ID, ISODate, LibraryState, Material, Playlist, Progress, Settings } from '@/domain/types';
import type { Action } from './actions';
import * as transition from './progressTransitions';
import { clampDailyMinutes } from './settings';
import { lookup, mapValues, omitKey, shallowEqual, unique } from './util';

export function libraryReducer(state: LibraryState, action: Action): LibraryState {
  switch (action.type) {
    case 'material/add':
      return addMaterial(state, action.material);
    case 'material/update':
      return updateMaterial(state, action.id, action.patch);
    case 'material/remove':
      return removeMaterial(state, action.id);

    case 'progress/open':
      return updateProgress(state, action.id, (p) => transition.open(p, action.at));
    case 'progress/start':
      return updateProgress(state, action.id, (p) => transition.start(p, action.at));
    case 'progress/set':
      if (Number.isNaN(action.percent)) return state;
      return updateProgress(state, action.id, (p) => transition.setPercent(p, action.percent, action.at));
    case 'progress/complete':
      return updateProgress(state, action.id, (p) => transition.complete(p, action.at));
    case 'progress/skip':
      return updateProgress(state, action.id, transition.skip);
    case 'progress/reset':
      return resetProgress(state, action.id);
    case 'progress/rate':
      return updateProgress(state, action.id, (p) => transition.rate(p, action.rating));
    case 'progress/review':
      return updateProgress(state, action.id, (p) => transition.review(p, action.grade, action.at));

    case 'playlist/create':
      return createPlaylist(state, action.playlist);
    case 'playlist/update':
      return updatePlaylist(state, action.id, (p) => patchPlaylist(p, action.patch, action.at));
    case 'playlist/delete':
      return lookup(state.playlists, action.id) ? { ...state, playlists: omitKey(state.playlists, action.id) } : state;
    case 'playlist/add':
      return addToPlaylist(state, action.id, action.materialId, action.at);
    case 'playlist/remove':
      return updatePlaylist(state, action.id, (p) => removeFromPlaylist(p, action.materialId, action.at));
    case 'playlist/move':
      return updatePlaylist(state, action.id, (p) => movePlaylistItem(p, action.from, action.to, action.at));

    case 'settings/update':
      return updateSettings(state, action.patch);
    case 'library/replace':
      return action.state;
  }
}

/* ───────────────────────────── Materials ───────────────────────────── */

function addMaterial(state: LibraryState, material: Material): LibraryState {
  if (lookup(state.materials, material.id)) return state;
  return { ...state, materials: { ...state.materials, [material.id]: material } };
}

function updateMaterial(state: LibraryState, id: ID, patch: Partial<Omit<Material, 'id'>>): LibraryState {
  const current = lookup(state.materials, id);
  if (!current) return state;
  const next = { ...current, ...patch, id };
  return shallowEqual(next, current) ? state : { ...state, materials: { ...state.materials, [id]: next } };
}

/**
 * Deletes the material and its progress, and unlinks it from playlists and prerequisites.
 * Playlists keep their `updatedAt`: they were not edited by the user.
 */
function removeMaterial(state: LibraryState, id: ID): LibraryState {
  if (!lookup(state.materials, id)) return state;
  const withoutId = (ids: ID[]) => ids.filter((other) => other !== id);
  return {
    ...state,
    materials: mapValues(omitKey(state.materials, id), (m) =>
      m.prerequisites.includes(id) ? { ...m, prerequisites: withoutId(m.prerequisites) } : m,
    ),
    progress: omitKey(state.progress, id),
    playlists: mapValues(state.playlists, (p) =>
      p.materialIds.includes(id) ? { ...p, materialIds: withoutId(p.materialIds) } : p,
    ),
  };
}

/* ───────────────────────────── Progress ───────────────────────────── */

/**
 * Applies `fn` to the material's progress, creating a queued entry when missing.
 * Unknown materials, and transitions whose result equals their input, keep the same state.
 */
function updateProgress(state: LibraryState, id: ID, fn: (progress: Progress) => Progress): LibraryState {
  if (!lookup(state.materials, id)) return state;
  const current = lookup(state.progress, id) ?? transition.emptyProgress(id);
  const next = fn(current);
  if (shallowEqual(next, current)) return state;
  return { ...state, progress: { ...state.progress, [id]: next } };
}

function resetProgress(state: LibraryState, id: ID): LibraryState {
  if (!lookup(state.progress, id)) return state;
  return { ...state, progress: omitKey(state.progress, id) };
}

/* ───────────────────────────── Playlists ───────────────────────────── */

/** Inserts unless the id exists; keeps only known materials, each at most once. */
function createPlaylist(state: LibraryState, playlist: Playlist): LibraryState {
  if (lookup(state.playlists, playlist.id)) return state;
  const materialIds = unique(playlist.materialIds.filter((id) => lookup(state.materials, id)));
  return { ...state, playlists: { ...state.playlists, [playlist.id]: { ...playlist, materialIds } } };
}

/** Applies `fn` to an existing playlist. Unknown ids, and unchanged results, keep the same state. */
function updatePlaylist(state: LibraryState, id: ID, fn: (playlist: Playlist) => Playlist): LibraryState {
  const current = lookup(state.playlists, id);
  if (!current) return state;
  const next = fn(current);
  if (shallowEqual(next, current)) return state;
  return { ...state, playlists: { ...state.playlists, [id]: next } };
}

/** Merges the patch and bumps `updatedAt`, unless the patch changes nothing (e.g. saving an unedited form). */
function patchPlaylist(
  playlist: Playlist,
  patch: Partial<Pick<Playlist, 'name' | 'description' | 'pinned'>>,
  at: ISODate,
): Playlist {
  const merged = { ...playlist, ...patch };
  return shallowEqual(merged, playlist) ? playlist : { ...merged, updatedAt: at };
}

function addToPlaylist(state: LibraryState, id: ID, materialId: ID, at: ISODate): LibraryState {
  if (!lookup(state.materials, materialId)) return state;
  return updatePlaylist(state, id, (p) =>
    p.materialIds.includes(materialId) ? p : { ...p, materialIds: [...p.materialIds, materialId], updatedAt: at },
  );
}

function removeFromPlaylist(playlist: Playlist, materialId: ID, at: ISODate): Playlist {
  if (!playlist.materialIds.includes(materialId)) return playlist;
  return { ...playlist, materialIds: playlist.materialIds.filter((id) => id !== materialId), updatedAt: at };
}

function movePlaylistItem(playlist: Playlist, from: number, to: number, at: ISODate): Playlist {
  const materialIds = moveItem(playlist.materialIds, from, to);
  return materialIds ? { ...playlist, materialIds, updatedAt: at } : playlist;
}

/**
 * Array-move semantics: the item at `from` ends up at index `to`.
 * Returns null when either index is out of range (or not an integer) or `from === to`.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] | null {
  const inRange = (index: number) => Number.isInteger(index) && index >= 0 && index < items.length;
  if (!inRange(from) || !inRange(to) || from === to) return null;
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/* ───────────────────────────── Settings ───────────────────────────── */

function updateSettings(state: LibraryState, patch: Partial<Settings>): LibraryState {
  const settings = mergeSettings(state.settings, patch);
  return shallowEqual(settings, state.settings) ? state : { ...state, settings };
}

/** Merges the patch; dailyMinutes is clamped (NaN ignored), a blank displayName keeps the old one. */
function mergeSettings(settings: Settings, patch: Partial<Settings>): Settings {
  const { dailyMinutes, displayName } = patch;
  return {
    ...settings,
    ...patch,
    dailyMinutes:
      dailyMinutes === undefined || Number.isNaN(dailyMinutes)
        ? settings.dailyMinutes
        : clampDailyMinutes(dailyMinutes),
    displayName: displayName?.trim() || settings.displayName,
  };
}
