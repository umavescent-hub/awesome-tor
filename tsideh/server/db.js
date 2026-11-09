// SQLite persistence (node:sqlite). One file in DATA_DIR, WAL mode, schema versioned with
// PRAGMA user_version. All timestamps are UTC epoch milliseconds.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const ORDER_STATUSES = ['pending', 'paid', 'ready', 'picked_up', 'canceled', 'expired', 'failed', 'refunded'];
export const CATERING_STATUSES = ['new', 'contacted', 'booked', 'declined'];

const list = (values) => values.map((value) => `'${value}'`).join(', ');

const MIGRATIONS = [
  `
  CREATE TABLE orders (
    code                  TEXT PRIMARY KEY,
    view_token_hash       TEXT NOT NULL,
    event_id              TEXT NOT NULL,
    event_json            TEXT NOT NULL,
    slot                  TEXT NOT NULL,
    pickup_at             INTEGER NOT NULL,
    status                TEXT NOT NULL CHECK (status IN (${list(ORDER_STATUSES)})),
    oversold              INTEGER NOT NULL DEFAULT 0,
    customer_name         TEXT NOT NULL,
    customer_email        TEXT NOT NULL,
    customer_phone        TEXT NOT NULL,
    notes                 TEXT NOT NULL DEFAULT '',
    subtotal_cents        INTEGER NOT NULL,
    tax_cents             INTEGER NOT NULL,
    tip_percent           INTEGER NOT NULL,
    tip_cents             INTEGER NOT NULL,
    total_cents           INTEGER NOT NULL,
    stripe_session_id     TEXT UNIQUE,
    stripe_payment_intent TEXT,
    created_at            INTEGER NOT NULL,
    expires_at            INTEGER NOT NULL,
    paid_at               INTEGER,
    updated_at            INTEGER NOT NULL
  );
  CREATE INDEX orders_by_event_slot ON orders (event_id, slot, status);
  CREATE INDEX orders_by_payment_intent ON orders (stripe_payment_intent);

  CREATE TABLE order_items (
    order_code TEXT NOT NULL REFERENCES orders (code) ON DELETE CASCADE,
    item_id    TEXT NOT NULL,
    name       TEXT NOT NULL,
    unit_cents INTEGER NOT NULL,
    qty        INTEGER NOT NULL CHECK (qty > 0),
    PRIMARY KEY (order_code, item_id)
  );

  CREATE TABLE catering_inquiries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    status        TEXT NOT NULL CHECK (status IN (${list(CATERING_STATUSES)})),
    name          TEXT NOT NULL,
    email         TEXT NOT NULL,
    phone         TEXT NOT NULL,
    event_date    TEXT NOT NULL,
    guest_count   INTEGER NOT NULL,
    location      TEXT NOT NULL,
    service_style TEXT NOT NULL,
    budget        TEXT NOT NULL,
    dietary       TEXT NOT NULL,
    message       TEXT NOT NULL
  );

  CREATE TABLE event_overrides (
    event_id   TEXT PRIMARY KEY,
    paused     INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE sold_out_items (
    event_id   TEXT NOT NULL,
    item_id    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (event_id, item_id)
  );

  CREATE TABLE admin_sessions (
    token_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE webhook_events (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    received_at INTEGER NOT NULL
  );
  `,
];

/**
 * Runs `fn` inside BEGIN IMMEDIATE ... COMMIT (or joins the transaction already open).
 * `fn` must be synchronous: an await inside would let other requests interleave.
 */
export function transaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    if (typeof result?.then === 'function') throw new TypeError('transaction() callbacks must be synchronous');
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function migrate(db) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version > MIGRATIONS.length) {
    throw new Error(`The database was created by a newer version of Tsideh (schema ${version}). Update the app before starting it.`);
  }
  for (let next = version; next < MIGRATIONS.length; next++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[next]);
      db.exec(`PRAGMA user_version = ${next + 1}`);
    });
  }
}

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'tsideh.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  migrate(db);
  return db;
}
