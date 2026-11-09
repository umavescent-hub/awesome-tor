// Order status: waits calmly for the payment to confirm, then shows the pickup code, the
// customer's own order mark (a keepsake drawn from the code), pickup details and the receipt.

import { getOrder, getSite } from '../api.js';
import { drawSherd, seedFrom } from '../art.js';
import * as cart from '../cart.js';
import { h, mount } from '../dom.js';
import { formatLongDate, formatMoney, formatTime, formatTimeRange, zonedClock, zonedDate } from '../format.js';
import { downloadCalendar } from '../ics.js';
import { errorState, icon, lazyArt, skeleton } from '../ui.js';

const POLL_MS = 2000;
const POLL_LIMIT_MS = 60_000;

function directionsUrl(event) {
  if (event.mapUrl && /^https:\/\//.test(event.mapUrl)) return event.mapUrl;
  const query = [event.address, event.locationName].filter(Boolean).join(', ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
}

const HEADLINES = {
  paid: (order) => ({ title: `Thank you, ${order.firstName}.`, text: 'Your order is in. We will have it ready at your pickup time.' }),
  ready: () => ({ title: 'Your order is ready', text: 'Head to the pickup table and show your code.' }),
  picked_up: (order) => ({ title: `Enjoy, ${order.firstName}.`, text: 'This order has been picked up. Thank you for coming.' }),
};

const ENDED = {
  canceled: { title: 'This checkout was canceled', text: 'No payment was taken. Your cart is still saved on this device.' },
  expired: { title: 'This checkout timed out', text: 'The payment was not completed in time, so no payment was taken. Your cart is still saved on this device.' },
  failed: { title: 'The payment did not go through', text: 'No payment was taken. You can try again with another card or wallet.' },
  refunded: { title: 'This order was refunded', text: 'The refund goes back to the card or wallet you paid with. Banks usually take 5 to 10 business days to show it.' },
};

function receipt(order, taxLabel) {
  return h('section', { class: 'receipt', 'aria-labelledby': 'receipt-title' },
    h('h2', { id: 'receipt-title' }, 'Receipt'),
    h('div', { class: 'lines' }, order.items.map((item) => h('div', { class: 'line' },
      h('span', { class: 'line__name' }, `${item.qty} × ${item.name}`, h('span', { class: 'line__unit' }, `${formatMoney(item.unitCents)} each`)),
      h('span', { class: 'line__total' }, formatMoney(item.lineCents))))),
    h('dl', { class: 'totals' },
      h('div', null, h('dt', null, 'Subtotal'), h('dd', null, formatMoney(order.subtotalCents))),
      h('div', null, h('dt', null, taxLabel), h('dd', null, formatMoney(order.taxCents))),
      h('div', null, h('dt', null, 'Tip'), h('dd', null, formatMoney(order.tipCents))),
      h('div', { class: 'totals__grand' }, h('dt', null, 'Total paid'), h('dd', null, formatMoney(order.totalCents)))),
    order.paidAt
      ? h('p', { class: 'receipt__paid' }, `Paid ${formatLongDate(zonedDate(order.paidAt))} at ${formatTime(zonedClock(order.paidAt))} through Stripe.`)
      : null);
}

function confirmed(order, taxLabel) {
  const event = order.event;
  const directions = directionsUrl(event);
  const words = HEADLINES[order.status](order);
  const sherd = lazyArt(h('canvas', { class: 'keepsake', role: 'img', 'aria-label': `Your order mark, drawn from code ${order.code}` }),
    (canvas) => drawSherd(canvas, { seed: seedFrom(order.code) }));
  const heading = h('h1', { tabindex: '-1' }, words.title);
  return h('div', { class: 'wrap wrap--narrow status-page' },
    h('div', { class: 'status-hero' },
      sherd,
      order.status === 'ready' ? h('span', { class: 'status-badge' }, icon('check'), 'Ready for pickup') : null,
      heading,
      h('p', null, words.text),
      h('div', { class: 'code-plate' },
        h('span', { class: 'code-plate__label' }, 'Pickup code'),
        h('span', { class: 'code-plate__code' }, order.code),
        h('span', { class: 'code-plate__hint' }, 'Show this code at pickup'))),
    h('dl', { class: 'status-details' },
      h('div', null, h('dt', null, 'Pickup'), h('dd', null,
        `${order.slotLabel}, ${formatLongDate(event.date)}`,
        h('span', { class: 'muted' }, 'Mountain Time'))),
      h('div', null, h('dt', null, 'Place'), h('dd', null,
        event.locationName,
        event.address ? h('span', { class: 'muted' }, event.address) : null,
        directions ? h('a', { class: 'link', href: directions, target: '_blank', rel: 'noopener noreferrer' }, icon('pin'), 'Directions') : null)),
      h('div', null, h('dt', null, 'Pop-up'), h('dd', null,
        h('a', { href: `/e/${encodeURIComponent(event.id)}`, 'data-link': '' }, event.title),
        h('span', { class: 'muted' }, formatTimeRange(event.start, event.end))))),
    order.status === 'picked_up' ? null : h('div', { class: 'status-actions' },
      h('button', { class: 'btn btn--outline', type: 'button', onclick: () => downloadCalendar(order, directions) }, icon('calendar'), 'Add to calendar')),
    receipt(order, taxLabel));
}

function ended(order, taxLabel) {
  const words = ENDED[order.status];
  const back = `/e/${encodeURIComponent(order.event.id)}`;
  return h('div', { class: 'wrap wrap--narrow status-page' },
    h('div', { class: 'status-hero' },
      h('h1', { tabindex: '-1' }, words.title),
      h('p', null, words.text),
      h('p', { class: 'num' }, `Order ${order.code}`),
      h('div', { class: 'state__actions' },
        order.status === 'refunded'
          ? h('a', { class: 'btn btn--outline', href: '/', 'data-link': '' }, 'Back to Tsideh')
          : h('a', { class: 'btn btn--primary', href: back, 'data-link': '' }, 'Back to the menu'))),
    order.status === 'refunded' ? receipt(order, taxLabel) : null);
}

function waiting({ late, onRefresh }) {
  return h('div', { class: 'wrap wrap--narrow status-page' },
    h('div', { class: 'status-hero', 'aria-busy': late ? null : 'true' },
      h('div', { class: 'keepsake keepsake--waiting', 'aria-hidden': 'true' }),
      h('h1', { tabindex: '-1' }, late ? 'Still confirming your payment' : 'Confirming your payment…'),
      h('p', { role: 'status' }, late
        ? 'This is taking longer than usual. If you finished checkout, your order is safe. Check again in a minute.'
        : 'This usually takes a few seconds. Keep this page open.'),
      late ? h('div', { class: 'state__actions' }, h('button', { class: 'btn btn--primary', type: 'button', onclick: onRefresh }, 'Check again')) : null));
}

export function render(ctx) {
  const code = ctx.params.code.toUpperCase();
  const token = ctx.query.get('k');
  let sessionId = ctx.query.get('session_id');
  const root = h('div', null, h('div', { class: 'wrap wrap--narrow status-page' }, skeleton(1, { className: 'skeleton--block' }), skeleton(4)));
  const controller = new AbortController();
  let timer = 0;
  let started = 0;
  let shown = '';
  let taxLabel = 'Tax';
  getSite().then((site) => { taxLabel = site.taxLabel || taxLabel; }, () => {});

  function notFound() {
    ctx.setTitle('Order not found');
    mount(root, h('div', { class: 'wrap' }, errorState({
      title: 'We could not find that order',
      message: 'Open the link from the device you ordered on, or ask us at the pickup table with your name.',
      action: h('a', { class: 'btn btn--primary', href: '/', 'data-link': '' }, 'Go to Tsideh'),
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
      present(order.status, () => confirmed(order, taxLabel));
    } else {
      ctx.setTitle(ENDED[order.status]?.title ?? `Order ${order.code}`);
      present(order.status, () => (ENDED[order.status]
        ? ended(order, taxLabel)
        : errorState({ message: 'This order is in an unexpected state. Ask us at the pickup table.' })));
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
  const ready = token ? poll() : Promise.resolve(notFound());
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
