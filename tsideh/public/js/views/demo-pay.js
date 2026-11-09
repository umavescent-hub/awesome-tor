// Demo payment: stands in for Stripe Checkout when the server runs without Stripe keys. Clearly
// labeled and takes no card details. Like Stripe's page, it asks for the name, mobile number and
// email that go with the order, then marks the order paid on the demo server.

import { cancelOrder, demoPay, getOrder, getSite } from '../api.js';
import { h, mount } from '../dom.js';
import { formatMoney } from '../format.js';
import { clean, emailError, errorSummary, field, phoneError } from '../forms.js';
import { errorState, setBusy, skeleton, spinner } from '../ui.js';

/** Name, mobile number and email, keyed by the names the server reports problems under. */
function contactFields() {
  return {
    name: field({ name: 'name', label: 'Your name', hint: 'We say this name when we hand you your food.',
      attrs: { autocomplete: 'name', autocapitalize: 'words', maxlength: 80, enterkeyhint: 'next' },
      validate: (v) => (clean(v) ? null : 'Enter your name.') }),
    phone: field({ name: 'phone', label: 'Mobile number', type: 'tel', hint: 'Only if we need to reach you about this order. For example: 505 555 0142',
      attrs: { autocomplete: 'tel', inputmode: 'tel', maxlength: 20, enterkeyhint: 'next' },
      validate: (v) => phoneError(v, { required: true }) }),
    email: field({ name: 'email', label: 'Email', type: 'email', hint: ['For your receipt. For example: name', h('wbr'), '@example.com'],
      attrs: { autocomplete: 'email', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', maxlength: 254, enterkeyhint: 'done' },
      validate: emailError }),
  };
}

export function render(ctx) {
  const code = ctx.params.code.toUpperCase();
  const token = ctx.query.get('k') ?? '';
  const orderPath = `/order/${encodeURIComponent(code)}?k=${encodeURIComponent(token)}`;
  const root = h('div', { class: 'demo-pay wrap' }, h('div', { class: 'demo-card' }, skeleton(6)));
  const controller = new AbortController();

  function card(order, taxLabel) {
    const fields = contactFields();
    const summary = errorSummary();
    const complete = h('button', { class: 'btn btn--primary btn--lg', type: 'submit' }, 'Complete demo payment');
    const cancel = h('button', { class: 'btn btn--outline btn--lg', type: 'button' }, 'Cancel and go back');
    const status = h('p', { class: 'field__error', 'aria-live': 'polite' });
    const form = h('form', { class: 'form demo-card__form', novalidate: true, 'aria-label': 'Your details' },
      summary.node,
      Object.values(fields).map((f) => f.node),
      h('div', { class: 'demo-card__actions' }, complete, cancel));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const problems = Object.values(fields)
        .map((f) => ({ message: f.check(), target: f.input }))
        .filter((problem) => problem.message);
      if (problems.length) {
        summary.show(problems.length === 1 ? 'One thing to fix before paying' : `${problems.length} things to fix before paying`, problems);
        return;
      }
      summary.hide();
      status.textContent = '';
      setBusy(complete, true);
      cancel.disabled = true;
      mount(complete, spinner(), 'Completing payment');
      try {
        await demoPay(code, token, {
          name: clean(fields.name.value()),
          email: clean(fields.email.value()),
          phone: clean(fields.phone.value()),
        });
        ctx.navigate(orderPath, { replace: true });
      } catch (error) {
        setBusy(complete, false);
        cancel.disabled = false;
        mount(complete, 'Complete demo payment');
        const target = error.code === 'invalid' ? fields[error.field] : null;
        if (target) {
          target.setError(error.message);
          summary.show('Please check this', [{ message: error.message, target: target.input }]);
        } else {
          status.textContent = error.message;
        }
      }
    });

    cancel.addEventListener('click', async () => {
      setBusy(cancel, true);
      complete.disabled = true;
      try {
        await cancelOrder(code, token);
        ctx.navigate(`/e/${encodeURIComponent(order.event.id)}?canceled=${encodeURIComponent(code)}&k=${encodeURIComponent(token)}`, { replace: true });
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
      h('p', { class: 'demo-card__amount num' }, h('span', { class: 'demo-card__label' }, 'Total '), formatMoney(order.totalCents)),
      h('ul', { class: 'lines' }, order.items.map((item) => h('li', { class: 'line' },
        h('p', { class: 'line__top' },
          h('span', { class: 'line__name' }, `${item.qty} × ${item.name}`),
          h('span', { class: 'line__total num' }, formatMoney(item.lineCents)))))),
      // How the total is made up, as on Stripe's page and on the receipt that follows.
      h('dl', { class: 'totals' },
        h('div', null, h('dt', null, 'Items'), h('dd', { class: 'num' }, formatMoney(order.subtotalCents))),
        h('div', null, h('dt', null, taxLabel), h('dd', { class: 'num' }, formatMoney(order.taxCents))),
        h('div', null, h('dt', null, 'Tip'), h('dd', { class: 'num' }, formatMoney(order.tipCents))),
        h('div', { class: 'totals__grand' }, h('dt', null, 'Total'), h('dd', { class: 'num' }, formatMoney(order.totalCents)))),
      h('p', { class: 'demo-card__note' }, 'On the real site, this is Stripe’s secure page, where you pay with card, Apple Pay or Google Pay.'),
      form,
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
      mount(root, card(order, site.taxLabel || 'Tax'));
    } catch (error) {
      if (controller.signal.aborted) return;
      mount(root, errorState(error.status === 404
        ? { title: 'This payment link is not active', message: 'Please start again from the menu.', action: h('a', { class: 'btn btn--primary', href: '/#popups', 'data-link': '' }, 'See upcoming pop-ups') }
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
