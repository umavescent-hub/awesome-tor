// Environment + JSON content loading. Everything is validated once at boot; any problem stops the
// server with a message that says exactly which file and field to fix.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDateString, isTimeString, isTimeZone, minutesOf } from './time.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TAGS = ['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'spicy', 'contains-nuts'];
const EVENT_STATUSES = ['open', 'paused', 'closed', 'hidden'];
const ADMIN_PASSWORD_MIN = 12;

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const MENU_IMAGE = /^\/assets\/menu\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:webp|jpe?g|png)$/;

export class ConfigError extends Error {
  constructor(problems) {
    super(`Tsideh cannot start. Fix the following and try again:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

// ---------------------------------------------------------------------------------------------
// Environment

function parseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Reads process-style env vars. Returns { config, warnings } or throws ConfigError. */
export function readEnv(env) {
  const problems = [];
  const warnings = [];
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';

  const portText = env.PORT ?? '8787';
  const port = /^\d{1,5}$/.test(portText) ? Number(portText) : NaN;
  if (!(port >= 0 && port <= 65535)) problems.push(`PORT must be a number between 0 and 65535 (got "${portText}").`);

  let publicUrl = null;
  if (env.PUBLIC_URL) {
    const url = parseUrl(env.PUBLIC_URL);
    if (!url) problems.push('PUBLIC_URL must be a full web address such as https://tsideh.com.');
    else if (url.pathname !== '/' || url.search || url.hash) problems.push('PUBLIC_URL must be just the site address, with no path (e.g. https://tsideh.com).');
    else if (production && url.protocol !== 'https:') problems.push('PUBLIC_URL must start with https:// in production.');
    else publicUrl = url.origin;
  } else if (production) {
    problems.push('PUBLIC_URL is required in production (e.g. https://tsideh.com).');
  }

  const stripeSecretKey = (env.STRIPE_SECRET_KEY ?? '').trim() || null;
  if (stripeSecretKey && !/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(stripeSecretKey)) {
    problems.push('STRIPE_SECRET_KEY must be a Stripe secret key (starts with sk_live_ or sk_test_). Never use the publishable pk_ key here.');
  }
  const stripeWebhookSecret = (env.STRIPE_WEBHOOK_SECRET ?? '').trim() || null;
  if (stripeWebhookSecret && !stripeWebhookSecret.startsWith('whsec_')) {
    problems.push('STRIPE_WEBHOOK_SECRET must be the webhook signing secret from Stripe (starts with whsec_).');
  }
  let stripeApiBase = 'https://api.stripe.com';
  if (env.STRIPE_API_BASE) {
    const url = parseUrl(env.STRIPE_API_BASE);
    if (!url || (production && url.protocol !== 'https:')) problems.push('STRIPE_API_BASE must be an https:// address.');
    else stripeApiBase = url.origin;
  }

  let adminPassword = env.ADMIN_PASSWORD || null;
  if (adminPassword && adminPassword.length < ADMIN_PASSWORD_MIN) {
    warnings.push(`ADMIN_PASSWORD is shorter than ${ADMIN_PASSWORD_MIN} characters, so the kitchen admin stays switched off.`);
    adminPassword = null;
  }

  let notifyWebhookUrl = null;
  if (env.NOTIFY_WEBHOOK_URL) {
    const url = parseUrl(env.NOTIFY_WEBHOOK_URL);
    if (!url || (production && url.protocol !== 'https:')) problems.push('NOTIFY_WEBHOOK_URL must be an https:// address (for example a Slack incoming webhook).');
    else notifyWebhookUrl = url.href;
  }

  const trustText = (env.TRUST_PROXY ?? '').trim().toLowerCase();
  let trustProxy = 0;
  if (trustText === 'true') trustProxy = 1;
  else if (/^\d+$/.test(trustText)) trustProxy = Number(trustText);
  else if (trustText !== '' && trustText !== 'false') problems.push('TRUST_PROXY must be 0, 1 (one proxy in front, e.g. Render) or the number of proxies.');

  let now = null;
  if (env.NOW) {
    if (production) {
      warnings.push('NOW is ignored in production; the real clock is used.');
    } else {
      now = Date.parse(env.NOW);
      if (Number.isNaN(now)) problems.push(`NOW must be an ISO date-time such as 2026-11-20T18:00:00Z (got "${env.NOW}").`);
    }
  }

  const paymentsMode = stripeSecretKey ? 'stripe' : production ? 'disabled' : 'demo';
  if (production && !stripeSecretKey) warnings.push('STRIPE_SECRET_KEY is not set: online payments are OFF and checkout will refuse orders.');
  if (production && stripeSecretKey?.includes('_test_')) warnings.push('STRIPE_SECRET_KEY is a TEST key: no real money will be collected.');
  if ((production || stripeSecretKey) && !stripeWebhookSecret) {
    warnings.push('STRIPE_WEBHOOK_SECRET is not set: Stripe cannot confirm payments in the background, so an order is marked paid only if the customer returns to the site. Add the webhook endpoint in Stripe and set this.');
  }
  if (production && !adminPassword) warnings.push('ADMIN_PASSWORD is not set: the kitchen admin at /admin is switched off.');

  if (problems.length) throw new ConfigError(problems);

  return {
    warnings,
    config: {
      nodeEnv,
      production,
      port,
      host: env.HOST || '0.0.0.0',
      publicUrl: publicUrl ?? `http://localhost:${port}`,
      dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
      stripeSecretKey,
      stripeWebhookSecret,
      stripeApiBase,
      adminPassword,
      notifyWebhookUrl,
      trustProxy,
      now,
      paymentsMode,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// JSON content: site.json, menu.json, events.json

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Field checkers that record a problem and return the value (or a fallback) so checking continues. */
function fields(report) {
  return {
    object(value, at) {
      if (isObject(value)) return value;
      report(at, 'must be an object { ... }');
      return {};
    },
    array(value, at, { min = 0, max = Infinity } = {}) {
      if (!Array.isArray(value)) {
        report(at, 'must be a list [ ... ]');
        return [];
      }
      if (value.length < min) report(at, min === 1 ? 'must not be empty' : `must have at least ${min} entries`);
      if (value.length > max) report(at, `must have at most ${max} entries`);
      return value;
    },
    text(value, at, { min = 0, max = 200, optional = false } = {}) {
      if (value === undefined && optional) return '';
      if (typeof value !== 'string') {
        report(at, 'must be text in quotes');
        return '';
      }
      if (value.trim().length < min) report(at, min === 1 ? 'must not be empty' : `must be at least ${min} characters`);
      if (value.length > max) report(at, `must be at most ${max} characters`);
      return value;
    },
    int(value, at, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
      if (!Number.isInteger(value) || value < min || value > max) {
        report(at, `must be a whole number from ${min} to ${max}`);
        return min;
      }
      return value;
    },
    slug(value, at) {
      if (typeof value !== 'string' || !SLUG.test(value)) {
        report(at, 'must use only lowercase letters, numbers and dashes (e.g. "winter-popup")');
        return '';
      }
      return value;
    },
    oneOf(value, at, choices) {
      if (!choices.includes(value)) report(at, `must be one of: ${choices.join(', ')}`);
      return value;
    },
    url(value, at) {
      if (value === undefined || value === '') return '';
      if (typeof value !== 'string' || value.length > 500 || !parseUrl(value)) report(at, 'must be empty or a full https:// link');
      return value;
    },
  };
}

function validateSite(input, report) {
  const f = fields(report);
  const site = f.object(input, '');
  f.text(site.name, 'name', { min: 1, max: 60 });
  f.text(site.tagline, 'tagline', { max: 120, optional: true });
  f.text(site.description, 'description', { max: 300, optional: true });
  if (!isTimeZone(site.timezone)) report('timezone', 'must be a time zone name such as "America/Denver"');
  f.oneOf(site.currency, 'currency', ['usd']);
  if (typeof site.taxRatePercent !== 'number' || site.taxRatePercent < 0 || site.taxRatePercent > 25
    || Math.abs(site.taxRatePercent * 10_000 - Math.round(site.taxRatePercent * 10_000)) > 1e-6) {
    report('taxRatePercent', 'must be a percentage from 0 to 25 with at most 4 decimals (e.g. 8.1875)');
  }
  f.text(site.taxLabel, 'taxLabel', { min: 1, max: 60 });
  const tips = f.array(site.tipPresetsPercent, 'tipPresetsPercent', { min: 1, max: 6 });
  tips.forEach((tip, i) => f.int(tip, `tipPresetsPercent[${i}]`, { min: 0, max: 100 }));
  if (new Set(tips).size !== tips.length) report('tipPresetsPercent', 'must not repeat a value');

  const order = f.object(site.order, 'order');
  f.int(order.leadTimeMinutes, 'order.leadTimeMinutes', { min: 0, max: 1440 });
  f.int(order.holdMinutes, 'order.holdMinutes', { min: 30, max: 120 });
  f.int(order.maxQtyPerItem, 'order.maxQtyPerItem', { min: 1, max: 99 });
  f.int(order.maxItemsPerOrder, 'order.maxItemsPerOrder', { min: 1, max: 500 });

  const contact = f.object(site.contact, 'contact');
  const email = f.text(contact.email, 'contact.email', { max: 254, optional: true });
  if (email && !EMAIL.test(email)) report('contact.email', 'must be empty or a valid email address');
  f.text(contact.phone, 'contact.phone', { max: 30, optional: true });
  f.text(contact.instagram, 'contact.instagram', { max: 80, optional: true });

  const catering = f.object(site.catering, 'catering');
  f.text(catering.blurb, 'catering.blurb', { max: 600, optional: true });
  const minGuests = f.int(catering.minGuests, 'catering.minGuests', { min: 1, max: 100_000 });
  f.int(catering.maxGuests, 'catering.maxGuests', { min: minGuests, max: 100_000 });
  f.int(catering.leadTimeDays, 'catering.leadTimeDays', { min: 0, max: 365 });
  const styles = f.array(catering.serviceStyles, 'catering.serviceStyles', { min: 1, max: 12 });
  styles.forEach((style, i) => f.text(style, `catering.serviceStyles[${i}]`, { min: 1, max: 40 }));
  if (new Set(styles).size !== styles.length) report('catering.serviceStyles', 'must not repeat a style');
}

function validateMenu(input, report) {
  const f = fields(report);
  const menu = f.object(input, '');
  const categoryIds = new Set();
  f.array(menu.categories, 'categories', { min: 1 }).forEach((entry, i) => {
    const at = `categories[${i}]`;
    const category = f.object(entry, at);
    const id = f.slug(category.id, `${at}.id`);
    if (categoryIds.has(id)) report(`${at}.id`, `"${id}" is used twice`);
    categoryIds.add(id);
    f.text(category.name, `${at}.name`, { min: 1, max: 40 });
  });

  const itemIds = new Set();
  f.array(menu.items, 'items', { min: 1 }).forEach((entry, i) => {
    const at = `items[${i}]`;
    const item = f.object(entry, at);
    const id = f.slug(item.id, `${at}.id`);
    if (itemIds.has(id)) report(`${at}.id`, `"${id}" is used twice`);
    itemIds.add(id);
    if (!categoryIds.has(item.category)) report(`${at}.category`, `"${item.category}" is not one of the categories above`);
    f.text(item.name, `${at}.name`, { min: 1, max: 80 });
    f.text(item.description, `${at}.description`, { max: 300, optional: true });
    f.int(item.priceCents, `${at}.priceCents`, { min: 50, max: 1_000_000 });
    const tags = f.array(item.tags ?? [], `${at}.tags`);
    tags.forEach((tag, t) => f.oneOf(tag, `${at}.tags[${t}]`, TAGS));
    if (item.image !== undefined && item.image !== null && !(typeof item.image === 'string' && MENU_IMAGE.test(item.image))) {
      report(`${at}.image`, 'must be a file in public/assets/menu, written like "/assets/menu/posole.webp"');
    }
  });
  return itemIds;
}

function validateEvents(input, itemIds, report) {
  const f = fields(report);
  const events = f.object(input, '');
  const eventIds = new Set();
  f.array(events.events, 'events').forEach((entry, i) => {
    const at = `events[${i}]`;
    const event = f.object(entry, at);
    const id = f.slug(event.id, `${at}.id`);
    if (eventIds.has(id)) report(`${at}.id`, `"${id}" is used twice`);
    eventIds.add(id);
    f.text(event.title, `${at}.title`, { min: 1, max: 80 });
    if (!isDateString(event.date)) report(`${at}.date`, 'must be a date written YYYY-MM-DD');
    const timesOk = isTimeString(event.start) && isTimeString(event.end);
    if (!timesOk) report(`${at}.start/end`, 'must be 24-hour times written HH:MM (e.g. "11:00", "14:30")');
    f.text(event.locationName, `${at}.locationName`, { min: 1, max: 80 });
    f.text(event.address, `${at}.address`, { max: 160, optional: true });
    f.url(event.mapUrl, `${at}.mapUrl`);
    f.text(event.note, `${at}.note`, { max: 300, optional: true });
    f.oneOf(event.status, `${at}.status`, EVENT_STATUSES);
    const slotMinutes = f.int(event.slotMinutes, `${at}.slotMinutes`, { min: 5, max: 240 });
    f.int(event.ordersPerSlot, `${at}.ordersPerSlot`, { min: 1, max: 1000 });
    f.int(event.preorderOpensDaysBefore, `${at}.preorderOpensDaysBefore`, { min: 0, max: 365 });
    if (timesOk && minutesOf(event.end) - minutesOf(event.start) < slotMinutes) {
      report(`${at}.end`, `must be at least one slot (${slotMinutes} minutes) after start`);
    }

    let onMenu = itemIds;
    if (event.menu !== 'all') {
      const menu = f.array(event.menu, `${at}.menu`, { min: 1 });
      menu.forEach((itemId, m) => {
        if (!itemIds.has(itemId)) report(`${at}.menu[${m}]`, `"${itemId}" is not an item in menu.json`);
      });
      if (new Set(menu).size !== menu.length) report(`${at}.menu`, 'must not list an item twice');
      onMenu = new Set(menu);
    }
    if (event.itemLimits !== undefined) {
      for (const [itemId, limit] of Object.entries(f.object(event.itemLimits, `${at}.itemLimits`))) {
        if (!onMenu.has(itemId)) report(`${at}.itemLimits.${itemId}`, 'is not on this event\'s menu');
        f.int(limit, `${at}.itemLimits.${itemId}`, { min: 0, max: 100_000 });
      }
    }
  });
}

function readJsonFile(file, problems) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const name = path.basename(file);
    problems.push(error.code === 'ENOENT' ? `config/${name} is missing.` : `config/${name} is not valid JSON: ${error.message}`);
    return undefined;
  }
}

/** Loads and validates site.json, menu.json and events.json from `configDir`. */
export function loadContent(configDir) {
  const problems = [];
  const site = readJsonFile(path.join(configDir, 'site.json'), problems);
  const menu = readJsonFile(path.join(configDir, 'menu.json'), problems);
  const events = readJsonFile(path.join(configDir, 'events.json'), problems);
  if (problems.length) throw new ConfigError(problems);

  const reporter = (file) => (at, message) => problems.push(`config/${file}${at ? ` → ${at}` : ''}: ${message}`);
  validateSite(site, reporter('site.json'));
  const itemIds = validateMenu(menu, reporter('menu.json'));
  validateEvents(events, itemIds, reporter('events.json'));
  if (problems.length) throw new ConfigError(problems);

  return { site, menu, events };
}
