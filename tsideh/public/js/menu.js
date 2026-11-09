// The menu set as type: dish rows and category headings shared by the home page and pop-up pages.

import { drawTile, seedFrom } from './art.js';
import { h } from './dom.js';
import { formatMoney } from './format.js';
import { lazyArt } from './ui.js';

const TAGS = {
  vegetarian: ['V', 'Vegetarian'],
  vegan: ['VG', 'Vegan'],
  'gluten-free': ['GF', 'Gluten-free'],
  'dairy-free': ['DF', 'Dairy-free'],
  spicy: ['Chile heat', 'Chile heat'],
  'contains-nuts': ['Nuts', 'Contains nuts'],
};

export const LOW_STOCK = 10;

function marks(tags) {
  const known = tags.filter((tag) => TAGS[tag]);
  if (!known.length) return null;
  return h('ul', { class: 'marks', 'aria-label': 'Dietary notes' }, known.map((tag) => {
    const [short, full] = TAGS[tag];
    return h('li', { class: 'mark', title: full },
      short === full ? short : [h('span', { 'aria-hidden': 'true' }, short), h('span', { class: 'visually-hidden' }, full)]);
  }));
}

/** "Sold out", "Only 4 left", or null. */
export function stockNote(item) {
  if (item.soldOut) return 'Sold out';
  if (item.remaining !== null && item.remaining <= LOW_STOCK) return `Only ${item.remaining} left`;
  return null;
}

/**
 * One dish. level: heading level for the dish name. control: an element for the add/stepper slot.
 * Returns the <li>; the control slot is `li.querySelector('.dish__control')`.
 */
export function dishNode(item, { level = 3, control = null } = {}) {
  const note = stockNote(item);
  const meta = [marks(item.tags), note ? h('span', { class: 'dish__note' }, note) : null].filter(Boolean);
  return h('li', { class: ['dish', item.soldOut ? 'dish--soldout' : ''], dataset: { item: item.id } },
    item.image ? h('img', { class: 'dish__media', src: item.image, alt: item.name, loading: 'lazy', decoding: 'async', width: 600, height: 400 }) : null,
    h(`h${level}`, { class: 'dish__name' }, item.name),
    h('span', { class: 'dish__price' }, formatMoney(item.priceCents)),
    item.description ? h('p', { class: 'dish__desc' }, item.description) : null,
    meta.length ? h('div', { class: 'dish__meta' }, meta) : null,
    control ? h('div', { class: 'dish__control' }, control) : null);
}

/** A category: heading with a small seeded sigil, then its dishes. */
export function categoryNode(category, { level = 2, id, dish }) {
  const sigil = lazyArt(h('canvas', { class: 'sigil', 'aria-hidden': 'true' }),
    (canvas) => drawTile(canvas, { seed: seedFrom(category.id), variant: 'item' }));
  return h('section', { class: 'menu-cat', id, 'aria-labelledby': `${id}-title` },
    h('div', { class: 'menu-cat__head' }, sigil, h(`h${level}`, { id: `${id}-title` }, category.name)),
    h('ul', { class: 'menu-cat__list' }, category.items.map(dish)));
}
