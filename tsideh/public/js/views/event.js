// A pop-up: its menu as type, and the order panel (beside the menu on desktop, in a bottom sheet
// on phones): items, pickup time, details, tip, totals, then Stripe Checkout.

import { cancelOrder, checkout, getEvent, getSite } from '../api.js';
import { drawTile, seedFrom } from '../art.js';
import * as cart from '../cart.js';
import { h, mount, nextId, prefersReducedMotion } from '../dom.js';
import { drawDotField } from '../dots.js';
import { eventStatusLabel, formatDate, formatLongDate, formatMoney, formatMonthDay, formatTimeRange, formatWeekday, percentOf, plural, zonedDate } from '../format.js';
import { choiceGroup, clean, emailError, errorSummary, field, phoneError } from '../forms.js';
import { categoryNode, dishNode } from '../menu.js';
import { createDialog } from '../sheet.js';
import { errorState, icon, lazyArt, setBusy, skeleton, spinner, toast, token } from '../ui.js';

const DESKTOP = '(min-width: 1024px)';
const CANCELED_MESSAGE = 'Checkout canceled — your cart is saved.';

const NOTICES = {
  upcoming: (event) => ({
    title: eventStatusLabel(event),
    text: `Have a look at the menu now. Pickup times open on ${formatLongDate(zonedDate(event.opensAt))}.`,
  }),
  paused: () => ({ title: 'Orders are paused', text: 'The kitchen has paused new orders for a moment. Check back soon.' }),
  soldout: () => ({ title: 'Sold out', text: 'Every pickup time or dish for this pop-up is spoken for.' }),
  closed: () => ({ title: 'Orders are closed', text: 'Online ordering for this pop-up has ended.' }),
};

function stepHead(n, title, { tag = 'div', id } = {}) {
  return h(tag, { class: 'step__head' },
    h('span', { class: 'step__num', 'aria-hidden': 'true' }, String(n)),
    h('span', { class: 'step__title', id, tabindex: id ? '-1' : null }, title));
}

/* ------------------------------------------------------------------------------------ page */

function buildPage(site, detail, ctx) {
  const eventId = detail.event.id;
  const enc = encodeURIComponent;
  const { maxQtyPerItem, maxItemsPerOrder } = site.order;
  const presets = site.tipPresetsPercent ?? [];
  const draft = cart.getDraft();
  const cleanup = [];

  const event = detail.event;
  let slots = detail.slots;
  let items = new Map(detail.menu.categories.flatMap((category) => category.items.map((item) => [item.id, item])));
  const open = event.status === 'open';

  const announcer = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const announce = (text) => {
    announcer.textContent = '';
    requestAnimationFrame(() => { announcer.textContent = text; });
  };

  /* --- items and quantities --- */
  const capFor = (item) => (item.soldOut ? 0 : Math.min(maxQtyPerItem, item.remaining ?? Infinity));
  const lineItems = () => Object.entries(cart.getItems(eventId))
    .map(([id, qty]) => ({ item: items.get(id), qty }))
    .filter((line) => line.item);

  function change(item, qty) {
    const before = cart.getQty(eventId, item.id);
    const next = Math.max(0, Math.min(qty, capFor(item)));
    cart.setQty(eventId, item.id, next);
    const total = cart.count(eventId);
    if (next > before) announce(`${item.name}: ${next} in your order. ${plural(total, 'item')} in total.`);
    else if (next === 0) announce(`Removed ${item.name}. ${plural(total, 'item')} in your order.`);
    else announce(`${item.name}: ${next} in your order.`);
  }

  function stepper(item, qty, { quiet = false } = {}) {
    const total = cart.count(eventId);
    return h('div', { class: ['stepper', quiet ? 'stepper--quiet' : ''], role: 'group', 'aria-label': `${item.name}, ${qty} in your order` },
      h('button', { type: 'button', dataset: { role: 'dec' }, 'aria-label': qty === 1 ? `Remove ${item.name}` : `One fewer ${item.name}`, onclick: () => change(item, qty - 1) }, icon('minus')),
      h('span', { class: 'stepper__qty', 'aria-hidden': 'true' }, String(qty)),
      h('button', {
        type: 'button',
        dataset: { role: 'inc' },
        'aria-label': `One more ${item.name}`,
        disabled: qty >= capFor(item) || total >= maxItemsPerOrder,
        onclick: () => change(item, qty + 1),
      }, icon('plus')));
  }

  function control(item) {
    const qty = cart.getQty(eventId, item.id);
    if (capFor(item) === 0) return h('button', { class: 'add', type: 'button', disabled: true, 'aria-label': `${item.name} is sold out` }, icon('plus'));
    if (qty > 0) return stepper(item, qty);
    return h('button', {
      class: 'add',
      type: 'button',
      dataset: { role: 'add' },
      'aria-label': `Add ${item.name}, ${formatMoney(item.priceCents)}`,
      disabled: cart.count(eventId) >= maxItemsPerOrder,
      onclick: () => change(item, 1),
    }, icon('plus'));
  }

  /** Focus the button in `slot` that best continues from a button with data-role `role`. */
  const FOCUS_NEXT = { add: ['inc', 'add'], inc: ['inc', 'dec'], dec: ['dec', 'add', 'inc'] };
  function focusLike(slot, role) {
    for (const candidate of FOCUS_NEXT[role] ?? []) {
      const target = slot.querySelector(`[data-role="${candidate}"]:not(:disabled)`);
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
  const banner = lazyArt(h('canvas', { class: 'event-banner', 'aria-hidden': 'true' }),
    (canvas) => drawTile(canvas, { seed: seedFrom(event.id), variant: 'banner' }));
  const grain = lazyArt(h('canvas', { class: 'grain', 'aria-hidden': 'true' }),
    (canvas) => drawDotField(canvas, { seed: event.id, ink: token('--black'), motif: 'spiral', strength: 0.07 }));
  const notice = !open && NOTICES[event.status] ? NOTICES[event.status](event) : null;
  const top = h('div', { class: 'event-top' },
    grain,
    h('div', { class: 'wrap' },
      h('a', { class: 'back-link', href: '/#popups', 'data-link': '' }, icon('back'), h('span', null, 'All pop-ups')),
      banner,
      h('div', { class: 'event-head' },
        h('div', { class: 'event-head__title' },
          h('h1', null, event.title),
          event.note ? h('p', { class: 'event-head__note' }, event.note) : null),
        h('dl', { class: 'facts' },
          h('div', null, h('dt', null, 'Date'), h('dd', null, formatMonthDay(event.date), h('span', { class: 'muted' }, formatWeekday(event.date)))),
          h('div', null, h('dt', null, 'Pickup window'), h('dd', null, formatTimeRange(event.start, event.end), h('span', { class: 'muted' }, 'Mountain Time'))),
          h('div', null, h('dt', null, 'Place'), h('dd', null, event.locationName,
            event.address ? h('span', { class: 'muted' }, event.address) : null,
            event.mapUrl && /^https:\/\//.test(event.mapUrl)
              ? h('a', { class: 'link', href: event.mapUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('pin'), 'Directions')
              : null)))),
      notice ? h('div', { class: 'notice', role: 'status' }, icon('alert'), h('div', null, h('h2', null, notice.title), h('p', null, notice.text))) : null));

  /* --- menu --- */
  const controlSlots = new Map();
  const dishNodes = new Map();
  function dish(item) {
    const slot = open ? h('span') : null;
    if (slot) {
      controlSlots.set(item.id, slot);
      mount(slot, control(item));
    }
    const node = dishNode(item, { level: 3, control: slot });
    dishNodes.set(item.id, node);
    return node;
  }
  const categories = detail.menu.categories;
  const catId = (category) => `menu-${category.id}`;
  const sections = categories.map((category) => categoryNode(category, { level: 2, id: catId(category), dish }));
  const chipLinks = new Map();
  const railLinks = new Map();
  const jump = (category) => (clickEvent) => {
    clickEvent.preventDefault();
    const section = document.getElementById(catId(category));
    section?.scrollIntoView({ behavior: prefersReducedMotion() ? 'instant' : 'smooth', block: 'start' });
    section?.querySelector('h2')?.focus({ preventScroll: true });
  };
  for (const section of sections) section.querySelector('h2').setAttribute('tabindex', '-1');
  const navList = (map) => h('ul', null, categories.map((category) => {
    const link = h('a', { href: `#${catId(category)}`, onclick: jump(category) }, category.name);
    map.set(category.id, link);
    return h('li', null, link);
  }));
  const chips = h('nav', { class: 'cat-nav', 'aria-label': 'Menu sections' }, navList(chipLinks));
  const rail = h('nav', { class: 'cat-rail', 'aria-label': 'Menu sections' }, navList(railLinks));
  const menu = h('div', { class: 'event-menu' }, categories.length > 1 ? chips : null, sections);

  function setActiveCategory(id) {
    for (const links of [chipLinks, railLinks]) {
      for (const [key, link] of links) {
        if (key === id) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    }
    const chip = chipLinks.get(id);
    const strip = chips.firstElementChild;
    if (chip && strip.scrollWidth > strip.clientWidth) {
      strip.scrollTo({ left: chip.parentElement.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
    }
  }
  const spy = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting);
    if (visible.length) setActiveCategory(visible[0].target.id.replace(/^menu-/, ''));
  }, { rootMargin: '-35% 0px -60% 0px' });
  cleanup.push(() => spy.disconnect());

  /* --- read-only pop-ups end here --- */
  const layout = h('div', { class: 'wrap event-layout' }, rail, menu);
  const node = h('div', { class: 'event-page' }, top, layout, announcer);
  if (!open) {
    return {
      node,
      mounted() {
        for (const section of sections) spy.observe(section);
      },
      destroy: () => cleanup.forEach((fn) => fn()),
    };
  }

  /* --- order form --- */
  const summary = errorSummary();
  const linesBox = h('div', { class: 'lines' });
  const itemsTitleId = nextId('items');
  const itemsError = h('p', { class: 'field__error', 'aria-live': 'polite' });
  const itemsStep = h('section', { class: 'step step--first', 'aria-labelledby': itemsTitleId },
    stepHead(1, 'Items', { id: itemsTitleId }), linesBox, itemsError);

  const slotOptions = () => slots.map((slot) => ({
    value: slot.time,
    label: slot.label,
    disabled: !slot.available,
    sub: slot.available ? (slot.remaining <= 2 ? `${slot.remaining} left` : '') : slot.remaining === 0 ? 'Full' : 'Closed',
  }));
  const slotGroup = choiceGroup({
    name: 'slot',
    legendNode: stepHead(2, 'Pickup time', { tag: 'legend' }),
    className: 'choices--grid',
    options: slotOptions(),
    onChange: (value) => cart.saveDraft({ slots: { ...cart.getDraft().slots, [eventId]: value } }),
  });
  slotGroup.node.classList.add('step');
  slotGroup.node.append(h('p', { class: 'slots-note' }, 'Times are Mountain Time.'));
  const savedSlot = draft.slots?.[eventId];
  if (slots.some((slot) => slot.time === savedSlot && slot.available)) slotGroup.select(savedSlot);

  const remember = (key) => (input) => input.addEventListener('input', () => cart.saveDraft({ [key]: input.value }));
  const name = field({ name: 'name', label: 'Name', attrs: { autocomplete: 'name', autocapitalize: 'words', maxlength: 80, enterkeyhint: 'next', value: draft.name ?? '' },
    validate: (v) => (clean(v) ? null : 'Enter the name for this order.') });
  const phone = field({ name: 'phone', label: 'Mobile phone', type: 'tel', hint: 'Only used if we need to reach you about this order.',
    attrs: { autocomplete: 'tel', inputmode: 'tel', maxlength: 20, enterkeyhint: 'next', value: draft.phone ?? '' },
    validate: (v) => phoneError(v, { required: true }) });
  const email = field({ name: 'email', label: 'Email', type: 'email',
    attrs: { autocomplete: 'email', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', maxlength: 254, enterkeyhint: 'done', value: draft.email ?? '' },
    validate: emailError });
  const notes = field({ name: 'notes', label: 'Notes for the kitchen', optional: true, multiline: true, max: 300,
    attrs: { rows: 2, value: draft.notes ?? '' },
    validate: (v) => (v.trim().length > 300 ? 'Keep notes to 300 characters.' : null) });
  remember('name')(name.input);
  remember('phone')(phone.input);
  remember('email')(email.input);
  remember('notes')(notes.input);
  const detailsStep = h('fieldset', { class: 'step' },
    stepHead(3, 'Your details', { tag: 'legend' }),
    h('div', { class: 'form' }, name.node, phone.node, email.node, notes.node));

  const defaultTip = presets.includes(15) ? 15 : 0;
  let tipPercent = presets.includes(draft.tip) ? draft.tip : defaultTip;
  const tipGroup = choiceGroup({
    name: 'tip',
    legendNode: stepHead(4, 'Tip for the crew', { tag: 'legend' }),
    className: 'choices--tips',
    options: presets.map((percent) => ({ value: String(percent), label: percent === 0 ? 'No tip' : `${percent}%`, sub: '' })),
    onChange: (value) => {
      tipPercent = Number(value);
      cart.saveDraft({ tip: tipPercent });
      update();
    },
  });
  tipGroup.node.classList.add('step');
  tipGroup.select(String(tipPercent));
  tipGroup.node.append(h('p', { class: 'tip-line' }, '100% of tips go to the crew.'));

  const totals = h('dl', { class: 'totals' });
  const payButton = h('button', { class: 'btn btn--primary btn--lg btn--block', type: 'submit' });
  const pay = h('div', { class: 'pay' },
    payButton,
    h('ul', { class: 'pay__methods', 'aria-label': 'Ways to pay' }, h('li', null, 'Card'), h('li', null, 'Apple Pay'), h('li', null, 'Google Pay')),
    h('p', { class: 'pay__secure' }, icon('lock'), 'Secure checkout by Stripe. We never see your card number.'));

  const form = h('form', { class: 'order-form', novalidate: true },
    h('h2', { class: 'order-form__title' }, 'Your order'),
    site.payments?.mode === 'demo' ? h('p', { class: 'demo-flag' }, 'Demo mode — no real charges') : null,
    site.payments?.mode === 'disabled' ? h('p', { class: 'demo-flag' }, 'Online payment is switched off right now, so orders cannot be placed.') : null,
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

  let busy = false;
  function update() {
    const lines = lineItems();
    const sums = computeTotals();
    const active = document.activeElement;
    const focusLine = linesBox.contains(active) ? active.closest('[data-line]')?.dataset.line : null;
    const rows = lines.map(({ item, qty }) => h('div', { class: 'line' },
      h('span', { class: 'line__name' }, item.name, h('span', { class: 'line__unit' }, `${formatMoney(item.priceCents)} each`)),
      h('span', { class: 'line__end' },
        h('span', { dataset: { line: item.id } }, stepper(item, qty, { quiet: true })),
        h('span', { class: 'line__total' }, formatMoney(item.priceCents * qty)))));
    mount(linesBox, rows.length ? rows : h('p', { class: 'lines-empty' }, 'Add dishes from the menu to start your order.'));
    if (focusLine) {
      const slot = [...linesBox.querySelectorAll('[data-line]')].find((el) => el.dataset.line === focusLine);
      if (!slot || !focusLike(slot, active.dataset.role)) document.getElementById(itemsTitleId)?.focus();
    }
    if (lines.length) itemsError.replaceChildren();

    tipGroup.setSubs((value) => (value === '0' ? '' : formatMoney(percentOf(sums.subtotal, Number(value)))));

    mount(totals,
      h('div', null, h('dt', null, 'Subtotal'), h('dd', null, formatMoney(sums.subtotal))),
      h('div', null, h('dt', null, site.taxLabel), h('dd', null, formatMoney(sums.tax))),
      h('div', null, h('dt', null, 'Tip'), h('dd', null, formatMoney(sums.tip))),
      h('div', { class: 'totals__grand' }, h('dt', null, 'Total'), h('dd', null, formatMoney(sums.total))));

    if (!busy) mount(payButton, icon('lock'), `Pay ${formatMoney(sums.total)}`);
    payButton.disabled = busy || lines.length === 0 || site.payments?.mode === 'disabled';

    for (const [id, slot] of controlSlots) {
      const item = items.get(id);
      if (item) refill(slot, control(item));
    }
    bar.update(lines.reduce((sum, line) => sum + line.qty, 0), sums.subtotal);
  }

  /* --- phone bar and sheet --- */
  const bar = (() => {
    const count = h('span', { class: 'order-bar__count' });
    const amount = h('span', { class: 'order-bar__total' });
    const button = h('button', { class: 'order-bar', type: 'button', hidden: true, onclick: () => openOrder() },
      h('span', null, count, amount),
      h('span', { class: 'order-bar__cta' }, 'Review order'));
    return {
      node: button,
      update(n, subtotal) {
        count.textContent = plural(n, 'item');
        amount.textContent = formatMoney(subtotal);
        button.setAttribute('aria-label', `Review order: ${plural(n, 'item')}, ${formatMoney(subtotal)} before tax`);
        button.hidden = n === 0 || sheet.isOpen();
        document.documentElement.classList.toggle('has-order-bar', n > 0);
      },
    };
  })();
  const sheet = createDialog({ variant: 'sheet', title: 'Your order', className: 'order-sheet', onClose: () => update() });
  const panelSlot = h('aside', { class: 'panel-slot', id: 'order', 'aria-label': 'Your order' });
  layout.append(panelSlot);
  node.append(bar.node);

  const desktop = matchMedia(DESKTOP);
  function place() {
    if (desktop.matches) {
      if (sheet.isOpen()) sheet.close({ immediate: true });
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
    bar.node.hidden = true;
  }
  ctx.shell.setCartAction(openOrder);

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
      sheet.close({ immediate: true });
      sheet.el.remove();
    },
    () => document.documentElement.classList.remove('has-order-bar'),
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
      const replacement = dishNode(item, { level: 3, control: controlSlots.get(id) });
      old.replaceWith(replacement);
      dishNodes.set(id, replacement);
    }
    slotGroup.set(slotOptions());
    update();
    return true;
  }

  /* --- validation and checkout --- */
  function validate() {
    const problems = [];
    if (lineItems().length === 0) {
      const message = 'Add at least one dish to your order.';
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
        const message = 'That pickup time just filled up. Choose another time.';
        if (!(await reload().catch(() => true))) return closedNow();
        slotGroup.select(null);
        slotGroup.setError(message);
        summary.show('Choose another pickup time', [{ message, target: slotGroup.target() }]);
        return;
      }
      case 'sold_out': {
        const { itemId, remaining } = error.details ?? {};
        if (itemId) cart.setQty(eventId, itemId, Math.max(0, remaining ?? 0));
        if (!(await reload().catch(() => true))) return closedNow();
        const message = `${error.message} Your order has been updated.`;
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
          summary.show('Check these details', [{ message: error.message, target: target.input }]);
        } else if (error.field === 'slot') {
          slotGroup.setError(error.message);
          summary.show('Check these details', [{ message: error.message, target: slotGroup.target() }]);
        } else {
          summary.show('Check your order', [{ message: error.message, target: document.getElementById(itemsTitleId) }]);
        }
        return;
      }
      case 'rate_limited':
        return summary.show('Too many attempts', [{ message: 'Wait a minute, then try again.' }]);
      case 'payments_unavailable':
        return summary.show('Online payment is unavailable', [{ message: 'Payments are switched off right now. Please try again later.' }]);
      case 'payment_provider_error':
        return summary.show('The payment page did not open', [{ message: 'Stripe did not respond. Your card was not charged. Try again in a moment.' }]);
      default:
        return summary.show('Checkout did not open', [{ message: error.message }]);
    }
  }

  function closedNow() {
    toast('Ordering for this pop-up just closed.', { tone: 'error' });
    ctx.navigate(`/e/${enc(eventId)}`, { replace: true });
  }

  form.addEventListener('submit', async (submitEvent) => {
    submitEvent.preventDefault();
    if (busy) return;
    const problems = validate();
    if (problems.length) {
      summary.show(problems.length === 1 ? 'One thing to fix' : `${problems.length} things to fix`, problems);
      return;
    }
    summary.hide();
    busy = true;
    setBusy(payButton, true);
    mount(payButton, spinner(), 'Opening secure checkout');
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
      for (const section of sections) spy.observe(section);
      update();
      if (ctx.hash === '#order') openOrder();
    },
    destroy: () => cleanup.forEach((fn) => fn()),
  };
}

/* ------------------------------------------------------------------------------------ view */

export function render(ctx) {
  const eventId = ctx.params.id;
  const root = h('div');
  const loading = () => mount(root, h('div', { class: 'wrap event-top' }, skeleton(1, { className: 'skeleton--block' }), skeleton(4, { className: 'skeleton--title' })));
  const controller = new AbortController();
  let page = null;

  let canceled = ctx.query.get('canceled');

  /** Back from a canceled Stripe checkout: release the held slot and stock, keep the cart.
   *  Resolves true when the order turned out to be paid and the page moved to its status. */
  async function releaseCanceledCheckout() {
    const code = canceled;
    const viewToken = ctx.query.get('k');
    canceled = null;
    if (!code) return false;
    ctx.replaceUrl(`/e/${encodeURIComponent(eventId)}${ctx.hash}`);
    if (!viewToken) return false;
    try {
      await cancelOrder(code, viewToken);
    } catch (error) {
      if (error.code === 'already_paid') {
        ctx.navigate(`/order/${encodeURIComponent(code)}?k=${encodeURIComponent(viewToken)}`, { replace: true });
        return true;
      }
    }
    toast(CANCELED_MESSAGE);
    return false;
  }

  async function load() {
    loading();
    if (await releaseCanceledCheckout()) return;
    try {
      const [site, detail] = await Promise.all([getSite(), getEvent(eventId, { signal: controller.signal })]);
      if (detail.event.status === 'open') {
        const changed = cart.reconcile(eventId, detail.menu.categories.flatMap((category) => category.items), site.order.maxQtyPerItem);
        if (changed.length) toast(`Your order was updated: ${changed.join(', ')} ${changed.length === 1 ? 'is' : 'are'} limited or sold out.`);
      }
      page = buildPage(site, detail, ctx);
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
