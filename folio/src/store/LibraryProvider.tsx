/**
 * Folio state container: React context over `libraryReducer`, hydrated from storage
 * (falls back to the seed library), persisted with a debounced write.
 * CONTRACT: exported names and shapes are fixed; screens depend on them.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type JSX,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { createSeedLibrary } from '@/data/seed';
import type {
  ID,
  LibraryState,
  Material,
  Playlist,
  ReviewGrade,
  Settings,
} from '@/domain/types';
import { buildSearchIndex, type SearchIndex } from '@/search';
import type { Action } from './actions';
import { createLibraryActions } from './libraryActions';
import { loadLibrary, saveLibrary, type KeyValueStorage } from './persistence';
import { libraryReducer } from './reducer';

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

/** Quiet period after the last change before the library is written to storage. */
const PERSIST_DEBOUNCE_MS = 400;

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider(props: { children: ReactNode; storage?: KeyValueStorage }): JSX.Element {
  // Fixed at mount so hydration and persistence always talk to the same backend.
  const [storage] = useState<KeyValueStorage>(() => props.storage ?? AsyncStorage);
  const [state, dispatch] = useReducer(libraryReducer, undefined, () => createSeedLibrary(new Date()));
  const ready = useHydration(storage, dispatch);
  usePersistence(storage, state, ready);

  const actions = useMemo(() => createLibraryActions(dispatch), [dispatch]);
  const searchIndex = useMemo(() => buildSearchIndex(Object.values(state.materials)), [state.materials]);
  const value = useMemo(() => ({ state, ready, actions, searchIndex }), [state, ready, actions, searchIndex]);

  return <LibraryContext value={value}>{props.children}</LibraryContext>;
}

export function useLibrary(): LibraryContextValue {
  const value = useContext(LibraryContext);
  if (value === null) throw new Error('useLibrary must be used inside <LibraryProvider>');
  return value;
}

/** Loads the stored library once; `ready` turns true afterwards whether or not anything usable was stored. */
function useHydration(storage: KeyValueStorage, dispatch: Dispatch<Action>): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void loadLibrary(storage).then((stored) => {
      if (!active) return;
      if (stored !== null) dispatch({ type: 'library/replace', state: stored });
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, [storage, dispatch]);
  return ready;
}

/**
 * Once hydrated, writes the state PERSIST_DEBOUNCE_MS after the last change, and immediately when
 * the app leaves the foreground or the provider unmounts. Nothing is written before hydration,
 * so a stored library is never clobbered by the seed.
 */
function usePersistence(storage: KeyValueStorage, state: LibraryState, ready: boolean): void {
  const pending = useRef<LibraryState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    saveLibrary(storage, next).catch(() => {
      // Keep it for the next flush unless a newer state is already waiting.
      pending.current ??= next;
    });
  }, [storage]);

  useEffect(() => {
    if (!ready) return;
    pending.current = state;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, PERSIST_DEBOUNCE_MS);
  }, [state, ready, flush]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'background' || status === 'inactive') flush();
    });
    return () => {
      subscription.remove();
      flush();
    };
  }, [flush]);
}
