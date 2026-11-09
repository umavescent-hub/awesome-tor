// End-to-end check in a real browser, on a phone (390×844, touch), a desktop (1440×900) and an
// iPhone SE (320×568) with the text size doubled: a customer orders from the first pop-up, typing
// nothing before Pay, gives a name, mobile number and email on the demo payment page (Stripe's
// stand-in) and pays, sends a catering request, the kitchen works the order, and a hidden pop-up's
// link says it is not on the calendar. Then, on servers with a fixed clock, the Thanksgiving
// pickup: the only open pop-up (with its last order time), the host upgrade added for every guest
// in one tap, a dish sold two at a time with a low-stock note, and the pop-up after its last order
// time. Every page must load without console errors (bar the hidden pop-up's own 404), page
// errors or Content Security Policy / Trusted Types violations, under the server's own security
// headers, without sideways scrolling, with readable text sizes, with pinch-zoom left on and
// without a single "$" (amounts read "48" or "65.29").
//
// Run: npm run e2e   (starts its own servers on free ports with throwaway data folders)
// Needs Playwright with Chromium: npm install --no-save playwright && npx playwright install chromium

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/app.js';

const ADMIN_PASSWORD = 'kitchen-demo-password-123';
const CODE = /^TS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;
const MONEY = /\d[\d,]*(?:\.\d{2})?/;                      // "48", "1,069.20": never a currency sign
const FIRST_EVENT = '2026-11-21-santa-fe';
const PAY_NEXT = 'Next: pay in one tap with Apple Pay or Google Pay, or enter a card. Secured by Stripe.';
const CHEF = 'Chef Rainbird Taylor, Ohkay Owingeh';
const CONFIG_DIR = path.join(import.meta.dirname, '../../config');
const HIDDEN_EVENT = '2026-12-24-winter-feast';           // hidden until the owner sends its pickup hours

// The Thanksgiving pickup, seen from two fixed moments.
const HOLIDAY_EVENT = '2026-11-25-thanksgiving';
const HOLIDAY_TITLE = 'Thanksgiving Harvest Table';
const TABLE_FOR_SIX = 'Harvest Table for six';
const HOST_UPGRADE = 'host-upgrade';                     // sold per guest
const MIN_ITEM = 'pie-nm-cherry';                        // sold two at a time on the holiday servers
const LOW_ITEM = 'pie-pumpkin-blue-corn';                // four left on the holiday servers
const ORDER_BY = 'Order by Friday, November 20 at 8:00 PM';
const BEFORE_LAST_ORDER = '2026-10-28T18:00:00Z';       // the only pop-up taking orders yet
const AFTER_LAST_ORDER = '2026-11-21T04:00:00Z';        // 9 PM on November 20, an hour after its last order time
const CART_KEY = 'tsideh.cart.v1';                      // where the site keeps the order in progress

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

/** Headings fit their box and never break inside a word ("Upco / ming", "Thanksgi / ving"). */
async function expectWholeWordHeadings(page, where) {
  const broken = await page.evaluate(() => {
    const out = [];
    const range = document.createRange();
    for (const el of document.querySelectorAll('h1, h2, h3')) {
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

/** The owner's rule: no "$" anywhere a page renders, read aloud or names itself, hidden text included. */
async function expectNoDollarSign(page, where) {
  const found = await page.evaluate(() => {
    const texts = [document.title, document.body.textContent];
    for (const el of document.querySelectorAll('[aria-label], [title], [alt], [placeholder], input[value]')) {
      for (const name of ['aria-label', 'title', 'alt', 'placeholder', 'value']) texts.push(el.getAttribute(name) ?? '');
    }
    const text = texts.find((value) => value.includes('$'));
    return text === undefined ? null : text.slice(Math.max(0, text.indexOf('$') - 40), text.indexOf('$') + 40).replace(/\s+/g, ' ');
  });
  assert.equal(found, null, `${where}: a "$" on the page`);
}

async function expectPageBasics(page, run, where) {
  if (run.phone) await expectNoSidewaysScroll(page, where);
  await expectWholeWordHeadings(page, where);
  await expectReadableText(page, run, where);
  await expectNoDollarSign(page, where);
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
  const { events } = await page.evaluate(() => fetch('/api/events').then((r) => r.json()));
  assert.ok(events.length > 1, 'more than one pop-up on the calendar');
  assert.equal(await cards.count(), events.length, 'every upcoming pop-up is listed');
  assert.match(await cards.first().locator('.popup__title').innerText(), /^Santa Fe pop-up$/);
  const logo = page.locator('.hero img.hero__logo');
  assert.equal(await logo.getAttribute('alt'), 'Tsideh');
  assert.ok(await logo.evaluate((img) => img.complete && img.naturalWidth > 0), 'the logo loads in the hero');
  const hero = page.locator('.hero');
  assert.match(await hero.innerText(), /Next pop-up/);
  assert.equal(await hero.locator('.hero__chef').innerText(), CHEF, 'the chef under the headline');
  assert.equal(await page.locator('.site-footer .footer-chef').innerText(), CHEF, 'and once in the footer');
  const orderLink = hero.getByRole('link', { name: 'Order food for pickup' });
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
    assert.match(await bar.innerText(), /^View order — 3 items, \d[\d,]*(?:\.\d{2})?$/);
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
  // Two steps, then the tip and Pay: name, email and phone are given on the payment page.
  assert.deepEqual(await form.locator('.step__title').allTextContents(), ['Step 1: Your food', 'Step 2: Choose a pickup time']);
  assert.equal(await form.locator('input:not([type="radio"]):not([type="hidden"])').count(), 0, 'no name, phone or email to type before paying');
  assert.equal(await form.locator('input[name="tip"][value="0"]').isChecked(), true, 'No tip is the default');
  assert.equal((await form.locator('.pay__next p').first().innerText()).trim(), PAY_NEXT);
  assert.equal(await form.locator('.pay__missing').innerText(), 'Choose a pickup time to continue.');
  assert.equal(await form.locator('input[name="slot"]:disabled').count(), 0, 'only times that can be chosen are shown');
  if (run.phone) await expectPageBasics(page, run, 'order sheet');

  const slot = form.locator('label.choice:has(input[name="slot"])').first();
  const slotLabel = (await slot.innerText()).trim();
  // Pay with no time chosen lists what is missing; choosing a time clears the list.
  await form.locator('button[type="submit"]').click();
  const fixList = form.locator('.error-summary', { hasText: 'One thing to fix before paying' });
  await fixList.waitFor();
  await slot.click();
  assert.equal(await fixList.isVisible(), false, 'nothing left to fix, so no list of things to fix');
  assert.equal(await form.locator('.pay__missing').isVisible(), false, 'with dishes and a time chosen, Pay is next');
  const notes = form.locator('.field:has(textarea[name="notes"])');
  assert.match(await notes.locator('.field__label').innerText(), /^Allergies or a note for the kitchen \(optional\)$/);
  assert.equal(await notes.locator('.field__hint').innerText(),
    'Most of our menu is naturally gluten-free and plant-forward. Tell us about allergies or dietary needs — there’s never an extra charge.');
  await notes.locator('textarea').fill('One of us is allergic to tree nuts.');
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
  assert.match(await card.locator('.demo-card__amount').innerText(), /^Total\s/, 'the amount is labelled');
  // Like Stripe's page, the bill shows how the total is made up: items, tax and tip.
  const bill = await card.locator('.totals dt').allInnerTexts();
  assert.deepEqual([bill[0], bill[2], bill[3]], ['Items', 'Tip', 'Total']);
  assert.match(bill[1], /tax/i);
  assert.equal(moneyIn(await card.locator('.totals__grand dd').innerText()), total);
  // Like Stripe's page, the demo page asks for the details that go with the order, with autofill hints.
  const complete = card.getByRole('button', { name: 'Complete demo payment' });
  const contact = {
    name: { value: run.customer.name, autocomplete: 'name', inputmode: null },
    phone: { value: run.customer.phone, autocomplete: 'tel', inputmode: 'tel' },
    email: { value: run.customer.email, autocomplete: 'email', inputmode: 'email' },
  };
  for (const [name, { autocomplete, inputmode }] of Object.entries(contact)) {
    const input = card.locator(`input[name="${name}"]`);
    assert.equal(await input.getAttribute('autocomplete'), autocomplete, `${name} autocomplete`);
    assert.equal(await input.getAttribute('inputmode'), inputmode, `${name} keyboard`);
  }
  await complete.click();
  await card.locator('.error-summary', { hasText: '3 things to fix before paying' }).waitFor();
  for (const [name, { value }] of Object.entries(contact)) await card.locator(`input[name="${name}"]`).fill(value);
  await expectPageBasics(page, run, 'demo payment');
  await complete.click();

  await page.waitForURL(/\/order\/TS-[A-Z0-9]{4}\?k=[A-Za-z0-9_-]+$/);
  const code = (await page.locator('.code-plate__code').innerText()).trim();
  assert.match(code, CODE);
  assert.equal(await page.locator('.status-hero h1').innerText(), `Thank you, ${run.customer.name.split(' ')[0]}. You’re all set.`);
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
  // The kinds of catering come from the site settings, under a plain question.
  const kinds = form.locator('fieldset:has(input[name="serviceStyle"])');
  assert.equal(await kinds.locator('legend').innerText(), 'How would you like it served?');
  const { catering } = await page.evaluate(() => fetch('/api/site').then((r) => r.json()));
  assert.deepEqual((await kinds.locator('.choice__label').allInnerTexts()).map((text) => text.trim()), catering.serviceStyles);
  await form.locator('label.choice:has(input[name="serviceStyle"])').nth(2).click();
  const dietary = form.locator('.field:has(textarea[name="dietary"])');
  assert.equal(await dietary.locator('.field__label').innerText(), 'Allergies or dietary needs (optional)');
  assert.equal(await dietary.locator('.field__hint').innerText(), 'There’s never an extra charge.');
  await dietary.locator('textarea').fill('Two guests are vegan.');
  await form.locator('textarea[name="message"]').fill('A family reunion with an outdoor lunch.');
  await expectPageBasics(page, run, 'catering');
  await form.getByRole('button', { name: 'Request a menu and quote' }).click();
  const done = page.locator('.catering__done');
  await done.waitFor();
  assert.match(await done.innerText(), new RegExp(`Thank you, ${run.catering.name.split(' ')[0]}\\.`));
  await expectPageBasics(page, run, 'catering sent');
}

/** A hidden pop-up's link says plainly that it is not on the calendar, and where to go instead. */
async function hiddenPopup(page, run, base) {
  await page.goto(`${base}/e/${HIDDEN_EVENT}`);
  await page.getByRole('heading', { name: 'This pop-up is not on the calendar' }).waitFor();
  await page.getByRole('link', { name: 'See upcoming pop-ups' }).waitFor();
  await expectPageBasics(page, run, 'a hidden pop-up');
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
  await expectNoDollarSign(page, 'kitchen orders');

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
  await expectNoDollarSign(page, 'kitchen prep');

  await page.locator('#tab-catering').click();
  await page.locator('.inquiry-name', { hasText: run.catering.name }).waitFor();
  if (run.phone) await expectNoSidewaysScroll(page, 'kitchen catering');
  assert.equal(await page.locator('canvas').count(), 0, 'no drawn art in the kitchen');
}

/* ------------------------------------------------------- the Thanksgiving pickup, fixed clocks */

/**
 * The site's own config, with two changes the holiday checks need and the real menu does not have
 * today: one pie sold two at a time, and only four of another pie left.
 */
function holidayConfig(dir) {
  const read = (name) => JSON.parse(readFileSync(path.join(CONFIG_DIR, name), 'utf8'));
  const menu = read('menu.json');
  menu.items.find((item) => item.id === MIN_ITEM).minQty = 2;
  const events = read('events.json');
  events.events.find((event) => event.id === HOLIDAY_EVENT).itemLimits[LOW_ITEM] = 4;
  mkdirSync(dir);
  writeFileSync(path.join(dir, 'site.json'), JSON.stringify(read('site.json')));
  writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(menu));
  writeFileSync(path.join(dir, 'events.json'), JSON.stringify(events));
  return dir;
}

/** Runs fn(base) against a server whose clock reads `now`, with its own throwaway data and config. */
async function withServer(now, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsideh-e2e-at-'));
  const errors = [];
  const server = await startServer({
    env: { PORT: '0', HOST: '127.0.0.1', DATA_DIR: path.join(dir, 'data'), NODE_ENV: 'development', NOW: now },
    configDir: holidayConfig(path.join(dir, 'config')),
    log: { info: () => {}, warn: () => {}, error: (line) => errors.push(line) },
  });
  try {
    await fn(`http://127.0.0.1:${server.port}`);
    assert.deepEqual(errors, [], 'the server logged no errors');
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs fn(page) in a fresh browser context for `run`, watched like the main runs. */
async function withPage(browser, run, fn) {
  const problems = [];
  const context = await browser.newContext(run.options);
  await watch(context, problems, []);
  if (run.bigText) await doubleTextSize(context);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await fn(page);
    assert.deepEqual(problems, [], 'no console errors, page errors or CSP violations');
  } finally {
    await context.close();
  }
}

/** The order checklist: in the sheet on phones (opened here), beside the menu on desktop. */
async function openOrder(page, run) {
  if (!run.phone) return page.locator('.panel-slot');
  await page.locator('.order-bar__button').click();
  await page.locator('dialog.order-sheet[open]').waitFor();
  return page.locator('dialog.order-sheet');
}

async function closeOrder(page, run, order) {
  if (!run.phone) return;
  await order.getByRole('button', { name: 'Close' }).click();
  await page.locator('dialog.order-sheet:not([open])').waitFor({ state: 'attached' });
}

/** How many of a dish the cart saved in this browser. */
const stored = (page, itemId) => page.evaluate(([key, eventId, id]) => JSON.parse(localStorage.getItem(key) ?? '{}')[eventId]?.items?.[id] ?? 0,
  [CART_KEY, HOLIDAY_EVENT, itemId]);

/**
 * With exactly one pop-up taking orders, "Order food for pickup" goes straight to its menu. Its
 * last order time is on its card, in the hero and on its page, and the holiday menu reads
 * naturally: its own categories, no photos, and a low-stock note that says the menu is once a year.
 */
async function onlyOpenPopup(page, run, base) {
  await page.goto(`${base}/`);
  const card = page.locator('.popup-list .popup', { hasText: HOLIDAY_TITLE });
  await card.waitFor();
  assert.match(await card.innerText(), /Taking orders now/);
  assert.equal(await card.locator('.deadline').innerText(), ORDER_BY);
  const hero = page.locator('.hero');
  assert.equal(await hero.locator('.deadline').innerText(), ORDER_BY);
  const link = hero.getByRole('link', { name: 'Order food for pickup' });
  assert.equal(await link.getAttribute('href'), `/e/${HOLIDAY_EVENT}`);
  await expectPageBasics(page, run, 'home with one open pop-up');

  await link.click();
  await page.waitForURL(new RegExp(`/e/${HOLIDAY_EVENT}$`));
  await page.locator('.event-menu .dish').first().waitFor();
  assert.equal(await page.locator('.event-top .deadline').innerText(), ORDER_BY);
  assert.deepEqual(await page.locator('.menu-cat__title').allInnerTexts(), ['Harvest Table', 'Pies', 'For the host']);
  assert.equal(await page.locator('.event-menu img').count(), 0, 'no photos on the holiday menu');
  assert.equal(await page.locator(`.dish[data-item="${LOW_ITEM}"] .dish__note`).innerText(), '4 left — then it’s gone until next year');
  assert.equal(await page.locator('.dish__price', { hasText: /^495$/ }).count(), 1, 'whole prices read "495"');
  await expectPageBasics(page, run, 'holiday pop-up page');
}

/**
 * The host upgrade is sold per guest. It is never in the order on its own; with a table for six in
 * the order its row offers it for six guests in one tap, and the order checklist itself carries no
 * suggestion: between the food and Pay there is nothing to decline.
 */
async function hostUpgradeForEveryGuest(page, run, base) {
  await page.goto(`${base}/e/${HOLIDAY_EVENT}`);
  const host = page.locator(`.event-menu .dish[data-item="${HOST_UPGRADE}"]`);
  const hostName = (await host.locator('.dish__name').innerText()).trim();
  await host.getByRole('button', { name: `Add ${hostName}` }).waitFor();
  const forSix = host.getByRole('button', { name: 'Add host upgrade for 6 guests (30 total)', exact: true });
  assert.equal(await forSix.count(), 0, 'no per-guest offer without a table in the order');

  const table = page.locator('.event-menu .dish', { has: page.locator('.dish__name', { hasText: new RegExp(`^${TABLE_FOR_SIX}$`) }) });
  await table.getByRole('button', { name: `Add ${TABLE_FOR_SIX}` }).click();
  await expectAdded(page, run, table, TABLE_FOR_SIX);
  await forSix.waitFor();
  assert.equal(await stored(page, HOST_UPGRADE), 0, 'the host upgrade is never added on its own');
  await expectPageBasics(page, run, 'holiday menu with a table in the order');

  let order = await openOrder(page, run);
  assert.doesNotMatch(await order.locator('form.order-form').innerText(), /host upgrade/i, 'no suggestion in the order checklist');
  await closeOrder(page, run, order);

  await forSix.click();
  await host.locator('.stepper__qty', { hasText: /^6$/ }).waitFor();
  assert.equal(await stored(page, HOST_UPGRADE), 6, 'one tap: one for each of the six guests');
  order = await openOrder(page, run);
  const line = order.locator(`.line[data-line="${HOST_UPGRADE}"]`);
  assert.equal((await line.locator('.line__total').innerText()).trim(), '30');
  assert.equal((await line.locator('.line__unit').innerText()).trim(), '5 each');
  if (run.phone) await expectPageBasics(page, run, 'order sheet with the host upgrade');
  await closeOrder(page, run, order);
}

/**
 * A dish sold two at a time: its row says "Minimum 2", "Add 2" puts two in the order, and the
 * amount never drops to one: at two, the − button is a worded "Remove" that takes both out. An
 * amount saved below the minimum (an older visit, another tab) comes back as the minimum, and the
 * page says so.
 */
async function minimumAmount(page, run, base) {
  await page.goto(`${base}/e/${HOLIDAY_EVENT}`);
  const dish = page.locator(`.event-menu .dish[data-item="${MIN_ITEM}"]`);
  await dish.waitFor();
  const name = (await dish.locator('.dish__name').innerText()).trim();
  const qty = dish.locator('.stepper__qty');
  const oneFewer = dish.getByRole('button', { name: `One fewer ${name}` });

  assert.match(await dish.locator('.dish__price').innerText(), /^\d+ Minimum 2$/);
  await dish.getByRole('button', { name: `Add 2 ${name}` }).click();
  await expectAdded(page, run, dish, name);
  assert.equal(await qty.innerText(), '2');
  assert.equal(await stored(page, MIN_ITEM), 2, 'Add put two in the order');
  assert.equal(await oneFewer.count(), 0, 'at the minimum there is no − button');
  await expectPageBasics(page, run, 'a dish at its minimum');

  await dish.getByRole('button', { name: `One more ${name}` }).click();
  await qty.filter({ hasText: /^3$/ }).waitFor();
  await oneFewer.click();
  await qty.filter({ hasText: /^2$/ }).waitFor();
  assert.equal(await oneFewer.count(), 0, 'one fewer than the minimum is never offered');
  assert.equal(await stored(page, MIN_ITEM), 2);

  // The order checklist says the same.
  const order = await openOrder(page, run);
  const line = order.locator(`.line[data-line="${MIN_ITEM}"]`);
  assert.match(await line.locator('.line__unit').innerText(), /each, minimum 2$/);
  assert.equal(await line.getByRole('button', { name: `One fewer ${name}` }).count(), 0);
  await line.getByRole('button', { name: `Remove ${name}` }).waitFor();
  if (run.phone) await expectPageBasics(page, run, 'order sheet with a dish at its minimum');
  await closeOrder(page, run, order);

  await dish.getByRole('button', { name: `Remove ${name}` }).click();
  await dish.getByRole('button', { name: `Add 2 ${name}` }).waitFor();
  assert.equal(await stored(page, MIN_ITEM), 0, 'Remove took both out');

  await page.evaluate(([key, eventId, itemId]) => {
    localStorage.setItem(key, JSON.stringify({ [eventId]: { items: { [itemId]: 1 }, updatedAt: Date.now() } }));
  }, [CART_KEY, HOLIDAY_EVENT, MIN_ITEM]);
  await page.reload();
  await page.locator('.notice', { hasText: `${name} has a minimum of 2` }).waitFor();
  await qty.filter({ hasText: /^2$/ }).waitFor();
  assert.equal(await stored(page, MIN_ITEM), 2, 'a saved amount below the minimum is raised to it');
}

/** After its last order time the pop-up says so in plain words and offers no order controls. */
async function afterLastOrderTime(page, run, base) {
  await page.goto(`${base}/`);
  const card = page.locator('.popup-list .popup', { hasText: HOLIDAY_TITLE });
  await card.waitFor();
  assert.match(await card.innerText(), /Online ordering has closed/);
  assert.equal(await card.locator('.deadline').count(), 0, 'no "Order by" once it has passed');
  await card.getByRole('link', { name: /^See the menu/ }).click();
  await page.waitForURL(new RegExp(`/e/${HOLIDAY_EVENT}$`));
  await page.locator('.notice', { hasText: 'Online ordering has closed' }).waitFor();
  await page.locator('.event-menu .dish').first().waitFor();
  assert.equal(await page.locator('.event-menu button, form.order-form, .order-bar').count(), 0, 'no order controls');
  assert.equal(await page.locator(`.dish[data-item="${LOW_ITEM}"] .dish__note`).innerText(), 'Only 4 left', 'no "until next year" once ordering has closed');
  await expectPageBasics(page, run, 'pop-up page after its last order time');
}

function holidayChecks(devices) {
  const runs = Object.fromEntries(viewports(devices).map((run) => [run.name, run]));
  return [
    { run: runs.desktop, now: BEFORE_LAST_ORDER, label: 'one open pop-up: "Order food for pickup" goes straight to its menu', fn: onlyOpenPopup },
    { run: runs.desktop, now: BEFORE_LAST_ORDER, label: 'the host upgrade for every guest in one tap, never suggested in the checklist', fn: hostUpgradeForEveryGuest },
    { run: runs.phone, now: BEFORE_LAST_ORDER, label: 'the host upgrade for every guest in one tap, never suggested in the checklist', fn: hostUpgradeForEveryGuest },
    { run: runs.desktop, now: BEFORE_LAST_ORDER, label: 'a dish with a minimum of 2 adds 2 and never drops to 1', fn: minimumAmount },
    { run: runs['iPhone SE at 200% text'], now: BEFORE_LAST_ORDER, label: 'a dish with a minimum of 2 adds 2 and never drops to 1', fn: minimumAmount },
    { run: runs.phone, now: AFTER_LAST_ORDER, label: 'after the last order time: "Online ordering has closed", no order controls', fn: afterLastOrderTime },
  ];
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
        await check('a hidden pop-up is not on the calendar', async () => {
          await hiddenPopup(page, run, base);
          // The browser logs the hidden pop-up's 404 from the API itself: that one line is expected.
          const notFound = problems.findIndex((line) => line.includes(HIDDEN_EVENT) && /status of 404/.test(line));
          assert.notEqual(notFound, -1, 'the hidden pop-up was asked for and not found');
          problems.splice(notFound, 1);
        });
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
    for (const { run, now, label, fn } of holidayChecks(devices)) {
      try {
        await withServer(now, (holidayBase) => withPage(browser, run, (page) => fn(page, run, holidayBase)));
        console.log(`ok    ${run.name}: ${label}`);
      } catch (error) {
        failed = true;
        console.log(`FAIL  ${run.name}: ${label}\n      ${String(error.message).split('\n').join('\n      ')}`);
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
