/**
 * Folio domain model. Every module (engine, search, store, UI) speaks these types.
 * Pure data: no functions, no class instances, JSON-serialisable end to end.
 */

export type ID = string;

/** ISO-8601 timestamp, e.g. "2026-11-02T13:00:00.000Z". */
export type ISODate = string;

export type MaterialKind =
  | 'paper'
  | 'book'
  | 'chapter'
  | 'article'
  | 'lecture'
  | 'video'
  | 'podcast'
  | 'dataset';

export const MATERIAL_KINDS: readonly MaterialKind[] = [
  'paper',
  'book',
  'chapter',
  'article',
  'lecture',
  'video',
  'podcast',
  'dataset',
] as const;

/** 1 = introductory … 5 = frontier / specialist. */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface Category {
  id: ID;
  name: string;
  /** Hex colour, e.g. "#2BB3A3". Drives generated cover art. */
  color: string;
  /** Ionicons glyph name (from @expo/vector-icons). */
  icon: string;
  description: string;
}

export interface Material {
  id: ID;
  title: string;
  authors: string[];
  year: number;
  kind: MaterialKind;
  /** Journal, publisher, conference, institution or show. */
  venue?: string;
  url?: string;
  doi?: string;
  abstract: string;
  tags: string[];
  categoryId: ID;
  /** Estimated focused effort to finish, in minutes. */
  minutes: number;
  difficulty: Difficulty;
  /** Materials that should be completed first (ids). */
  prerequisites: ID[];
  addedAt: ISODate;
}

export type ProgressStatus = 'queued' | 'in_progress' | 'completed' | 'skipped';

/** SM-2 style spaced-repetition card attached to a completed material. */
export interface ReviewCard {
  /** Ease factor, >= 1.3, starts at 2.5. */
  ease: number;
  /** Current interval in days. */
  intervalDays: number;
  /** Successful consecutive reviews. */
  reps: number;
  dueAt: ISODate;
  lastReviewedAt?: ISODate;
}

/** User's answer when reviewing a completed material. */
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

export interface Progress {
  materialId: ID;
  status: ProgressStatus;
  /** 0..1 */
  percent: number;
  startedAt?: ISODate;
  completedAt?: ISODate;
  lastOpenedAt?: ISODate;
  /** Personal value rating, 1..5, set after completion. Feeds the taste profile. */
  rating?: 1 | 2 | 3 | 4 | 5;
  /** Number of distinct study sessions logged. */
  sessions: number;
  review?: ReviewCard;
}

export interface Playlist {
  id: ID;
  name: string;
  description: string;
  /** Ordered. A material may appear in many playlists, at most once per playlist. */
  materialIds: ID[];
  pinned: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Settings {
  /** Focused minutes the user wants to study per day. Drives effort fit. */
  dailyMinutes: number;
  displayName: string;
}

export interface LibraryState {
  /** Bumped when the persisted shape changes. */
  version: 1;
  materials: Record<ID, Material>;
  categories: Record<ID, Category>;
  playlists: Record<ID, Playlist>;
  progress: Record<ID, Progress>;
  settings: Settings;
}

/* ───────────────────────── Recommendation engine contract ───────────────────────── */

export type ReasonCode =
  | 'continue' // already in progress
  | 'unlocked' // all prerequisites just completed
  | 'prereq_ready' // prerequisites satisfied
  | 'foundation' // other queued material depends on this
  | 'affinity' // matches your taste profile
  | 'playlist_order' // next in the playlist sequence
  | 'effort_fit' // fits your daily budget
  | 'stretch' // right difficulty step up
  | 'review_due' // spaced-repetition review is due
  | 'fresh'; // diversifies away from recent topics

export interface Reason {
  code: ReasonCode;
  /** Short human sentence, e.g. "Builds on The Maillard Reaction, which you finished". */
  text: string;
  /** Contribution to the final score (for ordering reasons, highest first). */
  weight: number;
}

export interface ScoreBreakdown {
  affinity: number;
  readiness: number;
  momentum: number;
  foundation: number;
  effortFit: number;
  stretch: number;
  sequence: number;
  /** Penalty applied for blocked prerequisites, <= 0. */
  blocked: number;
}

export type RecommendationLane = 'study' | 'review';

export interface Recommendation {
  materialId: ID;
  lane: RecommendationLane;
  /** Final score after diversity re-ranking. Higher is better. */
  score: number;
  /** Probability-like confidence in 0..1 (softmax over the candidate set). */
  confidence: number;
  reasons: Reason[];
  breakdown: ScoreBreakdown;
}

export interface RecommendOptions {
  /** Injected clock for determinism. */
  now: Date;
  /** Max results. Default 10. */
  limit?: number;
  /** Restrict candidates to one playlist, and honour its order. */
  playlistId?: ID;
  /** Restrict candidates to one category. */
  categoryId?: ID;
  /** Include due reviews (lane 'review'). Default true. */
  includeReviews?: boolean;
  /** MMR trade-off, 0..1. 1 = pure relevance, 0 = pure diversity. Default 0.75. */
  diversity?: number;
}

/* ───────────────────────────────── Search contract ───────────────────────────────── */

export type SearchField = 'title' | 'authors' | 'tags' | 'venue' | 'abstract';

export interface SearchFilters {
  kinds?: MaterialKind[];
  categoryIds?: ID[];
  statuses?: ProgressStatus[];
  yearFrom?: number;
  yearTo?: number;
}

export interface SearchHit {
  materialId: ID;
  score: number;
  /** Fields that matched, strongest first. */
  matchedFields: SearchField[];
  /** Query terms (normalised) that were matched only via typo tolerance. */
  fuzzyTerms: string[];
}
