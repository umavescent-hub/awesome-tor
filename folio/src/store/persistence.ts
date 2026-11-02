/**
 * Folio persistence. Storage is injected so it is testable; the app passes AsyncStorage.
 * CONTRACT: fixed.
 */
import type { Category, ID, LibraryState, Material, Playlist, Progress, ReviewCard, Settings } from '@/domain/types';
import {
  definedOnly,
  isMaterialKind,
  isProgressStatus,
  isRecord,
  readIsoDate,
  readNumber,
  readScale5,
  readString,
  readStringArray,
} from './guards';
import { clampDailyMinutes, DEFAULT_SETTINGS } from './settings';
import { clamp, lookup, mapValues, unique } from './util';

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const STORAGE_KEY = 'folio.library.v1';

/** SM-2 ease floor (see ReviewCard.ease). */
const MIN_EASE = 1.3;

/**
 * Validate + migrate unknown JSON into a LibraryState, or null if unusable. Never throws.
 *
 * The envelope must be `version: 1` with object-valued collections and settings; anything else
 * is unusable. Inside it, malformed entries are dropped one by one, numbers are coerced and
 * clamped, and references to dropped or missing materials are removed.
 */
export function migrate(raw: unknown): LibraryState | null {
  try {
    return parseLibrary(raw);
  } catch {
    // Only reachable for exotic non-JSON input (e.g. throwing getters); still "unusable".
    return null;
  }
}

/** Returns null when nothing stored or the payload is corrupt. Never throws. */
export async function loadLibrary(storage: KeyValueStorage): Promise<LibraryState | null> {
  try {
    const json = await storage.getItem(STORAGE_KEY);
    return json === null ? null : migrate(JSON.parse(json));
  } catch {
    return null;
  }
}

export async function saveLibrary(storage: KeyValueStorage, state: LibraryState): Promise<void> {
  await storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ───────────────────────────── Envelope ───────────────────────────── */

function parseLibrary(raw: unknown): LibraryState | null {
  if (!isRecord(raw) || raw.version !== 1) return null;
  const { materials, categories, playlists, progress, settings } = raw;
  if (
    !isRecord(materials) ||
    !isRecord(categories) ||
    !isRecord(playlists) ||
    !isRecord(progress) ||
    !isRecord(settings)
  ) {
    return null;
  }

  const parsedMaterials = parseCollection(materials, parseMaterial, (m) => m.id);
  const validMaterials = mapValues(parsedMaterials, (m) => ({
    ...m,
    prerequisites: m.prerequisites.filter((id) => id !== m.id && lookup(parsedMaterials, id)),
  }));
  return {
    version: 1,
    materials: validMaterials,
    categories: parseCollection(categories, parseCategory, (c) => c.id),
    playlists: parseCollection(
      playlists,
      (value) => parsePlaylist(value, validMaterials),
      (p) => p.id,
    ),
    progress: parseCollection(
      progress,
      (value) => parseProgress(value, validMaterials),
      (p) => p.materialId,
    ),
    settings: parseSettings(settings),
  };
}

/** Parses every value, drops the unusable ones and re-keys the rest by their own id. */
function parseCollection<T>(
  raw: Record<string, unknown>,
  parse: (value: unknown) => T | null,
  keyOf: (entity: T) => ID,
): Record<ID, T> {
  return Object.fromEntries(
    Object.values(raw).flatMap((value) => {
      const entity = parse(value);
      return entity === null ? [] : [[keyOf(entity), entity] as const];
    }),
  );
}

/* ───────────────────────────── Entities ───────────────────────────── */

function parseCategory(raw: unknown): Category | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  const name = readString(raw.name);
  const color = readString(raw.color);
  const icon = readString(raw.icon);
  if (id === undefined || name === undefined || color === undefined || icon === undefined) return null;
  return { id, name, color, icon, description: readString(raw.description) ?? '' };
}

/** Prerequisites are only deduplicated here; dangling ones are removed once all materials are known. */
function parseMaterial(raw: unknown): Material | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  const title = readString(raw.title);
  const categoryId = readString(raw.categoryId);
  const authors = readStringArray(raw.authors);
  const tags = readStringArray(raw.tags);
  const prerequisites = readStringArray(raw.prerequisites);
  const year = readNumber(raw.year);
  const minutes = readNumber(raw.minutes);
  const difficulty = readScale5(raw.difficulty);
  const addedAt = readIsoDate(raw.addedAt);
  const kind = raw.kind;
  if (
    id === undefined ||
    title === undefined ||
    categoryId === undefined ||
    authors === undefined ||
    tags === undefined ||
    prerequisites === undefined ||
    year === undefined ||
    minutes === undefined ||
    difficulty === undefined ||
    addedAt === undefined ||
    !isMaterialKind(kind)
  ) {
    return null;
  }
  return {
    id,
    title,
    authors,
    year: Math.round(year),
    kind,
    ...definedOnly({ venue: readString(raw.venue), url: readString(raw.url), doi: readString(raw.doi) }),
    abstract: readString(raw.abstract) ?? '',
    tags: unique(tags),
    categoryId,
    minutes: Math.max(1, Math.round(minutes)),
    difficulty,
    prerequisites: unique(prerequisites),
    addedAt,
  };
}

function parsePlaylist(raw: unknown, materials: Record<ID, Material>): Playlist | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  const name = readString(raw.name);
  const materialIds = readStringArray(raw.materialIds);
  const createdAt = readIsoDate(raw.createdAt);
  if (id === undefined || name === undefined || materialIds === undefined || createdAt === undefined) return null;
  return {
    id,
    name,
    description: readString(raw.description) ?? '',
    materialIds: unique(materialIds.filter((materialId) => lookup(materials, materialId))),
    pinned: raw.pinned === true,
    createdAt,
    updatedAt: readIsoDate(raw.updatedAt) ?? createdAt,
  };
}

/**
 * Matches what the reducer maintains: completed entries are at percent 1, and only they carry
 * `completedAt` and a review card.
 */
function parseProgress(raw: unknown, materials: Record<ID, Material>): Progress | null {
  if (!isRecord(raw)) return null;
  const materialId = readString(raw.materialId);
  const status = raw.status;
  if (materialId === undefined || !lookup(materials, materialId) || !isProgressStatus(status)) return null;
  const completed = status === 'completed';
  return {
    materialId,
    status,
    percent: completed ? 1 : clamp(readNumber(raw.percent) ?? 0, 0, 1),
    sessions: Math.max(0, Math.round(readNumber(raw.sessions) ?? 0)),
    ...definedOnly({
      startedAt: readIsoDate(raw.startedAt),
      completedAt: completed ? readIsoDate(raw.completedAt) : undefined,
      lastOpenedAt: readIsoDate(raw.lastOpenedAt),
      rating: readScale5(raw.rating),
      review: completed ? parseReviewCard(raw.review) : undefined,
    }),
  };
}

function parseReviewCard(raw: unknown): ReviewCard | undefined {
  if (!isRecord(raw)) return undefined;
  const ease = readNumber(raw.ease);
  const intervalDays = readNumber(raw.intervalDays);
  const reps = readNumber(raw.reps);
  const dueAt = readIsoDate(raw.dueAt);
  if (ease === undefined || intervalDays === undefined || reps === undefined || dueAt === undefined) return undefined;
  return {
    ease: Math.max(MIN_EASE, ease),
    intervalDays: Math.max(0, intervalDays),
    reps: Math.max(0, Math.round(reps)),
    dueAt,
    ...definedOnly({ lastReviewedAt: readIsoDate(raw.lastReviewedAt) }),
  };
}

/** Missing or unusable fields fall back to DEFAULT_SETTINGS. */
function parseSettings(raw: Record<string, unknown>): Settings {
  const dailyMinutes = readNumber(raw.dailyMinutes);
  return {
    dailyMinutes: dailyMinutes === undefined ? DEFAULT_SETTINGS.dailyMinutes : clampDailyMinutes(dailyMinutes),
    displayName: readString(raw.displayName)?.trim() || DEFAULT_SETTINGS.displayName,
  };
}
