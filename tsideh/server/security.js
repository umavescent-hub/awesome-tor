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
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
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
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Origin-Agent-Cluster': '?1',
    'X-DNS-Prefetch-Control': 'off',
    'X-Permitted-Cross-Domain-Policies': 'none',
  };
}

const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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

/**
 * What a client is counted as for rate limits. IPv4 addresses count one by one. IPv6 addresses
 * count per /64, the block one home or phone is given, so rotating addresses inside it does not
 * reset a limit. Addresses in ::/64 (loopback, IPv4-mapped) keep their full form.
 */
export function rateKey(ip) {
  const address = String(ip).split('%')[0].toLowerCase();
  if (!address.includes(':')) return address;
  const [head, tail = ''] = address.split('::');
  // An embedded IPv4 tail (a.b.c.d) fills the last two groups, never the /64 prefix.
  const groups = (part) => (part ? part.split(':') : []).flatMap((group) => (group.includes('.') ? ['0', '0'] : [group]));
  const front = groups(head);
  const back = groups(tail);
  const full = [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back];
  const prefix = full.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, '')).join(':');
  return prefix === '0:0:0:0' ? address : `${prefix}::/64`;
}

/**
 * Unpaid holds per client: at most `limit` open at once, so one visitor cannot tie up a pop-up's
 * limited dishes and pickup times without paying. A hold stops counting when it expires or
 * `isOpen(code)` says it is no longer waiting for payment (paid, canceled, failed). Each hold also
 * records the browser that made it, so a client's holds can be told apart.
 */
export function createHoldLimiter({ limit, isOpen }) {
  const holds = new Map();

  /** This key's holds still open. A hold whose checkout is still running has code null. */
  function open(key, now) {
    const live = (holds.get(key) ?? []).filter((hold) => hold.expiresAt > now && (hold.code === null || isOpen(hold.code)));
    if (live.length) holds.set(key, live);
    else holds.delete(key);
    return live;
  }

  return {
    open,
    /** Starts counting one more hold made by `browser`, or returns null when the key already has `limit` open. Set `.code` once known. */
    claim(key, now, expiresAt, browser) {
      const live = open(key, now);
      if (live.length >= limit) return null;
      const hold = { code: null, browser, expiresAt };
      holds.set(key, [...live, hold]);
      return hold;
    },
    /** Stops counting a hold whose checkout failed. */
    drop(key, hold) {
      const rest = (holds.get(key) ?? []).filter((entry) => entry !== hold);
      if (rest.length) holds.set(key, rest);
      else holds.delete(key);
    },
    sweep(now) {
      for (const key of [...holds.keys()]) open(key, now);
    },
  };
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
  let pollution = false;
  try {
    body = JSON.parse(raw.toString('utf8'), (key, value) => {
      if (PROTOTYPE_KEYS.has(key)) pollution = true;
      return value;
    });
  } catch {
    throw new ApiError(400, 'invalid', 'The request body is not valid JSON.');
  }
  if (pollution) throw new ApiError(400, 'invalid', 'The request body contains a reserved key.');
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
