/**
 * Builds the `LibraryActions` exposed by LibraryProvider. Free of React so it can be unit-tested:
 * each helper stamps time-dependent actions with `at` from the clock and dispatches exactly once.
 */
import { createSeedLibrary } from '@/data/seed';
import type { Action } from './actions';
import type { LibraryActions } from './LibraryProvider';
import { createId } from './selectors';

export function createLibraryActions(
  dispatch: (action: Action) => void,
  clock: () => Date = () => new Date(),
): LibraryActions {
  const at = () => clock().toISOString();
  return {
    open: (id) => dispatch({ type: 'progress/open', id, at: at() }),
    start: (id) => dispatch({ type: 'progress/start', id, at: at() }),
    setPercent: (id, percent) => dispatch({ type: 'progress/set', id, percent, at: at() }),
    complete: (id) => dispatch({ type: 'progress/complete', id, at: at() }),
    skip: (id) => dispatch({ type: 'progress/skip', id, at: at() }),
    reset: (id) => dispatch({ type: 'progress/reset', id }),
    rate: (id, rating) => dispatch({ type: 'progress/rate', id, rating }),
    review: (id, grade) => dispatch({ type: 'progress/review', id, grade, at: at() }),

    addMaterial: (input) => {
      const id = createId('m');
      dispatch({ type: 'material/add', material: { ...input, id, addedAt: at() } });
      return id;
    },
    updateMaterial: (id, patch) => dispatch({ type: 'material/update', id, patch }),
    removeMaterial: (id) => dispatch({ type: 'material/remove', id }),

    createPlaylist: ({ name, description = '', materialIds = [] }) => {
      const id = createId('p');
      const now = at();
      dispatch({
        type: 'playlist/create',
        playlist: { id, name, description, materialIds: [...materialIds], pinned: false, createdAt: now, updatedAt: now },
      });
      return id;
    },
    updatePlaylist: (id, patch) => dispatch({ type: 'playlist/update', id, patch, at: at() }),
    deletePlaylist: (id) => dispatch({ type: 'playlist/delete', id }),
    addToPlaylist: (id, materialId) => dispatch({ type: 'playlist/add', id, materialId, at: at() }),
    removeFromPlaylist: (id, materialId) => dispatch({ type: 'playlist/remove', id, materialId, at: at() }),
    movePlaylistItem: (id, from, to) => dispatch({ type: 'playlist/move', id, from, to, at: at() }),

    updateSettings: (patch) => dispatch({ type: 'settings/update', patch }),
    resetLibrary: () => dispatch({ type: 'library/replace', state: createSeedLibrary(clock()) }),
  };
}
