// A pop-up: its details, its menu with plain "Add" buttons, and the order checklist (beside the
// menu on desktop, in a sheet on phones behind the "View order" bar): 1 Your food,
// 2 Choose a pickup time, an optional tip, the total and one Pay button. Pay opens Stripe
// Checkout, where Apple Pay, Google Pay or Link fill in the name, email and mobile number, so the
// customer types nothing here.

import { cancelOrder, checkout, getEvent, getSite } from '../api.js';
import * as cart from '../cart.js';
import { h, mount, nextId, prefersReducedMotion } from '../dom.js';
import { formatDate, formatLongDate, formatMoney, formatTimeRange, orderByLabel, percentOf, plural, zonedDate } from '../format.js';
import { choiceGroup, errorSummary, field } from '../forms.js';
import { categoryNode, dishNode } from '../menu.js';
import { createSheet } from '../sheet.js';
import { errorState, icon, notice, setBusy, skeleton, spinner } from '../ui.js';

const DESKTOP = '(min-width: 64em)';
const PAY_NEXT = 'Next: pay in one tap with Apple Pay or Google Pay, or enter a card. Secured by Stripe.';
const PAY_CONTACT = 'Stripe asks for your name, email and mobile number there, so you don’t type them here.';

/* The host upgrade is sold one per guest. With a holiday table in the order, its Add button offers
   one for every guest the tables serve, in a single tap, and says what that costs (never added
   on its own). */
const HOST_UPGRADE = 'host-upgrade';
const TABLE_GUESTS = new Map([['harvest-table-for-two', 2], ['harvest-table-for-six', 6], ['winter-feast-table-for-six', 6]]);

const NOTICES = {
  upcoming: (event) => ({
    title: 'Ordering has not opened yet',
    text: `You can look at the menu now. Ordering opens on ${formatLongDate(zonedDate(event.opensAt))}.`,
  }),
  paused: () => ({ title: 'Ordering is paused', text: 'The kitchen has paused new orders for now. Please check back soon.' }),
  soldout: () => ({ title: 'This pop-up is sold out', text: 'Every pickup time or dish has been claimed. New dates are posted on the home page.' }),
  closed: () => ({ title: 'Online ordering has closed', text: 'Ordering for this pop-up has ended.' }),
};

/** One sentence for a dish whose saved amount no longer fits the live menu. */
function changeNote({ name, before, after }) {
  if (after === 0) return `${name} is sold out, so we took it out of your order.`;
  if (after > before) return `${name} has a minimum of ${after}, so we changed your order from ${before} to ${after}.`;
  return `${name}: only ${after} can be ordered now, so we changed your order from ${before} to ${after}.`;
}

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
  // Holiday pre-orders close days before pickup and come back only next year: while one is taking
  // orders, its low-stock notes say so.
  const seasonal = open && Boolean(event.ordersCloseAt);

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
  const capFor = (item) => cart.capOf(item, maxQtyPerItem);
  /** At a dish's minimum (above 1), one fewer would be too few, so the dish can only come out. */
  const atMinimum = (item, qty) => cart.minQtyOf(item) > 1 && qty <= cart.minQtyOf(item);
  const lineItems = () => Object.entries(cart.getItems(eventId))
    .map(([id, qty]) => ({ item: items.get(id), qty }))
    .filter((line) => line.item);
  /** How many guests the holiday tables in the order serve (0 without a table). */
  const tableGuests = () => lineItems().reduce((sum, { item, qty }) => sum + (TABLE_GUESTS.get(item.id) ?? 0) * qty, 0);
  const orderSummary = () => {
    const lines = lineItems();
    const n = lines.reduce((sum, line) => sum + line.qty, 0);
    const subtotal = lines.reduce((sum, { item, qty }) => sum + item.priceCents * qty, 0);
    return `${plural(n, 'item')}, ${formatMoney(subtotal)}`;
  };

  /** Change an amount. Instead of dead buttons, a limit is explained in words. */
  function change(item, wanted) {
    const before = cart.getQty(eventId, item.id);
    const min = cart.minQtyOf(item);
    let next = Math.max(0, wanted);
    // A dish with a minimum goes from none straight to the minimum, and from the minimum to none.
    if (next > 0 && next < min) next = next > before ? min : 0;
    if (next > before) {
      const cap = capFor(item);
      if (next > cap) {
        const why = cap === 0 ? `${item.name} is sold out.`
          : cap < maxQtyPerItem ? `Only ${cap} left of ${item.name}, and they’re all in your order.`
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

  /** − amount +. At a dish's minimum the − button becomes a worded "Remove" instead. */
  function stepper(item, qty) {
    return h('div', { class: 'stepper', role: 'group', 'aria-label': `${item.name}: ${qty} in your order` },
      atMinimum(item, qty)
        ? h('button', { class: 'stepper__btn stepper__btn--word', type: 'button', dataset: { role: 'remove' }, onclick: () => change(item, 0) },
          'Remove', h('span', { class: 'visually-hidden' }, ` ${item.name}`))
        : h('button', { class: 'stepper__btn', type: 'button', dataset: { role: 'dec' }, 'aria-label': `One fewer ${item.name}`, onclick: () => change(item, qty - 1) }, icon('minus')),
      h('span', { class: 'stepper__qty num', 'aria-hidden': 'true' }, String(qty)),
      h('button', { class: 'stepper__btn', type: 'button', dataset: { role: 'inc' }, 'aria-label': `One more ${item.name}`, onclick: () => change(item, qty + 1) }, icon('plus')));
  }

  /** Takes the dish out of the order, in words (the − button does the same one at a time). Not
   *  needed at a dish's minimum, where the stepper already says "Remove". */
  function removeButton(item, qty) {
    if (atMinimum(item, qty)) return null;
    return h('button', { class: 'btn btn--text', type: 'button', dataset: { role: 'remove' }, onclick: () => change(item, 0) },
      'Remove', h('span', { class: 'visually-hidden' }, ` ${item.name}`));
  }

  function control(item) {
    const qty = cart.getQty(eventId, item.id);
    if (qty > 0) {
      return h('div', { class: 'amount' },
        stepper(item, qty),
        h('p', { class: 'amount__note' }, icon('check'), 'In your order'),
        removeButton(item, qty));
    }
    if (capFor(item) === 0) return h('p', { class: 'dish__soldout' }, 'Sold out');
    const guests = item.id === HOST_UPGRADE ? tableGuests() : 0;
    if (guests > 1 && guests <= capFor(item)) {
      return h('button', { class: 'btn btn--add', type: 'button', dataset: { role: 'add' }, onclick: () => change(item, guests) },
        icon('plus'), `Add host upgrade for ${guests} guests (${formatMoney(item.priceCents * guests)} total)`);
    }
    const min = cart.minQtyOf(item);
    return h('button', { class: 'btn btn--add', type: 'button', dataset: { role: 'add' }, onclick: () => change(item, min) },
      icon('plus'), min > 1 ? `Add ${min}` : 'Add', h('span', { class: 'visually-hidden' }, ` ${item.name}`));
  }

  /** Focus the button in `slot` that best continues from a button with data-role `role`. */
  const FOCUS_NEXT = { add: ['inc', 'add'], inc: ['inc', 'dec'], dec: ['dec', 'remove', 'add', 'inc'], remove: ['add'] };
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
  const orderBy = orderByLabel(event);
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
    orderBy ? h('p', { class: 'deadline' }, orderBy) : null,
    event.note ? h('p', { class: 'event-note' }, event.note) : null,
    pageNotices.map((entry) => notice(entry)),
    statusNotice ? notice({ ...statusNotice, tone: 'alert' }) : null,
    open ? h('p', { class: 'event-howto' }, 'Three steps: add your dishes, choose a pickup time, then pay.') : null);

  /* --- menu --- */
  const controlSlots = new Map();
  const dishNodes = new Map();
  function dish(item) {
    const slot = open ? h('div', { class: 'dish__slot' }) : null;
    if (slot) {
      controlSlots.set(item.id, slot);
      mount(slot, control(item));
    }
    const node = dishNode(item, { level: 4, control: slot, seasonal });
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

  // 1 Your food, with an optional note for the kitchen
  const linesBox = h('ul', { class: 'lines' });
  const itemsTitleId = nextId('items');
  const itemsError = h('p', { class: 'field__error', 'aria-live': 'polite' });
  const notes = field({ name: 'notes', label: 'Allergies or a note for the kitchen', optional: true, multiline: true, max: 300,
    hint: 'Most of our menu is naturally gluten-free and plant-forward. Tell us about allergies or dietary needs — there’s never an extra charge.',
    attrs: { rows: 2, value: draft.notes ?? '' },
    validate: (v) => (v.trim().length > 300 ? 'Keep the note to 300 characters.' : null) });
  notes.input.addEventListener('input', () => cart.saveDraft({ notes: notes.input.value }));
  const itemsStep = h('section', { class: 'step', 'aria-labelledby': itemsTitleId },
    stepHead(1, 'Your food', 'Change how many, or remove a dish.', { id: itemsTitleId }), linesBox, itemsError, notes.node);

  // 2 Choose a pickup time: only times that can be chosen are shown
  const slotOptions = () => slots.filter((slot) => slot.available).map((slot) => ({ value: slot.time, label: slot.label }));
  const slotHint = () => {
    const full = slots.some((slot) => !slot.available && slot.remaining === 0);
    if (!slots.some((slot) => slot.available)) return 'Every pickup time for this pop-up has been taken.';
    return full ? 'Some times have already filled up. Every time shown here is still open.' : '';
  };
  const slotGroup = choiceGroup({
    name: 'slot',
    legendNode: stepHead(2, 'Choose a pickup time', 'Pick when you’ll come for your food. All times are Mountain Time.', { tag: 'legend' }),
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
    h('div', { class: 'pay__next' }, h('p', null, icon('lock'), PAY_NEXT), h('p', null, PAY_CONTACT)));

  // On desktop the steps scroll inside the panel and Pay stays in view below them.
  const steps = h('div', { class: 'order-form__steps' },
    h('h2', { class: 'order-form__title', id: 'order-title' }, 'Your order'),
    site.payments?.mode === 'demo' ? h('p', { class: 'demo-flag' }, 'Demo mode — no real charges') : null,
    site.payments?.mode === 'disabled' ? h('p', { class: 'demo-flag' }, 'Online payment is off right now, so orders can’t be placed here.') : null,
    panelStatus,
    summary.node,
    itemsStep,
    slotGroup.node,
    tipGroup.node,
    totals);
  const form = h('form', { class: 'order-form', novalidate: true, 'aria-labelledby': 'order-title' }, steps, pay);

  function computeTotals() {
    const subtotal = lineItems().reduce((sum, { item, qty }) => sum + item.priceCents * qty, 0);
    const tax = percentOf(subtotal, site.taxRatePercent);
    const tip = percentOf(subtotal, tipPercent);
    return { subtotal, tax, tip, total: subtotal + tax + tip };
  }

  /** What still has to happen before paying, in one sentence (or nothing). */
  function whatIsMissing() {
    if (!lineItems().length) return 'Add at least one dish to continue.';
    if (!slotGroup.value()) return slotOptions().length ? 'Choose a pickup time to continue.' : 'Every pickup time has been taken, so this order can’t be placed online.';
    return '';
  }

  // True while the summary lists what Pay found missing; it goes away once nothing is.
  let summaryListsMissing = false;
  function showMissing() {
    const text = whatIsMissing();
    missing.textContent = text;
    missing.hidden = !text;
    if (!text && summaryListsMissing) {
      summary.hide();
      summaryListsMissing = false;
    }
  }

  let busy = false;
  function update() {
    const lines = lineItems();
    const sums = computeTotals();
    const active = document.activeElement;
    const focusLine = linesBox.contains(active) ? active.closest('[data-line]')?.dataset.line : null;
    const rows = lines.map(({ item, qty }) => {
      const min = cart.minQtyOf(item);
      return h('li', { class: 'line', dataset: { line: item.id } },
        h('p', { class: 'line__top' },
          h('span', { class: 'line__name' }, item.name),
          h('span', { class: 'line__total num' }, formatMoney(item.priceCents * qty))),
        h('p', { class: 'line__unit num' }, `${formatMoney(item.priceCents)} each`, min > 1 ? `, minimum ${min}` : null),
        h('div', { class: 'line__controls' }, stepper(item, qty), removeButton(item, qty)));
    });
    mount(linesBox, rows.length ? rows : h('li', { class: 'lines-empty' }, 'Nothing added yet. Press Add next to any dish.'));
    if (focusLine) {
      const slot = linesBox.querySelector(`[data-line="${CSS.escape(focusLine)}"]`);
      if (!slot || !focusLike(slot, active.dataset.role)) document.getElementById(itemsTitleId)?.focus();
    }
    if (lines.length) itemsError.replaceChildren();

    tipGroup.setSubs((value) => (value === '0' ? '' : formatMoney(percentOf(sums.subtotal, Number(value)))));

    mount(totals,
      h('div', null, h('dt', null, 'Items'), h('dd', { class: 'num' }, formatMoney(sums.subtotal))),
      h('div', null, h('dt', null, site.taxLabel || 'Tax'), h('dd', { class: 'num' }, formatMoney(sums.tax))),
      h('div', null, h('dt', null, 'Tip'), h('dd', { class: 'num' }, formatMoney(sums.tip))),
      h('div', { class: 'totals__grand' }, h('dt', null, 'Total'), h('dd', { class: 'num' }, formatMoney(sums.total))));

    if (!busy) mount(payButton, icon('lock'), lines.length ? `Pay ${formatMoney(sums.total)}` : 'Pay');
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
    const sizer = new ResizeObserver(() => {
      wrap.classList.toggle('is-compact', button.offsetHeight > innerHeight * 0.15);
      root.style.setProperty('--order-bar-h', `${wrap.offsetHeight}px`);
    });
    sizer.observe(wrap);
    sizer.observe(button);
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
      steps.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
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
      const replacement = dishNode(item, { level: 4, control: controlSlots.get(id), seasonal });
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
    const message = notes.check();
    if (message) problems.push({ message, target: notes.input });
    return problems;
  }

  async function handleCheckoutError(error) {
    switch (error.code) {
      case 'slot_unavailable': {
        if (!(await reload().catch(() => true))) return closedNow();
        slotGroup.select(null);
        slotGroup.setError('That pickup time just filled up. Please choose another time.');
        showMissing();
        summary.show('That pickup time just filled up', [{ message: 'Please choose another time below.', target: slotGroup.target() }]);
        return;
      }
      case 'sold_out': {
        const { itemId, remaining = 0 } = error.details ?? {};
        const item = items.get(itemId);
        // Keep what is left, unless that is fewer than the dish's minimum.
        if (item) cart.setQty(eventId, itemId, remaining >= cart.minQtyOf(item) ? remaining : 0);
        if (!(await reload().catch(() => true))) return closedNow();
        const message = `${error.message} We changed your order to match. Check it, then press Pay again.`;
        mount(itemsError, icon('alert'), h('span', null, message));
        summary.show('Your order changed', [{ message, target: document.getElementById(itemsTitleId) }]);
        return;
      }
      case 'event_closed':
        return closedNow();
      case 'invalid': {
        if (error.field === 'notes') {
          notes.setError(error.message);
          summary.show('Please check this', [{ message: error.message, target: notes.input }]);
        } else if (error.field === 'slot') {
          slotGroup.setError(error.message);
          summary.show('Please check this', [{ message: error.message, target: slotGroup.target() }]);
        } else {
          if (error.field === 'items') mount(itemsError, icon('alert'), h('span', null, error.message));
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
      summaryListsMissing = true;
      return;
    }
    summary.hide();
    summaryListsMissing = false;
    busy = true;
    setBusy(payButton, true);
    mount(payButton, spinner(), 'Opening Stripe’s secure payment page');
    try {
      const result = await checkout({
        eventId,
        slot: slotGroup.value(),
        items: lineItems().map(({ item, qty }) => ({ id: item.id, qty })),
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
    return { title: 'You haven’t paid yet', text: 'You left the payment page, so nothing was charged. Your order is saved below. Press Pay when you’re ready.' };
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
        if (changed.length) notices.push({ title: 'We updated your order', text: changed.map(changeNote).join(' ') });
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
