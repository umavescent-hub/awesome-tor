import { gzipSync } from 'node:zlib';

export class ApiError extends Error {
  constructor(status, code, message, { field, details, headers } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
    this.details = details;
    this.headers = headers;
  }

  toJSON() {
    const error = { code: this.code, message: this.message };
    if (this.field !== undefined) error.field = this.field;
    if (this.details !== undefined) error.details = this.details;
    return { error };
  }
}

export const invalid = (field, message) => new ApiError(400, 'invalid', message, { field });
export const notFound = (message = 'Not found.') => new ApiError(404, 'not_found', message);

/** Picks "br", "gzip" or null from an Accept-Encoding header, honoring q=0. */
export function negotiateEncoding(header, offered = ['br', 'gzip']) {
  if (!header) return null;
  const accepted = new Map();
  for (const part of header.toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    accepted.set(name.trim(), q ? Number(q.slice(2)) : 1);
  }
  for (const encoding of offered) {
    const q = accepted.get(encoding) ?? accepted.get('*');
    if (q > 0) return encoding;
  }
  return null;
}

const COMPRESS_MIN_BYTES = 1024;

export function sendJson(res, status, body, headers = {}) {
  let payload = Buffer.from(JSON.stringify(body));
  const responseHeaders = { 'Content-Type': 'application/json; charset=utf-8', ...headers };
  if (payload.length >= COMPRESS_MIN_BYTES) {
    responseHeaders.Vary = 'Accept-Encoding';
    if (negotiateEncoding(res.req.headers['accept-encoding'], ['gzip'])) {
      payload = gzipSync(payload);
      responseHeaders['Content-Encoding'] = 'gzip';
    }
  }
  responseHeaders['Content-Length'] = payload.length;
  res.writeHead(status, responseHeaders);
  res.end(payload);
}

export function sendError(res, error) {
  sendJson(res, error.status, error.toJSON(), error.headers);
}

/**
 * Tiny exact-segment router. Patterns look like "/api/events/:id/orders.csv".
 * `match` returns { route, params }, { allowed } when only the method differs, or null.
 */
export function createRouter(routes) {
  const compiled = routes.map((route) => ({ ...route, segments: route.path.split('/').slice(1) }));

  function matchSegments(segments, pathSegments) {
    if (segments.length !== pathSegments.length) return null;
    const params = {};
    for (let i = 0; i < segments.length; i++) {
      const pattern = segments[i];
      const actual = pathSegments[i];
      if (pattern.startsWith(':')) {
        if (actual === '') return null;
        try {
          params[pattern.slice(1)] = decodeURIComponent(actual);
        } catch {
          return null;
        }
      } else if (pattern !== actual) {
        return null;
      }
    }
    return params;
  }

  return {
    match(method, pathname) {
      const pathSegments = pathname.split('/').slice(1);
      const allowed = [];
      for (const route of compiled) {
        const params = matchSegments(route.segments, pathSegments);
        if (!params) continue;
        if (route.method === method) return { route, params };
        allowed.push(route.method);
      }
      return allowed.length ? { allowed } : null;
    },
  };
}
