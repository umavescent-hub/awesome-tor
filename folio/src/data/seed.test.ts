import ionicons from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json';
import { describe, expect, it } from 'vitest';

import { MATERIAL_KINDS, type ID, type Material, type MaterialKind } from '@/domain/types';
import { isReviewDue, prerequisiteStatus } from '@/engine';
import { migrate } from '@/store/persistence';
import { inProgress, libraryStats, sortedPlaylists } from '@/store/selectors';
import { CATEGORIES, MATERIALS } from './catalog';
import { createSeedLibrary } from './seed';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-11-02T13:00:00.000Z');
const seed = createSeedLibrary(NOW);
const materials = Object.values(seed.materials);
const daysFromNow = (iso: string | undefined) => (Date.parse(iso ?? '') - NOW.getTime()) / DAY_MS;

/** Kind → allowed [min, max] minutes, for the kinds with an agreed effort range. */
const MINUTES_BY_KIND: Partial<Record<MaterialKind, [number, number]>> = {
  paper: [45, 120],
  chapter: [60, 120],
  book: [600, 1800],
  lecture: [60, 90],
};

function findCycle(byId: Record<ID, Material>): ID[] | null {
  const state = new Map<ID, 'visiting' | 'done'>();
  const visit = (id: ID, path: ID[]): ID[] | null => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'visiting') return [...path, id];
    state.set(id, 'visiting');
    for (const next of byId[id]?.prerequisites ?? []) {
      const cycle = visit(next, [...path, id]);
      if (cycle) return cycle;
    }
    state.set(id, 'done');
    return null;
  };
  for (const id of Object.keys(byId)) {
    const cycle = visit(id, []);
    if (cycle) return cycle;
  }
  return null;
}

describe('seed catalogue', () => {
  it('has unique ids that match their record keys', () => {
    expect(new Set(MATERIALS.map((m) => m.id)).size).toBe(MATERIALS.length);
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
    for (const [key, entity] of [...Object.entries(seed.materials), ...Object.entries(seed.categories)]) {
      expect(entity.id).toBe(key);
    }
    for (const [key, entry] of Object.entries(seed.progress)) expect(entry.materialId).toBe(key);
  });

  it('holds 36–44 materials covering every kind except dataset', () => {
    expect(materials.length).toBeGreaterThanOrEqual(36);
    expect(materials.length).toBeLessThanOrEqual(44);
    const kinds = new Set(materials.map((m) => m.kind));
    expect([...kinds].sort()).toEqual(MATERIAL_KINDS.filter((kind) => kind !== 'dataset').sort());
  });

  it('defines the seven categories with valid colours and Ionicons glyphs', () => {
    expect(Object.keys(seed.categories).sort()).toEqual(
      [
        'cat_fermentation',
        'cat_flavor',
        'cat_food_science',
        'cat_history',
        'cat_hospitality',
        'cat_indigenous',
        'cat_technique',
      ],
    );
    for (const c of Object.values(seed.categories)) {
      expect(c.color).toMatch(/^#[0-9A-F]{6}$/);
      expect(Object.hasOwn(ionicons, c.icon), c.icon).toBe(true);
      expect(c.description.length).toBeGreaterThan(20);
    }
  });

  it('gives every category at least three materials', () => {
    for (const id of Object.keys(seed.categories)) {
      expect(materials.filter((m) => m.categoryId === id).length, id).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps every material well-formed with realistic effort', () => {
    for (const m of materials) {
      expect(seed.categories[m.categoryId], m.id).toBeDefined();
      expect(m.id).toMatch(/^m_[a-z0-9_]+$/);
      expect(m.authors.length, m.id).toBeGreaterThan(0);
      expect(m.tags.length, m.id).toBeGreaterThan(0);
      expect(m.abstract.length, m.id).toBeGreaterThan(40);
      expect(m.abstract.length, m.id).toBeLessThan(450);
      expect(Number.isInteger(m.year) && m.year >= 1800 && m.year <= NOW.getUTCFullYear(), m.id).toBe(true);
      expect(m.url, m.id).toBeUndefined();
      if (m.doi !== undefined) expect(m.doi).toMatch(/^10\.\d{4,}\/\S+$/);
      const range = MINUTES_BY_KIND[m.kind];
      if (range) {
        expect(m.minutes, m.id).toBeGreaterThanOrEqual(range[0]);
        expect(m.minutes, m.id).toBeLessThanOrEqual(range[1]);
      }
    }
  });

  it('has resolvable, acyclic prerequisites', () => {
    for (const m of materials) {
      for (const prerequisite of m.prerequisites) {
        expect(seed.materials[prerequisite], `${m.id} → ${prerequisite}`).toBeDefined();
        expect(prerequisite).not.toBe(m.id);
      }
    }
    expect(findCycle(seed.materials)).toBeNull();
  });
});

describe('seed playlists', () => {
  const playlists = Object.values(seed.playlists);

  it('reference only known materials, each at most once', () => {
    expect(playlists.length).toBeGreaterThanOrEqual(4);
    expect(playlists.length).toBeLessThanOrEqual(5);
    for (const p of playlists) {
      expect(new Set(p.materialIds).size, p.id).toBe(p.materialIds.length);
      for (const id of p.materialIds) expect(seed.materials[id], `${p.id} → ${id}`).toBeDefined();
      expect(Date.parse(p.createdAt)).toBeLessThanOrEqual(Date.parse(p.updatedAt));
    }
  });

  it('pins the two signature playlists, with the Pueblo one opening with Ortiz', () => {
    expect(sortedPlaylists(seed).slice(0, 2).map((p) => p.name)).toEqual([
      'Pueblo Foodways & Food Sovereignty',
      'Road to the Fourth Star',
    ]);
    expect(seed.playlists.p_pueblo_foodways?.materialIds[0]).toBe('m_ortiz_the_tewa_world');
  });
});

describe('seed progress', () => {
  const entries = Object.values(seed.progress);

  it('references known materials with coherent, past timestamps', () => {
    for (const p of entries) {
      const material = seed.materials[p.materialId];
      expect(material, p.materialId).toBeDefined();
      const added = Date.parse(material?.addedAt ?? '');
      const started = Date.parse(p.startedAt ?? '');
      expect(added, p.materialId).toBeLessThanOrEqual(started);
      expect(started).toBeLessThanOrEqual(Date.parse(p.lastOpenedAt ?? ''));
      expect(Date.parse(p.lastOpenedAt ?? '')).toBeLessThanOrEqual(NOW.getTime());
      if (p.status === 'completed') {
        expect(p.percent).toBe(1);
        expect(started).toBeLessThanOrEqual(Date.parse(p.completedAt ?? ''));
      } else {
        expect(p.percent).toBeGreaterThan(0);
        expect(p.percent).toBeLessThan(1);
        expect(p.completedAt).toBeUndefined();
        expect(p.review).toBeUndefined();
      }
    }
  });

  it('has five completed works with consistent review cards and three in progress', () => {
    const done = entries.filter((p) => p.status === 'completed');
    expect(done).toHaveLength(5);
    expect(entries.filter((p) => p.status === 'in_progress')).toHaveLength(3);
    for (const p of done) {
      const review = p.review;
      expect(review, p.materialId).toBeDefined();
      const anchor = Date.parse(review?.lastReviewedAt ?? p.completedAt ?? '');
      expect(Date.parse(review?.dueAt ?? '')).toBe(anchor + (review?.intervalDays ?? Number.NaN) * DAY_MS);
      expect(anchor).toBeGreaterThanOrEqual(Date.parse(p.completedAt ?? ''));
      expect(review?.ease).toBeGreaterThanOrEqual(1.3);
      expect(p.rating).toBeDefined();
    }
  });

  it('tells the first-launch story', () => {
    const mcgee = seed.progress.m_mcgee_on_food_and_cooking;
    expect(mcgee).toMatchObject({ status: 'completed', rating: 5 });
    expect(daysFromNow(mcgee?.completedAt)).toBe(-25);
    expect(isReviewDue(mcgee, NOW)).toBe(true);

    const sfah = seed.progress.m_nosrat_salt_fat_acid_heat;
    expect(daysFromNow(sfah?.completedAt)).toBe(-40);
    expect(sfah?.rating).toBe(4);
    expect(isReviewDue(sfah, NOW)).toBe(false);

    expect(daysFromNow(seed.progress.m_katz_art_of_fermentation?.completedAt)).toBe(-9);
    expect(seed.materials.m_redzepi_zilber_noma_guide_to_fermentation?.prerequisites).toContain(
      'm_katz_art_of_fermentation',
    );
    expect(prerequisiteStatus(seed, 'm_redzepi_zilber_noma_guide_to_fermentation').missing).toEqual([]);

    expect(seed.progress.m_ortiz_the_tewa_world).toMatchObject({ status: 'in_progress', percent: 0.35 });
    expect(daysFromNow(seed.progress.m_ortiz_the_tewa_world?.lastOpenedAt)).toBe(-1);
    expect(seed.progress.m_lopez_alt_the_food_lab).toMatchObject({ status: 'in_progress', percent: 0.15 });
    expect(daysFromNow(seed.progress.m_lopez_alt_the_food_lab?.lastOpenedAt)).toBe(-6);

    expect(inProgress(seed).map((m) => m.id)[0]).toBe('m_ortiz_the_tewa_world');
    expect(libraryStats(seed, NOW).streakDays).toBe(2);
  });
});

describe('createSeedLibrary', () => {
  it('uses the default settings', () => {
    expect(seed.settings).toEqual({ dailyMinutes: 60, displayName: 'Chef' });
  });

  it('survives migration unchanged', () => {
    expect(migrate(JSON.parse(JSON.stringify(seed)))).toStrictEqual(seed);
    expect(migrate(seed)).toStrictEqual(seed);
  });

  it('is deterministic for a given clock and shifts with it', () => {
    expect(createSeedLibrary(NOW)).toStrictEqual(seed);
    const later = createSeedLibrary(new Date(NOW.getTime() + 3 * DAY_MS));
    expect(Date.parse(later.materials.m_mcgee_on_food_and_cooking?.addedAt ?? '')).toBe(
      Date.parse(seed.materials.m_mcgee_on_food_and_cooking?.addedAt ?? '') + 3 * DAY_MS,
    );
  });

  it('returns independent copies that share no arrays', () => {
    const a = createSeedLibrary(NOW);
    const b = createSeedLibrary(NOW);
    expect(a.materials.m_mcgee_on_food_and_cooking?.tags).not.toBe(b.materials.m_mcgee_on_food_and_cooking?.tags);
    expect(a.playlists.p_fermentation_lab?.materialIds).not.toBe(b.playlists.p_fermentation_lab?.materialIds);
  });
});
