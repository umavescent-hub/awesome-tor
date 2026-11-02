/**
 * Folio store actions. Every time-dependent action carries `at` (ISO) so the reducer stays pure.
 * CONTRACT: fixed; UI dispatches these through the helpers in LibraryProvider.
 */
import type { ID, ISODate, LibraryState, Material, Playlist, ReviewGrade, Settings } from '@/domain/types';

export type Action =
  | { type: 'material/add'; material: Material }
  | { type: 'material/update'; id: ID; patch: Partial<Omit<Material, 'id'>> }
  | { type: 'material/remove'; id: ID }
  | { type: 'progress/open'; id: ID; at: ISODate }
  | { type: 'progress/start'; id: ID; at: ISODate }
  | { type: 'progress/set'; id: ID; percent: number; at: ISODate }
  | { type: 'progress/complete'; id: ID; at: ISODate }
  | { type: 'progress/skip'; id: ID; at: ISODate }
  | { type: 'progress/reset'; id: ID }
  | { type: 'progress/rate'; id: ID; rating: 1 | 2 | 3 | 4 | 5 }
  | { type: 'progress/review'; id: ID; grade: ReviewGrade; at: ISODate }
  | { type: 'playlist/create'; playlist: Playlist }
  | { type: 'playlist/update'; id: ID; patch: Partial<Pick<Playlist, 'name' | 'description' | 'pinned'>>; at: ISODate }
  | { type: 'playlist/delete'; id: ID }
  | { type: 'playlist/add'; id: ID; materialId: ID; at: ISODate }
  | { type: 'playlist/remove'; id: ID; materialId: ID; at: ISODate }
  | { type: 'playlist/move'; id: ID; from: number; to: number; at: ISODate }
  | { type: 'settings/update'; patch: Partial<Settings> }
  | { type: 'library/replace'; state: LibraryState };
