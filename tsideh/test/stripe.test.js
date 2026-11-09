import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, test } from 'node:test';
import { createStripeClient, encodeForm, SignatureError, STRIPE_API_VERSION, StripeError, verifyWebhook } from '../server/stripe.js';

const SECRET = 'whsec_test_secret';
const NOW = 1_794_330_000;

function signature(payload, { secret = SECRET, timestamp = NOW } = {}) {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
}

describe('encodeForm', () => {
  test('brackets nested objects and arrays the way Stripe expects', () => {
    const body = encodeForm({
      mode: 'payment',
      line_items: [
        { price_data: { currency: 'usd', unit_amount: 1700, product_data: { name: 'Bison Red Chile Tacos' } }, quantity: 2 },
        { price_data: { currency: 'usd', unit_amount: 139, product_data: { name: 'NM gross receipts tax' } }, quantity: 1 },
      ],
      metadata: { order_code: 'TS-AB23' },
    });
    assert.equal(body, [
      'mode=payment',
      'line_items[0][price_data][currency]=usd',
      'line_items[0][price_data][unit_amount]=1700',
      'line_items[0][price_data][product_data][name]=Bison%20Red%20Chile%20Tacos',
      'line_items[0][quantity]=2',
      'line_items[1][price_data][currency]=usd',
      'line_items[1][price_data][unit_amount]=139',
      'line_items[1][price_data][product_data][name]=NM%20gross%20receipts%20tax',
      'line_items[1][quantity]=1',
      'metadata[order_code]=TS-AB23',
    ].join('&'));
  });

  test('escapes values (including URLs and the {CHECKOUT_SESSION_ID} template) and omits null/undefined', () => {
    const body = encodeForm({
      success_url: 'https://tsideh.com/order/TS-AB23?k=a_b-c&session_id={CHECKOUT_SESSION_ID}',
      customer_email: 'ana+pickup@example.com',
      description: 'Piñon & honey',
      skip: null,
      also: undefined,
      flag: true,
    });
    const parsed = new URLSearchParams(body);
    assert.equal(parsed.get('success_url'), 'https://tsideh.com/order/TS-AB23?k=a_b-c&session_id={CHECKOUT_SESSION_ID}');
    assert.equal(parsed.get('customer_email'), 'ana+pickup@example.com');
    assert.equal(parsed.get('description'), 'Piñon & honey');
    assert.equal(parsed.get('flag'), 'true');
    assert.equal(parsed.has('skip'), false);
    assert.equal(parsed.has('also'), false);
    assert.doesNotMatch(body, /&description=Piñon/);
  });
});

describe('verifyWebhook', () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1' } } });
  const raw = Buffer.from(payload);

  test('accepts a valid signature and returns the parsed event', () => {
    const event = verifyWebhook(raw, `t=${NOW},v1=${signature(payload)}`, SECRET, NOW);
    assert.equal(event.id, 'evt_1');
  });

  test('accepts when any one of several v1 signatures matches (secret rotation)', () => {
    const header = `t=${NOW},v1=${signature(payload, { secret: 'whsec_old' })},v0=deadbeef,v1=${signature(payload)}`;
    assert.equal(verifyWebhook(raw, header, SECRET, NOW).id, 'evt_1');
  });

  test('rejects a tampered body', () => {
    const tampered = Buffer.from(payload.replace('evt_1', 'evt_2'));
    assert.throws(() => verifyWebhook(tampered, `t=${NOW},v1=${signature(payload)}`, SECRET, NOW), SignatureError);
  });

  test('rejects a signature made with another secret', () => {
    assert.throws(() => verifyWebhook(raw, `t=${NOW},v1=${signature(payload, { secret: 'whsec_other' })}`, SECRET, NOW), SignatureError);
  });

  test('rejects a stale (or far-future) timestamp beyond 300 seconds', () => {
    const old = NOW - 301;
    assert.throws(() => verifyWebhook(raw, `t=${old},v1=${signature(payload, { timestamp: old })}`, SECRET, NOW), /tolerance/);
    const edge = NOW - 300;
    assert.equal(verifyWebhook(raw, `t=${edge},v1=${signature(payload, { timestamp: edge })}`, SECRET, NOW).id, 'evt_1');
    const future = NOW + 301;
    assert.throws(() => verifyWebhook(raw, `t=${future},v1=${signature(payload, { timestamp: future })}`, SECRET, NOW), /tolerance/);
  });

  test('rejects a timestamp swapped after signing', () => {
    assert.throws(() => verifyWebhook(raw, `t=${NOW + 1},v1=${signature(payload)}`, SECRET, NOW + 1), SignatureError);
  });

  test('rejects missing or malformed headers', () => {
    for (const header of [undefined, '', 'garbage', `v1=${signature(payload)}`, `t=${NOW}`, `t=${NOW},v0=${signature(payload)}`, `t=abc,v1=${signature(payload)}`, `t=${NOW},v1=short`]) {
      assert.throws(() => verifyWebhook(raw, header, SECRET, NOW), SignatureError, String(header));
    }
  });

  test('rejects a correctly signed body that is not JSON', () => {
    const notJson = 'not json';
    assert.throws(() => verifyWebhook(Buffer.from(notJson), `t=${NOW},v1=${signature(notJson)}`, SECRET, NOW), /not JSON/);
  });
});

describe('Stripe client', () => {
  function recordingFetch(response) {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, init });
      return response();
    };
    return { calls, fetch };
  }
  const json = (status, body) => () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  test('sends auth, version, idempotency key, form body and a timeout signal', async () => {
    const { calls, fetch } = recordingFetch(json(200, { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }));
    const stripe = createStripeClient({ secretKey: 'sk_test_123', apiBase: 'https://api.stripe.test', fetch });
    const session = await stripe.createCheckoutSession({ mode: 'payment' }, 'TS-AB23-1700000000000');
    assert.equal(session.id, 'cs_test_1');
    const [{ url, init }] = calls;
    assert.equal(url, 'https://api.stripe.test/v1/checkout/sessions');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer sk_test_123');
    assert.equal(init.headers['Stripe-Version'], STRIPE_API_VERSION);
    assert.equal(init.headers['Idempotency-Key'], 'TS-AB23-1700000000000');
    assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(init.body, 'mode=payment');
    assert.ok(init.signal instanceof AbortSignal);
  });

  test('retrieve and expire hit the right paths without a body', async () => {
    const { calls, fetch } = recordingFetch(json(200, { id: 'cs_test_1' }));
    const stripe = createStripeClient({ secretKey: 'sk_test_123', apiBase: 'https://api.stripe.test', fetch });
    await stripe.retrieveCheckoutSession('cs_test_1');
    await stripe.expireCheckoutSession('cs_test_1');
    assert.deepEqual(calls.map(({ url, init }) => [init.method, url, init.body]), [
      ['GET', 'https://api.stripe.test/v1/checkout/sessions/cs_test_1', undefined],
      ['POST', 'https://api.stripe.test/v1/checkout/sessions/cs_test_1/expire', undefined],
    ]);
  });

  test('maps API errors to StripeError with status, type and code', async () => {
    const { fetch } = recordingFetch(json(400, { error: { type: 'invalid_request_error', code: 'parameter_invalid_integer', message: 'Invalid integer' } }));
    const stripe = createStripeClient({ secretKey: 'sk_test_123', apiBase: 'https://api.stripe.test', fetch });
    await assert.rejects(stripe.createCheckoutSession({}, 'key'), (error) => error instanceof StripeError
      && error.status === 400 && error.type === 'invalid_request_error' && error.code === 'parameter_invalid_integer');
  });

  test('maps network failures and non-JSON answers to StripeError', async () => {
    const offline = createStripeClient({ secretKey: 'sk_test_123', apiBase: 'https://api.stripe.test', fetch: async () => { throw new TypeError('fetch failed'); } });
    await assert.rejects(offline.retrieveCheckoutSession('cs_test_1'), StripeError);
    const garbled = createStripeClient({ secretKey: 'sk_test_123', apiBase: 'https://api.stripe.test', fetch: async () => new Response('<html>', { status: 200 }) });
    await assert.rejects(garbled.retrieveCheckoutSession('cs_test_1'), StripeError);
  });
});
