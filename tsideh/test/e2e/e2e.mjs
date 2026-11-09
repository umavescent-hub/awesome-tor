// End-to-end check in a real browser, on a phone (390×844, touch) and a desktop (1440×900):
// a customer orders from the first pop-up and pays in demo mode, sends a catering inquiry, and the
// kitchen works the order. Every page must load without console errors, page errors or Content
// Security Policy violations, under the server's own security headers, and without sideways
// scrolling on the phone.
//
// Run: npm run e2e   (starts its own server on a free port with a throwaway data folder)
// Needs Playwright with Chromium: npm install --no-save playwright && npx playwright install chromium

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/app.js';

const ADMIN_PASSWORD = 'kitchen-demo-password-123';
const CODE = /^TS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;
const MONEY = /\$\d[\d,]*\.\d{2}/;

const VIEWPORTS = [
  {
    name: 'phone',
    phone: true,
    options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    customer: { name: 'Rosa Archuleta', phone: '505 555 0142', email: 'rosa@example.com' },
    catering: { name: 'Lucia Martinez', email: 'lucia@example.com', guests: '60', location: 'Taos' },
  },
  {
    name: 'desktop',
    phone: false,
    options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    customer: { name: 'Daniel Ortiz', phone: '(505) 555-0199', email: 'daniel@example.com' },
    catering: { name: 'Elena Romero', email: 'elena@example.com', guests: '120', location: 'Santa Fe Railyard' },
  },
];

function loadPlaywright() {
  try {
    return createRequire(import.meta.url)('playwright');
  } catch {
    throw new Error('Playwright is needed for the end-to-end check: npm install --no-save playwright && npx playwright install chromium');
  }
}

/** A date about a month ahead, as the catering form's date input expects it. */
function monthAhead() {
  return new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
}

/** How much of a canvas is painted, from a sparse sample of its pixels. */
function canvasStats(canvas) {
  if (!canvas.width || !canvas.height) return { painted: 0, colors: 0 };
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const colors = new Set();
  let painted = 0;
  for (let i = 0; i < data.length; i += 4 * 61) {
    if (data[i + 3] === 0) continue;
    painted += 1;
    colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  }
  return { painted, colors: colors.size };
}

async function expectPainted(locator, { minColors }) {
  await locator.waitFor({ state: 'visible' });
  let stats = { painted: 0, colors: 0 };
  for (let attempt = 0; attempt < 40; attempt += 1) {
    stats = await locator.evaluate(canvasStats);
    if (stats.painted > 50 && stats.colors >= minColors) return;
    await locator.page().waitForTimeout(100);
  }
  assert.fail(`canvas is not painted (${stats.painted} sampled pixels, ${stats.colors} colors)`);
}

const moneyIn = (text) => {
  const match = MONEY.exec(text);
  assert.ok(match, `no amount in "${text}"`);
  return match[0];
};

/** Collects everything a page should never produce, plus the headers every response came with. */
async function watch(context, problems, responses) {
  await context.exposeBinding('__reportCspViolation', (source, detail) => problems.push(`CSP violation on ${source.page.url()}: ${detail}`));
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__reportCspViolation(`${event.effectiveDirective} blocked ${event.blockedURI || 'inline code'}`);
    });
  });
  context.on('page', (page) => {
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' || /Content Security Policy|Trusted Type/i.test(text)) {
        problems.push(`console ${message.type()} on ${page.url()}: ${text}`);
      }
    });
    page.on('pageerror', (error) => problems.push(`page error on ${page.url()}: ${error.message}`));
    page.on('response', (response) => {
      responses.push({ url: response.url(), type: response.request().resourceType(), headers: response.headers() });
    });
  });
}

async function expectNoSidewaysScroll(page, where) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }));
  assert.ok(scrollWidth <= innerWidth, `${where}: page is ${scrollWidth}px wide in a ${innerWidth}px viewport`);
}

/* ------------------------------------------------------------------------------- customer */

async function orderAndPay(page, run, base) {
  await page.goto(`${base}/`);
  const rows = page.locator('.popup-list .popup');
  await rows.first().waitFor();
  assert.equal(await rows.count(), 3, 'three upcoming pop-ups are listed');
  await expectPainted(page.locator('canvas.hero__art'), { minColors: 3 });
  assert.match(await page.locator('.press').innerText(), /Food & Wine/);
  if (run.phone) await expectNoSidewaysScroll(page, 'home');

  await rows.first().locator('.popup__cta').click();
  await page.waitForURL(/\/e\/2026-11-21-santa-fe$/);
  const dishes = page.locator('.event-menu .dish');
  await dishes.first().waitFor();
  if (run.phone) await expectNoSidewaysScroll(page, 'pop-up page');

  const first = dishes.nth(0);
  const second = dishes.nth(1);
  const picked = [await first.locator('.dish__name').innerText(), await second.locator('.dish__name').innerText()];
  await first.locator('[data-role="add"]').click();
  await second.locator('[data-role="add"]').click();
  await first.locator('[data-role="inc"]').click();
  await first.locator('.stepper__qty', { hasText: '2' }).waitFor();

  const form = page.locator('form.order-form');
  if (run.phone) {
    await page.locator('button.order-bar').click();
    await page.locator('dialog.order-sheet[open]').waitFor();
  } else {
    await page.locator('#cart-button').click();
  }
  await form.waitFor({ state: 'visible' });
  assert.equal(await form.locator('.lines .line').count(), 2, 'two lines in the order');

  await form.locator('label.choice:has(input[name="slot"]:not(:disabled))').first().click();
  await form.locator('input[name="name"]').fill(run.customer.name);
  await form.locator('input[name="phone"]').fill(run.customer.phone);
  await form.locator('input[name="email"]').fill(run.customer.email);
  await form.locator('label.choice:has(input[name="tip"][value="20"])').click();

  const pay = form.locator('button[type="submit"]');
  const total = moneyIn(await pay.innerText());
  await pay.click();

  await page.waitForURL(/\/pay\/demo\/TS-[A-Z0-9]{4}\?k=/);
  const card = page.locator('.demo-card');
  await card.locator('h1').waitFor();
  assert.match(await card.innerText(), /no card will be charged/i);
  assert.equal(moneyIn(await card.locator('.demo-card__amount').innerText()), total, 'server total matches the pay button');
  if (run.phone) await expectNoSidewaysScroll(page, 'demo payment');
  await card.getByRole('button', { name: 'Complete demo payment' }).click();

  await page.waitForURL(/\/order\/TS-[A-Z0-9]{4}\?k=[A-Za-z0-9_-]+$/);
  const code = (await page.locator('.code-plate__code').innerText()).trim();
  assert.match(code, CODE);
  const firstName = run.customer.name.split(' ')[0];
  assert.equal(await page.locator('.status-hero h1').innerText(), `Thank you, ${firstName}.`);
  const status = await page.evaluate(async () => {
    const url = new URL(location.href);
    const response = await fetch(`/api/orders/${url.pathname.split('/').pop()}?k=${url.searchParams.get('k')}`);
    return (await response.json()).order.status;
  });
  assert.equal(status, 'paid');
  assert.equal(moneyIn(await page.locator('.receipt .totals__grand').innerText()), total);
  await expectPainted(page.locator('canvas.keepsake'), { minColors: 2 });
  if (run.phone) await expectNoSidewaysScroll(page, 'confirmation');
  return { code, picked };
}

async function sendCateringInquiry(page, run, base) {
  await page.goto(`${base}/catering`);
  const form = page.locator('form[aria-label="Catering inquiry"]');
  await form.waitFor();
  await form.locator('input[name="name"]').fill(run.catering.name);
  await form.locator('input[name="email"]').fill(run.catering.email);
  await form.locator('input[name="location"]').fill(run.catering.location);
  await form.locator('input[name="eventDate"]').fill(monthAhead());
  await form.locator('input[name="guestCount"]').fill(run.catering.guests);
  await form.locator('label.choice:has(input[name="serviceStyle"])').nth(2).click();
  await form.locator('textarea[name="message"]').fill('A family reunion with an outdoor lunch.');
  await form.getByRole('button', { name: 'Send inquiry' }).click();
  const done = page.locator('.catering__done');
  await done.waitFor();
  assert.match(await done.innerText(), new RegExp(`Thank you, ${run.catering.name.split(' ')[0]}\\.`));
  if (run.phone) await expectNoSidewaysScroll(page, 'catering');
}

/* -------------------------------------------------------------------------------- kitchen */

async function workTheOrder(page, run, base, { code, committed }) {
  await page.goto(`${base}/admin`);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.locator('#login-submit').click();
  await page.locator('#app:not([hidden])').waitFor();
  assert.equal(await page.locator('#event-select').inputValue(), '2026-11-21-santa-fe');

  const ticket = page.locator('.ticket', { has: page.locator('.ticket-code', { hasText: code }) });
  await ticket.waitFor();
  assert.equal((await ticket.locator('.ticket-strip').innerText()).trim(), 'Paid');
  assert.match(await ticket.innerText(), new RegExp(run.customer.name));
  if (run.phone) await expectNoSidewaysScroll(page, 'kitchen orders');

  await ticket.getByRole('button', { name: 'Mark ready' }).click();
  await ticket.locator('.ticket-strip', { hasText: 'Ready' }).waitFor();
  await ticket.getByRole('button', { name: 'Picked up' }).click();
  await ticket.waitFor({ state: 'detached' });
  await page.locator('[data-filter="picked_up"]').click();
  await ticket.locator('.ticket-strip', { hasText: 'Picked up' }).waitFor();

  await page.locator('#tab-prep').click();
  await page.locator('#panel-prep .prep-row').first().waitFor();
  for (const [name, qty] of committed) {
    const row = page.locator('#panel-prep .prep-row', { has: page.locator('.prep-name', { hasText: name }) });
    const shown = await row.locator('.num-major').evaluate((cell) => Number(cell.firstChild.textContent));
    assert.equal(shown, qty, `prep shows ${qty} ${name} committed`);
  }
  if (run.phone) await expectNoSidewaysScroll(page, 'kitchen prep');

  await page.locator('#tab-catering').click();
  await page.locator('.inquiry-name', { hasText: run.catering.name }).waitFor();
  if (run.phone) await expectNoSidewaysScroll(page, 'kitchen catering');
}

/* ----------------------------------------------------------------------------------- main */

async function main() {
  const { chromium } = loadPlaywright();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'tsideh-e2e-'));
  const serverErrors = [];
  const quiet = { info: () => {}, warn: () => {}, error: (line) => serverErrors.push(line) };
  const server = await startServer({
    env: { PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, ADMIN_PASSWORD, NODE_ENV: 'development' },
    log: quiet,
  });
  const base = `http://127.0.0.1:${server.port}`;
  const browser = await chromium.launch();
  const committed = new Map();
  let failed = false;

  try {
    for (const run of VIEWPORTS) {
      const problems = [];
      const responses = [];
      const context = await browser.newContext(run.options);
      await watch(context, problems, responses);
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      const check = async (label, fn) => {
        try {
          await fn();
          assert.deepEqual(problems, [], 'no console errors, page errors or CSP violations');
          console.log(`ok    ${run.name}: ${label}`);
        } catch (error) {
          failed = true;
          console.log(`FAIL  ${run.name}: ${label}\n      ${String(error.message).split('\n').join('\n      ')}`);
          throw error;
        }
      };

      try {
        let order;
        await check('order, pay and see the confirmation', async () => {
          order = await orderAndPay(page, run, base);
          const [firstDish, secondDish] = order.picked;
          committed.set(firstDish, (committed.get(firstDish) ?? 0) + 2);
          committed.set(secondDish, (committed.get(secondDish) ?? 0) + 1);
        });
        await check('send a catering inquiry', () => sendCateringInquiry(page, run, base));
        await check('kitchen: ready, picked up, prep and catering', () => workTheOrder(page, run, base, { code: order.code, committed }));
        await check('security headers on every response', async () => {
          const ours = responses.filter(({ url }) => url.startsWith(base));
          assert.ok(ours.filter(({ type }) => type === 'document').length >= 3, 'pages were loaded');
          for (const { url, headers } of ours) {
            const csp = headers['content-security-policy'] ?? '';
            assert.match(csp, /default-src 'self'/, `CSP on ${url}`);
            assert.match(csp, /require-trusted-types-for 'script'/, `Trusted Types on ${url}`);
            assert.equal(headers['x-content-type-options'], 'nosniff', `nosniff on ${url}`);
            assert.equal(headers['cross-origin-embedder-policy'], 'require-corp', `COEP on ${url}`);
          }
          assert.deepEqual(responses.filter(({ url }) => !url.startsWith(base)).map(({ url }) => url), [], 'no third-party requests');
        });
      } catch {
        // Reported above; carry on with the next viewport so one run shows every failure.
      } finally {
        await context.close();
      }
    }
    if (serverErrors.length) {
      failed = true;
      console.log(`FAIL  server logged errors:\n      ${serverErrors.join('\n      ')}`);
    }
  } finally {
    await browser.close();
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
  }

  console.log(failed ? '\nEnd-to-end check FAILED' : '\nEnd-to-end check passed');
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
