// A pop-up: its details, its menu with plain "Add" buttons, and the order checklist (beside the
// menu on desktop, in a sheet on phones behind the "View order" bar): 1 Your food, 2 Choose a
// pickup time, 3 Your details, an optional tip, the total and Pay, which opens Stripe Checkout.

import { cancelOrder, checkout, getEvent, getSite } from '../api.js';
import * as cart from '../cart.js';
import { h, mount, nextId, prefersReducedMotion } from '../dom.js';
import { formatDate, formatLongDate, formatMoney, formatTimeRange, percentOf, plural, zonedDate } from '../format.js';
import { choiceGroup, clean, emailError, errorSummary, field, phoneError } from '../forms.js';
import { categoryNode, dishNode } from '../menu.js';
import { createSheet } from '../sheet.js';
import { errorState, icon, notice, setBusy, skeleton, spinner } from '../ui.js';

const DESKTOP = '(min-width: 64em)';
const PAY_NEXT = 'Next you’ll pay securely with card, Apple Pay or Google Pay on Stripe’s checkout page.';

const NOTICES = {
  upcoming: (event) => ({
    title: 'Ordering has not opened yet',
    text: `You can look at the menu now. Ordering opens on ${formatLongDate(zonedDate(event.opensAt))}.`,
  }),
  paused: () => ({ title: 'Ordering is paused', text: 'The kitchen has paused new orders for now. Please check back soon.' }),
  soldout: () => ({ title: 'This pop-up is sold out', text: 'Every pickup time or dish has been ordered. Thank you for checking.' }),
  closed: () => ({ title: 'Online ordering has closed', text: 'Ordering for this pop-up has ended.' }),
};

/** A numbered checklist heading with its one helper line. */
function stepHead(n, title, help, { tag = 'div', id } = {}) {
  return h(tag, { class: 'step__head' },
    h('span', { class: 'step__num', 'aria-hidden': 'true' }, String(n)),
    h('span', { class: 'step__text' },
      h('span', { class: 'step__title', id, tabindex: id ? '-1' : null }, h('span', { class: 'visually-hidden' }, `Step ${n}: `), title),
      help ? h('span', { class: 'step__help' }, help) : null));
}

/* ------------------------------------------------------------------------------------ page */

function buildPage(site, detail, ctx, pageNotices) {
  const eventId = detail.event.id;
  const event = detail.event;
  const { maxQtyPerItem, maxItemsPerOrder } = site.order;
  const presets = site.tipPresetsPercent ?? [];
  const draft = cart.getDraft();
  const cleanup = [];
  const open = event.status === 'open';

  let slots = detail.slots;
  let items = new Map(detail.menu.categories.flatMap((category) => category.items.map((item) => [item.id, item])));

  /* --- what just happened: shown on screen and read out by screen readers --- */
  const announcer = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const statusNodes = [];
  function statusNode(className) {
    const node = h('p', { class: ['action-status', className], hidden: true });
    statusNodes.push(node);
    return node;
  }
  function say(text, { tone = 'done', spoken = text } = {}) {
    for (const node of statusNodes) {
      mount(node, icon(tone === 'done' ? 'check' : 'info'), h('span', null, text));
      node.dataset.tone = tone;
      node.hidden = false;
    }
    announcer.textContent = '';
    requestAnimationFrame(() => { announcer.textContent = spoken; });
  }

  /* --- items and quantities --- */
  const capFor = (item) => (item.soldOut ? 0 : Math.min(maxQtyPerItem, item.remaining ?? Infinity));
  const lineItems = () => Object.entries(cart.getItems(eventId))
    .map(([id, qty]) => ({ item: items.get(id), qty }))
    .filter((line) => line.item);
  const orderSummary = () => {
    const lines = lineItems();
    const n = lines.reduce((sum, line) => sum + line.qty, 0);
    const subtotal = lines.reduce((sum, { item, qty }) => sum + item.priceCents * qty, 0);
    return `${plural(n, 'item')}, ${formatMoney(subtotal)}`;
  };

  /** Change an amount. Instead of dead buttons, a limit is explained in words. */
  function change(item, wanted) {
    const before = cart.getQty(eventId, item.id);
    const next = Math.max(0, wanted);
    if (next > before) {
      const cap = capFor(item);
      if (next > cap) {
        const why = cap === 0 ? `${item.name} is sold out.`
          : cap < maxQtyPerItem ? `Only ${cap} ${item.name} are left, and they are all in your order.`
            : `One order can have up to ${maxQtyPerItem} of the same dish. For more, ask about catering.`;
        say(why, { tone: 'info' });
        return;
      }
      if (cart.count(eventId) + (next - before) > maxItemsPerOrder) {
        say(`One order can have up to ${maxItemsPerOrder} items. For a bigger order, ask about catering.`, { tone: 'info' });
        return;
      }
    }
    cart.setQty(eventId, item.id, next);
    const text = next > before ? `Added: ${item.name}` : next === 0 ? `Removed: ${item.name}` : `Removed one: ${item.name}`;
    say(text, { spoken: `${text}. Your order: ${orderSummary()}.` });
  }

  function stepper(item, qty) {
    return h('div', { class: 'stepper', role: 'group', 'aria-label': `${item.name}: ${qty} in your order` },
      h('button', { class: 'stepper__btn', type: 'button', dataset: { role: 'dec' }, 'aria-label': qty === 1 ? `Remove ${item.name}` : `One fewer ${item.name}`, onclick: () => change(item, qty - 1) }, icon('minus')),
      h('span', { class: 'stepper__qty num', 'aria-hidden': 'true' }, String(qty)),
      h('button', { class: 'stepper__btn', type: 'button', dataset: { role: 'inc' }, 'aria-label': `One more ${item.name}`, onclick: () => change(item, qty + 1) }, icon('plus')));
  }

  function control(item) {
    const qty = cart.getQty(eventId, item.id);
    if (qty > 0) {
      return h('div', { class: 'amount' },
        stepper(item, qty),
        h('p', { class: 'amount__note' }, icon('check'), 'In your order'));
    }
    if (capFor(item) === 0) return h('p', { class: 'dish__soldout' }, 'Sold out');
    return h('button', { class: 'btn btn--add', type: 'button', dataset: { role: 'add' }, onclick: () => change(item, 1) },
      icon('plus'), 'Add', h('span', { class: 'visually-hidden' }, ` ${item.name}`));
  }

  /** Focus the button in `slot` that best continues from a button with data-role `role`. */
  const FOCUS_NEXT = { add: ['inc', 'add'], inc: ['inc', 'dec'], dec: ['dec', 'add', 'inc'], remove: [] };
  function focusLike(slot, role) {
    for (const candidate of FOCUS_NEXT[role] ?? []) {
      const target = slot.querySelector(`[data-role="${candidate}"]`);
      if (target) {
        target.focus();
        return true;
      }
    }
    return false;
  }

  /** Re-render a control slot, keeping keyboard focus on the equivalent button. */
  function refill(slot, next) {
    const role = slot.contains(document.activeElement) ? document.activeElement.dataset.role : null;
    mount(slot, next);
    if (role) focusLike(slot, role);
  }

  /* --- top of page --- */
  const statusNotice = !open && NOTICES[event.status] ? NOTICES[event.status](event) : null;
  const directions = event.mapUrl && /^https:\/\//.test(event.mapUrl)
    ? h('a', { class: 'link', href: event.mapUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('pin'), 'Directions (opens a map)')
    : null;
  const top = h('div', { class: 'event-top' },
    h('a', { class: 'back-link', href: '/#popups', 'data-link': '' }, icon('back'), 'Back to all pop-ups'),
    h('h1', { class: 'event-title' }, event.title),
    h('dl', { class: 'facts' },
      h('div', null, h('dt', null, 'Date'), h('dd', null, formatLongDate(event.date))),
      h('div', null, h('dt', null, 'Pickup times'), h('dd', null, h('span', { class: 'num' }, formatTimeRange(event.start, event.end)), h('span', { class: 'muted' }, 'Mountain Time'))),
      h('div', null, h('dt', null, 'Place'), h('dd', null, event.locationName,
        event.address ? h('span', { class: 'muted' }, event.address) : null,
        directions))),
    event.note ? h('p', { class: 'event-note' }, event.note) : null,
    pageNotices.map((entry) => notice(entry)),
    statusNotice ? notice({ ...statusNotice, tone: 'alert' }) : null,
    open ? h('p', { class: 'event-howto' }, 'Add the dishes you want, then choose a pickup time and pay.') : null);

  /* --- menu --- */
  const controlSlots = new Map();
  const dishNodes = new Map();
  function dish(item) {
    const slot = open ? h('div', { class: 'dish__slot' }) : null;
    if (slot) {
      controlSlots.set(item.id, slot);
      mount(slot, control(item));
    }
    const node = dishNode(item, { level: 4, control: slot });
    dishNodes.set(item.id, node);
    return node;
  }
  const menu = h('section', { class: 'event-menu', 'aria-labelledby': 'menu-title' },
    h('h2', { class: 'event-menu__title', id: 'menu-title' }, 'Menu'),
    detail.menu.categories.map((category) => categoryNode(category, { level: 3, id: `menu-${category.id}`, dish })));

  const layout = h('div', { class: ['wrap', 'event-layout', open ? '' : 'event-layout--menu-only'] }, h('div', { class: 'event-main' }, top, menu));
  const node = h('div', { class: 'event-page' }, layout, announcer);
  if (!open) return { node, mounted() {}, destroy() {} };

  /* --- the order checklist --- */
  const summary = errorSummary();
  const panelStatus = statusNode('action-status--panel');

  // 1 Your food
  const linesBox = h('ul', { class: 'lines' });
  const itemsTitleId = nextId('items');
  const itemsError = h('p', { class: 'field__error', 'aria-live': 'polite' });
  const itemsStep = h('section', { class: 'step', 'aria-labelledby': itemsTitleId },
    stepHead(1, 'Your food', 'Change amounts or remove dishes here.', { id: itemsTitleId }), linesBox, itemsError);

  // 2 Choose a pickup time: only times that can be chosen are shown
  const slotOptions = () => slots.filter((slot) => slot.available).map((slot) => ({ value: slot.time, label: slot.label }));
  const slotHint = () => {
    const full = slots.some((slot) => !slot.available && slot.remaining === 0);
    if (!slots.some((slot) => slot.available)) return 'There are no pickup times left for this pop-up.';
    return full ? 'Times that are already full are not shown.' : '';
  };
  const slotGroup = choiceGroup({
    name: 'slot',
    legendNode: stepHead(2, 'Choose a pickup time', 'Pick when you will come to get your food. Times are Mountain Time.', { tag: 'legend' }),
    hint: slotHint(),
    className: 'choices--times',
    options: slotOptions(),
    onChange: (value) => {
      cart.saveDraft({ slots: { ...cart.getDraft().slots, [eventId]: value } });
      update();
    },
  });
  slotGroup.node.classList.add('step');
  const savedSlot = draft.slots?.[eventId];
  if (slots.some((slot) => slot.time === savedSlot && slot.available)) slotGroup.select(savedSlot);

  // 3 Your details
  const remember = (key) => (input) => input.addEventListener('input', () => {
    cart.saveDraft({ [key]: input.value });
    showMissing();
  });
  const name = field({ name: 'name', label: 'Your name', hint: 'We say this name when we hand you your food.',
    attrs: { autocomplete: 'name', autocapitalize: 'words', maxlength: 80, enterkeyhint: 'next', value: draft.name ?? '' },
    validate: (v) => (clean(v) ? null : 'Enter your name.') });
  const phone = field({ name: 'phone', label: 'Mobile number', type: 'tel', hint: 'For example: 505 555 0142',
    attrs: { autocomplete: 'tel', inputmode: 'tel', maxlength: 20, enterkeyhint: 'next', value: draft.phone ?? '' },
    validate: (v) => phoneError(v, { required: true }) });
  const email = field({ name: 'email', label: 'Email', type: 'email', hint: 'For your receipt. For example: name@example.com',
    attrs: { autocomplete: 'email', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', maxlength: 254, enterkeyhint: 'done', value: draft.email ?? '' },
    validate: emailError });
  const notes = field({ name: 'notes', label: 'Note for the kitchen', optional: true, multiline: true, max: 300, hint: 'Allergies or anything else we should know.',
    attrs: { rows: 2, value: draft.notes ?? '' },
    validate: (v) => (v.trim().length > 300 ? 'Keep the note to 300 characters.' : null) });
  remember('name')(name.input);
  remember('phone')(phone.input);
  remember('email')(email.input);
  remember('notes')(notes.input);
  const detailsStep = h('fieldset', { class: 'step' },
    stepHead(3, 'Your details', 'We only contact you about this order.', { tag: 'legend' }),
    h('div', { class: 'form' }, name.node, phone.node, email.node, notes.node));

  // Tip: optional, "No tip" unless the customer picks one
  let tipPercent = presets.includes(draft.tip) ? draft.tip : presets.includes(0) ? 0 : presets[0] ?? 0;
  const tipGroup = choiceGroup({
    name: 'tip',
    legendNode: h('legend', { class: 'tip__legend' }, 'Add a tip (optional)'),
    hint: 'Tips go to the kitchen crew.',
    className: 'choices--tips',
    options: presets.map((percent) => ({ value: String(percent), label: percent === 0 ? 'No tip' : `${percent}%`, sub: '' })),
    onChange: (value) => {
      tipPercent = Number(value);
      cart.saveDraft({ tip: tipPercent });
      update();
    },
  });
  tipGroup.node.classList.add('tip');
  tipGroup.select(String(tipPercent));

  const totals = h('dl', { class: 'totals' });
  const missing = h('p', { class: 'pay__missing', hidden: true });
  const payButton = h('button', { class: 'btn btn--primary btn--lg btn--block', type: 'submit' });
  const pay = h('div', { class: 'pay' },
    missing,
    payButton,
    h('p', { class: 'pay__next' }, icon('lock'), PAY_NEXT));

  const form = h('form', { class: 'order-form', novalidate: true, 'aria-labelledby': 'order-title' },
    h('h2', { class: 'order-form__title', id: 'order-title' }, 'Your order'),
    site.payments?.mode === 'demo' ? h('p', { class: 'demo-flag' }, 'Demo mode — no real charges') : null,
    site.payments?.mode === 'disabled' ? h('p', { class: 'demo-flag' }, 'Online payment is switched off right now, so orders cannot be placed.') : null,
    panelStatus,
    summary.node,
    itemsStep,
    slotGroup.node,
    detailsStep,
    tipGroup.node,
    totals,
    pay);

  function computeTotals() {
    const subtotal = lineItems().reduce((sum, { item, qty }) => sum + item.priceCents * qty, 0);
    const tax = percentOf(subtotal, site.taxRatePercent);
    const tip = percentOf(subtotal, tipPercent);
    return { subtotal, tax, tip, total: subtotal + tax + tip };
  }

  /** What still has to happen before paying, in one sentence (or nothing). */
  function whatIsMissing() {
    if (!lineItems().length) return 'Add at least one dish to continue.';
    if (!slotGroup.value()) return slotOptions().length ? 'Choose a pickup time to continue.' : 'There are no pickup times left, so this order cannot be placed.';
    const left = [
      [name, 'your name'],
      [phone, 'your mobile number'],
      [email, 'your email'],
    ].filter(([f]) => f.node.classList.contains('is-invalid') || !clean(f.value())).map(([, label]) => label);
    if (left.length) {
      const list = left.length > 1 ? `${left.slice(0, -1).join(', ')} and ${left.at(-1)}` : left[0];
      return `Fill in ${list} to continue.`;
    }
    return '';
  }
  function showMissing() {
    const text = whatIsMissing();
    missing.textContent = text;
    missing.hidden = !text;
  }

  let busy = false;
  function update() {
    const lines = lineItems();
    const sums = computeTotals();
    const active = document.activeElement;
    const focusLine = linesBox.contains(active) ? active.closest('[data-line]')?.dataset.line : null;
    const rows = lines.map(({ item, qty }) => h('li', { class: 'line', dataset: { line: item.id } },
      h('p', { class: 'line__top' },
        h('span', { class: 'line__name' }, item.name),
        h('span', { class: 'line__total num' }, formatMoney(item.priceCents * qty))),
      h('p', { class: 'line__unit num' }, `${formatMoney(item.priceCents)} each`),
      h('div', { class: 'line__controls' },
        stepper(item, qty),
        h('button', { class: 'btn btn--text', type: 'button', dataset: { role: 'remove' }, onclick: () => change(item, 0) },
          'Remove', h('span', { class: 'visually-hidden' }, ` ${item.name}`)))));
    mount(linesBox, rows.length ? rows : h('li', { class: 'lines-empty' }, 'No dishes yet. Use the Add buttons on the menu.'));
    if (focusLine) {
      const slot = linesBox.querySelector(`[data-line="${CSS.escape(focusLine)}"]`);
      if (!slot || !focusLike(slot, active.dataset.role)) document.getElementById(itemsTitleId)?.focus();
    }
    if (lines.length) itemsError.replaceChildren();

    tipGroup.setSubs((value) => (value === '0' ? '' : formatMoney(percentOf(sums.subtotal, Number(value)))));

    mount(totals,
      h('div', null, h('dt', null, 'Food'), h('dd', { class: 'num' }, formatMoney(sums.subtotal))),
      h('div', null, h('dt', null, site.taxLabel || 'Tax'), h('dd', { class: 'num' }, formatMoney(sums.tax))),
      h('div', null, h('dt', null, 'Tip'), h('dd', { class: 'num' }, formatMoney(sums.tip))),
      h('div', { class: 'totals__grand' }, h('dt', null, 'Total'), h('dd', { class: 'num' }, formatMoney(sums.total))));

    if (!busy) mount(payButton, icon('lock'), `Pay ${formatMoney(sums.total)}`);
    payButton.disabled = busy || site.payments?.mode === 'disabled';
    showMissing();

    for (const [id, slot] of controlSlots) {
      const item = items.get(id);
      if (item) refill(slot, control(item));
    }
    bar.update(lines.reduce((sum, line) => sum + line.qty, 0), sums.subtotal);
  }

  /* --- phone: the "View order" bar and the sheet --- */
  const bar = (() => {
    const label = h('span', { class: 'order-bar__label' });
    const button = h('button', { class: 'order-bar__button', type: 'button', onclick: () => openOrder() }, label);
    const wrap = h('div', { class: 'order-bar', hidden: true }, statusNode('action-status--bar'), button);
    // Keep focused and scrolled-to content clear of the bar: the page's scroll padding follows its height.
    const root = document.documentElement;
    const sizer = new ResizeObserver(() => root.style.setProperty('--order-bar-h', `${wrap.offsetHeight}px`));
    sizer.observe(wrap);
    cleanup.push(() => {
      sizer.disconnect();
      root.style.removeProperty('--order-bar-h');
    });
    return {
      node: wrap,
      update(n, subtotal) {
        mount(label, h('strong', null, 'View order'), ` — ${plural(n, 'item')}, ${formatMoney(subtotal)}`);
        wrap.hidden = n === 0;
      },
    };
  })();
  const sheet = createSheet({ title: 'Your order', key: `order-${eventId}`, className: 'order-sheet' });
  const panelSlot = h('aside', { class: 'panel-slot', id: 'order', 'aria-label': 'Your order' });
  layout.append(panelSlot);
  node.append(bar.node);

  const desktop = matchMedia(DESKTOP);
  function place() {
    if (desktop.matches) {
      if (sheet.isOpen()) sheet.close();
      panelSlot.append(form);
    } else {
      sheet.body.append(form);
    }
  }
  desktop.addEventListener('change', place);
  place();

  function openOrder() {
    if (desktop.matches) {
      panelSlot.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
      document.getElementById(itemsTitleId)?.focus({ preventScroll: true });
      return;
    }
    sheet.open();
  }

  // Back from Stripe with the browser's back button: the page may come from the back/forward
  // cache still showing "Opening secure checkout".
  const onPageShow = (pageEvent) => {
    if (!pageEvent.persisted || !busy) return;
    busy = false;
    setBusy(payButton, false);
    update();
  };
  addEventListener('pageshow', onPageShow);

  cleanup.push(
    cart.subscribe(update),
    () => removeEventListener('pageshow', onPageShow),
    () => desktop.removeEventListener('change', place),
    () => {
      sheet.close({ silent: true });
      sheet.el.remove();
    },
  );

  /* --- live data refresh (after a conflict at checkout) --- */
  async function reload() {
    const fresh = await getEvent(eventId);
    if (fresh.event.status !== 'open') return false;
    slots = fresh.slots;
    items = new Map(fresh.menu.categories.flatMap((category) => category.items.map((item) => [item.id, item])));
    cart.reconcile(eventId, [...items.values()], maxQtyPerItem);
    for (const [id, old] of dishNodes) {
      const item = items.get(id);
      if (!item) continue;
      const replacement = dishNode(item, { level: 4, control: controlSlots.get(id) });
      old.replaceWith(replacement);
      dishNodes.set(id, replacement);
    }
    slotGroup.set(slotOptions());
    slotGroup.setHint(slotHint());
    update();
    return true;
  }

  /* --- validation and checkout --- */
  function validate() {
    const problems = [];
    if (lineItems().length === 0) {
      const message = 'Add at least one dish from the menu.';
      mount(itemsError, icon('alert'), h('span', null, message));
      problems.push({ message, target: document.getElementById(itemsTitleId) });
    }
    if (!slotGroup.value()) {
      const message = 'Choose a pickup time.';
      slotGroup.setError(message);
      problems.push({ message, target: slotGroup.target() });
    }
    for (const f of [name, phone, email, notes]) {
      const message = f.check();
      if (message) problems.push({ message, target: f.input });
    }
    return problems;
  }

  const fieldsByServerName = { 'customer.name': name, 'customer.phone': phone, 'customer.email': email, notes };

  async function handleCheckoutError(error) {
    switch (error.code) {
      case 'slot_unavailable': {
        const message = 'That pickup time just filled up. Please choose another time.';
        if (!(await reload().catch(() => true))) return closedNow();
        slotGroup.select(null);
        slotGroup.setError(message);
        showMissing();
        summary.show('Your pickup time is no longer free', [{ message, target: slotGroup.target() }]);
        return;
      }
      case 'sold_out': {
        const { itemId, remaining } = error.details ?? {};
        if (itemId) cart.setQty(eventId, itemId, Math.max(0, remaining ?? 0));
        if (!(await reload().catch(() => true))) return closedNow();
        const message = `${error.message} We changed your order to match. Check it, then press Pay again.`;
        mount(itemsError, icon('alert'), h('span', null, message));
        summary.show('Your order changed', [{ message, target: document.getElementById(itemsTitleId) }]);
        return;
      }
      case 'event_closed':
        return closedNow();
      case 'invalid': {
        const target = fieldsByServerName[error.field];
        if (target) {
          target.setError(error.message);
          summary.show('Please check this', [{ message: error.message, target: target.input }]);
        } else if (error.field === 'slot') {
          slotGroup.setError(error.message);
          summary.show('Please check this', [{ message: error.message, target: slotGroup.target() }]);
        } else {
          summary.show('Please check your order', [{ message: error.message, target: document.getElementById(itemsTitleId) }]);
        }
        return;
      }
      case 'rate_limited':
        return summary.show('Too many tries in a short time', [{ message: 'Wait a minute, then press Pay again.' }]);
      case 'payments_unavailable':
        return summary.show('Online payment is not available', [{ message: 'Payments are switched off right now. Please try again later.' }]);
      case 'payment_provider_error':
        return summary.show('The payment page did not open', [{ message: 'Stripe did not answer. You were not charged. Press Pay again in a moment.' }]);
      default:
        return summary.show('The payment page did not open', [{ message: error.message }]);
    }
  }

  function closedNow() {
    ctx.navigate(`/e/${encodeURIComponent(eventId)}`, { replace: true });
  }

  form.addEventListener('submit', async (submitEvent) => {
    submitEvent.preventDefault();
    if (busy) return;
    const problems = validate();
    if (problems.length) {
      summary.show(problems.length === 1 ? 'One thing to fix before paying' : `${problems.length} things to fix before paying`, problems);
      return;
    }
    summary.hide();
    busy = true;
    setBusy(payButton, true);
    mount(payButton, spinner(), 'Opening the secure payment page');
    try {
      const result = await checkout({
        eventId,
        slot: slotGroup.value(),
        items: lineItems().map(({ item, qty }) => ({ id: item.id, qty })),
        customer: { name: clean(name.value()), email: clean(email.value()), phone: clean(phone.value()) },
        notes: notes.value().trim(),
        tipPercent,
      });
      const url = new URL(result.url, location.href);
      if (url.protocol !== 'https:' && url.origin !== location.origin) throw new Error('Unexpected checkout address');
      window.location.assign(url.href);
    } catch (error) {
      busy = false;
      setBusy(payButton, false);
      update();
      await handleCheckoutError(error);
    }
  });

  return {
    node,
    mounted() {
      update();
      // Arrived on the history entry of an open sheet (Back from the payment page): open it again.
      if (sheet.ownsEntry() && !desktop.matches && cart.count(eventId) > 0) sheet.open();
    },
    destroy: () => cleanup.forEach((fn) => fn()),
  };
}

/* ------------------------------------------------------------------------------------ view */

export function render(ctx) {
  const eventId = ctx.params.id;
  const root = h('div');
  const loading = () => mount(root, h('div', { class: 'wrap event-top' }, skeleton(2, { className: 'skeleton--title' }), skeleton(5)));
  const controller = new AbortController();
  let page = null;

  let canceled = ctx.query.get('canceled');

  /** Back from a canceled payment page: release the held time and stock, keep the cart.
   *  Resolves 'paid' when the order turned out to be paid, else a notice (or null). */
  async function releaseCanceledCheckout() {
    const code = canceled;
    const viewToken = ctx.query.get('k');
    canceled = null;
    if (!code) return null;
    ctx.replaceUrl(`/e/${encodeURIComponent(eventId)}${ctx.hash}`);
    if (!viewToken) return null;
    try {
      await cancelOrder(code, viewToken);
    } catch (error) {
      if (error.code === 'already_paid') {
        ctx.navigate(`/order/${encodeURIComponent(code)}?k=${encodeURIComponent(viewToken)}`, { replace: true });
        return 'paid';
      }
    }
    return { title: 'You have not paid yet', text: 'You left the payment page, so nothing was charged. Your order is saved below.' };
  }

  async function load() {
    loading();
    const notices = [];
    const released = await releaseCanceledCheckout();
    if (released === 'paid') return;
    if (released) notices.push(released);
    try {
      const [site, detail] = await Promise.all([getSite(), getEvent(eventId, { signal: controller.signal })]);
      if (detail.event.status === 'open') {
        const changed = cart.reconcile(eventId, detail.menu.categories.flatMap((category) => category.items), site.order.maxQtyPerItem);
        if (changed.length) {
          notices.push({
            title: 'We updated your order',
            text: `${changed.join(', ')} ${changed.length === 1 ? 'has' : 'have'} sold out or only a few left, so we changed the amount in your order.`,
          });
        }
      }
      page = buildPage(site, detail, ctx, notices);
      mount(root, page.node);
      ctx.setTitle(`${detail.event.title}, ${formatDate(detail.event.date)}`);
      page.mounted();
    } catch (error) {
      if (controller.signal.aborted) return;
      mount(root, h('div', { class: 'wrap' }, error.status === 404
        ? errorState({
          title: 'This pop-up is not on the calendar',
          message: 'It may have ended, or the link may be old.',
          action: h('a', { class: 'btn btn--primary', href: '/#popups', 'data-link': '' }, 'See upcoming pop-ups'),
        })
        : errorState({ message: error.message, onRetry: load })));
    }
  }

  const ready = load();
  return {
    node: root,
    title: 'Pop-up',
    ready,
    destroy() {
      controller.abort();
      page?.destroy();
    },
  };
}
