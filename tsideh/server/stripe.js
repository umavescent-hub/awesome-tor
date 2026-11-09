// Minimal Stripe REST client (no SDK) and webhook signature verification.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const STRIPE_API_VERSION = '2024-06-20';
const TIMEOUT_MS = 10_000;
const WEBHOOK_TOLERANCE_SECONDS = 300;

export class StripeError extends Error {
  constructor(message, { status = null, type = null, code = null, cause } = {}) {
    super(message, { cause });
    this.name = 'StripeError';
    this.status = status;
    this.type = type;
    this.code = code;
  }
}

export class SignatureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SignatureError';
  }
}

const encodeKey = (key) => encodeURIComponent(key).replaceAll('%5B', '[').replaceAll('%5D', ']');

/**
 * Stripe's form encoding: nested objects and arrays become bracketed keys,
 * e.g. { line_items: [{ price_data: { currency: 'usd' } }] } -> line_items[0][price_data][currency]=usd.
 * null and undefined are omitted.
 */
export function encodeForm(params) {
  const pairs = [];
  const walk = (value, key) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${key}[${index}]`));
    } else if (typeof value === 'object') {
      for (const [name, entry] of Object.entries(value)) walk(entry, key ? `${key}[${name}]` : name);
    } else {
      pairs.push(`${encodeKey(key)}=${encodeURIComponent(String(value))}`);
    }
  };
  walk(params, '');
  return pairs.join('&');
}

export function createStripeClient({ secretKey, apiBase, fetch: fetchImpl = globalThis.fetch }) {
  async function call(method, path, { form, idempotencyKey } = {}) {
    const headers = { Authorization: `Bearer ${secretKey}`, 'Stripe-Version': STRIPE_API_VERSION };
    let body;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = encodeForm(form);
    }
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    let response;
    let payload;
    try {
      response = await fetchImpl(`${apiBase}${path}`, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      payload = await response.json().catch(() => null);
    } catch (cause) {
      const timedOut = cause?.name === 'TimeoutError';
      throw new StripeError(timedOut ? 'Stripe did not answer within 10 seconds' : 'Could not reach Stripe', { cause });
    }
    if (!response.ok) {
      const error = payload?.error ?? {};
      throw new StripeError(error.message ?? `Stripe answered ${response.status}`, {
        status: response.status,
        type: error.type ?? null,
        code: error.code ?? null,
      });
    }
    if (!payload || typeof payload !== 'object') throw new StripeError('Stripe sent a response that is not JSON', { status: response.status });
    return payload;
  }

  return {
    createCheckoutSession: (params, idempotencyKey) => call('POST', '/v1/checkout/sessions', { form: params, idempotencyKey }),
    retrieveCheckoutSession: (id) => call('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`),
    expireCheckoutSession: (id) => call('POST', `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`),
  };
}

/**
 * Verifies a Stripe-Signature header ("t=<unix>,v1=<hex>[,v1=<hex>...]") over the raw request
 * body exactly as Stripe specifies, then parses the event. Throws SignatureError on any failure.
 */
export function verifyWebhook(rawBody, header, secret, nowSeconds, toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS) {
  if (typeof header !== 'string' || header === '') throw new SignatureError('Missing Stripe-Signature header');
  let timestamp = null;
  const signatures = [];
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') signatures.push(value);
  }
  if (timestamp === null || !/^\d+$/.test(timestamp)) throw new SignatureError('Signature header has no valid timestamp');
  if (signatures.length === 0) throw new SignatureError('Signature header has no v1 signature');

  const expected = Buffer.from(createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex'));
  const matched = signatures.some((signature) => {
    const candidate = Buffer.from(signature);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
  if (!matched) throw new SignatureError('No signature matches the payload');
  if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) throw new SignatureError('Signature timestamp is outside the tolerance window');

  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new SignatureError('Signed payload is not JSON');
  }
}
