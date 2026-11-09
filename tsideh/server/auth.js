// Kitchen admin authentication: one shared password (ADMIN_PASSWORD), server-side sessions
// referenced by an HttpOnly, SameSite=Strict cookie. Only token hashes are stored. A session ends
// after 12 hours, or after 2 hours without a request, whichever comes first.

import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const SESSION_SECONDS = 12 * 60 * 60;
const IDLE_MS = 2 * 60 * 60 * 1000;
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

/**
 * The session cookie. In production it carries the __Host- prefix, so browsers only accept it
 * over HTTPS, for this exact host and for every path.
 */
export function sessionCookies({ production }) {
  const name = production ? '__Host-tsideh_admin' : 'tsideh_admin';
  const build = (value, maxAge, secure) => {
    const attributes = [`${name}=${value}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${maxAge}`];
    if (secure) attributes.push('Secure');
    return attributes.join('; ');
  };
  return {
    name,
    set: (token, { secure }) => build(token, SESSION_SECONDS, secure),
    clear: ({ secure }) => build('', 0, secure),
  };
}

export function createAdminAuth({ db, password }) {
  const enabled = Boolean(password);
  const salt = randomBytes(16);
  const expected = enabled ? scryptSync(password, salt, KEY_LENGTH) : null;
  const sql = {
    insert: db.prepare('INSERT INTO admin_sessions (token_hash, created_at, expires_at, last_seen_at) VALUES (:hash, :now, :expiresAt, :now)'),
    find: db.prepare('SELECT expires_at, last_seen_at FROM admin_sessions WHERE token_hash = ?'),
    touch: db.prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?'),
    remove: db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?'),
    prune: db.prepare('DELETE FROM admin_sessions WHERE expires_at <= :now OR last_seen_at <= :idleSince'),
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
      sql.insert.run({ hash: hash(token), now, expiresAt: now + SESSION_SECONDS * 1000 });
      return token;
    },

    /** A valid session counts as activity, which keeps it from going idle. */
    isValid(token, now) {
      if (!token) return false;
      const tokenHash = hash(token);
      const row = sql.find.get(tokenHash);
      if (!row || row.expires_at <= now || row.last_seen_at <= now - IDLE_MS) return false;
      sql.touch.run(now, tokenHash);
      return true;
    },

    destroy(token) {
      if (token) sql.remove.run(hash(token));
    },

    prune(now) {
      sql.prune.run({ now, idleSince: now - IDLE_MS });
    },
  };
}
