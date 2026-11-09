import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ADMIN_PASSWORD, checkoutBody, startTestServer } from './helpers.js';

let server;
before(async () => {
  server = await startTestServer({ env: { ADMIN_PASSWORD } });
});
after(() => server.close());

const MUTATION_HEADERS = { 'X-Tsideh-Admin': '1' };

/** Logs in and returns a client that sends the session cookie (and the admin header on POST). */
async function signIn() {
  const c = server.client();
  const login = await c.post('/api/admin/login', { password: ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  return {
    cookie,
    get: (url) => c.get(url, { headers: { Cookie: cookie } }),
    post: (url, body, headers = MUTATION_HEADERS) => c.post(url, body, { headers: { Cookie: cookie, ...headers } }),
  };
}

async function paidOrder(overrides) {
  const c = server.client();
  const { body } = await c.post('/api/checkout', checkoutBody(overrides));
  await c.post(`/api/demo/pay/${body.code}`, { k: body.viewToken });
  return body;
}

describe('admin switched off', () => {
  test('every admin route answers 503 admin_disabled without ADMIN_PASSWORD', async () => {
    const off = await startTestServer();
    try {
      const c = off.client();
      for (const [method, url] of [['GET', '/api/admin/session'], ['POST', '/api/admin/login'], ['GET', '/api/admin/events'], ['GET', '/api/admin/whatever']]) {
        const response = await c.call(method, url, { body: method === 'POST' ? { password: 'x' } : undefined });
        assert.equal(response.status, 503, url);
        assert.equal(response.body.error.code, 'admin_disabled');
      }
    } finally {
      await off.close();
    }
  });
});

describe('sign in and sessions', () => {
  test('wrong password is 401 bad_credentials (after a small delay)', async () => {
    const started = performance.now();
    const response = await server.client().post('/api/admin/login', { password: 'not-the-password' });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'bad_credentials');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.ok(performance.now() - started >= 240);
  });

  test('login sets a hardened session cookie; session and logout work', async () => {
    const c = server.client();
    const login = await c.post('/api/admin/login', { password: ADMIN_PASSWORD });
    assert.deepEqual(login.body, { authenticated: true });
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /^tsideh_admin=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200$/);
    const cookie = setCookie.split(';')[0];

    assert.deepEqual((await c.get('/api/admin/session', { headers: { Cookie: cookie } })).body, { authenticated: true });
    assert.deepEqual((await c.get('/api/admin/session')).body, { authenticated: false });

    const logout = await c.post('/api/admin/logout', {}, { headers: { Cookie: cookie } });
    assert.deepEqual(logout.body, { ok: true });
    assert.match(logout.headers.get('set-cookie'), /^tsideh_admin=; HttpOnly; SameSite=Strict; Path=\/; Max-Age=0$/);
    assert.deepEqual((await c.get('/api/admin/session', { headers: { Cookie: cookie } })).body, { authenticated: false });
    assert.equal((await c.get('/api/admin/events', { headers: { Cookie: cookie } })).status, 401);
  });

  test('sessions expire after 12 hours', async () => {
    const admin = await signIn();
    server.clock.advance(12 * 60 * 60 * 1000);
    try {
      assert.equal((await admin.get('/api/admin/events')).status, 401);
    } finally {
      server.clock.advance(-12 * 60 * 60 * 1000);
    }
  });

  test('admin data needs a session: 401 unauthorized without one', async () => {
    const c = server.client();
    for (const url of ['/api/admin/events', '/api/admin/events/winter/orders', '/api/admin/events/winter/prep', '/api/admin/events/winter/orders.csv', '/api/admin/catering']) {
      const response = await c.get(url, { headers: { Cookie: 'tsideh_admin=forged-token' } });
      assert.equal(response.status, 401, url);
      assert.equal(response.body.error.code, 'unauthorized');
    }
    const mutation = await c.post('/api/admin/events/winter/pause', { paused: true }, { headers: MUTATION_HEADERS });
    assert.equal(mutation.status, 401);
  });

  test('mutations need X-Tsideh-Admin and a same-site Origin: 403 otherwise', async () => {
    const admin = await signIn();
    const noHeader = await admin.post('/api/admin/events/winter/pause', { paused: false }, {});
    assert.equal(noHeader.status, 403);
    assert.equal(noHeader.body.error.code, 'forbidden');
    const foreign = await admin.post('/api/admin/events/winter/pause', { paused: false }, { ...MUTATION_HEADERS, Origin: 'https://evil.example' });
    assert.equal(foreign.status, 403);
    const nullOrigin = await admin.post('/api/admin/events/winter/pause', { paused: false }, { ...MUTATION_HEADERS, Origin: 'null' });
    assert.equal(nullOrigin.status, 403);
    const ownOrigin = await admin.post('/api/admin/events/winter/pause', { paused: false }, { ...MUTATION_HEADERS, Origin: server.base });
    assert.equal(ownOrigin.status, 200);
    const loginFromElsewhere = await server.client().post('/api/admin/login', { password: ADMIN_PASSWORD }, { headers: { Origin: 'https://evil.example' } });
    assert.equal(loginFromElsewhere.status, 403);
  });

  test('login is rate limited to 5 per minute per IP', async () => {
    const c = server.client();
    for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/admin/login', { password: `guess-${i}` })).status, 401);
    const limited = await c.post('/api/admin/login', { password: ADMIN_PASSWORD });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'rate_limited');
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  });
});

describe('kitchen board', () => {
  test('events include hidden and recently ended ones, with counts and revenue', async () => {
    const admin = await signIn();
    const first = await paidOrder({ eventId: 'today', slot: '10:30', items: [{ id: 'atole', qty: 2 }] });
    const c = server.client();
    await c.post('/api/checkout', checkoutBody({ eventId: 'today', slot: '10:45' }));
    const { body } = await admin.get('/api/admin/events');
    assert.deepEqual(body.events.map((event) => [event.id, event.configStatus, event.status]), [
      ['past', 'open', 'closed'],
      ['today', 'open', 'open'],
      ['winter', 'open', 'open'],
      ['secret', 'hidden', 'closed'],
      ['resting', 'paused', 'paused'],
      ['closed', 'closed', 'closed'],
      ['later', 'open', 'upcoming'],
    ]);
    const today = body.events.find((event) => event.id === 'today');
    assert.deepEqual(today.counts, { active: 2, paid: 1, ready: 0, pickedUp: 0, pending: 1 });
    assert.equal(today.revenueCents, 1200 + 98);
    assert.equal(today.paused, false);
    assert.ok(first.code);
  });

  test('orders: active by default, all=1 adds every status; sorted by slot then time', async () => {
    const admin = await signIn();
    const c = server.client();
    const late = await paidOrder({ slot: '12:30', customer: { name: 'Zia Late', email: 'z@example.com', phone: '5055550100' } });
    const early = await paidOrder({ slot: '11:00', notes: 'No cilantro.' });
    server.clock.advance(1000);
    const { body: canceled } = await c.post('/api/checkout', checkoutBody({ slot: '11:00' }));
    await c.post(`/api/orders/${canceled.code}/cancel`, { k: canceled.viewToken });
    server.clock.advance(-1000);

    const active = (await admin.get('/api/admin/events/winter/orders')).body.orders;
    assert.deepEqual(active.map((order) => order.code), [early.code, late.code]);
    assert.deepEqual(active[0], {
      code: early.code,
      status: 'paid',
      oversold: false,
      slot: '11:00',
      slotLabel: '11:00 AM',
      customer: { name: 'Maria Ortiz', email: 'maria@example.com', phone: '(505) 555-0142' },
      items: [{ id: 'stew', name: 'Green Chile Stew', qty: 1 }],
      notes: 'No cilantro.',
      totalCents: 1406,
      createdAt: new Date(server.clock.now()).toISOString(),
      paidAt: new Date(server.clock.now()).toISOString(),
    });
    const all = (await admin.get('/api/admin/events/winter/orders?all=1')).body.orders;
    assert.deepEqual(all.map((order) => [order.code, order.status]), [[early.code, 'paid'], [canceled.code, 'canceled'], [late.code, 'paid']]);
    assert.equal((await admin.get('/api/admin/events/nope/orders')).status, 404);
  });

  test('status: paid -> ready -> picked_up (and back), never from pending', async () => {
    const admin = await signIn();
    const order = await paidOrder({ slot: '11:15' });
    for (const status of ['ready', 'picked_up', 'ready']) {
      assert.deepEqual((await admin.post(`/api/admin/orders/${order.code}/status`, { status })).body, { ok: true });
    }
    const orders = (await admin.get('/api/admin/events/winter/orders')).body.orders;
    assert.equal(orders.find((entry) => entry.code === order.code).status, 'ready');

    const { body: pending } = await server.client().post('/api/checkout', checkoutBody({ slot: '11:15' }));
    const conflict = await admin.post(`/api/admin/orders/${pending.code}/status`, { status: 'ready' });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'invalid_transition');
    assert.equal((await admin.post(`/api/admin/orders/${order.code}/status`, { status: 'refunded' })).status, 400);
    assert.equal((await admin.post('/api/admin/orders/TS-2222/status', { status: 'ready' })).status, 404);
  });

  test('pause stops new orders; unpause reopens', async () => {
    const admin = await signIn();
    const c = server.client();
    assert.deepEqual((await admin.post('/api/admin/events/winter/pause', { paused: true })).body, { ok: true });
    assert.equal((await c.get('/api/events/winter')).body.event.status, 'paused');
    const refused = await c.post('/api/checkout', checkoutBody({ slot: '11:30' }));
    assert.equal(refused.body.error.code, 'event_closed');
    assert.equal((await admin.get('/api/admin/events')).body.events.find((event) => event.id === 'winter').paused, true);

    await admin.post('/api/admin/events/winter/pause', { paused: false });
    assert.equal((await c.get('/api/events/winter')).body.event.status, 'open');
    assert.equal((await admin.post('/api/admin/events/winter/pause', { paused: 'yes' })).status, 400);
    assert.equal((await admin.post('/api/admin/events/nope/pause', { paused: true })).status, 404);
  });

  test('86 switch marks an item sold out for one event and back', async () => {
    const admin = await signIn();
    const c = server.client();
    const stew = async () => (await c.get('/api/events/winter')).body.menu.categories[0].items.find((item) => item.id === 'stew');
    assert.deepEqual((await admin.post('/api/admin/events/winter/items/stew/sold-out', { soldOut: true })).body, { ok: true });
    assert.equal((await stew()).soldOut, true);
    const refused = await c.post('/api/checkout', checkoutBody({ slot: '11:30' }));
    assert.equal(refused.status, 409);
    assert.deepEqual(refused.body.error.details, { itemId: 'stew', remaining: 0 });

    await admin.post('/api/admin/events/winter/items/stew/sold-out', { soldOut: false });
    assert.equal((await stew()).soldOut, false);
    assert.equal((await admin.post('/api/admin/events/winter/items/atole/sold-out', { soldOut: true })).status, 404, 'atole is not on the winter menu');
  });

  test('prep sheet: committed vs pending per item, committed per slot', async () => {
    const admin = await signIn();
    const fresh = await startTestServer({ env: { ADMIN_PASSWORD } });
    try {
      const c = fresh.client();
      const login = await c.post('/api/admin/login', { password: ADMIN_PASSWORD });
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const pay = async (overrides) => {
        const { body } = await c.post('/api/checkout', checkoutBody(overrides));
        await c.post(`/api/demo/pay/${body.code}`, { k: body.viewToken });
      };
      await pay({ slot: '11:00', items: [{ id: 'tacos', qty: 2 }, { id: 'stew', qty: 1 }] });
      await pay({ slot: '11:15', items: [{ id: 'stew', qty: 3 }] });
      await c.post('/api/checkout', checkoutBody({ slot: '11:15', items: [{ id: 'tacos', qty: 1 }] }));

      const { body } = await c.get('/api/admin/events/winter/prep', { headers: { Cookie: cookie } });
      assert.deepEqual(body.items, [
        { id: 'tacos', name: 'Bison Red Chile Tacos', category: 'Plates', committed: 2, pending: 1, limit: 3, remaining: 0, soldOut: true },
        { id: 'stew', name: 'Green Chile Stew', category: 'Plates', committed: 4, pending: 0, limit: null, remaining: null, soldOut: false },
        { id: 'cookies', name: 'Biscochitos (6)', category: 'Sweets', committed: 0, pending: 0, limit: null, remaining: null, soldOut: false },
      ]);
      assert.deepEqual(body.slots.slice(0, 3), [
        { time: '11:00', label: '11:00 AM', orders: 1, items: { tacos: 2, stew: 1 } },
        { time: '11:15', label: '11:15 AM', orders: 1, items: { stew: 3 } },
        { time: '11:30', label: '11:30 AM', orders: 0, items: {} },
      ]);
      assert.equal(body.slots.length, 8);
    } finally {
      await fresh.close();
    }
    assert.equal((await admin.get('/api/admin/events/nope/prep')).status, 404);
  });

  test('CSV export: attachment, BOM, every cell quoted, formulas defused', async () => {
    const admin = await signIn();
    const evil = await paidOrder({
      slot: '12:00',
      customer: { name: '=HYPERLINK("http://evil.example","Click")', email: 'eve@example.com', phone: '+1 505 555 0101' },
      notes: '@SUM(A1:A9)\nsecond "line"',
    });
    const response = await admin.get('/api/admin/events/winter/orders.csv');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="tsideh-winter-orders.csv"');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const text = response.text;
    assert.ok(text.startsWith('"code","status","slot","name","phone","email","items","notes","total"\r\n'), 'BOM is stripped by fetch; header follows');
    const row = text.split('\r\n').find((line) => line.startsWith(`"${evil.code}"`));
    assert.ok(row);
    assert.ok(row.includes('"\'=HYPERLINK(""http://evil.example"",""Click"")"'));
    assert.ok(row.includes('"\'+1 505 555 0101"'));
    assert.ok(text.includes('"\'@SUM(A1:A9)\nsecond ""line"""'));
    assert.ok(row.includes('"1 x Green Chile Stew"'));
    assert.ok(row.includes('"14.06"'));

    const raw = await fetch(`${server.base}/api/admin/events/winter/orders.csv`, { headers: { Cookie: admin.cookie } });
    const bytes = Buffer.from(await raw.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  });
});

describe('catering inbox', () => {
  test('inquiries are listed newest first and their status can be updated', async () => {
    const admin = await signIn();
    const c = server.client();
    const send = (name, email) => c.post('/api/catering', {
      name, email, eventDate: '2026-12-12', guestCount: 40, location: 'Santa Fe', serviceStyle: 'Drop-off',
    });
    await send('First Guest', 'first@example.com');
    server.clock.advance(1000);
    try {
      await send('Second Guest', 'second@example.com');
    } finally {
      server.clock.advance(-1000);
    }
    const { body } = await admin.get('/api/admin/catering');
    assert.deepEqual(body.inquiries.slice(0, 2).map((inquiry) => inquiry.name), ['Second Guest', 'First Guest']);
    const second = body.inquiries[0];
    assert.deepEqual(Object.keys(second).sort(), ['budget', 'createdAt', 'dietary', 'email', 'eventDate', 'guestCount', 'id', 'location', 'message', 'name', 'phone', 'serviceStyle', 'status'].sort());
    assert.equal(second.phone, '');

    assert.deepEqual((await admin.post(`/api/admin/catering/${second.id}/status`, { status: 'contacted' })).body, { ok: true });
    assert.equal((await admin.get('/api/admin/catering')).body.inquiries[0].status, 'contacted');
    assert.equal((await admin.post(`/api/admin/catering/${second.id}/status`, { status: 'maybe' })).status, 400);
    assert.equal((await admin.post('/api/admin/catering/99999/status', { status: 'booked' })).status, 404);
    assert.equal((await admin.post('/api/admin/catering/abc/status', { status: 'booked' })).status, 404);
  });
});
