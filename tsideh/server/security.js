// Response hardening, client identification, rate limiting and bounded body reading.

import { ApiError } from './http.js';
import { isPlainObject } from './validate.js';

const JSON_LIMIT_BYTES = 16 * 1024;
export const WEBHOOK_LIMIT_BYTES = 256 * 1024;
export const HSTS = 'max-age=63072000; includeSubDomains';

/** Headers sent on every response. */
export function securityHeaders({ production }) {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ];
  if (production) policy.push('upgrade-insecure-requests');
  return {
    'Content-Security-Policy': policy.join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

const unmapIpv4 = (ip) => (ip.startsWith('::ffff:') ? ip.slice(7) : ip);

/**
 * Client IP and scheme. With TRUST_PROXY=n (n proxies in front of the app) the client is the
 * address the outermost trusted proxy recorded: the n-th X-Forwarded-For entry from the right.
 * Entries further left were written by the client and are never trusted.
 */
export function clientInfo(req, trustProxy) {
  const socketIp = unmapIpv4(req.socket.remoteAddress ?? '');
  const encrypted = Boolean(req.socket.encrypted);
  if (!trustProxy) return { ip: socketIp, https: encrypted, forwardedProto: null };
  const chain = String(req.headers['x-forwarded-for'] ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  const ip = chain.length ? unmapIpv4(chain[Math.max(0, chain.length - trustProxy)]) : socketIp;
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase() || null;
  return { ip, https: forwardedProto ? forwardedProto === 'https' : encrypted, forwardedProto };
}

/** Sliding-window limiter: at most `limit` hits per `windowMs` per key. */
export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  return {
    /** Records a hit. Returns 0 when allowed, otherwise the seconds to wait. */
    take(key, now) {
      let stamps = hits.get(key);
      if (!stamps) {
        stamps = [];
        hits.set(key, stamps);
      }
      while (stamps.length && stamps[0] <= now - windowMs) stamps.shift();
      if (stamps.length >= limit) return Math.max(1, Math.ceil((stamps[0] + windowMs - now) / 1000));
      stamps.push(now);
      return 0;
    },
    sweep(now) {
      for (const [key, stamps] of hits) {
        if (stamps.length === 0 || stamps[stamps.length - 1] <= now - windowMs) hits.delete(key);
      }
    },
  };
}

const tooLarge = () => new ApiError(413, 'payload_too_large', 'That request is too large.', { headers: { Connection: 'close' } });

/** Reads the raw body, refusing anything over `limit` bytes without buffering it. */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > limit) {
      reject(tooLarge());
      return;
    }
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      if (overflow) return;
      size += chunk.length;
      if (size > limit) {
        overflow = true;
        chunks.length = 0;
        reject(tooLarge());
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('close', () => {
      if (!req.complete) reject(new ApiError(400, 'invalid', 'The request body was not fully received.'));
    });
    req.on('error', reject);
  });
}

export async function readJson(req) {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    throw new ApiError(415, 'unsupported_media_type', 'Send the request as JSON (Content-Type: application/json).');
  }
  const raw = await readBody(req, JSON_LIMIT_BYTES);
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError(400, 'invalid', 'The request body is not valid JSON.');
  }
  if (!isPlainObject(body)) throw new ApiError(400, 'invalid', 'The request body must be a JSON object.');
  return body;
}

/**
 * An Origin header, when present, must be this site: either the configured PUBLIC_URL or the
 * origin the browser actually used to reach us.
 */
export function originAllowed(req, { publicUrl, https }) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return origin === publicUrl || origin === `${https ? 'https' : 'http'}://${req.headers.host}`;
}
