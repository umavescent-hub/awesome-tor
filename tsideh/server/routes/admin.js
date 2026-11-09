// Kitchen admin API. Every route needs a valid session cookie except login/logout/session; every
// mutation also needs the X-Tsideh-Admin header and a same-site Origin (CSRF defense in depth on
// top of the SameSite=Strict cookie).

import { setTimeout as sleep } from 'node:timers/promises';
import { parseCookies, sessionCookies } from '../auth.js';
import { eventSummary, isRecent } from '../catalog.js';
import { CATERING_STATUSES } from '../db.js';
import { ApiError, notFound, sendJson } from '../http.js';
import { CODE_PATTERN, COMMITTED } from '../orders.js';
import { originAllowed, readJson } from '../security.js';
import { timeLabel, toIso } from '../time.js';
import * as validate from '../validate.js';

const FAILED_LOGIN_DELAY_MS = 250;

const forbidden = () => new ApiError(403, 'forbidden', 'This request was blocked. Reload the admin and try again.');

export function adminRoutes({ config, catalog, orders, catering, auth, clock }) {
  const cookies = sessionCookies({ production: config.production });
  const tokenOf = (req) => parseCookies(req.headers.cookie).get(cookies.name);
  const secureCookie = (client) => client.https || config.production;
  const sameOrigin = (req, client) => originAllowed(req, { publicUrl: config.publicUrl, https: client.https });

  function session(handler) {
    return (req, res, context) => {
      if (!auth.isValid(tokenOf(req), clock.now())) throw new ApiError(401, 'unauthorized', 'Please sign in.');
      return handler(req, res, context);
    };
  }

  function mutation(handler) {
    return session((req, res, context) => {
      if (req.headers['x-tsideh-admin'] !== '1' || !sameOrigin(req, context.client)) throw forbidden();
      return handler(req, res, context);
    });
  }

  function eventFor(id) {
    const event = catalog.events.get(id);
    if (!event) throw notFound('No event with that id.');
    return event;
  }

  function ordersFor(event, query) {
    const now = clock.now();
    orders.expireLapsed(now);
    return orders.listForEvent(event.id, { all: query.get('all') === '1', now });
  }

  return [
    {
      method: 'POST',
      path: '/api/admin/login',
      limit: 'login',
      handler: async (req, res, { client }) => {
        if (!sameOrigin(req, client)) throw forbidden();
        const body = await readJson(req);
        if (!(await auth.verifyPassword(body.password))) {
          await sleep(FAILED_LOGIN_DELAY_MS);
          throw new ApiError(401, 'bad_credentials', 'That password is not right.');
        }
        auth.destroy(tokenOf(req));
        const token = auth.createSession(clock.now());
        sendJson(res, 200, { authenticated: true }, { 'Set-Cookie': cookies.set(token, { secure: secureCookie(client) }) });
      },
    },
    {
      method: 'POST',
      path: '/api/admin/logout',
      handler: (req, res, { client }) => {
        if (!sameOrigin(req, client)) throw forbidden();
        auth.destroy(tokenOf(req));
        sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookies.clear({ secure: secureCookie(client) }) });
      },
    },
    {
      method: 'GET',
      path: '/api/admin/session',
      handler: (req, res) => sendJson(res, 200, { authenticated: auth.isValid(tokenOf(req), clock.now()) }),
    },
    {
      method: 'GET',
      path: '/api/admin/events',
      handler: session((req, res) => {
        const now = clock.now();
        const events = catalog.eventList.filter((event) => isRecent(event, now)).map((event) => ({
          ...eventSummary(event, orders.inspect(event, now).status),
          configStatus: event.configStatus,
          ...orders.stats(event.id, now),
        }));
        sendJson(res, 200, { events });
      }),
    },
    {
      method: 'GET',
      path: '/api/admin/events/:id/orders',
      handler: session((req, res, { params, query }) => {
        const list = ordersFor(eventFor(params.id), query).map((order) => ({
          code: order.code,
          status: order.status,
          oversold: order.oversold,
          slot: order.slot,
          slotLabel: timeLabel(order.slot),
          customer: order.customer,
          items: order.items.map(({ id, name, qty }) => ({ id, name, qty })),
          notes: order.notes,
          totalCents: order.totalCents,
          createdAt: toIso(order.createdAt),
          paidAt: toIso(order.paidAt),
        }));
        sendJson(res, 200, { orders: list });
      }),
    },
    {
      method: 'GET',
      path: '/api/admin/events/:id/prep',
      handler: session((req, res, { params }) => {
        const event = eventFor(params.id);
        const now = clock.now();
        const state = orders.inspect(event, now);
        const prep = orders.prep(event.id, now);
        const items = catalog.categories
          .flatMap((category) => event.menuItems.filter((item) => item.category === category.id))
          .map((item) => {
            const totals = prep.get(item.id) ?? { committed: 0, pending: 0 };
            const stock = state.items.get(item.id);
            return {
              id: item.id,
              name: item.name,
              category: item.categoryName,
              committed: totals.committed,
              pending: totals.pending,
              limit: stock.limit,
              remaining: stock.remaining,
              soldOut: stock.soldOut,
            };
          });
        sendJson(res, 200, { items });
      }),
    },
    {
      method: 'POST',
      path: '/api/admin/orders/:code/status',
      handler: mutation(async (req, res, { params }) => {
        const body = await readJson(req);
        const status = validate.oneOf(body.status, 'status', COMMITTED, 'Status must be paid, ready or picked_up.');
        const code = params.code.toUpperCase();
        const order = CODE_PATTERN.test(code) ? orders.find(code) : null;
        if (!order) throw notFound('No order with that code.');
        if (!orders.setKitchenStatus(code, status, clock.now())) {
          throw new ApiError(409, 'invalid_transition', `Order ${code} is ${order.status.replace('_', ' ')} and cannot be changed here.`);
        }
        sendJson(res, 200, { ok: true });
      }),
    },
    {
      method: 'GET',
      path: '/api/admin/catering',
      handler: session((req, res) => sendJson(res, 200, { inquiries: catering.list() })),
    },
    {
      method: 'POST',
      path: '/api/admin/catering/:id/status',
      handler: mutation(async (req, res, { params }) => {
        const body = await readJson(req);
        const status = validate.oneOf(body.status, 'status', CATERING_STATUSES, 'Status must be new, contacted, booked or declined.');
        if (!/^\d{1,12}$/.test(params.id) || !catering.setStatus(Number(params.id), status, clock.now())) {
          throw notFound('No inquiry with that id.');
        }
        sendJson(res, 200, { ok: true });
      }),
    },
  ];
}
