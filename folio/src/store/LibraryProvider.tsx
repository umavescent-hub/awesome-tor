/**
 * Folio state container: React context over `libraryReducer`, hydrated from storage
 * (falls back to the seed library), persisted with a debounced write.
 * CONTRACT: exported names and shapes are fixed; screens depend on them.
 */
import type { ReactNode } from 'react';

import type {
  ID,
  LibraryState,
  Material,
  Playlist,
  ReviewGrade,
  Settings,
} from '@/domain/types';
import type { SearchIndex } from '@/search';
import type { KeyValueStorage } from './persistence';

export type NewMaterialInput = Omit<Material, 'id' | 'addedAt'>;

export interface LibraryActions {
  /** Marks lastOpenedAt; counts a new session if the last open was > 30 min ago. */
  open(id: ID): void;
  start(id: ID): void;
  setPercent(id: ID, percent: number): void;
  complete(id: ID): void;
  skip(id: ID): void;
  reset(id: ID): void;
  rate(id: ID, rating: 1 | 2 | 3 | 4 | 5): void;
  review(id: ID, grade: ReviewGrade): void;
  addMaterial(input: NewMaterialInput): ID;
  updateMaterial(id: ID, patch: Partial<NewMaterialInput>): void;
  removeMaterial(id: ID): void;
  createPlaylist(input: { name: string; description?: string; materialIds?: ID[] }): ID;
  updatePlaylist(id: ID, patch: Partial<Pick<Playlist, 'name' | 'description' | 'pinned'>>): void;
  deletePlaylist(id: ID): void;
  addToPlaylist(id: ID, materialId: ID): void;
  removeFromPlaylist(id: ID, materialId: ID): void;
  movePlaylistItem(id: ID, from: number, to: number): void;
  updateSettings(patch: Partial<Settings>): void;
  /** Replace everything with a fresh seed library. */
  resetLibrary(): void;
}

export interface LibraryContextValue {
  state: LibraryState;
  /** False until storage hydration finishes (state is the seed meanwhile). */
  ready: boolean;
  actions: LibraryActions;
  /** Memoised on state.materials. */
  searchIndex: SearchIndex;
}

export function LibraryProvider(props: { children: ReactNode; storage?: KeyValueStorage }): ReactNode {
  throw new Error('not implemented');
}

export function useLibrary(): LibraryContextValue {
  throw new Error('not implemented');
}
