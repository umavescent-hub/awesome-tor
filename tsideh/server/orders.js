// Orders: the capacity-safe reservation, status transitions and the queries behind the order
// page, the kitchen board and the prep sheet.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { evaluateEvent } from './catalog.js';
import { transaction } from './db.js';
import { ApiError } from './http.js';

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_PATTERN = /^TS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const COMMITTED = ['paid', 'ready', 'picked_up'];
const PAYABLE = ['pending', 'expired', 'canceled', 'failed'];

const ACTIVE = `(status IN ('paid', 'ready', 'picked_up') OR (status = 'pending' AND expires_at > :now))`;
const COMMITTED_SQL = `status IN ('paid', 'ready', 'picked_up')`;
const EMPTY_HASH = Buffer.alloc(32);

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function newCode() {
  let code = 'TS-';
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

function toOrder(row, items) {
  return {
    code: row.code,
    status: row.status,
    oversold: row.oversold === 1,
    eventId: row.event_id,
    eventSnapshot: JSON.parse(row.event_json),
    slot: row.slot,
    pickupAt: row.pickup_at,
    customer: { name: row.customer_name, email: row.customer_email, phone: row.customer_phone },
    notes: row.notes,
    items,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    tipPercent: row.tip_percent,
    tipCents: row.tip_cents,
    totalCents: row.total_cents,
    stripeSessionId: row.stripe_session_id,
    stripePaymentIntent: row.stripe_payment_intent,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
  };
}

const toLine = (row) => ({
  id: row.item_id,
  name: row.name,
  qty: row.qty,
  unitCents: row.unit_cents,
  lineCents: row.unit_cents * row.qty,
});

export function createOrders({ db, catalog, overrides }) {
  const sql = {
    slotCounts: db.prepare(`
      SELECT slot, COUNT(*) AS n FROM orders
      WHERE event_id = :eventId AND code <> :exclude AND ${ACTIVE}
      GROUP BY slot`),
    itemQty: db.prepare(`
      SELECT item_id, SUM(qty) AS qty FROM order_items
      WHERE order_code IN (SELECT code FROM orders WHERE event_id = :eventId AND code <> :exclude AND ${ACTIVE})
      GROUP BY item_id`),
    codeExists: db.prepare('SELECT 1 FROM orders WHERE code = ?'),
    insertOrder: db.prepare(`
      INSERT INTO orders (
        code, view_token_hash, event_id, event_json, slot, pickup_at, status,
        customer_name, customer_email, customer_phone, notes,
        subtotal_cents, tax_cents, tip_percent, tip_cents, total_cents,
        created_at, expires_at, updated_at
      ) VALUES (
        :code, :tokenHash, :eventId, :eventJson, :slot, :pickupAt, 'pending',
        :name, :email, :phone, :notes,
        :subtotal, :tax, :tipPercent, :tip, :total,
        :now, :expiresAt, :now
      )`),
    insertItem: db.prepare('INSERT INTO order_items (order_code, item_id, name, unit_cents, qty) VALUES (?, ?, ?, ?, ?)'),
    byCode: db.prepare('SELECT * FROM orders WHERE code = ?'),
    byPaymentIntent: db.prepare('SELECT * FROM orders WHERE stripe_payment_intent = ?'),
    itemsOf: db.prepare('SELECT item_id, name, unit_cents, qty FROM order_items WHERE order_code = ? ORDER BY rowid'),
    attachSession: db.prepare('UPDATE orders SET stripe_session_id = ?, updated_at = ? WHERE code = ?'),
    setPaymentIntent: db.prepare(`
      UPDATE orders SET stripe_payment_intent = :paymentIntent, updated_at = :now
      WHERE code = :code AND stripe_payment_intent IS NULL`),
    markPaid: db.prepare(`
      UPDATE orders SET status = 'paid', paid_at = :now, oversold = :oversold, updated_at = :now,
        stripe_payment_intent = COALESCE(:paymentIntent, stripe_payment_intent)
      WHERE code = :code`),
    transition: db.prepare(`
      UPDATE orders SET status = :to, updated_at = :now
      WHERE code = :code AND status IN (SELECT value FROM json_each(:from))`),
    expireLapsed: db.prepare(`UPDATE orders SET status = 'expired', updated_at = :now WHERE status = 'pending' AND expires_at <= :now`),
    forEvent: db.prepare(`
      SELECT * FROM orders WHERE event_id = :eventId AND (:all = 1 OR ${ACTIVE})
      ORDER BY slot, created_at, code`),
    itemsForEvent: db.prepare(`
      SELECT order_code, item_id, name, unit_cents, qty FROM order_items
      WHERE order_code IN (SELECT code FROM orders WHERE event_id = ?) ORDER BY rowid`),
    statusCounts: db.prepare(`
      SELECT status, COUNT(*) AS n, SUM(total_cents) AS cents FROM orders
      WHERE event_id = :eventId AND ${ACTIVE} GROUP BY status`),
    prepItems: db.prepare(`
      SELECT oi.item_id,
        SUM(CASE WHEN o.${COMMITTED_SQL} THEN oi.qty ELSE 0 END) AS committed,
        SUM(CASE WHEN o.status = 'pending' AND o.expires_at > :now THEN oi.qty ELSE 0 END) AS pending
      FROM order_items oi JOIN orders o ON o.code = oi.order_code
      WHERE o.event_id = :eventId GROUP BY oi.item_id`),
    prepSlotItems: db.prepare(`
      SELECT o.slot, oi.item_id, SUM(oi.qty) AS qty
      FROM orders o JOIN order_items oi ON oi.order_code = o.code
      WHERE o.event_id = ? AND o.${COMMITTED_SQL} GROUP BY o.slot, oi.item_id`),
    prepSlotOrders: db.prepare(`SELECT slot, COUNT(*) AS n FROM orders WHERE event_id = ? AND ${COMMITTED_SQL} GROUP BY slot`),
  };

  function usage(eventId, now, exclude = '') {
    const params = { eventId, now, exclude };
    return {
      slotCounts: new Map(sql.slotCounts.all(params).map((row) => [row.slot, row.n])),
      itemQty: new Map(sql.itemQty.all(params).map((row) => [row.item_id, row.qty])),
    };
  }

  function read(code) {
    const row = sql.byCode.get(code);
    return row ? toOrder(row, sql.itemsOf.all(code).map(toLine)) : null;
  }

  /** Would committing this order (now) push its slot or any item past capacity? */
  function exceedsCapacity(order, now) {
    const event = catalog.events.get(order.eventId);
    if (!event) return false;
    const current = usage(event.id, now, order.code);
    if ((current.slotCounts.get(order.slot) ?? 0) + 1 > event.ordersPerSlot) return true;
    return order.items.some((line) => {
      const limit = event.limits.get(line.id);
      return limit !== undefined && (current.itemQty.get(line.id) ?? 0) + line.qty > limit;
    });
  }

  function transition(code, from, to, now) {
    return sql.transition.run({ code, from: JSON.stringify(from), to, now }).changes === 1;
  }

  /** Live status, slots and stock for an event. */
  function inspect(event, now) {
    return evaluateEvent(catalog, event, { now, usage: usage(event.id, now), overrides: overrides.forEvent(event.id) });
  }

  return {
    inspect,

    /**
     * Re-checks availability and inserts a pending hold in one BEGIN IMMEDIATE transaction, so two
     * customers can never take the last spot. Returns the new code and its one-time view token.
     */
    reserve({ event, slot, lines, customer, notes, tipPercent, totals, now, holdMs }) {
      return transaction(db, () => {
        const state = inspect(event, now);
        if (state.status === 'closed' || state.status === 'paused' || state.status === 'upcoming') {
          throw new ApiError(409, 'event_closed', 'Pre-orders for this pop-up are not open right now.');
        }
        if (!state.slots.find((candidate) => candidate.time === slot)?.available) {
          throw new ApiError(409, 'slot_unavailable', 'That pickup time just filled up. Please choose another.');
        }
        for (const line of lines) {
          const stock = state.items.get(line.id);
          if (stock.soldOut || (stock.remaining !== null && line.qty > stock.remaining)) {
            const remaining = stock.soldOut ? 0 : stock.remaining;
            throw new ApiError(409, 'sold_out',
              remaining === 0 ? `${line.name} just sold out.` : `Only ${remaining} left of ${line.name}.`,
              { details: { itemId: line.id, remaining } });
          }
        }

        let code;
        do code = newCode(); while (sql.codeExists.get(code));
        const viewToken = randomBytes(32).toString('base64url');
        const expiresAt = now + holdMs;
        sql.insertOrder.run({
          code,
          tokenHash: hashToken(viewToken),
          eventId: event.id,
          eventJson: JSON.stringify({
            id: event.id,
            title: event.title,
            date: event.date,
            start: event.start,
            end: event.end,
            locationName: event.locationName,
            address: event.address,
            mapUrl: event.mapUrl,
          }),
          slot,
          pickupAt: event.slotsByTime.get(slot).atMs,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          notes,
          subtotal: totals.subtotalCents,
          tax: totals.taxCents,
          tipPercent,
          tip: totals.tipCents,
          total: totals.totalCents,
          now,
          expiresAt,
        });
        for (const line of lines) sql.insertItem.run(code, line.id, line.name, line.unitCents, line.qty);
        return { code, viewToken, createdAt: now, expiresAt };
      });
    },

    find: read,

    /** Code + token lookup. The token hash is always compared, so a miss costs the same as a hit. */
    findWithToken(code, token) {
      const row = sql.byCode.get(code);
      const expected = row ? Buffer.from(row.view_token_hash, 'hex') : EMPTY_HASH;
      const matches = timingSafeEqual(Buffer.from(hashToken(token), 'hex'), expected);
      return row && matches ? read(code) : null;
    },

    findByPaymentIntent(paymentIntent) {
      const row = sql.byPaymentIntent.get(paymentIntent);
      return row ? read(row.code) : null;
    },

    attachSession(code, sessionId, now) {
      sql.attachSession.run(sessionId, now, code);
    },

    /**
     * Records a payment. Money taken is always recorded, even after the hold lapsed or the order was
     * canceled; if that pushes the slot or an item past capacity the order is flagged oversold.
     */
    markPaid(code, { paymentIntent = null } = {}, now) {
      return transaction(db, () => {
        const order = read(code);
        if (!order) return { order: null, changed: false };
        if (!PAYABLE.includes(order.status)) {
          if (paymentIntent) sql.setPaymentIntent.run({ code, paymentIntent, now });
          return { order: read(code), changed: false };
        }
        sql.markPaid.run({ code, now, paymentIntent, oversold: exceedsCapacity(order, now) ? 1 : 0 });
        return { order: read(code), changed: true };
      });
    },

    markFailed: (code, now) => transition(code, ['pending', 'expired'], 'failed', now),
    markExpired: (code, now) => transition(code, ['pending'], 'expired', now),
    cancel: (code, now) => transition(code, ['pending'], 'canceled', now),
    markRefunded: (code, now) => transition(code, COMMITTED, 'refunded', now),
    setKitchenStatus: (code, status, now) => transition(code, COMMITTED, status, now),

    /** Pending holds past their expiry become "expired" so every screen tells the truth. */
    expireLapsed(now) {
      return sql.expireLapsed.run({ now }).changes;
    },

    listForEvent(eventId, { all, now }) {
      const lines = new Map();
      for (const row of sql.itemsForEvent.all(eventId)) {
        if (!lines.has(row.order_code)) lines.set(row.order_code, []);
        lines.get(row.order_code).push(toLine(row));
      }
      return sql.forEvent.all({ eventId, all: all ? 1 : 0, now }).map((row) => toOrder(row, lines.get(row.code) ?? []));
    },

    /** Active order counts by status plus committed revenue. */
    stats(eventId, now) {
      const counts = { active: 0, paid: 0, ready: 0, pickedUp: 0, pending: 0 };
      let revenueCents = 0;
      for (const row of sql.statusCounts.all({ eventId, now })) {
        counts.active += row.n;
        counts[row.status === 'picked_up' ? 'pickedUp' : row.status] = row.n;
        if (COMMITTED.includes(row.status)) revenueCents += row.cents;
      }
      return { counts, revenueCents };
    },

    /** Raw prep numbers: per-item committed/pending qty and committed qty by slot. */
    prep(eventId, now) {
      const slotItems = new Map();
      for (const row of sql.prepSlotItems.all(eventId)) {
        if (!slotItems.has(row.slot)) slotItems.set(row.slot, {});
        slotItems.get(row.slot)[row.item_id] = row.qty;
      }
      return {
        items: new Map(sql.prepItems.all({ eventId, now }).map((row) => [row.item_id, { committed: row.committed, pending: row.pending }])),
        slotOrders: new Map(sql.prepSlotOrders.all(eventId).map((row) => [row.slot, row.n])),
        slotItems,
      };
    },
  };
}
