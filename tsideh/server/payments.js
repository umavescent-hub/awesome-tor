// Payment orchestration: hold -> Stripe Checkout (or demo) -> paid, plus the webhook, the
// confirm-on-return check and cancellation. Card data never reaches this server.

import { transaction } from './db.js';
import { ApiError } from './http.js';
import { COMMITTED } from './orders.js';
import { SignatureError, StripeError, verifyWebhook } from './stripe.js';
import { timeLabel } from './time.js';
import { isPlainObject } from './validate.js';

// Stripe requires a Checkout Session to live at least 30 minutes by its own clock. The session
// outlives the hold by this margin; a payment landing inside it is still recorded (and flagged
// oversold if the spot was taken meanwhile).
const STRIPE_EXPIRY_MARGIN_SECONDS = 120;
const WEBHOOK_RETENTION_MS = 30 * 86_400_000;
const TIP_LABEL = 'Tip for the crew';

const idOf = (value) => (typeof value === 'string' ? value : isPlainObject(value) && typeof value.id === 'string' ? value.id : null);
const describe = (error) => [error.message, error.status && `status ${error.status}`, error.type, error.code].filter(Boolean).join(' · ');

const alreadyPaid = () => new ApiError(409, 'already_paid', 'This order is already paid. Contact us if you need to change it.');

export function createPayments({ config, catalog, db, orders, stripe, notifier, log, clock }) {
  const site = catalog.site;
  const sql = {
    seen: db.prepare('SELECT 1 FROM webhook_events WHERE id = ?'),
    record: db.prepare('INSERT INTO webhook_events (id, type, received_at) VALUES (?, ?, ?)'),
    prune: db.prepare('DELETE FROM webhook_events WHERE received_at <= ?'),
  };

  function announcePaid(order) {
    const title = catalog.events.get(order.eventId)?.title ?? order.eventSnapshot.title;
    notifier.paidOrder(order, title, timeLabel(order.slot));
  }

  function checkoutSessionParams({ event, slot, lines, customer, totals }, hold) {
    const lineItem = (name, unitAmount, quantity) => ({
      price_data: { currency: site.currency, unit_amount: unitAmount, product_data: { name } },
      quantity,
    });
    const metadata = { order_code: hold.code, event_id: event.id, slot };
    return {
      mode: 'payment',
      line_items: [
        ...lines.map((line) => lineItem(line.name, line.unitCents, line.qty)),
        ...(totals.taxCents > 0 ? [lineItem(site.taxLabel, totals.taxCents, 1)] : []),
        ...(totals.tipCents > 0 ? [lineItem(TIP_LABEL, totals.tipCents, 1)] : []),
      ],
      customer_email: customer.email,
      client_reference_id: hold.code,
      metadata,
      payment_intent_data: { metadata, description: `Tsideh pickup ${hold.code}` },
      expires_at: Math.ceil(hold.expiresAt / 1000) + STRIPE_EXPIRY_MARGIN_SECONDS,
      success_url: `${config.publicUrl}/order/${hold.code}?k=${hold.viewToken}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.publicUrl}/e/${event.id}?canceled=${hold.code}&k=${hold.viewToken}`,
    };
  }

  /** The order a Checkout Session belongs to, only if both sides agree on it. */
  function orderForSession(session) {
    const code = session.client_reference_id;
    if (typeof code !== 'string') return null;
    const order = orders.find(code);
    return order && order.stripeSessionId === session.id ? order : null;
  }

  function paySession(session, now) {
    const order = orderForSession(session);
    if (!order) return [];
    const { order: paid, changed } = orders.markPaid(order.code, { paymentIntent: idOf(session.payment_intent) }, now);
    return changed ? [paid] : [];
  }

  /** Applies one verified event. Returns orders that just became paid. */
  function applyEvent(event, now) {
    const object = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
        return object.payment_status === 'paid' ? paySession(object, now) : [];
      case 'checkout.session.async_payment_succeeded':
        return paySession(object, now);
      case 'checkout.session.async_payment_failed': {
        const order = orderForSession(object);
        if (order) orders.markFailed(order.code, now);
        return [];
      }
      case 'checkout.session.expired': {
        const order = orderForSession(object);
        if (order) orders.markExpired(order.code, now);
        return [];
      }
      case 'charge.refunded': {
        const paymentIntent = idOf(object.payment_intent);
        const order = object.refunded === true && paymentIntent ? orders.findByPaymentIntent(paymentIntent) : null;
        if (order) orders.markRefunded(order.code, now);
        return [];
      }
      default:
        return [];
    }
  }

  return {
    mode: config.paymentsMode,

    ensureAvailable() {
      if (config.paymentsMode === 'disabled') {
        throw new ApiError(503, 'payments_unavailable', 'Online payments are not available right now. Please try again later.');
      }
    },

    /** Reserves the order, then opens a payment session for it. */
    async checkout(input) {
      const hold = orders.reserve({ ...input, now: clock.now(), holdMs: site.order.holdMinutes * 60_000 });
      const result = { code: hold.code, viewToken: hold.viewToken, totals: input.totals };
      if (config.paymentsMode === 'demo') return { ...result, url: `/pay/demo/${hold.code}?k=${hold.viewToken}` };

      let session;
      try {
        session = await stripe.createCheckoutSession(checkoutSessionParams(input, hold), `${hold.code}-${hold.createdAt}`);
        if (typeof session.id !== 'string' || typeof session.url !== 'string') throw new StripeError('Checkout Session response is missing id or url');
      } catch (error) {
        orders.markFailed(hold.code, clock.now());
        log.error(`stripe: checkout session for ${hold.code} failed: ${describe(error)}`);
        throw new ApiError(502, 'payment_provider_error', 'We could not reach our payment provider. Please try again in a moment.');
      }
      orders.attachSession(hold.code, session.id, clock.now());
      return { ...result, url: session.url };
    },

    /**
     * Customer is back from Stripe with ?session_id=... but the webhook has not landed yet:
     * ask Stripe directly and record the payment if it went through.
     */
    async confirmReturn(order, sessionId) {
      if (config.paymentsMode !== 'stripe' || !sessionId || sessionId !== order.stripeSessionId) return order;
      if (order.status !== 'pending' && order.status !== 'expired') return order;
      let session;
      try {
        session = await stripe.retrieveCheckoutSession(sessionId);
      } catch (error) {
        if (!(error instanceof StripeError)) throw error;
        log.warn(`stripe: could not confirm ${order.code}: ${describe(error)}`);
        return order;
      }
      if (session.client_reference_id !== order.code || session.payment_status !== 'paid') return order;
      const { order: paid, changed } = orders.markPaid(order.code, { paymentIntent: idOf(session.payment_intent) }, clock.now());
      if (changed) announcePaid(paid);
      return paid;
    },

    handleWebhook(rawBody, signatureHeader) {
      if (!config.stripeWebhookSecret) throw new ApiError(503, 'webhooks_unavailable', 'Stripe webhooks are not configured.');
      const now = clock.now();
      let event;
      try {
        event = verifyWebhook(rawBody, signatureHeader, config.stripeWebhookSecret, Math.floor(now / 1000));
      } catch (error) {
        if (!(error instanceof SignatureError)) throw error;
        log.warn(`stripe: webhook rejected (${error.message})`);
        throw new ApiError(400, 'bad_signature', 'Invalid Stripe signature.');
      }
      if (!isPlainObject(event) || typeof event.id !== 'string' || typeof event.type !== 'string' || !isPlainObject(event.data?.object)) {
        throw new ApiError(400, 'invalid', 'Malformed Stripe event.');
      }
      const paid = transaction(db, () => {
        if (sql.seen.get(event.id)) return [];
        const newlyPaid = applyEvent(event, now);
        sql.record.run(event.id, event.type, now);
        return newlyPaid;
      });
      paid.forEach(announcePaid);
    },

    async cancel(order) {
      if (COMMITTED.includes(order.status)) throw alreadyPaid();
      if (order.status !== 'pending') return { ok: true, status: order.status };
      if (config.paymentsMode === 'stripe' && order.stripeSessionId) {
        try {
          await stripe.expireCheckoutSession(order.stripeSessionId);
        } catch (error) {
          if (!(error instanceof StripeError)) throw error;
          log.warn(`stripe: could not expire session for ${order.code}: ${describe(error)}`);
        }
      }
      if (orders.cancel(order.code, clock.now())) return { ok: true };
      const current = orders.find(order.code);
      if (COMMITTED.includes(current.status)) throw alreadyPaid();
      return { ok: true, status: current.status };
    },

    /** Demo mode only (the route exists only then): stands in for a completed Stripe payment. */
    demoPay(order) {
      if (COMMITTED.includes(order.status)) return { ok: true };
      if (order.status !== 'pending') {
        throw new ApiError(409, 'order_closed', 'This order can no longer be paid. Please start a new one.');
      }
      const { order: paid, changed } = orders.markPaid(order.code, {}, clock.now());
      if (changed) announcePaid(paid);
      return { ok: true };
    },

    prune(now) {
      sql.prune.run(now - WEBHOOK_RETENTION_MS);
    },
  };
}
