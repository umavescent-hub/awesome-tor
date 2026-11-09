// Demo payment: stands in for Stripe Checkout when the server runs without Stripe keys. Clearly
// labeled, takes no card details, and only marks the order paid on the demo server.

import { cancelOrder, demoPay, getOrder, getSite } from '../api.js';
import { h, mount } from '../dom.js';
import { formatMoney } from '../format.js';
import { errorState, setBusy, skeleton, spinner, toast } from '../ui.js';

export function render(ctx) {
  const code = ctx.params.code.toUpperCase();
  const token = ctx.query.get('k') ?? '';
  const orderPath = `/order/${encodeURIComponent(code)}?k=${encodeURIComponent(token)}`;
  const root = h('div', { class: 'demo-pay wrap' }, h('div', { class: 'demo-card' }, skeleton(6)));
  const controller = new AbortController();

  function card(order) {
    const complete = h('button', { class: 'btn btn--primary btn--lg', type: 'button' }, 'Complete demo payment');
    const cancel = h('button', { class: 'btn btn--outline', type: 'button' }, 'Cancel');
    const status = h('p', { class: 'field__error', 'aria-live': 'polite' });

    complete.addEventListener('click', async () => {
      setBusy(complete, true);
      cancel.disabled = true;
      mount(complete, spinner(), 'Completing payment');
      try {
        await demoPay(code, token);
        ctx.navigate(orderPath, { replace: true });
      } catch (error) {
        setBusy(complete, false);
        cancel.disabled = false;
        mount(complete, 'Complete demo payment');
        status.textContent = error.message;
      }
    });

    cancel.addEventListener('click', async () => {
      setBusy(cancel, true);
      complete.disabled = true;
      try {
        await cancelOrder(code, token);
        toast('Checkout canceled — your cart is saved.');
        ctx.navigate(`/e/${encodeURIComponent(order.event.id)}`, { replace: true });
      } catch (error) {
        if (error.code === 'already_paid') {
          ctx.navigate(orderPath, { replace: true });
          return;
        }
        setBusy(cancel, false);
        complete.disabled = false;
        status.textContent = error.message;
      }
    });

    return h('div', { class: 'demo-card' },
      h('p', { class: 'demo-flag' }, 'Demo payment — no card will be charged'),
      h('h1', null, order.event.title),
      h('p', { class: 'demo-card__code num' }, `Order ${order.code}`),
      h('p', { class: 'demo-card__amount' }, h('span', { class: 'visually-hidden' }, 'Total: '), formatMoney(order.totalCents)),
      h('div', { class: 'lines' }, order.items.map((item) => h('div', { class: 'line' },
        h('span', { class: 'line__name' }, `${item.qty} × ${item.name}`),
        h('span', { class: 'line__total' }, formatMoney(item.lineCents))))),
      h('div', { class: 'demo-card__actions' }, complete, cancel),
      status);
  }

  const ready = (async () => {
    try {
      const [site, { order }] = await Promise.all([getSite(), getOrder(code, token, null, { signal: controller.signal })]);
      if (site.payments?.mode !== 'demo') throw Object.assign(new Error('Not found'), { status: 404 });
      if (order.status !== 'pending') {
        ctx.navigate(orderPath, { replace: true });
        return;
      }
      mount(root, card(order));
    } catch (error) {
      if (controller.signal.aborted) return;
      mount(root, errorState(error.status === 404
        ? { title: 'This payment link is not active', message: 'Start again from the menu.', action: h('a', { class: 'btn btn--primary', href: '/#popups', 'data-link': '' }, 'See upcoming pop-ups') }
        : { message: error.message, onRetry: () => location.reload() }));
    }
  })();

  return {
    node: root,
    title: 'Demo payment',
    ready,
    destroy: () => controller.abort(),
  };
}
