// JSON client for the Tsideh API: timeouts, one error shape for every failure, and named calls.

const TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(status, code, message, { field = null, details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), TIMEOUT_MS);
  const relay = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', relay, { once: true });

  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (controller.signal.reason?.name === 'TimeoutError') {
      throw new ApiError(0, 'timeout', 'The kitchen is taking too long to answer. Check your connection and try again.');
    }
    throw new ApiError(0, 'network', 'You appear to be offline. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }

  let data = null;
  if ((response.headers.get('Content-Type') ?? '').includes('application/json')) {
    data = await response.json().catch(() => null);
  }
  if (!response.ok) {
    const error = data?.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? 'http_error',
      error.message ?? 'Something went wrong on our side. Please try again.',
      { field: error.field ?? null, details: error.details ?? null },
    );
  }
  if (data === null) throw new ApiError(response.status, 'bad_response', 'The kitchen sent an answer we could not read. Please try again.');
  return data;
}

const enc = encodeURIComponent;

let site = null;
/** Site settings rarely change during a visit: fetched once and shared. A failure is not cached. */
export function getSite() {
  site ??= request('/api/site').catch((error) => {
    site = null;
    throw error;
  });
  return site;
}

export const getEvents = (options) => request('/api/events', options);
export const getEvent = (id, options) => request(`/api/events/${enc(id)}`, options);
export const checkout = (body) => request('/api/checkout', { method: 'POST', body });

export function getOrder(code, token, sessionId, options) {
  const query = new URLSearchParams({ k: token });
  if (sessionId) query.set('session_id', sessionId);
  return request(`/api/orders/${enc(code)}?${query}`, options);
}

export const cancelOrder = (code, token) => request(`/api/orders/${enc(code)}/cancel`, { method: 'POST', body: { k: token } });
export const demoPay = (code, token) => request(`/api/demo/pay/${enc(code)}`, { method: 'POST', body: { k: token } });
export const sendCatering = (body) => request('/api/catering', { method: 'POST', body });
