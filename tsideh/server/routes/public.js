// Customer-facing API: site info, events and menus, checkout, order status, catering, and the
// Stripe webhook.

import { eventSummary, isListed, menuView } from '../catalog.js';
import { invalid, notFound, sendJson } from '../http.js';
import { CODE_PATTERN, TOKEN_PATTERN } from '../orders.js';
import { computeTotals, priceCart, tipPercentFrom } from '../pricing.js';
import { readBody, readJson, WEBHOOK_LIMIT_BYTES } from '../security.js';
import { addDays, localDate, timeLabel, toIso } from '../time.js';
import * as validate from '../validate.js';

const EVENT_ID = /^[a-z0-9-]{1,64}$/;
const SESSION_ID = /^cs_[A-Za-z0-9_]{1,250}$/;
const CATERING_HORIZON_DAYS = 730;

export function publicRoutes({ catalog, orders, payments, catering, notifier, clock }) {
  const site = catalog.site;

  const siteView = {
    name: site.name,
    tagline: site.tagline ?? '',
    heroHeadline: site.heroHeadline ?? '',
    description: site.description ?? '',
    timezone: site.timezone,
    currency: site.currency,
    taxRatePercent: site.taxRatePercent,
    taxLabel: site.taxLabel,
    tipPresetsPercent: site.tipPresetsPercent,
    contact: { email: site.contact.email ?? '', phone: site.contact.phone ?? '', instagram: site.contact.instagram ?? '' },
    press: (site.press ?? []).map(({ name, kind, url, quote }) => ({ name, kind, url: url ?? '', quote: quote ?? '' })),
    catering: {
      blurb: site.catering.blurb ?? '',
      minGuests: site.catering.minGuests,
      maxGuests: site.catering.maxGuests,
      leadTimeDays: site.catering.leadTimeDays,
      serviceStyles: site.catering.serviceStyles,
    },
    order: { maxQtyPerItem: site.order.maxQtyPerItem, maxItemsPerOrder: site.order.maxItemsPerOrder },
    payments: { mode: payments.mode },
  };

  function listedEvent(id, now) {
    const event = typeof id === 'string' && EVENT_ID.test(id) ? catalog.events.get(id) : undefined;
    if (!event || !isListed(event, now)) throw notFound('That pop-up is not on the calendar.');
    return event;
  }

  /** Code + view token lookup. A hold that has run out is marked expired on the way. */
  function orderFor(code, token, now) {
    const normalized = typeof code === 'string' ? code.toUpperCase() : '';
    if (!CODE_PATTERN.test(normalized) || typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw notFound('Order not found.');
    const order = orders.findWithToken(normalized, token);
    if (!order) throw notFound('Order not found.');
    if (order.status === 'pending' && order.expiresAt <= now) {
      orders.markExpired(order.code, now);
      return orders.find(order.code);
    }
    return order;
  }

  function orderView(order) {
    const live = catalog.events.get(order.eventId);
    const event = live ?? order.eventSnapshot;
    return {
      order: {
        code: order.code,
        status: order.status,
        event: {
          id: event.id,
          title: event.title,
          date: event.date,
          start: event.start,
          end: event.end,
          locationName: event.locationName,
          address: event.address,
          mapUrl: event.mapUrl,
        },
        slot: order.slot,
        slotLabel: timeLabel(order.slot),
        pickupAt: toIso(live?.slotsByTime.get(order.slot)?.atMs ?? order.pickupAt),
        items: order.items.map(({ id, name, qty, unitCents, lineCents }) => ({ id, name, qty, unitCents, lineCents })),
        subtotalCents: order.subtotalCents,
        taxCents: order.taxCents,
        tipCents: order.tipCents,
        totalCents: order.totalCents,
        firstName: order.customer.name.split(' ')[0],
        createdAt: toIso(order.createdAt),
        paidAt: toIso(order.paidAt),
      },
    };
  }

  function cateringDate(value, now) {
    const date = validate.date(value, 'eventDate');
    const today = localDate(now, catalog.timeZone);
    if (date < today) throw invalid('eventDate', 'Choose a date from today onward.');
    if (date > addDays(today, CATERING_HORIZON_DAYS)) throw invalid('eventDate', 'Choose a date within the next two years.');
    return date;
  }

  const routes = [
    {
      method: 'GET',
      path: '/api/site',
      handler: (req, res) => sendJson(res, 200, siteView),
    },
    {
      method: 'GET',
      path: '/api/events',
      handler: (req, res) => {
        const now = clock.now();
        const events = catalog.eventList
          .filter((event) => isListed(event, now))
          .map((event) => eventSummary(event, orders.inspect(event, now).status));
        sendJson(res, 200, { events });
      },
    },
    {
      method: 'GET',
      path: '/api/events/:id',
      handler: (req, res, { params }) => {
        const now = clock.now();
        const event = listedEvent(params.id, now);
        const state = orders.inspect(event, now);
        sendJson(res, 200, {
          event: eventSummary(event, state.status),
          menu: menuView(catalog, event, state.items),
          slots: state.slots,
        });
      },
    },
    {
      method: 'POST',
      path: '/api/checkout',
      limit: 'checkout',
      handler: async (req, res) => {
        payments.ensureAvailable();
        const body = await readJson(req);
        if (typeof body.eventId !== 'string' || body.eventId === '') throw invalid('eventId', 'Choose a pop-up.');
        const event = listedEvent(body.eventId, clock.now());
        if (typeof body.slot !== 'string' || !event.slotsByTime.has(body.slot)) throw invalid('slot', 'Choose a pickup time.');
        const lines = priceCart(event, body.items, site.order);
        const customer = validate.customer(body.customer);
        const notes = validate.text(body.notes, { field: 'notes', label: 'your notes', max: 300, multiline: true });
        const tipPercent = tipPercentFrom(body.tipPercent, site.tipPresetsPercent);
        const totals = computeTotals(lines, { taxRatePercent: site.taxRatePercent, tipPercent });
        const result = await payments.checkout({ event, slot: body.slot, lines, customer, notes, tipPercent, totals });
        sendJson(res, 200, { code: result.code, viewToken: result.viewToken, url: result.url, totals: result.totals });
      },
    },
    {
      method: 'GET',
      path: '/api/orders/:code',
      limit: 'lookup',
      handler: async (req, res, { params, query }) => {
        let order = orderFor(params.code, query.get('k'), clock.now());
        const sessionId = query.get('session_id');
        if (sessionId && SESSION_ID.test(sessionId)) order = await payments.confirmReturn(order, sessionId);
        sendJson(res, 200, orderView(order));
      },
    },
    {
      method: 'POST',
      path: '/api/orders/:code/cancel',
      handler: async (req, res, { params }) => {
        const body = await readJson(req);
        const order = orderFor(params.code, body.k, clock.now());
        sendJson(res, 200, await payments.cancel(order));
      },
    },
    {
      method: 'POST',
      path: '/api/catering',
      limit: 'catering',
      handler: async (req, res) => {
        const body = await readJson(req);
        if (body.website) {
          sendJson(res, 201, { ok: true });
          return;
        }
        const now = clock.now();
        const { minGuests, maxGuests, serviceStyles } = site.catering;
        const inquiry = {
          name: validate.text(body.name, { field: 'name', label: 'your name', min: 1, max: 80 }),
          email: validate.email(body.email, 'email'),
          phone: validate.phone(body.phone, 'phone', { required: false }),
          eventDate: cateringDate(body.eventDate, now),
          guestCount: validate.integer(body.guestCount, 'guestCount', {
            min: minGuests,
            max: maxGuests,
            message: `We cater for ${minGuests} to ${maxGuests} guests.`,
          }),
          location: validate.text(body.location, { field: 'location', label: 'the location', min: 1, max: 120 }),
          serviceStyle: validate.oneOf(body.serviceStyle, 'serviceStyle', serviceStyles, 'Choose a service style.'),
          budget: validate.text(body.budget, { field: 'budget', label: 'your budget', max: 60 }),
          dietary: validate.text(body.dietary, { field: 'dietary', label: 'dietary needs', max: 300, multiline: true }),
          message: validate.text(body.message, { field: 'message', label: 'your message', max: 1500, multiline: true }),
        };
        catering.create(inquiry, now);
        notifier.cateringInquiry(inquiry);
        sendJson(res, 201, { ok: true });
      },
    },
    {
      method: 'POST',
      path: '/api/stripe/webhook',
      handler: async (req, res) => {
        const raw = await readBody(req, WEBHOOK_LIMIT_BYTES);
        payments.handleWebhook(raw, req.headers['stripe-signature']);
        sendJson(res, 200, { received: true });
      },
    },
  ];

  if (payments.mode === 'demo') {
    routes.push({
      method: 'POST',
      path: '/api/demo/pay/:code',
      handler: async (req, res, { params }) => {
        const body = await readJson(req);
        sendJson(res, 200, payments.demoPay(orderFor(params.code, body.k, clock.now())));
      },
    });
  }

  return routes;
}
