// Dish rows and category headings for a pop-up's menu.

import { minQtyOf } from './cart.js';
import { h } from './dom.js';
import { formatMoney } from './format.js';

const TAGS = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  'gluten-free': 'Gluten-free',
  'dairy-free': 'Dairy-free',
  spicy: 'Spicy',
  'contains-nuts': 'Contains nuts',
};

const LOW_STOCK = 10;

/** Dietary notes written out in full words. */
function marks(tags) {
  const known = tags.filter((tag) => TAGS[tag]);
  if (!known.length) return null;
  return h('ul', { class: 'marks', 'aria-label': 'Dietary notes' }, known.map((tag) => h('li', { class: 'mark' }, TAGS[tag])));
}

/** From the live count: "Sold out", "Only 4 left" (on a holiday menu, "4 left — then it’s gone
 *  until next year"), or null. */
function stockNote(item, seasonal) {
  if (item.soldOut) return 'Sold out';
  if (item.remaining === null || item.remaining > LOW_STOCK) return null;
  return seasonal ? `${item.remaining} left — then it’s gone until next year` : `Only ${item.remaining} left`;
}

/**
 * One dish. control: an element for the Add button / amount controls, or null on a menu that is
 * not taking orders. seasonal: a holiday menu taking orders, which comes back only next year.
 * Returns the <li>.
 */
export function dishNode(item, { level = 3, control = null, seasonal = false } = {}) {
  const note = stockNote(item, seasonal);
  const min = minQtyOf(item);
  return h('li', { class: ['dish', item.soldOut ? 'dish--soldout' : ''], dataset: { item: item.id } },
    item.image ? h('img', { class: 'dish__media', src: item.image, alt: '', loading: 'lazy', decoding: 'async', width: 600, height: 400 }) : null,
    h('div', { class: 'dish__text' },
      h(`h${level}`, { class: 'dish__name' }, item.name),
      h('p', { class: 'dish__price num' }, formatMoney(item.priceCents),
        min > 1 ? [' ', h('span', { class: 'dish__min' }, `Minimum ${min}`)] : null),
      item.description ? h('p', { class: 'dish__desc' }, item.description) : null,
      marks(item.tags),
      note ? h('p', { class: 'dish__note' }, note) : null),
    control ? h('div', { class: 'dish__control' }, control) : null);
}

/** A category: its heading, then its dishes. */
export function categoryNode(category, { level = 2, id, dish }) {
  return h('section', { class: 'menu-cat', id, 'aria-labelledby': `${id}-title` },
    h(`h${level}`, { class: 'menu-cat__title', id: `${id}-title` }, category.name),
    h('ul', { class: 'menu-cat__list' }, category.items.map(dish)));
}
