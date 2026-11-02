import { describe, expect, it } from 'vitest';

import { createSeedLibrary } from '@/data/seed';
import type { Action } from './actions';
import { createLibraryActions } from './libraryActions';
import { libraryReducer } from './reducer';
import { library, material, materialInput } from './testFixtures';

const NOW = new Date('2026-11-02T15:00:00.000Z');
const AT = NOW.toISOString();

function recorder() {
  const actions: Action[] = [];
  return { actions, api: createLibraryActions((action) => actions.push(action), () => NOW) };
}

describe('createLibraryActions', () => {
  it('stamps time-dependent progress actions with the clock', () => {
    const { actions, api } = recorder();
    api.open('m1');
    api.start('m1');
    api.setPercent('m1', 0.5);
    api.complete('m1');
    api.skip('m1');
    api.review('m1', 'hard');
    api.reset('m1');
    api.rate('m1', 4);
    expect(actions).toEqual([
      { type: 'progress/open', id: 'm1', at: AT },
      { type: 'progress/start', id: 'm1', at: AT },
      { type: 'progress/set', id: 'm1', percent: 0.5, at: AT },
      { type: 'progress/complete', id: 'm1', at: AT },
      { type: 'progress/skip', id: 'm1', at: AT },
      { type: 'progress/review', id: 'm1', grade: 'hard', at: AT },
      { type: 'progress/reset', id: 'm1' },
      { type: 'progress/rate', id: 'm1', rating: 4 },
    ]);
  });

  it('addMaterial generates an m_ id, stamps addedAt and returns the id', () => {
    const { actions, api } = recorder();
    const input = materialInput({ title: 'Nixtamal' });
    const id = api.addMaterial(input);
    expect(id).toMatch(/^m_[0-9a-z]+$/);
    expect(actions).toEqual([{ type: 'material/add', material: { ...input, id, addedAt: AT } }]);
  });

  it('createPlaylist generates a p_ id, unpinned, with defaults, and returns the id', () => {
    const { actions, api } = recorder();
    const id = api.createPlaylist({ name: 'Mole' });
    expect(id).toMatch(/^p_[0-9a-z]+$/);
    expect(actions).toEqual([
      {
        type: 'playlist/create',
        playlist: { id, name: 'Mole', description: '', materialIds: [], pinned: false, createdAt: AT, updatedAt: AT },
      },
    ]);
  });

  it('dispatches playlist, material and settings edits', () => {
    const { actions, api } = recorder();
    api.updateMaterial('m1', { title: 'T' });
    api.removeMaterial('m1');
    api.updatePlaylist('p1', { pinned: true });
    api.deletePlaylist('p1');
    api.addToPlaylist('p1', 'm1');
    api.removeFromPlaylist('p1', 'm1');
    api.movePlaylistItem('p1', 0, 2);
    api.updateSettings({ dailyMinutes: 30 });
    expect(actions).toEqual([
      { type: 'material/update', id: 'm1', patch: { title: 'T' } },
      { type: 'material/remove', id: 'm1' },
      { type: 'playlist/update', id: 'p1', patch: { pinned: true }, at: AT },
      { type: 'playlist/delete', id: 'p1' },
      { type: 'playlist/add', id: 'p1', materialId: 'm1', at: AT },
      { type: 'playlist/remove', id: 'p1', materialId: 'm1', at: AT },
      { type: 'playlist/move', id: 'p1', from: 0, to: 2, at: AT },
      { type: 'settings/update', patch: { dailyMinutes: 30 } },
    ]);
  });

  it('resetLibrary replaces the state with a seed built from the clock', () => {
    const { actions, api } = recorder();
    api.resetLibrary();
    expect(actions).toEqual([{ type: 'library/replace', state: createSeedLibrary(NOW) }]);
  });

  it('round-trips through the reducer', () => {
    let state = library({ materials: [material('m1')] });
    const api = createLibraryActions((action) => {
      state = libraryReducer(state, action);
    }, () => NOW);
    const playlistId = api.createPlaylist({ name: 'Corn', materialIds: ['m1'] });
    api.start('m1');
    expect(state.playlists[playlistId]?.materialIds).toEqual(['m1']);
    expect(state.progress.m1?.status).toBe('in_progress');
  });
});
