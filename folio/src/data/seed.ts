/**
 * First-launch library. Real, verifiable works only — no invented titles, authors, DOIs or URLs.
 * CONTRACT: fixed signature.
 *
 * Every timestamp is relative to `now`, so a fresh install looks lived-in: a few works finished
 * (one review overdue, one unlocking the Noma guide), a few in progress, the rest queued.
 */
import type { ID, ISODate, LibraryState, Playlist, Progress, ReviewCard } from '@/domain/types';
import { DEFAULT_SETTINGS } from '@/store/settings';
import { CATEGORIES, MATERIALS } from './catalog';

const DAY_MS = 86_400_000;

interface PlaylistSeed {
  id: ID;
  name: string;
  description: string;
  pinned: boolean;
  createdDaysAgo: number;
  updatedDaysAgo: number;
  materialIds: ID[];
}

const PLAYLISTS: readonly PlaylistSeed[] = [
  {
    id: 'p_road_to_the_fourth_star',
    name: 'Road to the Fourth Star',
    description: 'From knife work and seasoning to the frontier of modern cuisine and hospitality, in the order to build it.',
    pinned: true,
    createdDaysAgo: 110,
    updatedDaysAgo: 2,
    materialIds: [
      'm_pepin_la_technique',
      'm_nosrat_salt_fat_acid_heat',
      'm_mcgee_on_food_and_cooking',
      'm_escoffier_le_guide_culinaire',
      'm_hodge_browning_reactions',
      'm_page_dornenburg_flavor_bible',
      'm_keller_french_laundry_cookbook',
      'm_baldwin_sous_vide_review',
      'm_meyer_setting_the_table',
      'm_adria_a_day_at_elbulli',
      'm_shepherd_neurogastronomy',
      'm_myhrvold_modernist_cuisine',
      'm_chefs_table_grant_achatz',
      'm_achatz_alinea',
      'm_guidara_unreasonable_hospitality',
    ],
  },
  {
    id: 'p_pueblo_foodways',
    name: 'Pueblo Foodways & Food Sovereignty',
    description: 'Beginning at home with the Tewa world, then outward to Native agriculture, seeds and the movement to restore Indigenous food systems.',
    pinned: true,
    createdDaysAgo: 35,
    updatedDaysAgo: 1,
    materialIds: [
      'm_ortiz_the_tewa_world',
      'm_frank_foods_of_the_southwest_indian_nations',
      'm_kimmerer_the_three_sisters',
      'm_mt_pleasant_burt_iroquoian_cropping',
      'm_katz_hediger_valleroy_maize_processing',
      'm_nabhan_enduring_seeds',
      'm_salmon_eating_the_landscape',
      'm_sherman_sioux_chefs_indigenous_kitchen',
      'm_mihesuah_hoover_indigenous_food_sovereignty',
    ],
  },
  {
    id: 'p_fermentation_lab',
    name: 'Fermentation Lab',
    description: 'From a first crock of sauerkraut to koji, garums and the Noma fermentation lab.',
    pinned: false,
    createdDaysAgo: 90,
    updatedDaysAgo: 9,
    materialIds: [
      'm_katz_wild_fermentation',
      'm_katz_art_of_fermentation',
      'm_pollan_cooked',
      'm_redzepi_zilber_noma_guide_to_fermentation',
      'm_mouritsen_styrbaek_umami',
      'm_shih_umansky_koji_alchemy',
    ],
  },
  {
    id: 'p_science_of_flavor',
    name: 'The Science of Flavor',
    description: 'How flavor is made in the pan, in the molecule and in the brain.',
    pinned: false,
    createdDaysAgo: 80,
    updatedDaysAgo: 6,
    materialIds: [
      'm_harvardx_science_and_cooking',
      'm_this_scientific_look_at_cooking',
      'm_hodge_browning_reactions',
      'm_spence_gastrophysics',
      'm_shepherd_neurogastronomy',
      'm_mouritsen_styrbaek_umami',
      'm_segnit_flavour_thesaurus',
      'm_ahn_flavor_network',
      'm_this_molecular_gastronomy',
    ],
  },
  {
    id: 'p_service_as_art',
    name: 'Service as Art',
    description: 'The dining room as a craft of its own, from the first Paris restaurants to unreasonable hospitality.',
    pinned: false,
    createdDaysAgo: 70,
    updatedDaysAgo: 12,
    materialIds: [
      'm_bourdain_dont_eat_before_reading_this',
      'm_brillat_savarin_physiology_of_taste',
      'm_spang_invention_of_the_restaurant',
      'm_buford_heat',
      'm_meyer_setting_the_table',
      'm_spence_gastrophysics',
      'm_guidara_unreasonable_hospitality',
    ],
  },
];

interface ReviewSeed {
  ease: number;
  intervalDays: number;
  reps: number;
  lastReviewedDaysAgo: number;
}

type ProgressSeed =
  | {
      materialId: ID;
      status: 'completed';
      startedDaysAgo: number;
      completedDaysAgo: number;
      sessions: number;
      rating: 1 | 2 | 3 | 4 | 5;
      review: ReviewSeed;
    }
  | {
      materialId: ID;
      status: 'in_progress';
      percent: number;
      startedDaysAgo: number;
      lastOpenedDaysAgo: number;
      sessions: number;
    };

/** Materials without an entry here are queued (no progress record). */
const PROGRESS: readonly ProgressSeed[] = [
  {
    // Review fell due yesterday: shows up in the review lane on first launch.
    materialId: 'm_mcgee_on_food_and_cooking',
    status: 'completed',
    startedDaysAgo: 70,
    completedDaysAgo: 25,
    sessions: 18,
    rating: 5,
    review: { ease: 2.6, intervalDays: 6, reps: 2, lastReviewedDaysAgo: 7 },
  },
  {
    materialId: 'm_nosrat_salt_fat_acid_heat',
    status: 'completed',
    startedDaysAgo: 55,
    completedDaysAgo: 40,
    sessions: 9,
    rating: 4,
    review: { ease: 2.5, intervalDays: 15, reps: 3, lastReviewedDaysAgo: 10 },
  },
  {
    materialId: 'm_katz_wild_fermentation',
    status: 'completed',
    startedDaysAgo: 95,
    completedDaysAgo: 75,
    sessions: 8,
    rating: 4,
    review: { ease: 2.5, intervalDays: 38, reps: 4, lastReviewedDaysAgo: 22 },
  },
  {
    // Prerequisite of the Noma guide, so finishing it unlocked that book.
    materialId: 'm_katz_art_of_fermentation',
    status: 'completed',
    startedDaysAgo: 48,
    completedDaysAgo: 9,
    sessions: 21,
    rating: 5,
    review: { ease: 2.6, intervalDays: 6, reps: 2, lastReviewedDaysAgo: 3 },
  },
  {
    materialId: 'm_meyer_setting_the_table',
    status: 'completed',
    startedDaysAgo: 66,
    completedDaysAgo: 52,
    sessions: 7,
    rating: 4,
    review: { ease: 2.5, intervalDays: 15, reps: 3, lastReviewedDaysAgo: 12 },
  },
  {
    materialId: 'm_ortiz_the_tewa_world',
    status: 'in_progress',
    percent: 0.35,
    startedDaysAgo: 20,
    lastOpenedDaysAgo: 1,
    sessions: 6,
  },
  {
    materialId: 'm_hodge_browning_reactions',
    status: 'in_progress',
    percent: 0.6,
    startedDaysAgo: 4,
    lastOpenedDaysAgo: 2,
    sessions: 2,
  },
  {
    materialId: 'm_lopez_alt_the_food_lab',
    status: 'in_progress',
    percent: 0.15,
    startedDaysAgo: 14,
    lastOpenedDaysAgo: 6,
    sessions: 3,
  },
];

export function createSeedLibrary(now: Date): LibraryState {
  const daysAgo = (days: number): ISODate => new Date(now.getTime() - days * DAY_MS).toISOString();

  const reviewCard = ({ ease, intervalDays, reps, lastReviewedDaysAgo }: ReviewSeed): ReviewCard => ({
    ease,
    intervalDays,
    reps,
    lastReviewedAt: daysAgo(lastReviewedDaysAgo),
    dueAt: daysAgo(lastReviewedDaysAgo - intervalDays),
  });

  const toProgress = (seed: ProgressSeed): Progress =>
    seed.status === 'completed'
      ? {
          materialId: seed.materialId,
          status: 'completed',
          percent: 1,
          startedAt: daysAgo(seed.startedDaysAgo),
          completedAt: daysAgo(seed.completedDaysAgo),
          lastOpenedAt: daysAgo(seed.completedDaysAgo),
          rating: seed.rating,
          sessions: seed.sessions,
          review: reviewCard(seed.review),
        }
      : {
          materialId: seed.materialId,
          status: 'in_progress',
          percent: seed.percent,
          startedAt: daysAgo(seed.startedDaysAgo),
          lastOpenedAt: daysAgo(seed.lastOpenedDaysAgo),
          sessions: seed.sessions,
        };

  const toPlaylist = ({ createdDaysAgo, updatedDaysAgo, materialIds, ...rest }: PlaylistSeed): Playlist => ({
    ...rest,
    materialIds: [...materialIds],
    createdAt: daysAgo(createdDaysAgo),
    updatedAt: daysAgo(updatedDaysAgo),
  });

  return {
    version: 1,
    categories: Object.fromEntries(CATEGORIES.map((category) => [category.id, { ...category }])),
    materials: Object.fromEntries(
      MATERIALS.map(({ addedDaysAgo, ...material }) => [
        material.id,
        {
          ...material,
          authors: [...material.authors],
          tags: [...material.tags],
          prerequisites: [...material.prerequisites],
          addedAt: daysAgo(addedDaysAgo),
        },
      ]),
    ),
    playlists: Object.fromEntries(PLAYLISTS.map((playlist) => [playlist.id, toPlaylist(playlist)])),
    progress: Object.fromEntries(PROGRESS.map((seed) => [seed.materialId, toProgress(seed)])),
    settings: { ...DEFAULT_SETTINGS },
  };
}
