import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildCatalog, evaluateEvent, eventSummary, isListed, isRecent, menuView } from '../server/catalog.js';
import { fixtureContent, MINUTE, T0 } from './helpers.js';

const catalog = buildCatalog(fixtureContent());
const winter = catalog.events.get('winter');
const none = { slotCounts: new Map(), itemQty: new Map() };
const noOverrides = { paused: false, soldOut: new Set() };

const evaluate = (event, { now = T0, usage = none, overrides = noOverrides } = {}) => evaluateEvent(catalog, event, { now, usage, overrides });

describe('event status', () => {
  test('open when pre-orders are open and capacity remains', () => {
    const state = evaluate(winter);
    assert.equal(state.status, 'open');
    assert.ok(state.slots.every((slot) => slot.available && slot.remaining === 2));
  });

  test('upcoming before the pre-order window opens', () => {
    assert.equal(evaluate(catalog.events.get('later')).status, 'upcoming');
    assert.equal(evaluate(winter, { now: winter.opensAtMs - 1 }).status, 'upcoming');
    assert.equal(evaluate(winter, { now: winter.opensAtMs }).status, 'open');
  });

  test('paused by config or by the kitchen override', () => {
    assert.equal(evaluate(catalog.events.get('resting')).status, 'paused');
    assert.equal(evaluate(winter, { overrides: { paused: true, soldOut: new Set() } }).status, 'paused');
  });

  test('closed by config, hidden, or when no slot is left time-wise', () => {
    assert.equal(evaluate(catalog.events.get('closed')).status, 'closed');
    assert.equal(evaluate(catalog.events.get('secret')).status, 'closed');
    const lastSlot = winter.slots.at(-1).atMs;
    assert.equal(evaluate(winter, { now: lastSlot - 30 * MINUTE }).status, 'open');
    assert.equal(evaluate(winter, { now: lastSlot - 29 * MINUTE }).status, 'closed');
  });

  test('closed takes precedence over paused, paused over upcoming', () => {
    const closedAndPaused = evaluate(catalog.events.get('closed'), { overrides: { paused: true, soldOut: new Set() } });
    assert.equal(closedAndPaused.status, 'closed');
    const later = catalog.events.get('later');
    assert.equal(evaluate(later, { overrides: { paused: true, soldOut: new Set() } }).status, 'paused');
  });

  test('soldout when every bookable slot is full', () => {
    const full = { slotCounts: new Map(winter.slots.map((slot) => [slot.time, 2])), itemQty: new Map() };
    const state = evaluate(winter, { usage: full });
    assert.equal(state.status, 'soldout');
    assert.ok(state.slots.every((slot) => !slot.available && slot.remaining === 0));
  });

  test('soldout when every menu item is out (limits or 86)', () => {
    const usage = { slotCounts: new Map(), itemQty: new Map([['tacos', 3]]) };
    const overrides = { paused: false, soldOut: new Set(['stew', 'cookies']) };
    assert.equal(evaluate(winter, { usage, overrides }).status, 'soldout');
    assert.equal(evaluate(winter, { usage }).status, 'open');
  });

  test('lead time: slots starting within leadTimeMinutes are unavailable', () => {
    const today = catalog.events.get('today');
    const state = evaluate(today);
    const available = state.slots.filter((slot) => slot.available).map((slot) => slot.time);
    assert.deepEqual(available, ['10:30', '10:45']);
  });

  test('a full slot is unavailable while its neighbours stay open', () => {
    const usage = { slotCounts: new Map([['11:15', 2], ['11:30', 1]]), itemQty: new Map() };
    const slots = evaluate(winter, { usage }).slots.slice(0, 4);
    assert.deepEqual(slots.map((slot) => [slot.time, slot.available, slot.remaining]), [
      ['11:00', true, 2],
      ['11:15', false, 0],
      ['11:30', true, 1],
      ['11:45', true, 2],
    ]);
  });
});

describe('item stock', () => {
  test('remaining = limit - active qty; unlimited items report null', () => {
    const usage = { slotCounts: new Map(), itemQty: new Map([['tacos', 2], ['stew', 40]]) };
    const items = evaluate(winter, { usage }).items;
    assert.deepEqual(items.get('tacos'), { limit: 3, remaining: 1, soldOut: false });
    assert.deepEqual(items.get('stew'), { limit: null, remaining: null, soldOut: false });
  });

  test('86 marks an item sold out regardless of limit', () => {
    const items = evaluate(winter, { overrides: { paused: false, soldOut: new Set(['stew']) } }).items;
    assert.equal(items.get('stew').soldOut, true);
  });

  test('menuView groups by category in config order and omits empty categories', () => {
    const view = menuView(catalog, winter, evaluate(winter).items);
    assert.deepEqual(view.categories.map((category) => category.id), ['plates', 'sweets']);
    assert.deepEqual(view.categories[0].items[1], {
      id: 'stew',
      name: 'Green Chile Stew',
      description: 'Roasted green chile.',
      priceCents: 1300,
      tags: ['vegan', 'gluten-free'],
      image: '/assets/menu/stew.webp',
      remaining: null,
      soldOut: false,
    });
    assert.equal(view.categories[1].items[0].image, null);
  });
});

describe('listing rules', () => {
  test('hidden and ended events are not listed publicly', () => {
    assert.equal(isListed(winter, T0), true);
    assert.equal(isListed(catalog.events.get('secret'), T0), false);
    assert.equal(isListed(catalog.events.get('past'), T0), false);
    assert.equal(isListed(winter, winter.endsAtMs), false);
  });

  test('the kitchen sees events that ended within 14 days', () => {
    assert.equal(isRecent(catalog.events.get('past'), T0), true);
    assert.equal(isRecent(catalog.events.get('ancient'), T0), false);
  });

  test('eventSummary exposes local fields and UTC instants', () => {
    assert.deepEqual(eventSummary(winter, 'open'), {
      id: 'winter',
      title: 'Winter Pop-up',
      date: '2026-11-21',
      start: '11:00',
      end: '13:00',
      startsAt: '2026-11-21T18:00:00.000Z',
      endsAt: '2026-11-21T20:00:00.000Z',
      locationName: 'Santa Fe',
      address: 'Railyard, 1612 Paseo de Peralta',
      mapUrl: 'https://maps.example.com/railyard',
      note: 'Pickup only.',
      status: 'open',
      opensAt: '2026-10-31T06:00:00.000Z',
    });
  });
});
