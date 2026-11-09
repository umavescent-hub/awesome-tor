import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ADMIN_PASSWORD, checkoutBody, CONTACT, demoPayment, startTestServer } from './helpers.js';

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

/** Checks out, then pays on the demo page with `contact`. */
async function paidOrder(overrides, contact = CONTACT) {
  const c = server.client();
  const { body } = await c.post('/api/checkout', checkoutBody(overrides));
  await c.post(`/api/demo/pay/${body.code}`, demoPayment(body.viewToken, contact));
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

  test('sessions end 12 hours after sign-in, even while in use', async () => {
    const admin = await signIn();
    const HOUR = 60 * 60 * 1000;
    try {
      for (let hour = 1; hour < 12; hour++) {
        server.clock.advance(HOUR);
        assert.equal((await admin.get('/api/admin/events')).status, 200, `hour ${hour}`);
      }
      server.clock.advance(HOUR);
      assert.equal((await admin.get('/api/admin/events')).status, 401);
    } finally {
      server.clock.advance(-12 * HOUR);
    }
  });

  test('sessions end after 2 hours without a request', async () => {
    const admin = await signIn();
    const quiet = 2 * 60 * 60 * 1000;
    try {
      server.clock.advance(quiet - 1);
      assert.equal((await admin.get('/api/admin/events')).status, 200);
      server.clock.advance(quiet);
      assert.equal((await admin.get('/api/admin/events')).status, 401);
    } finally {
      server.clock.advance(1 - 2 * quiet);
    }
  });

  test('signing in again replaces the session the browser presented', async () => {
    const admin = await signIn();
    const again = await server.client().post('/api/admin/login', { password: ADMIN_PASSWORD }, { headers: { Cookie: admin.cookie } });
    assert.equal(again.status, 200);
    assert.notEqual(again.headers.get('set-cookie').split(';')[0], admin.cookie);
    assert.equal((await admin.get('/api/admin/events')).status, 401);
  });

  test('in production the cookie is __Host- prefixed and Secure', async () => {
    const prod = await startTestServer({ env: { NODE_ENV: 'production', PUBLIC_URL: 'https://tsideh.test', ADMIN_PASSWORD } });
    try {
      const https = { 'X-Forwarded-Proto': 'https' };
      const login = await prod.client().post('/api/admin/login', { password: ADMIN_PASSWORD }, { headers: https });
      const setCookie = login.headers.get('set-cookie');
      assert.match(setCookie, /^__Host-tsideh_admin=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200; Secure$/);
      const session = await prod.client().get('/api/admin/session', { headers: { ...https, Cookie: setCookie.split(';')[0] } });
      assert.deepEqual(session.body, { authenticated: true });
      const unprefixed = setCookie.split(';')[0].replace('__Host-', '');
      assert.deepEqual((await prod.client().get('/api/admin/session', { headers: { ...https, Cookie: unprefixed } })).body, { authenticated: false });
    } finally {
      await prod.close();
    }
  });

  test('admin data needs a session: 401 unauthorized without one', async () => {
    const c = server.client();
    for (const url of ['/api/admin/events', '/api/admin/events/winter/orders', '/api/admin/events/winter/prep', '/api/admin/catering']) {
      const response = await c.get(url, { headers: { Cookie: 'tsideh_admin=forged-token' } });
      assert.equal(response.status, 401, url);
      assert.equal(response.body.error.code, 'unauthorized');
    }
    const mutation = await c.post('/api/admin/orders/TS-2222/status', { status: 'ready' }, { headers: MUTATION_HEADERS });
    assert.equal(mutation.status, 401);
  });

  test('mutations need X-Tsideh-Admin and a same-site Origin: 403 otherwise', async () => {
    const admin = await signIn();
    const path = '/api/admin/orders/TS-2222/status';
    const noHeader = await admin.post(path, { status: 'ready' }, {});
    assert.equal(noHeader.status, 403);
    assert.equal(noHeader.body.error.code, 'forbidden');
    const foreign = await admin.post(path, { status: 'ready' }, { ...MUTATION_HEADERS, Origin: 'https://evil.example' });
    assert.equal(foreign.status, 403);
    const nullOrigin = await admin.post(path, { status: 'ready' }, { ...MUTATION_HEADERS, Origin: 'null' });
    assert.equal(nullOrigin.status, 403);
    const ownOrigin = await admin.post(path, { status: 'ready' }, { ...MUTATION_HEADERS, Origin: server.base });
    assert.equal(ownOrigin.status, 404, 'past the CSRF checks, the unknown order is simply not found');
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
      ['harvest', 'open', 'open'],
      ['resting', 'paused', 'paused'],
      ['closed', 'closed', 'closed'],
      ['later', 'open', 'upcoming'],
    ]);
    const today = body.events.find((event) => event.id === 'today');
    assert.deepEqual(today.counts, { active: 2, paid: 1, ready: 0, pickedUp: 0, pending: 1 });
    assert.equal(today.revenueCents, 1200 + 98);
    assert.ok(first.code);
  });

  test('orders: active by default, all=1 adds every status; sorted by slot then time', async () => {
    const admin = await signIn();
    const c = server.client();
    const late = await paidOrder({ slot: '12:30' }, { name: 'Zia Late', email: 'z@example.com', phone: '5055550100' });
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
      customer: CONTACT,
      items: [{ id: 'stew', name: 'Green Chile Stew', qty: 1 }],
      notes: 'No cilantro.',
      totalCents: 1406,
      createdAt: new Date(server.clock.now()).toISOString(),
      paidAt: new Date(server.clock.now()).toISOString(),
    });
    assert.deepEqual(active[1].customer, { name: 'Zia Late', email: 'z@example.com', phone: '5055550100' });
    const all = (await admin.get('/api/admin/events/winter/orders?all=1')).body.orders;
    assert.deepEqual(all.map((order) => [order.code, order.status]), [[early.code, 'paid'], [canceled.code, 'canceled'], [late.code, 'paid']]);
    assert.deepEqual(all[1].customer, { name: '', email: '', phone: '' }, 'an order never paid has no contact details');
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

  test('prep list: committed vs pending per item', async () => {
    const admin = await signIn();
    const fresh = await startTestServer({ env: { ADMIN_PASSWORD } });
    try {
      const c = fresh.client();
      const login = await c.post('/api/admin/login', { password: ADMIN_PASSWORD });
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const pay = async (overrides) => {
        const { body } = await c.post('/api/checkout', checkoutBody(overrides));
        await c.post(`/api/demo/pay/${body.code}`, demoPayment(body.viewToken));
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
      assert.deepEqual(Object.keys(body), ['items']);
    } finally {
      await fresh.close();
    }
    assert.equal((await admin.get('/api/admin/events/nope/prep')).status, 404);
  });
});


describe('catering inbox', () => {
  test('inquiries are listed newest first and their status can be updated', async () => {
    const admin = await signIn();
    const c = server.client();
    const send = (name, email) => c.post('/api/catering', {
      name, email, eventDate: '2026-12-12', guestCount: 40, location: 'Santa Fe', serviceStyle: 'Drop-off, boxed lunch or pickup',
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
