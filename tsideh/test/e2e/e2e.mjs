// End-to-end check in a real browser, on a phone (390×844, touch), a desktop (1440×900) and an
// iPhone SE (320×568) with the text size doubled: a customer orders from the first pop-up and pays
// in demo mode, sends a catering request, and the kitchen works the order. Every page must load
// without console errors, page errors or Content Security Policy / Trusted Types violations, under
// the server's own security headers, without sideways scrolling, with readable text sizes and with
// pinch-zoom left on.
//
// Run: npm run e2e   (starts its own servers on free ports with throwaway data folders)
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
const FIRST_EVENT = '2026-11-21-santa-fe';
const PAY_NEXT = /Next you.ll pay securely with card, Apple Pay or Google Pay on Stripe.s checkout page\./;

function loadPlaywright() {
  try {
    return createRequire(import.meta.url)('playwright');
  } catch {
    throw new Error('Playwright is needed for the end-to-end check: npm install --no-save playwright && npx playwright install chromium');
  }
}

function viewports(devices) {
  const { defaultBrowserType, ...iPhoneSE } = devices['iPhone SE'];
  return [
    {
      name: 'phone',
      phone: true,
      kitchen: true,
      options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      customer: { name: 'Rosa Archuleta', phone: '505 555 0142', email: 'rosa@example.com' },
      catering: { name: 'Lucia Martinez', email: 'lucia@example.com', guests: '60', location: 'Taos' },
    },
    {
      name: 'desktop',
      phone: false,
      kitchen: true,
      options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
      customer: { name: 'Daniel Ortiz', phone: '(505) 555-0199', email: 'daniel@example.com' },
      catering: { name: 'Elena Romero', email: 'elena@example.com', guests: '120', location: 'Santa Fe Railyard' },
    },
    {
      // The smallest common phone with the text size doubled (browser text zoom / Larger Text).
      name: 'iPhone SE at 200% text',
      phone: true,
      kitchen: false,
      bigText: true,
      options: iPhoneSE,
      customer: { name: 'Josephine Naranjo', phone: '505 555 0177', email: 'josephine@example.com' },
    },
  ];
}

/** A date about a month ahead, as the catering form's date input expects it. */
function monthAhead() {
  return new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
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

/** Doubles the root font size before any page script runs (CSSOM only, so the CSP stays strict). */
async function doubleTextSize(context) {
  await context.addInitScript(() => {
    const apply = () => document.documentElement?.style.setProperty('font-size', '200%');
    apply();
    document.addEventListener('readystatechange', apply);
  });
}

/**
 * Compares with the screen width the context was made with: on a phone the browser widens its
 * layout viewport (and innerWidth) to fit a page that is too wide, which would hide the problem.
 */
async function expectNoSidewaysScroll(page, where) {
  const screenWidth = page.viewportSize().width;
  const { scrollWidth, wide } = await page.evaluate(() => {
    const sheet = document.querySelector('dialog[open] .sheet__body');
    return {
      scrollWidth: document.documentElement.scrollWidth,
      wide: sheet && sheet.scrollWidth > sheet.clientWidth ? `${sheet.scrollWidth}px in ${sheet.clientWidth}px` : null,
    };
  });
  assert.ok(scrollWidth <= screenWidth, `${where}: page is ${scrollWidth}px wide on a ${screenWidth}px screen`);
  assert.equal(wide, null, `${where}: the order sheet scrolls sideways`);
}

/** Big headings fit their box and never break inside a word ("Upco / ming"). */
async function expectWholeWordHeadings(page, where) {
  const broken = await page.evaluate(() => {
    const out = [];
    const range = document.createRange();
    for (const el of document.querySelectorAll('h1, h2')) {
      if (el.clientWidth <= 1 || el.closest('.visually-hidden, [hidden], dialog:not([open])')) continue;
      if (el.scrollWidth > el.clientWidth + 1) out.push(`"${el.textContent.trim()}" is wider than its box`);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const word of node.textContent.matchAll(/[^\s-]+/g)) {
          range.setStart(node, word.index);
          range.setEnd(node, word.index + word[0].length);
          const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          if (lines.size > 1) out.push(`"${word[0]}" is split across lines in "${el.textContent.trim()}"`);
        }
      }
    }
    return out;
  });
  assert.deepEqual(broken, [], `${where}: headings`);
}

/**
 * Nothing on screen below 14px; on phones, dish names, prices, buttons, labels and form fields
 * at 17px or more. With the text size doubled the floors double too.
 */
async function expectReadableText(page, run, where) {
  const scale = run.bigText ? 2 : 1;
  const tooSmall = await page.evaluate(({ scale, phone }) => {
    const visible = (el) => {
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return false;
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && !el.closest('.visually-hidden, [hidden], dialog:not([open])');
    };
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      const hasText = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
      if (!hasText || !visible(el)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 14 * scale) out.push(`${el.className || el.tagName} "${el.textContent.trim().slice(0, 30)}" at ${size}px`);
    }
    if (phone) {
      for (const el of document.querySelectorAll('.dish__name, .dish__price, .btn, .field__label, .input, .choice__box, .order-bar__button, .step__title')) {
        if (!visible(el)) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 17 * scale) out.push(`${el.className} "${el.textContent.trim().slice(0, 30)}" at ${size}px (17px minimum)`);
      }
    }
    return out;
  }, { scale, phone: run.phone });
  assert.deepEqual(tooSmall, [], `${where}: text too small`);
}

async function expectPageBasics(page, run, where) {
  if (run.phone) await expectNoSidewaysScroll(page, where);
  await expectWholeWordHeadings(page, where);
  await expectReadableText(page, run, where);
  assert.equal(await page.locator('canvas').count(), 0, `${where}: no drawn art (canvas) on the page`);
}

/* ------------------------------------------------------------------------------- customer */

/**
 * After "Add": screen readers hear "Added: <dish>" and it is on screen: in the order panel on
 * desktop, above the "View order" bar on phones (one line). With very large text the bar keeps only
 * its button, and the dish row's "In your order" is the visible confirmation. The bar never takes
 * more than a third of the screen, so the dish just added stays in view.
 */
async function expectAdded(page, run, dish, name) {
  await page.locator('[aria-live="polite"]', { hasText: `Added: ${name}` }).waitFor({ state: 'attached' });
  await dish.locator('.amount__note', { hasText: 'In your order' }).waitFor();
  await dish.getByRole('button', { name: `Remove ${name}` }).waitFor();
  if (!run.phone) {
    await page.locator('.panel-slot .action-status', { hasText: `Added: ${name}` }).waitFor();
    return;
  }
  if (await page.locator('.order-bar.is-compact').count() === 0) {
    assert.equal(run.bigText ?? false, false, 'the bar keeps only its button with very large text on a short screen');
    await page.locator('.order-bar .action-status', { hasText: `Added: ${name}` }).waitFor();
  }
  const { bar, screen } = await page.evaluate(() => ({ bar: document.querySelector('.order-bar').offsetHeight, screen: innerHeight }));
  assert.ok(bar <= screen / 3, `the View order bar is ${bar}px of a ${screen}px screen`);
}

async function orderAndPay(page, run, base) {
  await page.goto(`${base}/`);
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  assert.doesNotMatch(viewport, /maximum-scale|user-scalable\s*=\s*(no|0)/, 'pinch-zoom stays on');

  const cards = page.locator('.popup-list .popup');
  await cards.first().waitFor();
  assert.equal(await cards.count(), 3, 'three upcoming pop-ups are listed');
  const logo = page.locator('.hero img.hero__logo');
  assert.equal(await logo.getAttribute('alt'), 'Tsideh');
  assert.ok(await logo.evaluate((img) => img.complete && img.naturalWidth > 0), 'the logo loads in the hero');
  const hero = page.locator('.hero');
  assert.match(await hero.innerText(), /Next pop-up/);
  const orderLink = hero.getByRole('link', { name: 'Order food for pickup' });
  const { events } = await page.evaluate(() => fetch('/api/events').then((r) => r.json()));
  const open = events.filter((event) => event.status === 'open');
  assert.equal(await orderLink.getAttribute('href'), open.length === 1 ? `/e/${open[0].id}` : '/#popups',
    'Order food for pickup goes straight to the menu only when exactly one pop-up is open');
  await hero.getByRole('link', { name: 'Ask about catering' }).waitFor();
  if (!run.phone && open.length !== 1) {
    // Keyboard: Enter on "Order food for pickup" moves on to the list of pop-ups, so the next Tab
    // reaches the first pop-up's "Order food" instead of jumping back into the hero.
    await orderLink.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.id === 'popups-title');
    await page.keyboard.press('Tab');
    assert.match(await page.evaluate(() => document.activeElement.textContent), /^Order food from the /);
  }
  assert.match(await page.locator('.press').innerText(), /Food & Wine/);
  assert.match(await cards.first().innerText(), /Taking orders now/);
  await expectPageBasics(page, run, 'home');

  await cards.first().getByRole('link', { name: /^Order food/ }).click();
  await page.waitForURL(new RegExp(`/e/${FIRST_EVENT}$`));
  const dishes = page.locator('.event-menu .dish');
  await dishes.first().waitFor();
  await page.getByRole('link', { name: 'Back to all pop-ups' }).waitFor();
  await expectPageBasics(page, run, 'pop-up page');

  const first = dishes.nth(0);
  const second = dishes.nth(1);
  const picked = [await first.locator('.dish__name').innerText(), await second.locator('.dish__name').innerText()];
  await first.getByRole('button', { name: `Add ${picked[0]}` }).click();
  await expectAdded(page, run, first, picked[0]);
  await second.getByRole('button', { name: `Add ${picked[1]}` }).click();
  await expectAdded(page, run, second, picked[1]);
  await first.getByRole('button', { name: `One more ${picked[0]}` }).click();
  await first.locator('.stepper__qty', { hasText: '2' }).waitFor();
  await expectAdded(page, run, first, picked[0]);

  const form = page.locator('form.order-form');
  const sheet = page.locator('dialog.order-sheet');
  if (run.phone) {
    const bar = page.locator('.order-bar__button');
    assert.match(await bar.innerText(), /^View order — 3 items, \$\d+\.\d{2}$/);
    await expectPageBasics(page, run, 'pop-up page with an order');
    await bar.click();
    await page.locator('dialog.order-sheet[open]').waitFor();
    if (!run.bigText) {
      // The phone's Back button closes the sheet and stays on the pop-up page.
      await page.goBack();
      await page.locator('dialog.order-sheet:not([open])').waitFor({ state: 'attached' });
      assert.match(page.url(), new RegExp(`/e/${FIRST_EVENT}$`), 'Back closed the sheet without leaving the page');
      await bar.waitFor();
      await bar.click();
      await page.locator('dialog.order-sheet[open]').waitFor();
    }
    // Close (a labelled button) closes it too.
    await sheet.getByRole('button', { name: 'Close' }).click();
    await page.locator('dialog.order-sheet:not([open])').waitFor({ state: 'attached' });
    assert.match(page.url(), new RegExp(`/e/${FIRST_EVENT}$`));
    await bar.click();
    await page.locator('dialog.order-sheet[open]').waitFor();
  }
  await form.waitFor({ state: 'visible' });
  assert.equal(await form.locator('.lines .line').count(), 2, 'two dishes in the order');
  for (const step of ['Your food', 'Choose a pickup time', 'Your details']) {
    await form.locator('.step__title', { hasText: step }).waitFor();
  }
  assert.equal(await form.locator('input[name="tip"][value="0"]').isChecked(), true, 'No tip is the default');
  assert.match(await form.locator('.pay__next').innerText(), PAY_NEXT);
  assert.equal(await form.locator('.pay__missing').innerText(), 'Choose a pickup time to continue.');
  assert.equal(await form.locator('input[name="slot"]:disabled').count(), 0, 'only times that can be chosen are shown');
  if (run.phone) await expectPageBasics(page, run, 'order sheet');

  const slot = form.locator('label.choice:has(input[name="slot"])').first();
  const slotLabel = (await slot.innerText()).trim();
  await slot.click();
  assert.match(await form.locator('.pay__missing').innerText(), /^Fill in your name, your mobile number and your email to continue\.$/);
  await form.locator('input[name="name"]').fill(run.customer.name);
  await form.locator('input[name="phone"]').fill(run.customer.phone);
  await form.locator('input[name="email"]').fill(run.customer.email);
  assert.equal(await form.locator('.pay__missing').isVisible(), false, 'nothing is missing once the form is filled in');
  await form.locator('label.choice:has(input[name="tip"][value="20"])').click();
  if (run.phone) await expectPageBasics(page, run, 'order sheet, filled in');

  const pay = form.locator('button[type="submit"]');
  const total = moneyIn(await pay.innerText());
  await pay.click();

  await page.waitForURL(/\/pay\/demo\/TS-[A-Z0-9]{4}\?k=/);
  const card = page.locator('.demo-card');
  await card.locator('h1').waitFor();
  assert.match(await card.innerText(), /no card will be charged/i);
  assert.equal(moneyIn(await card.locator('.demo-card__amount').innerText()), total, 'server total matches the pay button');
  await expectPageBasics(page, run, 'demo payment');
  await card.getByRole('button', { name: 'Complete demo payment' }).click();

  await page.waitForURL(/\/order\/TS-[A-Z0-9]{4}\?k=[A-Za-z0-9_-]+$/);
  const code = (await page.locator('.code-plate__code').innerText()).trim();
  assert.match(code, CODE);
  assert.equal(await page.locator('.status-hero h1').innerText(), 'You’re all set.');
  assert.equal(await page.locator('.status-when').innerText(), `Pick up at ${slotLabel} on Saturday, November 21 in Santa Fe.`);
  await page.getByRole('button', { name: 'Add to calendar' }).waitFor();
  await page.getByRole('link', { name: 'Back to home' }).waitFor();
  const status = await page.evaluate(async () => {
    const url = new URL(location.href);
    const response = await fetch(`/api/orders/${url.pathname.split('/').pop()}?k=${url.searchParams.get('k')}`);
    return (await response.json()).order.status;
  });
  assert.equal(status, 'paid');
  assert.equal(moneyIn(await page.locator('.receipt .totals__grand').innerText()), total);
  await expectPageBasics(page, run, 'confirmation');
  return { code, picked };
}

async function sendCateringRequest(page, run, base) {
  await page.goto(`${base}/`);
  await page.locator('.hero').getByRole('link', { name: 'Ask about catering' }).click();
  await page.waitForURL(/\/catering$/);
  const form = page.locator('form[aria-label="Catering request"]');
  await form.waitFor();
  await form.locator('input[name="name"]').fill(run.catering.name);
  await form.locator('input[name="email"]').fill(run.catering.email);
  await form.locator('input[name="location"]').fill(run.catering.location);
  await form.locator('input[name="eventDate"]').fill(monthAhead());
  await form.locator('input[name="guestCount"]').fill(run.catering.guests);
  await form.locator('label.choice:has(input[name="serviceStyle"])').nth(2).click();
  await form.locator('textarea[name="message"]').fill('A family reunion with an outdoor lunch.');
  await expectPageBasics(page, run, 'catering');
  await form.getByRole('button', { name: 'Send catering request' }).click();
  const done = page.locator('.catering__done');
  await done.waitFor();
  assert.match(await done.innerText(), new RegExp(`Thank you, ${run.catering.name.split(' ')[0]}\\.`));
  await expectPageBasics(page, run, 'catering sent');
}

/* -------------------------------------------------------------------------------- kitchen */

async function workTheOrder(page, run, base, { code, committed }) {
  await page.goto(`${base}/admin`);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.locator('#login-submit').click();
  await page.locator('#app:not([hidden])').waitFor();
  assert.equal(await page.locator('#event-select').inputValue(), FIRST_EVENT);

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
    assert.equal(shown, qty, `prep shows ${qty} ${name} paid for`);
  }
  if (run.phone) await expectNoSidewaysScroll(page, 'kitchen prep');

  await page.locator('#tab-catering').click();
  await page.locator('.inquiry-name', { hasText: run.catering.name }).waitFor();
  if (run.phone) await expectNoSidewaysScroll(page, 'kitchen catering');
  assert.equal(await page.locator('canvas').count(), 0, 'no drawn art in the kitchen');
}

/* ----------------------------------------------------------------- one open pop-up */

/** With exactly one pop-up taking orders, "Order food for pickup" goes straight to its menu. */
async function oneOpenPopup(browser) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'tsideh-e2e-one-'));
  const server = await startServer({
    env: { PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, NODE_ENV: 'development', NOW: '2026-11-04T18:00:00Z' },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.locator('.popup-list .popup').first().waitFor();
    const link = page.locator('.hero').getByRole('link', { name: 'Order food for pickup' });
    assert.equal(await link.getAttribute('href'), `/e/${FIRST_EVENT}`);
    await link.click();
    await page.waitForURL(new RegExp(`/e/${FIRST_EVENT}$`));
    await page.locator('.event-menu .dish').first().waitFor();
  } finally {
    await context.close();
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

/* ----------------------------------------------------------------------------------- main */

async function main() {
  const { chromium, devices } = loadPlaywright();
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
    for (const run of viewports(devices)) {
      const problems = [];
      const responses = [];
      const context = await browser.newContext(run.options);
      await watch(context, problems, responses);
      if (run.bigText) await doubleTextSize(context);
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
        if (run.kitchen) {
          await check('send a catering request', () => sendCateringRequest(page, run, base));
          await check('kitchen: ready, picked up, prep and catering', () => workTheOrder(page, run, base, { code: order.code, committed }));
        }
        await check('security headers on every response', async () => {
          const ours = responses.filter(({ url }) => url.startsWith(base));
          assert.ok(ours.filter(({ type }) => type === 'document').length >= 2, 'pages were loaded');
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
    try {
      await oneOpenPopup(browser);
      console.log('ok    desktop: one open pop-up, "Order food for pickup" goes straight to its menu');
    } catch (error) {
      failed = true;
      console.log(`FAIL  desktop: one open pop-up\n      ${String(error.message).split('\n').join('\n      ')}`);
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
