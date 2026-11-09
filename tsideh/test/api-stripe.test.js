import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { ADMIN_PASSWORD, checkoutBody, MINUTE, startTestServer, T0 } from './helpers.js';

const WEBHOOK_SECRET = 'whsec_fake_signing_secret';
const SECRET_KEY = 'sk_test_fakekey123';
const PUBLIC_URL = 'https://tsideh.test';

/** A tiny stand-in for api.stripe.com plus a Slack-style alert sink. */
function startFakeStripe() {
  const requests = [];
  const sessions = new Map();
  const alerts = [];
  let failNextCreate = false;
  let sequence = 0;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      const reply = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (req.url === '/alerts') {
        alerts.push(JSON.parse(body));
        reply(200, { ok: true });
        return;
      }
      requests.push({ method: req.method, url: req.url, headers: req.headers, form: new URLSearchParams(body) });
      const match = req.url.match(/^\/v1\/checkout\/sessions(?:\/([^/]+))?(\/expire)?$/);
      if (!match) return reply(404, { error: { type: 'invalid_request_error', message: 'Unrecognized request URL' } });
      const [, id, expire] = match;
      if (req.method === 'POST' && !id) {
        if (failNextCreate) {
          failNextCreate = false;
          return reply(500, { error: { type: 'api_error', message: `Internal detail for ${SECRET_KEY}` } });
        }
        const form = new URLSearchParams(body);
        let amountTotal = 0;
        for (let i = 0; form.has(`line_items[${i}][quantity]`); i++) {
          amountTotal += Number(form.get(`line_items[${i}][price_data][unit_amount]`)) * Number(form.get(`line_items[${i}][quantity]`));
        }
        const session = {
          id: `cs_test_${++sequence}`,
          object: 'checkout.session',
          url: `https://checkout.stripe.test/c/pay/cs_test_${sequence}`,
          client_reference_id: form.get('client_reference_id'),
          status: 'open',
          payment_status: 'unpaid',
          payment_intent: null,
          amount_total: amountTotal,
          currency: form.get('line_items[0][price_data][currency]'),
        };
        sessions.set(session.id, session);
        return reply(200, session);
      }
      const session = sessions.get(id);
      if (!session) return reply(404, { error: { type: 'invalid_request_error', message: `No such checkout.session: ${id}` } });
      if (req.method === 'POST' && expire) {
        session.status = 'expired';
        return reply(200, session);
      }
      return reply(200, session);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        requests,
        sessions,
        alerts,
        failNextCreate: () => {
          failNextCreate = true;
        },
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

let stripe;
let app;

before(async () => {
  stripe = await startFakeStripe();
  app = await startTestServer({
    env: {
      STRIPE_SECRET_KEY: SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      STRIPE_API_BASE: stripe.base,
      PUBLIC_URL,
      ADMIN_PASSWORD,
      NOTIFY_WEBHOOK_URL: `${stripe.base}/alerts`,
    },
  });
});
after(async () => {
  await app.close();
  await stripe.close();
});
beforeEach(() => {
  stripe.requests.length = 0;
});

function signedHeader(payload, timestamp = Math.floor(app.clock.now() / 1000)) {
  return `t=${timestamp},v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest('hex')}`;
}

let eventSequence = 0;
/** Sends a signed event. A session object gets the amount Stripe stored for it unless the test sets one. */
async function deliver(type, object, { id = `evt_${++eventSequence}`, header } = {}) {
  const stored = stripe.sessions.get(object.id);
  const amounts = stored ? { amount_total: stored.amount_total, currency: stored.currency } : {};
  const payload = JSON.stringify({ id, object: 'event', type, data: { object: { ...amounts, ...object } } });
  return app.client().post('/api/stripe/webhook', payload, {
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header ?? signedHeader(payload) },
  });
}

async function placeOrder(overrides) {
  const c = app.client();
  const response = await c.post('/api/checkout', checkoutBody(overrides));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const sessionId = [...stripe.sessions.values()].find((session) => session.client_reference_id === response.body.code).id;
  return { c, ...response.body, sessionId };
}

const lookup = (order, query = '') => order.c.get(`/api/orders/${order.code}?k=${order.viewToken}${query}`);

async function adminOrders(eventId) {
  const c = app.client();
  const login = await c.post('/api/admin/login', { password: ADMIN_PASSWORD });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  return (await c.get(`/api/admin/events/${eventId}/orders?all=1`, { headers: { Cookie: cookie } })).body.orders;
}

/** Alerts are fire-and-forget, so poll briefly for the one we expect. */
async function waitForAlert(predicate) {
  for (let i = 0; i < 100; i++) {
    const alert = stripe.alerts.find(predicate);
    if (alert) return alert;
    await sleep(10);
  }
  assert.fail('expected alert was not sent');
}

describe('Checkout Session creation', () => {
  test('sends exactly the fields Stripe needs and returns the hosted URL', async () => {
    const order = await placeOrder({ slot: '11:00', items: [{ id: 'tacos', qty: 2 }, { id: 'cookies', qty: 1 }], tipPercent: 15 });
    assert.equal(order.url, `https://checkout.stripe.test/c/pay/${order.sessionId}`);
    assert.deepEqual(order.totals, { subtotalCents: 4200, taxCents: 344, tipCents: 630, totalCents: 5174 });

    const [request] = stripe.requests;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/checkout/sessions');
    assert.equal(request.headers.authorization, `Bearer ${SECRET_KEY}`);
    assert.equal(request.headers['stripe-version'], '2024-06-20');
    assert.equal(request.headers['idempotency-key'], `${order.code}-${T0}`);
    assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded');

    const expected = {
      mode: 'payment',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': '1700',
      'line_items[0][price_data][product_data][name]': 'Bison Red Chile Tacos',
      'line_items[0][quantity]': '2',
      'line_items[1][price_data][currency]': 'usd',
      'line_items[1][price_data][unit_amount]': '800',
      'line_items[1][price_data][product_data][name]': 'Biscochitos (6)',
      'line_items[1][quantity]': '1',
      'line_items[2][price_data][currency]': 'usd',
      'line_items[2][price_data][unit_amount]': '344',
      'line_items[2][price_data][product_data][name]': 'NM gross receipts tax',
      'line_items[2][quantity]': '1',
      'line_items[3][price_data][currency]': 'usd',
      'line_items[3][price_data][unit_amount]': '630',
      'line_items[3][price_data][product_data][name]': 'Tip for the crew',
      'line_items[3][quantity]': '1',
      customer_email: 'maria@example.com',
      client_reference_id: order.code,
      'metadata[order_code]': order.code,
      'metadata[event_id]': 'winter',
      'metadata[slot]': '11:00',
      'payment_intent_data[metadata][order_code]': order.code,
      'payment_intent_data[metadata][event_id]': 'winter',
      'payment_intent_data[metadata][slot]': '11:00',
      'payment_intent_data[description]': `Tsideh pickup ${order.code}`,
      expires_at: String(T0 / 1000 + 30 * 60 + 120),
      success_url: `${PUBLIC_URL}/order/${order.code}?k=${order.viewToken}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_URL}/e/winter?canceled=${order.code}&k=${order.viewToken}`,
    };
    assert.deepEqual(Object.fromEntries(request.form), expected);
    assert.equal([...request.form.keys()].some((key) => key.startsWith('payment_method_types')), false);

    const { body } = await lookup(order);
    assert.equal(body.order.status, 'pending');
  });

  test('omits the tip line when there is no tip', async () => {
    const order = await placeOrder({ slot: '11:15', tipPercent: 0 });
    const form = stripe.requests[0].form;
    assert.equal(form.get('line_items[0][price_data][product_data][name]'), 'Green Chile Stew');
    assert.equal(form.get('line_items[1][price_data][product_data][name]'), 'NM gross receipts tax');
    assert.equal(form.has('line_items[2][quantity]'), false);
    await order.c.post(`/api/orders/${order.code}/cancel`, { k: order.viewToken });
  });

  test('a Stripe failure is a 502 that leaks nothing and releases the hold', async () => {
    stripe.failNextCreate();
    const c = app.client();
    const failed = await c.post('/api/checkout', checkoutBody({ slot: '12:45' }));
    assert.equal(failed.status, 502);
    assert.equal(failed.body.error.code, 'payment_provider_error');
    assert.equal(JSON.stringify(failed.body).includes('sk_test'), false);
    assert.equal(JSON.stringify(failed.body).includes('Internal detail'), false);
    assert.ok(app.logs.some((line) => line.startsWith('stripe: checkout session for TS-') && line.includes('status 500')));
    assert.equal(app.logs.some((line) => line.includes(SECRET_KEY)), false, 'secret keys are redacted from logs');

    assert.equal((await c.post('/api/checkout', checkoutBody({ slot: '12:45' }))).status, 200);
    assert.equal((await c.post('/api/checkout', checkoutBody({ slot: '12:45' }))).status, 200, 'the failed order does not hold a spot');
    const orders = await adminOrders('winter');
    assert.equal(orders.filter((order) => order.slot === '12:45' && order.status === 'failed').length, 1);
  });
});

describe('webhook', () => {
  test('checkout.session.completed marks the order paid once, alerting the kitchen once', async () => {
    const order = await placeOrder({ slot: '11:30' });
    const session = { id: order.sessionId, object: 'checkout.session', client_reference_id: order.code, payment_status: 'paid', payment_intent: 'pi_paid_1' };
    const first = await deliver('checkout.session.completed', session, { id: 'evt_completed_1' });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { received: true });
    const { body } = await lookup(order);
    assert.equal(body.order.status, 'paid');
    assert.ok(body.order.paidAt);

    assert.equal((await deliver('checkout.session.completed', session, { id: 'evt_completed_1' })).status, 200);
    assert.equal((await deliver('checkout.session.completed', session, { id: 'evt_completed_2' })).status, 200);

    const { text } = await waitForAlert((alert) => alert.text.includes(order.code));
    assert.equal(text, `New paid order ${order.code} · Winter Pop-up · pickup 11:30 AM · Maria · 1× Green Chile Stew · $14.06`);
    await sleep(50);
    assert.equal(stripe.alerts.filter((alert) => alert.text.includes(order.code)).length, 1, 'redelivery does not re-alert');
  });

  test('completed but unpaid (async method pending) leaves the order pending', async () => {
    const order = await placeOrder({ slot: '11:45' });
    await deliver('checkout.session.completed', { id: order.sessionId, client_reference_id: order.code, payment_status: 'unpaid' });
    assert.equal((await lookup(order)).body.order.status, 'pending');
    await deliver('checkout.session.async_payment_succeeded', { id: order.sessionId, client_reference_id: order.code, payment_status: 'paid', payment_intent: 'pi_async_1' });
    assert.equal((await lookup(order)).body.order.status, 'paid');
  });

  test('async_payment_failed marks the order failed', async () => {
    const order = await placeOrder({ slot: '11:45' });
    await deliver('checkout.session.async_payment_failed', { id: order.sessionId, client_reference_id: order.code, payment_status: 'unpaid' });
    assert.equal((await lookup(order)).body.order.status, 'failed');
  });

  test('checkout.session.expired expires a pending order but never a paid one', async () => {
    const order = await placeOrder({ slot: '12:00' });
    await deliver('checkout.session.expired', { id: order.sessionId, client_reference_id: order.code });
    assert.equal((await lookup(order)).body.order.status, 'expired');

    const paid = await placeOrder({ slot: '12:00' });
    await deliver('checkout.session.completed', { id: paid.sessionId, client_reference_id: paid.code, payment_status: 'paid', payment_intent: 'pi_keep' });
    await deliver('checkout.session.expired', { id: paid.sessionId, client_reference_id: paid.code });
    assert.equal((await lookup(paid)).body.order.status, 'paid');
  });

  test('charge.refunded: a full refund marks the order refunded, a partial one does not', async () => {
    const order = await placeOrder({ slot: '12:15' });
    await deliver('checkout.session.completed', { id: order.sessionId, client_reference_id: order.code, payment_status: 'paid', payment_intent: 'pi_refund_1' });
    await deliver('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: 'pi_refund_1', amount: 1406, amount_refunded: 500, refunded: false });
    assert.equal((await lookup(order)).body.order.status, 'paid');
    await deliver('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: 'pi_refund_1', amount: 1406, amount_refunded: 1406, refunded: true });
    assert.equal((await lookup(order)).body.order.status, 'refunded');
  });

  test('events for sessions that are not ours are acknowledged and ignored', async () => {
    const order = await placeOrder({ slot: '12:15' });
    const response = await deliver('checkout.session.completed', { id: 'cs_test_someone_else', client_reference_id: order.code, payment_status: 'paid' });
    assert.equal(response.status, 200);
    assert.equal((await lookup(order)).body.order.status, 'pending');
    assert.equal((await deliver('customer.created', { id: 'cus_1' })).status, 200);
  });

  test('a session whose amount or currency differs from the order is not marked paid and is flagged', async () => {
    const order = await placeOrder({ slot: '11:30' });
    const session = { id: order.sessionId, client_reference_id: order.code, payment_status: 'paid', payment_intent: 'pi_short' };
    assert.equal((await deliver('checkout.session.completed', { ...session, amount_total: 100 })).status, 200);
    assert.equal((await lookup(order)).body.order.status, 'pending');
    const { text } = await waitForAlert((alert) => alert.text.startsWith('REVIEW') && alert.text.includes(order.code));
    assert.equal(text, `REVIEW: Stripe charged $1.00 USD for order ${order.code}, which costs $14.06. It was not marked paid; check it in the Stripe Dashboard.`);
    await deliver('checkout.session.completed', { ...session, currency: 'eur' });
    assert.equal((await lookup(order)).body.order.status, 'pending');
    await deliver('checkout.session.completed', session);
    assert.equal((await lookup(order)).body.order.status, 'paid');
  });

  test('bad, stale or missing signatures are 400', async () => {
    const payload = JSON.stringify({ id: 'evt_x', type: 'checkout.session.completed', data: { object: {} } });
    const c = app.client();
    const send = (header) => c.post('/api/stripe/webhook', payload, { headers: { 'Content-Type': 'application/json', ...(header && { 'Stripe-Signature': header }) } });
    const now = Math.floor(app.clock.now() / 1000);
    for (const header of [undefined, 't=1,v1=abc', signedHeader(payload.replace('evt_x', 'evt_y')), signedHeader(payload, now - 301)]) {
      const response = await send(header);
      assert.equal(response.status, 400, String(header));
      assert.equal(response.body.error.code, 'bad_signature');
    }
  });

  test('a signed but malformed event is 400', async () => {
    const payload = JSON.stringify({ id: 'evt_bad', type: 'checkout.session.completed' });
    const response = await app.client().post('/api/stripe/webhook', payload, { headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signedHeader(payload) } });
    assert.equal(response.status, 400);
  });
});

describe('payment confirmation and cancellation', () => {
  test('returning with session_id confirms with Stripe when the webhook has not arrived', async () => {
    const order = await placeOrder({ slot: '12:30' });
    stripe.sessions.get(order.sessionId).payment_status = 'paid';
    stripe.sessions.get(order.sessionId).payment_intent = 'pi_return_1';
    stripe.requests.length = 0;

    const mismatched = await lookup(order, '&session_id=cs_test_999');
    assert.equal(mismatched.body.order.status, 'pending');
    assert.equal(stripe.requests.length, 0, 'a session id that is not this order\'s is never sent to Stripe');

    const confirmed = await lookup(order, `&session_id=${order.sessionId}`);
    assert.equal(confirmed.body.order.status, 'paid');
    assert.deepEqual(stripe.requests.map((request) => [request.method, request.url]), [['GET', `/v1/checkout/sessions/${order.sessionId}`]]);

    stripe.requests.length = 0;
    await lookup(order, `&session_id=${order.sessionId}`);
    assert.equal(stripe.requests.length, 0, 'once paid, no further Stripe calls');
  });

  test('confirmation leaves the order pending while Stripe says unpaid', async () => {
    const order = await placeOrder({ slot: '12:30' });
    const response = await lookup(order, `&session_id=${order.sessionId}`);
    assert.equal(response.body.order.status, 'pending');
  });

  test('cancel expires the Checkout Session at Stripe and cancels the order', async () => {
    const order = await placeOrder({ slot: '11:15' });
    stripe.requests.length = 0;
    const response = await order.c.post(`/api/orders/${order.code}/cancel`, { k: order.viewToken });
    assert.deepEqual(response.body, { ok: true });
    assert.deepEqual(stripe.requests.map((request) => [request.method, request.url]), [['POST', `/v1/checkout/sessions/${order.sessionId}/expire`]]);
    assert.equal(stripe.sessions.get(order.sessionId).status, 'expired');
    assert.equal((await lookup(order)).body.order.status, 'canceled');
  });

  test('demo routes do not exist in Stripe mode', async () => {
    const order = await placeOrder({ eventId: 'today', slot: '10:30' });
    const response = await order.c.post(`/api/demo/pay/${order.code}`, { k: order.viewToken });
    assert.equal(response.status, 404);
    assert.equal((await lookup(order)).body.order.status, 'pending');
  });

  test('a payment that lands after the hold lapsed is recorded and flagged oversold', async () => {
    const late = await placeOrder({ eventId: 'today', slot: '10:45' });
    app.clock.advance(5 * MINUTE);
    try {
      await deliver('checkout.session.expired', { id: late.sessionId, client_reference_id: late.code });
      await placeOrder({ eventId: 'today', slot: '10:45' });
      const taker = await placeOrder({ eventId: 'today', slot: '10:45' });
      await deliver('checkout.session.completed', { id: taker.sessionId, client_reference_id: taker.code, payment_status: 'paid', payment_intent: 'pi_taker' });

      await deliver('checkout.session.completed', { id: late.sessionId, client_reference_id: late.code, payment_status: 'paid', payment_intent: 'pi_late' });
      assert.equal((await lookup(late)).body.order.status, 'paid');
      const orders = await adminOrders('today');
      assert.equal(orders.find((order) => order.code === late.code).oversold, true);
      assert.equal(orders.find((order) => order.code === taker.code).oversold, false);
      const alert = await waitForAlert((entry) => entry.text.includes(late.code));
      assert.match(alert.text, /^OVERSOLD \(over capacity, check the board\) · New paid order/);
    } finally {
      app.clock.advance(-5 * MINUTE);
    }
  });
});
