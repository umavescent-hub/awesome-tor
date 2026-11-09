// Shared test fixtures: a known config, a temp data dir, a controllable clock, and HTTP helpers.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../server/app.js';

/** Tuesday 2026-11-10, 10:00 in Santa Fe (MST). */
export const T0 = Date.parse('2026-11-10T17:00:00Z');
/** The fixture Thanksgiving pickup's ordersCloseAt, "2026-11-20T20:00" in Santa Fe. */
export const HARVEST_CLOSES = Date.parse('2026-11-21T03:00:00Z');
export const MINUTE = 60_000;
export const ADMIN_PASSWORD = 'blue-corn-and-chile';

export const SERVICE_STYLES = [
  "Chef's table or tasting menu",
  "Family-style, buffet or hors d'oeuvres",
  'Drop-off, boxed lunch or pickup',
  'Not sure yet',
];

export function fixtureContent() {
  return {
    site: {
      name: 'Tsideh',
      tagline: 'Pop-up kitchen · Northern New Mexico',
      description: 'Pre-order pickup and catering.',
      chef: { name: 'Chef Rainbird Taylor', from: 'Ohkay Owingeh' },
      timezone: 'America/Denver',
      currency: 'usd',
      taxRatePercent: 8.1875,
      taxLabel: 'NM gross receipts tax',
      tipPresetsPercent: [0, 10, 15, 20],
      order: { leadTimeMinutes: 30, holdMinutes: 30, maxQtyPerItem: 12, maxItemsPerOrder: 30 },
      contact: { email: 'hello@tsideh.test', phone: '', instagram: '' },
      catering: { blurb: 'We bring the kitchen to you.', minGuests: 10, maxGuests: 500, leadTimeDays: 7, serviceStyles: [...SERVICE_STYLES] },
    },
    menu: {
      categories: [
        { id: 'plates', name: 'Plates' },
        { id: 'sweets', name: 'Sweets' },
        { id: 'drinks', name: 'Drinks' },
        { id: 'feast', name: 'Thanksgiving' },
      ],
      items: [
        { id: 'tacos', category: 'plates', name: 'Bison Red Chile Tacos', description: 'Blue corn, red chile.', priceCents: 1700, tags: ['spicy'] },
        { id: 'stew', category: 'plates', name: 'Green Chile Stew', description: 'Roasted green chile.', priceCents: 1300, tags: ['vegan', 'gluten-free'], image: '/assets/menu/stew.webp' },
        { id: 'cookies', category: 'sweets', name: 'Biscochitos (6)', description: 'Anise shortbread.', priceCents: 800, tags: ['vegetarian'] },
        { id: 'atole', category: 'drinks', name: 'Blue Corn Atole', description: 'Warm and sweet.', priceCents: 600, tags: [] },
        { id: 'dinner', category: 'feast', name: 'Thanksgiving dinner, per person', description: 'Plated for each person.', priceCents: 8500, minQty: 2, tags: [] },
        { id: 'pie', category: 'feast', name: 'Piñon-honey pie', description: '12-inch pie.', priceCents: 4800, tags: ['vegetarian', 'contains-nuts'] },
      ],
    },
    events: {
      events: [
        event({ id: 'winter', title: 'Winter Pop-up', date: '2026-11-21', start: '11:00', end: '13:00', menu: ['tacos', 'stew', 'cookies'], itemLimits: { tacos: 3 } }),
        event({ id: 'today', title: 'Tuesday Lunch', date: '2026-11-10', start: '09:00', end: '11:00' }),
        event({ id: 'later', title: 'Winter Market', date: '2027-01-30', preorderOpensDaysBefore: 7 }),
        event({ id: 'resting', title: 'Paused Pop-up', date: '2026-11-28', status: 'paused' }),
        event({ id: 'closed', title: 'Closed Pop-up', date: '2026-11-29', status: 'closed' }),
        event({ id: 'secret', title: 'Private Dinner', date: '2026-11-22', status: 'hidden' }),
        event({ id: 'past', title: 'Harvest Pop-up', date: '2026-11-01' }),
        event({ id: 'ancient', title: 'Summer Pop-up', date: '2026-08-01' }),
        // Orders close Friday 2026-11-20 at 8 PM MST = 2026-11-21T03:00:00Z (HARVEST_CLOSES).
        event({
          id: 'harvest',
          title: 'Thanksgiving Pickup',
          date: '2026-11-25',
          start: '12:00',
          end: '14:00',
          slotMinutes: 30,
          ordersCloseAt: '2026-11-20T20:00',
          menu: ['dinner', 'pie'],
          itemLimits: { dinner: 5 },
        }),
      ],
    },
  };
}

function event(fields) {
  return {
    start: '11:00',
    end: '13:00',
    locationName: 'Santa Fe',
    address: 'Railyard, 1612 Paseo de Peralta',
    mapUrl: 'https://maps.example.com/railyard',
    status: 'open',
    slotMinutes: 15,
    ordersPerSlot: 2,
    preorderOpensDaysBefore: 21,
    menu: 'all',
    itemLimits: {},
    note: 'Pickup only.',
    ...fields,
  };
}

export function tempDir() {
  return mkdtempSync(path.join(tmpdir(), 'tsideh-test-'));
}

export function writeConfig(dir, content) {
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(content)) writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(value, null, 2));
}

function testClock(start = T0) {
  return {
    t: start,
    now() {
      return this.t;
    },
    advance(ms) {
      this.t += ms;
    },
  };
}

let nextIp = 1;

/**
 * Starts the real server on an ephemeral port with fixture config and a temp data dir. `fetch`
 * stands in for Stripe and the alert webhook when a test needs to control them in-process.
 */
export async function startTestServer({ env = {}, content = fixtureContent(), publicDir, fetch: serviceFetch } = {}) {
  const dir = tempDir();
  const configDir = path.join(dir, 'config');
  writeConfig(configDir, content);
  const clock = testClock();
  const logs = [];
  const log = { info: (line) => logs.push(line), warn: (line) => logs.push(line), error: (line) => logs.push(line) };
  const running = await startServer({
    env: { PORT: '0', HOST: '127.0.0.1', DATA_DIR: path.join(dir, 'data'), TRUST_PROXY: '1', ...env },
    configDir,
    publicDir: publicDir ?? path.join(dir, 'public'),
    clock,
    log,
    fetch: serviceFetch,
  });
  const base = `http://127.0.0.1:${running.port}`;

  /** A distinct client (its own X-Forwarded-For address, so rate limits do not bleed between tests). */
  function client(ip = `198.51.100.${nextIp++ % 250}`) {
    async function call(method, url, { body, headers = {}, raw = false } = {}) {
      const init = { method, headers: { 'X-Forwarded-For': ip, ...headers }, redirect: 'manual' };
      if (body !== undefined) {
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
        if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) init.headers['Content-Type'] = 'application/json';
      }
      const response = await fetch(`${base}${url}`, init);
      const text = await response.text();
      const json = !raw && response.headers.get('content-type')?.startsWith('application/json') ? JSON.parse(text) : null;
      return { status: response.status, headers: response.headers, body: json, text };
    }
    return {
      ip,
      get: (url, options) => call('GET', url, options),
      post: (url, body, options = {}) => call('POST', url, { ...options, body }),
      call,
    };
  }

  return {
    base,
    port: running.port,
    clock,
    logs,
    client,
    async close() {
      await running.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Raw HTTP request that sends the path exactly as given (fetch would normalize "..") and returns the undecoded body. */
export function rawRequest(port, requestPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const customer = { name: 'Maria Ortiz', email: 'maria@example.com', phone: '(505) 555-0142' };

export function checkoutBody(overrides = {}) {
  return {
    eventId: 'winter',
    slot: '11:00',
    items: [{ id: 'stew', qty: 1 }],
    customer,
    tipPercent: 0,
    ...overrides,
  };
}
