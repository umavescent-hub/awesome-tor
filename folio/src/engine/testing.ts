/**
 * Test-only fixture builders for small, hand-made libraries. Not imported by app code.
 */
import type {
  Category,
  ID,
  ISODate,
  LibraryState,
  Material,
  Playlist,
  Progress,
  ProgressStatus,
} from '@/domain/types';

import { MS_PER_DAY } from './time';

export const NOW = new Date('2026-11-02T12:00:00.000Z');

export function daysAgo(days: number, now: Date = NOW): ISODate {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

export function material(id: ID, overrides: Partial<Material> = {}): Material {
  return {
    id,
    title: `Material ${id}`,
    authors: [],
    year: 2020,
    kind: 'paper',
    abstract: '',
    tags: [],
    categoryId: 'general',
    minutes: 30,
    difficulty: 2,
    prerequisites: [],
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function progress(
  materialId: ID,
  status: ProgressStatus,
  overrides: Partial<Progress> = {},
): Progress {
  return {
    materialId,
    status,
    percent: status === 'completed' ? 1 : 0,
    sessions: status === 'queued' ? 0 : 1,
    ...overrides,
  };
}

export function category(id: ID, name: string): Category {
  return { id, name, color: '#2BB3A3', icon: 'book', description: '' };
}

export function playlist(id: ID, name: string, materialIds: ID[]): Playlist {
  return {
    id,
    name,
    description: '',
    materialIds,
    pinned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const byId = <T extends { id: ID }>(items: readonly T[]): Record<ID, T> =>
  Object.fromEntries(items.map((item) => [item.id, item]));

export function library(parts: {
  materials: Material[];
  progress?: Progress[];
  categories?: Category[];
  playlists?: Playlist[];
  dailyMinutes?: number;
}): LibraryState {
  return {
    version: 1,
    materials: byId(parts.materials),
    categories: byId(parts.categories ?? [category('general', 'General')]),
    playlists: byId(parts.playlists ?? []),
    progress: Object.fromEntries((parts.progress ?? []).map((entry) => [entry.materialId, entry])),
    settings: { dailyMinutes: parts.dailyMinutes ?? 60, displayName: 'Reader' },
  };
}

/** A small fermentation curriculum with a prerequisite chain and one off-topic outlier. */
export function fermentationLibrary(progressEntries: Progress[] = []): LibraryState {
  return library({
    categories: [category('ferment', 'Fermentation'), category('astro', 'Astronomy')],
    materials: [
      material('intro', {
        title: 'Introduction to Fermentation',
        authors: ['Sandor Katz'],
        tags: ['fermentation', 'microbes'],
        abstract: 'How microbes transform food: a gentle overview of fermentation.',
        categoryId: 'ferment',
        difficulty: 1,
        minutes: 40,
      }),
      material('lacto', {
        title: 'Lacto-fermentation of Vegetables',
        authors: ['Sandor Katz'],
        tags: ['fermentation', 'lactic acid'],
        abstract: 'Lactic acid bacteria, brines and vegetable ferments such as sauerkraut.',
        categoryId: 'ferment',
        difficulty: 2,
        prerequisites: ['intro'],
      }),
      material('koji', {
        title: 'Koji Alchemy',
        authors: ['Rich Shih', 'Jeremy Umansky'],
        tags: ['koji', 'aspergillus', 'fermentation'],
        abstract: 'Growing koji mould on grains to build amino pastes and seasonings.',
        categoryId: 'ferment',
        difficulty: 3,
        minutes: 90,
        prerequisites: ['intro'],
      }),
      material('miso', {
        title: 'Miso and Shoyu Production',
        authors: ['William Shurtleff'],
        tags: ['koji', 'miso', 'soy'],
        abstract: 'Traditional miso and shoyu made with koji and long fermentation.',
        categoryId: 'ferment',
        difficulty: 4,
        minutes: 120,
        prerequisites: ['koji'],
      }),
      material('yeast', {
        title: 'Metabolic Pathways of Yeast',
        authors: ['Graeme Walker'],
        tags: ['yeast', 'metabolism', 'fermentation'],
        abstract: 'Glycolysis and ethanol fermentation in Saccharomyces.',
        categoryId: 'ferment',
        difficulty: 5,
        minutes: 180,
        prerequisites: ['lacto', 'koji'],
      }),
      material('stars', {
        title: 'Stellar Nucleosynthesis',
        authors: ['Donald Clayton'],
        tags: ['stars', 'nuclear physics'],
        abstract: 'How stars forge heavy elements through fusion.',
        categoryId: 'astro',
        difficulty: 3,
        minutes: 60,
      }),
    ],
    progress: progressEntries,
  });
}
