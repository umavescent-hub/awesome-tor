import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildCatalog } from '../server/catalog.js';
import { ApiError } from '../server/http.js';
import { computeTotals, MAX_LINES, percentOf, priceCart, tipPercentFrom } from '../server/pricing.js';
import { fixtureContent } from './helpers.js';

const catalog = buildCatalog(fixtureContent());
const winter = catalog.events.get('winter');
const rules = { maxQtyPerItem: 12, maxItemsPerOrder: 30 };

function rejects(fn, field) {
  assert.throws(fn, (error) => error instanceof ApiError && error.status === 400 && error.code === 'invalid' && error.field === field);
}

describe('percentOf (half-up on cents, exact integer math)', () => {
  test('tax at 8.1875%', () => {
    assert.equal(percentOf(1700, 8.1875), 139); // 139.1875
    assert.equal(percentOf(1000, 8.1875), 82); // 81.875
    assert.equal(percentOf(4200, 8.1875), 344); // 343.875
    assert.equal(percentOf(0, 8.1875), 0);
  });

  test('exact half cents round up', () => {
    assert.equal(percentOf(1705, 10), 171); // 170.5
    assert.equal(percentOf(1, 50), 1); // 0.5
    assert.equal(percentOf(3, 50), 2); // 1.5
  });

  test('no floating-point drift on values that are inexact in binary', () => {
    assert.equal(percentOf(1005, 15), 151); // 150.75
    assert.equal(percentOf(10_000, 8.1875), 819); // 818.75
    assert.equal(percentOf(100, 1.005), 1); // 1.005
    assert.equal(percentOf(29_000_000, 8.1875), 2_374_375);
  });
});

describe('computeTotals', () => {
  test('subtotal + tax + tip', () => {
    const lines = priceCart(winter, [{ id: 'tacos', qty: 2 }, { id: 'cookies', qty: 1 }], rules);
    assert.deepEqual(computeTotals(lines, { taxRatePercent: 8.1875, tipPercent: 15 }), {
      subtotalCents: 4200,
      taxCents: 344,
      tipCents: 630,
      totalCents: 5174,
    });
  });

  test('tip is computed on the subtotal, not the taxed total', () => {
    const lines = priceCart(winter, [{ id: 'stew', qty: 1 }], rules);
    const totals = computeTotals(lines, { taxRatePercent: 8.1875, tipPercent: 20 });
    assert.equal(totals.tipCents, 260);
    assert.equal(totals.totalCents, 1300 + 106 + 260);
  });
});

describe('priceCart', () => {
  test('prices from the server menu and merges duplicate ids', () => {
    const lines = priceCart(winter, [{ id: 'stew', qty: 1 }, { id: 'tacos', qty: 2, priceCents: 1 }, { id: 'stew', qty: 2 }], rules);
    assert.deepEqual(lines, [
      { id: 'stew', name: 'Green Chile Stew', unitCents: 1300, qty: 3, lineCents: 3900 },
      { id: 'tacos', name: 'Bison Red Chile Tacos', unitCents: 1700, qty: 2, lineCents: 3400 },
    ]);
  });

  test('rejects empty and malformed carts', () => {
    rejects(() => priceCart(winter, [], rules), 'items');
    rejects(() => priceCart(winter, undefined, rules), 'items');
    rejects(() => priceCart(winter, { id: 'stew', qty: 1 }, rules), 'items');
    rejects(() => priceCart(winter, ['stew'], rules), 'items[0]');
  });

  test('rejects items that are unknown or not on this event', () => {
    rejects(() => priceCart(winter, [{ id: 'caviar', qty: 1 }], rules), 'items[0].id');
    rejects(() => priceCart(winter, [{ id: 'stew', qty: 1 }, { id: 'atole', qty: 1 }], rules), 'items[1].id');
    rejects(() => priceCart(winter, [{ id: 7, qty: 1 }], rules), 'items[0].id');
  });

  test('rejects bad quantities', () => {
    for (const qty of [0, -1, 1.5, '2', null]) rejects(() => priceCart(winter, [{ id: 'stew', qty }], rules), 'items[0].qty');
  });

  test('enforces per-item and per-order maximums (after merging)', () => {
    assert.equal(priceCart(winter, [{ id: 'stew', qty: 12 }], rules)[0].qty, 12);
    rejects(() => priceCart(winter, [{ id: 'stew', qty: 13 }], rules), 'items');
    rejects(() => priceCart(winter, [{ id: 'stew', qty: 8 }, { id: 'stew', qty: 5 }], rules), 'items');
    rejects(() => priceCart(winter, [{ id: 'stew', qty: 12 }, { id: 'tacos', qty: 12 }, { id: 'cookies', qty: 7 }], rules), 'items');
  });

  test(`allows at most ${MAX_LINES} distinct lines`, () => {
    const menuItems = Array.from({ length: MAX_LINES + 1 }, (_, i) => ({ id: `dish-${i}`, name: `Dish ${i}`, priceCents: 500 }));
    const big = { menuItems };
    const loose = { maxQtyPerItem: 12, maxItemsPerOrder: 500 };
    assert.equal(priceCart(big, menuItems.slice(0, MAX_LINES).map(({ id }) => ({ id, qty: 1 })), loose).length, MAX_LINES);
    rejects(() => priceCart(big, menuItems.map(({ id }) => ({ id, qty: 1 })), loose), 'items');
  });
});

describe('tipPercentFrom', () => {
  const presets = [0, 10, 15, 20];

  test('defaults to no tip', () => {
    assert.equal(tipPercentFrom(undefined, presets), 0);
    assert.equal(tipPercentFrom(null, presets), 0);
  });

  test('accepts only the configured presets', () => {
    assert.equal(tipPercentFrom(15, presets), 15);
    for (const tip of [12, '15', 15.5, -10, 100]) rejects(() => tipPercentFrom(tip, presets), 'tipPercent');
  });
});
