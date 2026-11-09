// Pure cart validation and totals. The server is the only price authority: clients send item ids
// and quantities, never prices.

import { invalid } from './http.js';
import { isPlainObject } from './validate.js';

export const MAX_LINES = 25;

/**
 * `percent` of `cents`, rounded half-up to a whole cent. Percentages carry at most four
 * decimals, so the arithmetic is done on exact integers (8.1875% -> 81875 per million).
 */
export function percentOf(cents, percent) {
  const perMillion = Math.round(percent * 10_000);
  return Math.floor((cents * perMillion + 500_000) / 1_000_000);
}

/**
 * Validates [{ id, qty }] against the event menu and order rules. Duplicate ids are merged before
 * an item's minQty and the order maximums are checked. Returns priced lines in the order first seen.
 */
export function priceCart(event, rawItems, { maxQtyPerItem, maxItemsPerOrder }) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw invalid('items', 'Add at least one item.');

  const onMenu = new Map(event.menuItems.map((item) => [item.id, item]));
  const quantities = new Map();
  rawItems.forEach((entry, i) => {
    if (!isPlainObject(entry)) throw invalid(`items[${i}]`, 'Each item needs an id and a quantity.');
    const item = typeof entry.id === 'string' ? onMenu.get(entry.id) : undefined;
    if (!item) throw invalid(`items[${i}].id`, 'One of those items is not on this menu.');
    if (!Number.isInteger(entry.qty) || entry.qty < 1) throw invalid(`items[${i}].qty`, 'Quantities must be whole numbers of 1 or more.');
    quantities.set(item.id, (quantities.get(item.id) ?? 0) + entry.qty);
  });

  if (quantities.size > MAX_LINES) throw invalid('items', `An order can include up to ${MAX_LINES} different items.`);
  let count = 0;
  const lines = [];
  for (const [id, qty] of quantities) {
    const item = onMenu.get(id);
    if (qty < item.minQty) throw invalid('items', `Order at least ${item.minQty} of ${item.name}.`);
    if (qty > maxQtyPerItem) throw invalid('items', `You can order up to ${maxQtyPerItem} of ${item.name}.`);
    count += qty;
    lines.push({ id, name: item.name, unitCents: item.priceCents, qty, lineCents: item.priceCents * qty });
  }
  if (count > maxItemsPerOrder) {
    throw invalid('items', `Online orders are limited to ${maxItemsPerOrder} items. For more, ask us about catering.`);
  }
  return lines;
}

export function tipPercentFrom(value, presets) {
  if (value === undefined || value === null) return 0;
  if (!presets.includes(value)) throw invalid('tipPercent', 'Choose one of the tip options.');
  return value;
}

export function computeTotals(lines, { taxRatePercent, tipPercent }) {
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);
  const taxCents = percentOf(subtotalCents, taxRatePercent);
  const tipCents = percentOf(subtotalCents, tipPercent);
  return { subtotalCents, taxCents, tipCents, totalCents: subtotalCents + taxCents + tipCents };
}
