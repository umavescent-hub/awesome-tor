import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  ADMIN_PASSWORD, checkoutBody, fixtureContent, HARVEST_CLOSES, MINUTE, SERVICE_STYLES, startTestServer,
} from './helpers.js';

const CODE = /^TS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

let server;
before(async () => {
  server = await startTestServer({ env: { ADMIN_PASSWORD } });
});
after(() => server.close());

const checkout = (c, overrides) => c.post('/api/checkout', checkoutBody(overrides));

async function adminSession() {
  const c = server.client();
  const login = await c.post('/api/admin/login', { password: ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  return {
    get: (url) => c.get(url, { headers: { Cookie: cookie } }),
  };
}

describe('site and events', () => {
  test('GET /api/site exposes public settings and demo payment mode', async () => {
    const { status, body, headers } = await server.client().get('/api/site');
    assert.equal(status, 200);
    assert.equal(headers.get('cache-control'), 'no-store');
    assert.deepEqual(body, {
      name: 'Tsideh',
      tagline: 'Pop-up kitchen · Northern New Mexico',
      heroHeadline: '',
      description: 'Pre-order pickup and catering.',
      chef: { name: 'Chef Rainbird Taylor', from: 'Ohkay Owingeh' },
      timezone: 'America/Denver',
      currency: 'usd',
      taxRatePercent: 8.1875,
      taxLabel: 'NM gross receipts tax',
      tipPresetsPercent: [0, 10, 15, 20],
      contact: { email: 'hello@tsideh.test', phone: '', instagram: '' },
      press: [],
      catering: { blurb: 'We bring the kitchen to you.', minGuests: 10, maxGuests: 500, leadTimeDays: 7, serviceStyles: SERVICE_STYLES },
      order: { maxQtyPerItem: 12, maxItemsPerOrder: 30 },
      payments: { mode: 'demo' },
    });
  });

  test('GET /api/site: chef is null when site.json names none, and "from" is optional', async () => {
    const content = fixtureContent();
    delete content.site.chef;
    const unnamed = await startTestServer({ content });
    try {
      assert.equal((await unnamed.client().get('/api/site')).body.chef, null);
    } finally {
      await unnamed.close();
    }
    content.site.chef = { name: 'Chef Rainbird Taylor' };
    const nameOnly = await startTestServer({ content });
    try {
      assert.deepEqual((await nameOnly.client().get('/api/site')).body.chef, { name: 'Chef Rainbird Taylor', from: '' });
    } finally {
      await nameOnly.close();
    }
  });

  test('GET /api/events lists visible events in date order with computed status', async () => {
    const { body } = await server.client().get('/api/events');
    assert.deepEqual(body.events.map((event) => [event.id, event.status]), [
      ['today', 'open'],
      ['winter', 'open'],
      ['harvest', 'open'],
      ['resting', 'paused'],
      ['closed', 'closed'],
      ['later', 'upcoming'],
    ]);
    const later = body.events.at(-1);
    assert.equal(later.opensAt, '2027-01-23T07:00:00.000Z');
    assert.equal(later.startsAt, '2027-01-30T18:00:00.000Z');
    assert.equal(later.ordersCloseAt, null);
    assert.equal(body.events.find((event) => event.id === 'harvest').ordersCloseAt, '2026-11-21T03:00:00.000Z');
  });

  test('GET /api/events/:id returns event, grouped menu with stock, and slots', async () => {
    const { status, body } = await server.client().get('/api/events/winter');
    assert.equal(status, 200);
    assert.equal(body.event.id, 'winter');
    assert.deepEqual(body.menu.categories.map((category) => [category.id, category.items.map((item) => item.id)]), [
      ['plates', ['tacos', 'stew']],
      ['sweets', ['cookies']],
    ]);
    const tacos = body.menu.categories[0].items[0];
    assert.equal(tacos.remaining, 3);
    assert.equal(tacos.soldOut, false);
    assert.deepEqual(body.slots[0], { time: '11:00', label: '11:00 AM', available: true, remaining: 2 });
    assert.equal(body.slots.length, 8);
  });

  test('hidden, past, unknown and malformed event ids are 404', async () => {
    const c = server.client();
    for (const id of ['secret', 'past', 'nope', 'Winter', '..%2Fsecret']) {
      const { status, body } = await c.get(`/api/events/${id}`);
      assert.equal(status, 404, id);
      assert.equal(body.error.code, 'not_found');
    }
  });

  test('unknown API paths are JSON 404s and wrong methods are 405', async () => {
    const c = server.client();
    const missing = await c.get('/api/nothing-here');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'not_found');
    const wrong = await c.call('DELETE', '/api/events');
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get('allow'), 'GET');
  });
});

describe('checkout and payment (demo)', () => {
  test('full flow: checkout -> pending order -> demo pay -> paid', async () => {
    const c = server.client();
    const created = await checkout(c, {
      slot: '11:15',
      items: [{ id: 'stew', qty: 1 }, { id: 'cookies', qty: 2 }],
      tipPercent: 15,
      notes: 'Extra napkins, please.',
    });
    assert.equal(created.status, 200);
    const { code, viewToken, url, totals } = created.body;
    assert.match(code, CODE);
    assert.match(viewToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(url, `/pay/demo/${code}?k=${viewToken}`);
    assert.deepEqual(totals, { subtotalCents: 2900, taxCents: 237, tipCents: 435, totalCents: 3572 });

    const pending = await c.get(`/api/orders/${code}?k=${viewToken}`);
    assert.equal(pending.status, 200);
    assert.equal(pending.body.order.status, 'pending');
    assert.equal(pending.body.order.paidAt, null);

    const paid = await c.post(`/api/demo/pay/${code}`, { k: viewToken });
    assert.deepEqual(paid.body, { ok: true });

    const { body } = await c.get(`/api/orders/${code.toLowerCase()}?k=${viewToken}`);
    assert.equal(body.order.status, 'paid');
    assert.deepEqual(body.order.event, {
      id: 'winter',
      title: 'Winter Pop-up',
      date: '2026-11-21',
      start: '11:00',
      end: '13:00',
      locationName: 'Santa Fe',
      address: 'Railyard, 1612 Paseo de Peralta',
      mapUrl: 'https://maps.example.com/railyard',
    });
    assert.equal(body.order.slot, '11:15');
    assert.equal(body.order.slotLabel, '11:15 AM');
    assert.equal(body.order.pickupAt, '2026-11-21T18:15:00.000Z');
    assert.deepEqual(body.order.items, [
      { id: 'stew', name: 'Green Chile Stew', qty: 1, unitCents: 1300, lineCents: 1300 },
      { id: 'cookies', name: 'Biscochitos (6)', qty: 2, unitCents: 800, lineCents: 1600 },
    ]);
    assert.deepEqual(
      [body.order.subtotalCents, body.order.taxCents, body.order.tipCents, body.order.totalCents],
      [2900, 237, 435, 3572],
    );
    assert.equal(body.order.firstName, 'Maria');
    assert.equal(body.order.createdAt, new Date(server.clock.now()).toISOString());
    assert.equal(body.order.paidAt, new Date(server.clock.now()).toISOString());
    assert.equal(JSON.stringify(body).includes('maria@example.com'), false, 'order view must not echo contact details');

    const again = await c.post(`/api/demo/pay/${code}`, { k: viewToken });
    assert.deepEqual(again.body, { ok: true });
  });

  test('order lookups need the exact token; a wrong token looks like a missing order', async () => {
    const c = server.client();
    const { body } = await checkout(c, { slot: '11:30' });
    const wrongToken = `${body.viewToken.slice(0, -1)}${body.viewToken.endsWith('A') ? 'B' : 'A'}`;
    for (const url of [`/api/orders/${body.code}?k=${wrongToken}`, `/api/orders/${body.code}`, `/api/orders/TS-2222?k=${body.viewToken}`, `/api/orders/nope?k=${body.viewToken}`]) {
      const response = await c.get(url);
      assert.equal(response.status, 404, url);
      assert.equal(response.body.error.code, 'not_found');
    }
    await c.post(`/api/orders/${body.code}/cancel`, { k: body.viewToken });
  });

  test('slot capacity: the third order for a two-order slot gets 409 slot_unavailable', async () => {
    const c = server.client();
    assert.equal((await checkout(c, { slot: '11:45' })).status, 200);
    assert.equal((await checkout(c, { slot: '11:45' })).status, 200);
    const third = await checkout(server.client(), { slot: '11:45' });
    assert.equal(third.status, 409);
    assert.equal(third.body.error.code, 'slot_unavailable');
    const { body } = await c.get('/api/events/winter');
    assert.deepEqual(body.slots.find((slot) => slot.time === '11:45'), { time: '11:45', label: '11:45 AM', available: false, remaining: 0 });
  });

  test('concurrent checkouts for the last spots never overbook', async () => {
    const attempts = await Promise.all(Array.from({ length: 6 }, () => checkout(server.client(), { slot: '12:45' })));
    const statuses = attempts.map((response) => response.status).sort();
    assert.deepEqual(statuses, [200, 200, 409, 409, 409, 409]);
    assert.ok(attempts.filter((response) => response.status === 409).every((response) => response.body.error.code === 'slot_unavailable'));
  });

  test('pending holds expire after holdMinutes and release capacity', async () => {
    const c = server.client();
    const other = server.client();
    const first = await checkout(c, { slot: '12:00' });
    await checkout(c, { slot: '12:00' });
    assert.equal((await checkout(other, { slot: '12:00' })).body.error.code, 'slot_unavailable');

    server.clock.advance(30 * MINUTE - 1);
    try {
      assert.equal((await checkout(other, { slot: '12:00' })).body.error.code, 'slot_unavailable', 'still held one ms before expiry');
      assert.equal((await c.get(`/api/orders/${first.body.code}?k=${first.body.viewToken}`)).body.order.status, 'pending');

      server.clock.advance(1);
      assert.equal((await c.get(`/api/orders/${first.body.code}?k=${first.body.viewToken}`)).body.order.status, 'expired');
      assert.equal((await checkout(c, { slot: '12:00' })).status, 200, 'the lapsed holds no longer count');

      const payLapsed = await c.post(`/api/demo/pay/${first.body.code}`, { k: first.body.viewToken });
      assert.equal(payLapsed.status, 409);
      assert.equal(payLapsed.body.error.code, 'order_closed');
    } finally {
      server.clock.advance(-30 * MINUTE);
    }
  });

  test('item limits: ordering past the remaining stock is 409 sold_out with details', async () => {
    const c = server.client();
    const tacos = async () => (await c.get('/api/events/winter')).body.menu.categories[0].items[0];
    assert.equal((await tacos()).remaining, 3);

    const tooMany = await checkout(c, { slot: '11:00', items: [{ id: 'tacos', qty: 4 }] });
    assert.equal(tooMany.status, 409);
    assert.equal(tooMany.body.error.code, 'sold_out');
    assert.deepEqual(tooMany.body.error.details, { itemId: 'tacos', remaining: 3 });
    assert.equal(tooMany.body.error.message, 'Only 3 left of Bison Red Chile Tacos.');

    const hold = await checkout(c, { slot: '11:00', items: [{ id: 'tacos', qty: 3 }] });
    assert.equal(hold.status, 200);
    const afterHold = await tacos();
    assert.equal(afterHold.remaining, 0);
    assert.equal(afterHold.soldOut, true);

    const gone = await checkout(c, { slot: '11:00', items: [{ id: 'tacos', qty: 1 }] });
    assert.deepEqual(gone.body.error.details, { itemId: 'tacos', remaining: 0 });
    assert.equal(gone.body.error.message, 'Bison Red Chile Tacos just sold out.');

    assert.deepEqual((await c.post(`/api/orders/${hold.body.code}/cancel`, { k: hold.body.viewToken })).body, { ok: true });
    assert.equal((await tacos()).remaining, 3, 'cancel releases the stock');
  });

  test('slots inside the lead time cannot be booked', async () => {
    const c = server.client();
    server.clock.advance(MINUTE);
    try {
      const { body } = await c.get('/api/events/today');
      assert.deepEqual(body.slots.find((slot) => slot.time === '10:30'), { time: '10:30', label: '10:30 AM', available: false, remaining: 2 });
      const response = await checkout(c, { eventId: 'today', slot: '10:30' });
      assert.equal(response.status, 409);
      assert.equal(response.body.error.code, 'slot_unavailable');
    } finally {
      server.clock.advance(-MINUTE);
    }
  });

  test('cancel: releases the slot, is idempotent, and refuses paid orders', async () => {
    const c = server.client();
    const a = await checkout(c, { eventId: 'today', slot: '10:30' });
    const b = await checkout(c, { eventId: 'today', slot: '10:30' });
    assert.equal((await checkout(server.client(), { eventId: 'today', slot: '10:30' })).body.error.code, 'slot_unavailable');

    assert.deepEqual((await c.post(`/api/orders/${a.body.code}/cancel`, { k: a.body.viewToken })).body, { ok: true });
    assert.deepEqual((await c.post(`/api/orders/${a.body.code}/cancel`, { k: a.body.viewToken })).body, { ok: true, status: 'canceled' });
    assert.equal((await c.get(`/api/orders/${a.body.code}?k=${a.body.viewToken}`)).body.order.status, 'canceled');

    const replacement = await checkout(c, { eventId: 'today', slot: '10:30' });
    assert.equal(replacement.status, 200, 'the canceled hold no longer counts');

    await c.post(`/api/demo/pay/${b.body.code}`, { k: b.body.viewToken });
    const paidCancel = await c.post(`/api/orders/${b.body.code}/cancel`, { k: b.body.viewToken });
    assert.equal(paidCancel.status, 409);
    assert.equal(paidCancel.body.error.code, 'already_paid');

    const wrongToken = await c.post(`/api/orders/${replacement.body.code}/cancel`, { k: 'x'.repeat(43) });
    assert.equal(wrongToken.status, 404);
  });

  test('closed, paused and not-yet-open events refuse orders with 409 event_closed', async () => {
    const c = server.client();
    for (const eventId of ['resting', 'closed', 'later']) {
      const response = await checkout(c, { eventId });
      assert.equal(response.status, 409, eventId);
      assert.equal(response.body.error.code, 'event_closed');
    }
  });

  test('hidden, past and unknown events are 404 at checkout', async () => {
    const c = server.client();
    for (const eventId of ['secret', 'past', 'nope']) {
      const response = await checkout(c, { eventId });
      assert.equal(response.status, 404, eventId);
      assert.equal(response.body.error.code, 'not_found');
    }
  });
});

describe('holiday pickup: minimum quantities and the order cutoff', () => {
  // Its own server: the cutoff test moves the clock ten days ahead.
  let holiday;
  before(async () => {
    holiday = await startTestServer();
  });
  after(() => holiday.close());

  const order = (c, items, slot = '12:00') => c.post('/api/checkout', checkoutBody({ eventId: 'harvest', slot, items }));
  const cancel = (c, placed) => c.post(`/api/orders/${placed.body.code}/cancel`, { k: placed.body.viewToken });
  async function dinner() {
    const { body } = await holiday.client().get('/api/events/harvest');
    const { remaining, soldOut } = body.menu.categories[0].items.find((item) => item.id === 'dinner');
    return { remaining, soldOut };
  }

  test('the menu gives each dish its minimum', async () => {
    const { body } = await holiday.client().get('/api/events/harvest');
    assert.deepEqual(body.menu.categories.map((category) => category.items.map((item) => [item.id, item.minQty])), [[['dinner', 2], ['pie', 1]]]);
  });

  test('fewer than a dish\'s minimum is 400 invalid on items; the minimum itself is accepted', async () => {
    const c = holiday.client();
    const one = await order(c, [{ id: 'dinner', qty: 1 }, { id: 'pie', qty: 1 }]);
    assert.equal(one.status, 400);
    assert.equal(one.body.error.code, 'invalid');
    assert.equal(one.body.error.field, 'items');
    assert.equal(one.body.error.message, 'Order at least 2 of Thanksgiving dinner, per person.');

    const two = await order(c, [{ id: 'dinner', qty: 1 }, { id: 'pie', qty: 1 }, { id: 'dinner', qty: 1 }]);
    assert.equal(two.status, 200, 'lines for the same dish count together');
    assert.equal(two.body.totals.subtotalCents, 2 * 8500 + 4800);
    await cancel(c, two);
  });

  test('a dish sells out once fewer than its minimum remain', async () => {
    const [a, b] = [holiday.client(), holiday.client()];
    const first = await order(a, [{ id: 'dinner', qty: 2 }]);
    assert.deepEqual(await dinner(), { remaining: 3, soldOut: false });
    const second = await order(b, [{ id: 'dinner', qty: 2 }], '12:30');
    assert.deepEqual(await dinner(), { remaining: 1, soldOut: true }, 'the last portion cannot make up an order');

    const late = await order(holiday.client(), [{ id: 'dinner', qty: 2 }], '13:00');
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'sold_out');
    assert.equal(late.body.error.message, 'Thanksgiving dinner, per person just sold out.');
    assert.deepEqual(late.body.error.details, { itemId: 'dinner', remaining: 0 });
    assert.equal((await holiday.client().get('/api/events/harvest')).body.event.status, 'open', 'the pies are still for sale');

    await cancel(a, first);
    assert.deepEqual(await dinner(), { remaining: 3, soldOut: false });
    await cancel(b, second);
  });

  test('orders close at exactly ordersCloseAt; a hold placed before it can still be paid', async () => {
    const c = holiday.client();
    const start = holiday.clock.now();
    holiday.clock.advance(HARVEST_CLOSES - 1 - start);
    try {
      const held = await order(c, [{ id: 'pie', qty: 1 }]);
      assert.equal(held.status, 200, 'one millisecond before the cutoff');

      holiday.clock.advance(1);
      const { body } = await c.get('/api/events/harvest');
      assert.equal(body.event.status, 'closed');
      assert.equal(body.event.ordersCloseAt, '2026-11-21T03:00:00.000Z');
      assert.ok(body.slots.every((slot) => !slot.available));
      const listed = (await c.get('/api/events')).body.events.find((event) => event.id === 'harvest');
      assert.equal(listed.status, 'closed', 'still on the calendar, shown as closed');

      const late = await order(holiday.client(), [{ id: 'pie', qty: 1 }], '12:30');
      assert.equal(late.status, 409);
      assert.equal(late.body.error.code, 'event_closed');

      assert.deepEqual((await c.post(`/api/demo/pay/${held.body.code}`, { k: held.body.viewToken })).body, { ok: true });
      assert.equal((await c.get(`/api/orders/${held.body.code}?k=${held.body.viewToken}`)).body.order.status, 'paid');
    } finally {
      holiday.clock.advance(start - holiday.clock.now());
    }
  });
});

describe('checkout validation', () => {
  const cases = [
    ['missing event', { eventId: undefined }, 'eventId'],
    ['unknown slot', { slot: '11:05' }, 'slot'],
    ['no items', { items: [] }, 'items'],
    ['item not on this menu', { items: [{ id: 'atole', qty: 1 }] }, 'items[0].id'],
    ['fractional quantity', { items: [{ id: 'stew', qty: 0.5 }] }, 'items[0].qty'],
    ['too many of one item', { items: [{ id: 'stew', qty: 13 }] }, 'items'],
    ['missing customer', { customer: undefined }, 'customer'],
    ['blank name', { customer: { name: '  ', email: 'a@example.com', phone: '5055550142' } }, 'customer.name'],
    ['bad email', { customer: { name: 'Ana', email: 'ana@', phone: '5055550142' } }, 'customer.email'],
    ['bad phone', { customer: { name: 'Ana', email: 'ana@example.com', phone: '12' } }, 'customer.phone'],
    ['long notes', { notes: 'x'.repeat(301) }, 'notes'],
    ['tip outside presets', { tipPercent: 18 }, 'tipPercent'],
  ];
  for (const [name, overrides, field] of cases) {
    test(`400 invalid: ${name}`, async () => {
      const { status, body } = await checkout(server.client(), overrides);
      assert.equal(status, 400);
      assert.equal(body.error.code, 'invalid');
      assert.equal(body.error.field, field);
      assert.equal(typeof body.error.message, 'string');
    });
  }

  test('client prices are ignored', async () => {
    const c = server.client();
    const { body } = await checkout(c, { slot: '12:15', items: [{ id: 'stew', qty: 1, priceCents: 1 }], totalCents: 1 });
    assert.equal(body.totals.subtotalCents, 1300);
    await c.post(`/api/orders/${body.code}/cancel`, { k: body.viewToken });
  });

  test('non-JSON, malformed and oversized bodies', async () => {
    const c = server.client();
    const form = await c.post('/api/checkout', 'eventId=winter', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
    assert.equal(form.body.error.code, 'unsupported_media_type');
    const broken = await c.post('/api/checkout', '{"eventId":', { headers: { 'Content-Type': 'application/json' } });
    assert.equal(broken.status, 400);
    const list = await c.post('/api/checkout', '[]', { headers: { 'Content-Type': 'application/json' } });
    assert.equal(list.status, 400);
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const polluted = await c.post('/api/checkout', `{"eventId":"winter","customer":{"${key}":{"admin":true}}}`, { headers: { 'Content-Type': 'application/json' } });
      assert.equal(polluted.status, 400, key);
      assert.equal(polluted.body.error.message, 'The request body contains a reserved key.');
    }
    const huge = await c.post('/api/checkout', checkoutBody({ notes: 'x'.repeat(17 * 1024) }));
    assert.equal(huge.status, 413);
    assert.equal(huge.body.error.code, 'payload_too_large');
  });
});

describe('catering', () => {
  const inquiry = (overrides = {}) => ({
    name: 'Rosa Naranjo',
    email: 'rosa@example.com',
    phone: '505-555-0199',
    eventDate: '2026-12-12',
    guestCount: 60,
    location: 'Ohkay Owingeh community center',
    serviceStyle: "Family-style, buffet or hors d'oeuvres",
    budget: '$2,500',
    dietary: 'Two vegan guests.',
    message: 'Feast day lunch for family.',
    website: '',
    ...overrides,
  });

  test('a valid inquiry is stored for the kitchen', async () => {
    const created = await server.client().post('/api/catering', inquiry({ guestCount: '60' }));
    assert.equal(created.status, 201);
    assert.deepEqual(created.body, { ok: true });
    const admin = await adminSession();
    const { body } = await admin.get('/api/admin/catering');
    const stored = body.inquiries.find((entry) => entry.email === 'rosa@example.com');
    assert.equal(stored.guestCount, 60);
    assert.equal(stored.status, 'new');
    assert.equal(stored.serviceStyle, "Family-style, buffet or hors d'oeuvres");
  });

  test('every service style offered in site.json is accepted', async () => {
    for (const [i, serviceStyle] of SERVICE_STYLES.entries()) {
      const response = await server.client().post('/api/catering', inquiry({ serviceStyle, email: `style${i}@example.com` }));
      assert.equal(response.status, 201, serviceStyle);
    }
  });

  test('retired service styles are refused', async () => {
    for (const serviceStyle of ['Drop-off', 'Buffet', 'Family-style', 'Plated', 'Pop-up at your event']) {
      const { status, body } = await server.client().post('/api/catering', inquiry({ serviceStyle }));
      assert.equal(status, 400, serviceStyle);
      assert.equal(body.error.field, 'serviceStyle');
      assert.equal(body.error.message, 'Choose a service style.');
    }
  });

  test('honeypot: a filled "website" field gets 201 but nothing is stored', async () => {
    const response = await server.client().post('/api/catering', inquiry({ email: 'bot@spam.example', website: 'http://spam.example' }));
    assert.equal(response.status, 201);
    const admin = await adminSession();
    const { body } = await admin.get('/api/admin/catering');
    assert.equal(body.inquiries.some((entry) => entry.email === 'bot@spam.example'), false);
  });

  const invalid = [
    ['date in the past (site time zone)', { eventDate: '2026-11-09' }, 'eventDate'],
    ['date too far out', { eventDate: '2029-01-01' }, 'eventDate'],
    ['not a date', { eventDate: 'next week' }, 'eventDate'],
    ['too few guests', { guestCount: 9 }, 'guestCount'],
    ['too many guests', { guestCount: 501 }, 'guestCount'],
    ['unknown service style', { serviceStyle: 'Food truck' }, 'serviceStyle'],
    ['missing location', { location: '' }, 'location'],
    ['long message', { message: 'x'.repeat(1501) }, 'message'],
    ['long budget', { budget: 'x'.repeat(61) }, 'budget'],
    ['bad optional phone', { phone: 'call me' }, 'phone'],
  ];
  for (const [name, overrides, field] of invalid) {
    test(`400 invalid: ${name}`, async () => {
      const { status, body } = await server.client().post('/api/catering', inquiry(overrides));
      assert.equal(status, 400);
      assert.equal(body.error.field, field);
    });
  }

  test('today is accepted (site time zone)', async () => {
    const response = await server.client().post('/api/catering', inquiry({ eventDate: '2026-11-10', email: 'today@example.com' }));
    assert.equal(response.status, 201);
  });
});

describe('rate limits and logging', () => {
  test('catering: 5 per 10 minutes per IP, then 429 with Retry-After', async () => {
    const c = server.client();
    for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/catering', { website: 'bot' })).status, 201);
    const limited = await c.post('/api/catering', { website: 'bot' });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'rate_limited');
    assert.equal(limited.headers.get('retry-after'), '600');
    assert.equal((await server.client().post('/api/catering', { website: 'bot' })).status, 201, 'other visitors are unaffected');
  });

  test('checkout: 10 per minute per IP', async () => {
    const c = server.client();
    for (let i = 0; i < 10; i++) assert.equal((await checkout(c, { slot: 'nope' })).status, 400);
    assert.equal((await checkout(c, { slot: 'nope' })).status, 429);
    server.clock.advance(MINUTE);
    try {
      assert.equal((await checkout(c, { slot: 'nope' })).status, 400, 'the window slides');
    } finally {
      server.clock.advance(-MINUTE);
    }
  });

  test('request logs carry method, path, status and time, never query strings', async () => {
    const c = server.client();
    const { body } = await checkout(c, { slot: '12:30' });
    await c.get(`/api/orders/${body.code}?k=${body.viewToken}`);
    const line = server.logs.find((entry) => entry.startsWith(`GET /api/orders/${body.code} `));
    assert.match(line, /^GET \/api\/orders\/TS-[A-Z0-9]{4} 200 \d+ms$/);
    assert.equal(server.logs.some((entry) => entry.includes(body.viewToken)), false);
    await c.post(`/api/orders/${body.code}/cancel`, { k: body.viewToken });
  });

  test('the Stripe webhook is unavailable without a signing secret', async () => {
    const response = await server.client().post('/api/stripe/webhook', '{}', { headers: { 'Stripe-Signature': 't=1,v1=00' } });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'webhooks_unavailable');
  });
});

describe('production guardrails', () => {
  let prod;
  before(async () => {
    prod = await startTestServer({ env: { NODE_ENV: 'production', PUBLIC_URL: 'https://tsideh.test' } });
  });
  after(() => prod.close());

  test('without a Stripe key checkout is 503 payments_unavailable and demo routes do not exist', async () => {
    const c = prod.client();
    const site = await c.get('/api/site', { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(site.body.payments.mode, 'disabled');
    const response = await c.post('/api/checkout', checkoutBody(), { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'payments_unavailable');
    const demo = await c.post('/api/demo/pay/TS-2222', { k: 'x' }, { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(demo.status, 404);
  });

  test('HTTPS requests get HSTS and upgrade-insecure-requests', async () => {
    const { headers } = await prod.client().get('/api/site', { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(headers.get('strict-transport-security'), 'max-age=63072000; includeSubDomains');
    assert.match(headers.get('content-security-policy'), /; upgrade-insecure-requests$/);
  });

  test('plain HTTP through the proxy is redirected to the HTTPS site', async () => {
    const response = await prod.client().get('/order/TS-2222?k=abc', { headers: { 'X-Forwarded-Proto': 'http' } });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), 'https://tsideh.test/order/TS-2222?k=abc');
    assert.ok(prod.logs.some((line) => /^GET \/order\/TS-2222 301 \d+ms$/.test(line)), 'logged without the query string');
  });

  test('admin stays off without ADMIN_PASSWORD', async () => {
    const response = await prod.client().get('/api/admin/session', { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'admin_disabled');
  });
});
