// Order status: waits calmly for the payment to confirm, then shows the pickup code front and
// centre with one plain sentence about when and where to pick up, "Add to calendar", "Back to
// home", the pickup details and what was ordered.

import { getOrder, getSite } from '../api.js';
import * as cart from '../cart.js';
import { h, mount } from '../dom.js';
import { formatLongDate, formatMoney, formatTime, zonedClock, zonedDate } from '../format.js';
import { downloadCalendar } from '../ics.js';
import { errorState, icon, skeleton, spinner } from '../ui.js';

const POLL_MS = 2000;
const POLL_LIMIT_MS = 60_000;

function directionsUrl(event) {
  if (event.mapUrl && /^https:\/\//.test(event.mapUrl)) return event.mapUrl;
  const query = [event.address, event.locationName].filter(Boolean).join(', ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
}

/** "Pick up at 11:15 AM on Saturday, November 21 in Santa Fe." */
const pickupSentence = (order) => `Pick up at ${order.slotLabel} on ${formatLongDate(order.event.date)} in ${order.event.locationName}.`;

const HEADLINES = {
  paid: (order) => ({ title: 'You’re all set.', text: pickupSentence(order) }),
  ready: (order) => ({ title: 'Your food is ready.', text: `Come to the pickup table in ${order.event.locationName} and show your code.` }),
  picked_up: () => ({ title: 'Enjoy your meal.', text: 'This order has been picked up. Thank you for coming.' }),
};

const ENDED = {
  canceled: { title: 'This order was not paid', text: 'You left the payment page, so nothing was charged. Your dishes are still saved on this device.' },
  expired: { title: 'The time to pay ran out', text: 'The payment was not finished in time, so nothing was charged. Your dishes are still saved on this device.' },
  failed: { title: 'The payment did not go through', text: 'Nothing was charged. You can try again with another card or wallet.' },
  refunded: { title: 'This order was refunded', text: 'The money goes back to the card or wallet you paid with. Banks usually take 5 to 10 business days to show it.' },
};

function receipt(order, taxLabel) {
  return h('section', { class: 'receipt', 'aria-labelledby': 'receipt-title' },
    h('h2', { id: 'receipt-title' }, 'What you ordered'),
    h('ul', { class: 'lines' }, order.items.map((item) => h('li', { class: 'line' },
      h('p', { class: 'line__top' },
        h('span', { class: 'line__name' }, `${item.qty} × ${item.name}`),
        h('span', { class: 'line__total num' }, formatMoney(item.lineCents))),
      h('p', { class: 'line__unit num' }, `${formatMoney(item.unitCents)} each`)))),
    h('dl', { class: 'totals' },
      h('div', null, h('dt', null, 'Food'), h('dd', { class: 'num' }, formatMoney(order.subtotalCents))),
      h('div', null, h('dt', null, taxLabel), h('dd', { class: 'num' }, formatMoney(order.taxCents))),
      h('div', null, h('dt', null, 'Tip'), h('dd', { class: 'num' }, formatMoney(order.tipCents))),
      h('div', { class: 'totals__grand' }, h('dt', null, 'Total paid'), h('dd', { class: 'num' }, formatMoney(order.totalCents)))),
    order.paidAt
      ? h('p', { class: 'receipt__paid' }, `Paid on ${formatLongDate(zonedDate(order.paidAt))} at ${formatTime(zonedClock(order.paidAt))}.`)
      : null);
}

function confirmed(order, site) {
  const event = order.event;
  const directions = directionsUrl(event);
  const words = HEADLINES[order.status](order);
  const taxLabel = site?.taxLabel || 'Tax';
  return h('div', { class: 'wrap wrap--narrow status-page' },
    h('div', { class: 'status-hero' },
      order.status === 'ready' ? h('p', { class: 'status-badge' }, icon('check'), 'Ready for pickup') : null,
      h('h1', { tabindex: '-1' }, words.title),
      h('p', { class: 'status-when' }, words.text),
      h('div', { class: 'code-plate' },
        h('p', { class: 'code-plate__label' }, 'Your pickup code'),
        h('p', { class: 'code-plate__code' }, order.code),
        h('p', { class: 'code-plate__hint' }, 'Show this code when you pick up your food.')),
      site?.payments?.mode === 'stripe' && order.status === 'paid'
        ? h('p', { class: 'status-note' }, 'Stripe is emailing your receipt to the address you gave.')
        : null,
      h('div', { class: 'status-actions' },
        order.status === 'picked_up' ? null
          : h('button', { class: 'btn btn--primary btn--lg', type: 'button', onclick: () => downloadCalendar(order, directions) }, icon('calendar'), 'Add to calendar'),
        h('a', { class: 'btn btn--outline btn--lg', href: '/', 'data-link': '' }, 'Back to home'))),
    h('dl', { class: 'status-details' },
      h('div', null, h('dt', null, 'Pickup time'), h('dd', null,
        `${order.slotLabel}, ${formatLongDate(event.date)}`,
        h('span', { class: 'muted' }, 'Mountain Time'))),
      h('div', null, h('dt', null, 'Place'), h('dd', null,
        event.locationName,
        event.address ? h('span', { class: 'muted' }, event.address) : null,
        directions ? h('a', { class: 'link', href: directions, target: '_blank', rel: 'noopener noreferrer' }, icon('pin'), 'Directions (opens a map)') : null)),
      h('div', null, h('dt', null, 'Pop-up'), h('dd', null,
        h('a', { href: `/e/${encodeURIComponent(event.id)}`, 'data-link': '' }, event.title)))),
    receipt(order, taxLabel));
}

function ended(order, site) {
  const words = ENDED[order.status];
  const back = `/e/${encodeURIComponent(order.event.id)}`;
  return h('div', { class: 'wrap wrap--narrow status-page' },
    h('div', { class: 'status-hero' },
      h('h1', { tabindex: '-1' }, words.title),
      h('p', { class: 'status-when' }, words.text),
      h('p', { class: 'status-note num' }, `Order ${order.code}`),
      h('div', { class: 'status-actions' },
        order.status === 'refunded'
          ? h('a', { class: 'btn btn--outline btn--lg', href: '/', 'data-link': '' }, 'Back to home')
          : h('a', { class: 'btn btn--primary btn--lg', href: back, 'data-link': '' }, 'Back to the menu'))),
    order.status === 'refunded' ? receipt(order, site?.taxLabel || 'Tax') : null);
}

function waiting({ late, onRefresh }) {
  return h('div', { class: 'wrap wrap--narrow status-page' },
    h('div', { class: 'status-hero', 'aria-busy': late ? null : 'true' },
      late ? null : h('span', { class: 'status-spinner' }, spinner()),
      h('h1', { tabindex: '-1' }, late ? 'Still confirming your payment' : 'Confirming your payment'),
      h('p', { class: 'status-when', role: 'status' }, late
        ? 'This is taking longer than usual. If you finished paying, your order is safe. Press Check again in a minute.'
        : 'This usually takes a few seconds. Please keep this page open.'),
      late ? h('div', { class: 'status-actions' }, h('button', { class: 'btn btn--primary btn--lg', type: 'button', onclick: onRefresh }, 'Check again')) : null));
}

export function render(ctx) {
  const code = ctx.params.code.toUpperCase();
  const token = ctx.query.get('k');
  let sessionId = ctx.query.get('session_id');
  const root = h('div', null, h('div', { class: 'wrap wrap--narrow status-page' }, skeleton(2, { className: 'skeleton--title' }), skeleton(4)));
  const controller = new AbortController();
  let timer = 0;
  let started = 0;
  let shown = '';
  let site = null;

  function notFound() {
    ctx.setTitle('Order not found');
    mount(root, h('div', { class: 'wrap' }, errorState({
      title: 'We could not find that order',
      message: 'Open the link on the phone or computer you ordered on, or tell us your name at the pickup table.',
      action: h('a', { class: 'btn btn--primary', href: '/', 'data-link': '' }, 'Back to home'),
    })));
  }

  /** Render a state once; repeated polls in the same state change nothing on screen. */
  function present(key, build) {
    if (key === shown) return;
    const first = shown === '';
    shown = key;
    mount(root, build());
    if (!first) root.querySelector('h1')?.focus({ preventScroll: true });
  }

  function show(order) {
    if (order.status === 'pending') {
      const late = Date.now() - started >= POLL_LIMIT_MS;
      ctx.setTitle('Confirming payment');
      present(`pending-${late}`, () => waiting({
        late,
        onRefresh: () => {
          started = Date.now();
          poll();
        },
      }));
      if (!late) timer = setTimeout(poll, POLL_MS);
      return;
    }
    if (HEADLINES[order.status]) {
      ctx.setTitle(`Order ${order.code}`);
      cart.clear(order.event.id);
      cart.saveDraft({ notes: '' });
      if (sessionId) {
        sessionId = null;
        ctx.replaceUrl(`/order/${encodeURIComponent(order.code)}?k=${encodeURIComponent(token)}`);
      }
      present(order.status, () => confirmed(order, site));
    } else {
      ctx.setTitle(ENDED[order.status]?.title ?? `Order ${order.code}`);
      present(order.status, () => (ENDED[order.status]
        ? ended(order, site)
        : errorState({ message: 'This order is in an unexpected state. Please ask us at the pickup table.' })));
    }
  }

  async function poll() {
    clearTimeout(timer);
    try {
      const { order } = await getOrder(code, token, sessionId, { signal: controller.signal });
      show(order);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error.status === 404) notFound();
      else mount(root, h('div', { class: 'wrap' }, errorState({ message: error.message, onRetry: poll })));
    }
  }

  started = Date.now();
  const ready = token
    ? getSite().then((value) => { site = value; }, () => {}).then(poll)
    : Promise.resolve(notFound());
  return {
    node: root,
    title: 'Your order',
    ready,
    destroy() {
      controller.abort();
      clearTimeout(timer);
    },
  };
}
