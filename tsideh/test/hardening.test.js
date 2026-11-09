// Regressions for abuse found in review: unpaid holds tying up stock (RT-1), IPv6 rotation past
// rate limits (RT-2), Slack markup in alerts (RT-3), emails in Stripe error logs (RT-5) and
// order lookups fanning out into Stripe calls (RT-6).

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { ADMIN_PASSWORD, checkoutBody, demoPayment, fixtureContent, MINUTE, startTestServer } from './helpers.js';

/** Fixture with roomy pickup times, so only the per-client hold limit can turn an order away. */
function roomyContent() {
  const content = fixtureContent();
  for (const event of content.events.events) event.ordersPerSlot = 20;
  return content;
}

/** A checkout from a browser: a new one each time, unless `cookie` says which browser it is. */
const order = (c, overrides = {}, cookie) => c.post('/api/checkout', checkoutBody(overrides), { headers: cookie ? { Cookie: cookie } : {} });
const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];
const status = async (c, placed) => (await c.get(`/api/orders/${placed.body.code}?k=${placed.body.viewToken}`)).body.order.status;

/** In-process stand-in for Stripe and the alert webhook, answering after a short delay like the real thing. */
function fakeServices() {
  const calls = [];
  const alerts = [];
  const sessions = new Map();
  let nextError = null;
  const reply = (code, payload) => new Response(JSON.stringify(payload), { status: code, headers: { 'Content-Type': 'application/json' } });
  async function fetch(url, init = {}) {
    const { hostname, pathname } = new URL(url);
    await sleep(15);
    if (hostname === 'hooks.test') {
      alerts.push(JSON.parse(init.body).text);
      return reply(200, { ok: true });
    }
    calls.push(`${init.method} ${pathname}`);
    if (init.method === 'POST' && pathname === '/v1/checkout/sessions') {
      if (nextError) {
        const error = nextError;
        nextError = null;
        return reply(400, { error });
      }
      const id = `cs_test_${sessions.size + 1}`;
      const session = { id, url: `https://checkout.stripe.test/${id}`, client_reference_id: new URLSearchParams(init.body).get('client_reference_id'), status: 'open', payment_status: 'unpaid' };
      sessions.set(id, session);
      return reply(200, session);
    }
    const session = sessions.get(pathname.split('/')[4]);
    if (!session) return reply(404, { error: { type: 'invalid_request_error', message: 'No such checkout.session' } });
    if (pathname.endsWith('/expire')) session.status = 'expired';
    return reply(200, session);
  }
  return { fetch, calls, alerts, sessions, failNextCreate: (error) => { nextError = error; } };
}

describe('unpaid holds per client (RT-1, demo mode)', () => {
  let server;
  before(async () => {
    server = await startTestServer({ env: { ADMIN_PASSWORD }, content: roomyContent() });
  });
  after(() => server.close());

  test('one client keeps at most two unpaid orders; everyone else can still order', async () => {
    const c = server.client();
    assert.equal((await order(c, { items: [{ id: 'tacos', qty: 1 }] })).status, 200);
    assert.equal((await order(c, { items: [{ id: 'tacos', qty: 1 }] })).status, 200);
    const third = await order(c, { items: [{ id: 'tacos', qty: 1 }] });
    assert.equal(third.status, 429);
    assert.equal(third.body.error.code, 'too_many_holds');
    assert.equal(third.body.error.message, 'Other orders from this internet connection are still waiting for payment. Finish paying for one of them, or try again in 30 minutes.');
    assert.equal(third.headers.get('retry-after'), '1800');

    const { body } = await c.get('/api/events/winter');
    assert.equal(body.menu.categories[0].items[0].remaining, 1, 'the refused order held nothing');
    assert.equal((await order(server.client(), { items: [{ id: 'tacos', qty: 1 }] })).status, 200, 'another customer gets the last one');
  });

  test('paying, canceling or letting a hold lapse frees a place', async () => {
    const c = server.client();
    const first = await order(c);
    const second = await order(c);
    assert.equal((await order(c)).status, 429);

    assert.deepEqual((await c.post(`/api/demo/pay/${first.body.code}`, demoPayment(first.body.viewToken))).body, { ok: true });
    const third = await order(c);
    assert.equal(third.status, 200, 'a paid order no longer counts');
    assert.equal((await order(c)).status, 429);

    await c.post(`/api/orders/${second.body.code}/cancel`, { k: second.body.viewToken });
    assert.equal((await order(c)).status, 200, 'a canceled order no longer counts');
    assert.equal((await order(c)).status, 429);

    server.clock.advance(30 * MINUTE);
    try {
      assert.equal((await order(c)).status, 200, 'lapsed holds no longer count');
    } finally {
      server.clock.advance(-30 * MINUTE);
    }
  });

  test('checkout marks the browser with a short-lived cookie sent only to checkout', async () => {
    const c = server.client();
    const first = await order(c);
    assert.match(first.headers.get('set-cookie'), /^tsideh_checkout=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/api\/checkout; Max-Age=1800$/);
    const cookie = cookieOf(first);
    assert.equal(cookieOf(await order(c, {}, cookie)), cookie, 'the same browser keeps its id');
    for (const forged of ['tsideh_checkout=short', `tsideh_checkout=${'%'.repeat(43)}`]) {
      const fresh = cookieOf(await order(server.client(), {}, forged));
      assert.match(fresh, /^tsideh_checkout=[A-Za-z0-9_-]{43}$/, forged);
      assert.notEqual(fresh, forged);
    }
    const refused = await order(c);
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get('set-cookie'), null, 'a refused checkout sets no cookie');
  });

  test('the same browser starting over (Back on the payment page) replaces its earlier attempts', async () => {
    const c = server.client();
    const first = await order(c);
    const cookie = cookieOf(first);
    const second = await order(c, {}, cookie);
    const again = await order(c, {}, cookie);
    assert.equal(again.status, 200);
    assert.equal(await status(c, first), 'canceled');
    assert.equal(await status(c, second), 'canceled');
    assert.equal(await status(c, again), 'pending');

    assert.equal((await order(c)).status, 200, 'another browser on the connection still has a place');
    assert.equal((await order(c)).status, 429);
  });

  test('another browser on the same connection never replaces someone\'s unpaid order', async () => {
    const c = server.client();
    const neighbor = await order(c);
    const mine = await order(c);
    const refused = await order(c, {}, `tsideh_checkout=${'A'.repeat(43)}`);
    assert.equal(refused.status, 429);
    assert.equal(refused.body.error.code, 'too_many_holds');
    assert.equal(await status(c, neighbor), 'pending');
    assert.equal(await status(c, mine), 'pending');
  });

  test('another pop-up\'s unpaid order is not replaced', async () => {
    const c = server.client();
    const today = await order(c, { eventId: 'today', slot: '10:45' });
    assert.equal(today.status, 200);
    await order(c);
    assert.equal((await order(c, {}, cookieOf(today))).status, 429);
    assert.equal(await status(c, today), 'pending');
  });

  test('addresses in one IPv6 /64 share the limit', async () => {
    const [a, b, d] = ['2001:db8:77:1::1', '2001:db8:77:1:abcd::2', '2001:DB8:77:1::3'].map((ip) => server.client(ip));
    assert.equal((await order(a)).status, 200);
    assert.equal((await order(b)).status, 200);
    assert.equal((await order(d)).status, 429);
    assert.equal((await order(server.client('2001:db8:77:2::1'))).status, 200, 'the next /64 is someone else');
  });
});

describe('rate limits count an IPv6 /64 as one client (RT-2)', () => {
  let server;
  before(async () => {
    server = await startTestServer({ env: { ADMIN_PASSWORD } });
  });
  after(() => server.close());

  test('checkout: rotating addresses inside a /64 does not reset the limit', async () => {
    for (let i = 1; i <= 10; i++) {
      assert.equal((await server.client(`2001:db8:abcd:12::${i.toString(16)}`).post('/api/checkout', {})).status, 400);
    }
    const blocked = await server.client('2001:db8:abcd:12:ffff:ffff:ffff:ffff').post('/api/checkout', {});
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, 'rate_limited');
    assert.equal((await server.client('2001:db8:abcd:13::1').post('/api/checkout', {})).status, 400, 'another /64 is not limited');
  });

  test('admin sign-in: five guesses a minute per /64', async () => {
    const guess = (ip) => server.client(ip).post('/api/admin/login', { password: 'not-the-password' });
    for (let i = 1; i <= 5; i++) assert.equal((await guess(`2001:db8:1:2::${i}`)).status, 401);
    assert.equal((await guess('2001:0db8:0001:0002:0000:0000:0000:0099')).status, 429);
    assert.equal((await guess('2001:db8:1:3::1')).status, 401, 'another /64 is not limited');
  });
});

describe('Stripe mode (RT-1 race, RT-3, RT-5, RT-6)', () => {
  let server;
  let services;
  before(async () => {
    services = fakeServices();
    server = await startTestServer({
      env: {
        STRIPE_SECRET_KEY: 'sk_test_fakekey123',
        STRIPE_WEBHOOK_SECRET: 'whsec_fake',
        STRIPE_API_BASE: 'https://stripe.test',
        NOTIFY_WEBHOOK_URL: 'https://hooks.test/alerts',
      },
      content: roomyContent(),
      fetch: services.fetch,
    });
  });
  after(() => server.close());

  test('simultaneous checkouts from one client cannot race past the hold limit', async () => {
    const c = server.client();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => order(c)));
    assert.deepEqual(results.map((response) => response.status).sort(), [200, 200, 429, 429, 429]);
  });

  test('starting over expires the earlier Checkout Session at Stripe', async () => {
    const c = server.client();
    const first = await order(c);
    const cookie = cookieOf(first);
    await order(c, {}, cookie);
    assert.equal((await order(c, {}, cookie)).status, 200);
    assert.equal(await status(c, first), 'canceled');
    const firstSession = [...services.sessions.values()].find((session) => session.client_reference_id === first.body.code);
    assert.equal(firstSession.status, 'expired');
  });

  test('in production the checkout cookie is __Secure- prefixed and Secure', async () => {
    const prod = await startTestServer({
      env: { NODE_ENV: 'production', PUBLIC_URL: 'https://tsideh.test', STRIPE_SECRET_KEY: 'sk_test_fakekey123', STRIPE_API_BASE: 'https://stripe.test' },
      content: roomyContent(),
      fetch: fakeServices().fetch,
    });
    try {
      const send = (cookie) => prod.client().post('/api/checkout', checkoutBody(), { headers: { 'X-Forwarded-Proto': 'https', ...(cookie && { Cookie: cookie }) } });
      const first = await send();
      assert.match(first.headers.get('set-cookie'), /^__Secure-tsideh_checkout=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/api\/checkout; Max-Age=1800; Secure$/);
      const cookie = cookieOf(first);
      assert.equal(cookieOf(await send(cookie)), cookie);
      assert.notEqual(cookieOf(await send(cookie.replace('__Secure-', ''))).split('=')[1], cookie.split('=')[1], 'the unprefixed name is not trusted');
    } finally {
      await prod.close();
    }
  });

  test('a catering inquiry cannot put Slack commands in the kitchen alert', async () => {
    const response = await server.client().post('/api/catering', {
      name: '<!channel> Stripe payout failed',
      email: 'x@example.com',
      eventDate: '2026-12-20',
      guestCount: 20,
      location: '<https://evil.example/stripe-login|Verify your Stripe account here>',
      serviceStyle: 'Not sure yet',
    });
    assert.equal(response.status, 201);
    for (let i = 0; i < 100 && services.alerts.length === 0; i++) await sleep(10);
    const [text] = services.alerts;
    assert.ok(text.startsWith('New catering inquiry · &lt;!channel&gt; Stripe payout failed'), text);
    assert.equal(/[<>]/.test(text), false, text);
  });

  test('Stripe error text never puts a customer\'s email in the log', async () => {
    services.failNextCreate({ type: 'invalid_request_error', code: 'email_invalid', message: 'Invalid email address: maria.lopez@example.com' });
    const failed = await order(server.client());
    assert.equal(failed.status, 502);
    const line = server.logs.find((entry) => entry.startsWith('stripe: checkout session for') && entry.includes('email_invalid'));
    assert.ok(line, 'the failure is still logged');
    assert.match(line, /Invalid email address: \[email\]/);
    assert.equal(server.logs.some((entry) => entry.includes('maria.lopez@example.com')), false);
  });

  test('order lookups after Stripe ask Stripe at most once every 5 seconds per order', async () => {
    const c = server.client();
    const placed = await order(c);
    const session = [...services.sessions.values()].find((entry) => entry.client_reference_id === placed.body.code);
    const lookup = () => c.get(`/api/orders/${placed.body.code}?k=${placed.body.viewToken}&session_id=${session.id}`);
    const retrieves = () => services.calls.filter((call) => call === `GET /v1/checkout/sessions/${session.id}`).length;

    for (let i = 0; i < 5; i++) assert.equal((await lookup()).body.order.status, 'pending');
    assert.equal(retrieves(), 1);

    session.payment_status = 'paid';
    session.amount_total = 1406;
    session.currency = 'usd';
    server.clock.advance(4_999);
    assert.equal((await lookup()).body.order.status, 'pending');
    assert.equal(retrieves(), 1, 'still inside the interval');
    server.clock.advance(1);
    assert.equal((await lookup()).body.order.status, 'paid', 'the next check records the payment');
    assert.equal(retrieves(), 2);
    server.clock.advance(-5_000);
  });
});
