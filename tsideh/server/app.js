// Composition root: config -> catalog -> database -> services -> HTTP handler.

import http from 'node:http';
import path from 'node:path';
import { createAdminAuth } from './auth.js';
import { buildCatalog } from './catalog.js';
import { createCatering } from './catering.js';
import { loadContent, readEnv, ROOT } from './config.js';
import { openDatabase } from './db.js';
import { ApiError, createRouter, sendError } from './http.js';
import { createNotifier } from './notify.js';
import { createOrders } from './orders.js';
import { createPayments } from './payments.js';
import { adminRoutes } from './routes/admin.js';
import { publicRoutes } from './routes/public.js';
import { clientInfo, createHoldLimiter, createRateLimiter, HSTS, rateKey, securityHeaders } from './security.js';
import { createStaticHandler } from './static.js';
import { createStripeClient } from './stripe.js';
import { fixedClock, systemClock } from './time.js';

const RATE_LIMITS = {
  checkout: { limit: 10, windowMs: 60_000 },
  catering: { limit: 5, windowMs: 10 * 60_000 },
  login: { limit: 5, windowMs: 60_000 },
  lookup: { limit: 60, windowMs: 60_000 },
  api: { limit: 120, windowMs: 60_000 },
};
// Unpaid holds one client may keep open at once (a customer normally has one).
const OPEN_HOLDS_PER_CLIENT = 2;
const HOUSEKEEPING_MS = 60_000;
const NO_INDEX = /^\/(?:api\/)?admin(?:\/|$)/;

const consoleLog = { info: console.log, warn: console.warn, error: console.error };

/**
 * Builds the whole application without listening. Options exist for tests and previews:
 * a controllable clock, alternative config/public directories, a fetch for Stripe and alerts.
 */
function createApp({
  env = process.env,
  configDir = path.join(ROOT, 'config'),
  publicDir = path.join(ROOT, 'public'),
  clock,
  fetch = globalThis.fetch,
  log = consoleLog,
} = {}) {
  const { config, warnings } = readEnv(env);
  const catalog = buildCatalog(loadContent(configDir));
  const appClock = clock ?? (config.now === null ? systemClock() : fixedClock(config.now));
  const db = openDatabase(config.dataDir);

  const orders = createOrders({ db, catalog });
  const catering = createCatering(db);
  const auth = createAdminAuth({ db, password: config.adminPassword });
  const notifier = createNotifier({ url: config.notifyWebhookUrl, log, fetch });
  const stripe = config.stripeSecretKey
    ? createStripeClient({ secretKey: config.stripeSecretKey, apiBase: config.stripeApiBase, fetch })
    : null;
  const payments = createPayments({ config, catalog, db, orders, stripe, notifier, log, clock: appClock });

  const holds = createHoldLimiter({ limit: OPEN_HOLDS_PER_CLIENT, isOpen: (code) => orders.find(code)?.status === 'pending' });

  const context = { config, catalog, clock: appClock, orders, catering, auth, payments, notifier, holds };
  const router = createRouter([...publicRoutes(context), ...adminRoutes(context)]);
  const limiters = Object.fromEntries(Object.entries(RATE_LIMITS).map(([name, rule]) => [name, createRateLimiter(rule)]));
  const serveStatic = createStaticHandler(publicDir);
  const baseHeaders = securityHeaders({ production: config.production });

  async function handleApi(req, res, url, client) {
    res.setHeader('Cache-Control', 'no-store');
    const match = router.match(req.method === 'HEAD' ? 'GET' : req.method, url.pathname);
    const wait = limiters[match?.route?.limit ?? 'api'].take(rateKey(client.ip), appClock.now());
    if (wait) {
      throw new ApiError(429, 'rate_limited', 'Too many requests. Please wait a moment and try again.', { headers: { 'Retry-After': String(wait) } });
    }
    if (url.pathname.startsWith('/api/admin/') && !auth.enabled) {
      throw new ApiError(503, 'admin_disabled', 'The kitchen admin is switched off. Set ADMIN_PASSWORD (12+ characters) to turn it on.');
    }
    if (!match) throw new ApiError(404, 'not_found', 'Not found.');
    if (!match.route) throw new ApiError(405, 'method_not_allowed', 'Method not allowed.', { headers: { Allow: match.allowed.join(', ') } });
    await match.route.handler(req, res, { params: match.params, query: url.searchParams, client });
  }

  async function handle(req, res) {
    const started = performance.now();
    let pathname = '-';
    let api = false;
    res.on('close', () => log.info(`${req.method} ${pathname} ${res.statusCode} ${Math.round(performance.now() - started)}ms`));
    try {
      for (const [name, value] of Object.entries(baseHeaders)) res.setHeader(name, value);
      if (!req.url.startsWith('/')) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad request');
        return;
      }
      const url = new URL(`http://localhost${req.url}`);
      pathname = url.pathname;

      const client = clientInfo(req, config.trustProxy);
      if (config.production && client.https) res.setHeader('Strict-Transport-Security', HSTS);
      if (config.production && client.forwardedProto === 'http') {
        res.writeHead(301, { Location: `${config.publicUrl}${req.url}` });
        res.end();
        return;
      }

      api = pathname === '/api' || pathname.startsWith('/api/');
      if (NO_INDEX.test(pathname)) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      if (api) await handleApi(req, res, url, client);
      else await serveStatic(req, res, pathname);
    } catch (error) {
      if (!(error instanceof ApiError)) log.error(`${req.method} ${pathname} failed: ${error.stack ?? error}`);
      if (res.headersSent) {
        res.destroy();
      } else if (api) {
        sendError(res, error instanceof ApiError ? error : new ApiError(500, 'internal', 'Something went wrong on our side. Please try again.'));
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('Something went wrong on our side. Please try again.');
      }
    }
  }

  function housekeeping() {
    const now = appClock.now();
    try {
      orders.expireLapsed(now);
      auth.prune(now);
      payments.prune(now);
      holds.sweep(now);
      for (const limiter of Object.values(limiters)) limiter.sweep(now);
    } catch (error) {
      log.error(`housekeeping failed: ${error.stack ?? error}`);
    }
  }
  const timer = setInterval(housekeeping, HOUSEKEEPING_MS);
  timer.unref();

  return {
    config,
    warnings,
    handle,
    close() {
      clearInterval(timer);
      db.close();
    },
  };
}

/** Creates the app and listens. Resolves once the port is bound. */
export async function startServer(options) {
  const app = createApp(options);
  const server = http.createServer((req, res) => {
    app.handle(req, res);
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(app.config.port, app.config.host, resolve);
    });
  } catch (error) {
    app.close();
    throw error;
  }
  return {
    app,
    port: server.address().port,
    close: () => new Promise((resolve) => {
      server.close(() => {
        app.close();
        resolve();
      });
    }),
  };
}
