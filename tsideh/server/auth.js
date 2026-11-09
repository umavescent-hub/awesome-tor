// Kitchen admin authentication: one shared password (ADMIN_PASSWORD), server-side sessions
// referenced by an HttpOnly, SameSite=Strict cookie. Only token hashes are stored.

import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

export const SESSION_COOKIE = 'tsideh_admin';
const SESSION_SECONDS = 12 * 60 * 60;
const KEY_LENGTH = 32;
const scryptAsync = promisify(scrypt);

const hash = (token) => createHash('sha256').update(token).digest('hex');

export function parseCookies(header) {
  const cookies = new Map();
  for (const part of String(header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (!cookies.has(name)) cookies.set(name, part.slice(separator + 1).trim());
  }
  return cookies;
}

export function sessionCookie(token, { secure }) {
  const attributes = [`${SESSION_COOKIE}=${token}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${SESSION_SECONDS}`];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearedSessionCookie({ secure }) {
  const attributes = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0'];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function createAdminAuth({ db, password }) {
  const enabled = Boolean(password);
  const salt = randomBytes(16);
  const expected = enabled ? scryptSync(password, salt, KEY_LENGTH) : null;
  const sql = {
    insert: db.prepare('INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)'),
    find: db.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash = ?'),
    remove: db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?'),
    prune: db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?'),
  };

  return {
    enabled,

    /** Both sides go through scrypt, so the comparison is constant-time and length-independent. */
    async verifyPassword(candidate) {
      if (!enabled || typeof candidate !== 'string' || candidate.length > 1024) return false;
      const derived = await scryptAsync(candidate, salt, KEY_LENGTH);
      return timingSafeEqual(derived, expected);
    },

    createSession(now) {
      const token = randomBytes(32).toString('base64url');
      sql.insert.run(hash(token), now, now + SESSION_SECONDS * 1000);
      return token;
    },

    isValid(token, now) {
      if (!token) return false;
      const row = sql.find.get(hash(token));
      return Boolean(row && row.expires_at > now);
    },

    destroy(token) {
      if (token) sql.remove.run(hash(token));
    },

    prune(now) {
      sql.prune.run(now);
    },
  };
}
