// Kitchen alerts to a Slack-compatible incoming webhook. Fire-and-forget: a slow or failing
// webhook never delays or breaks an order.

const TIMEOUT_MS = 5_000;

const formatCents = (cents) => `$${(cents / 100).toFixed(2)}`;

export function createNotifier({ url, log, fetch: fetchImpl = globalThis.fetch }) {
  function send(text) {
    if (!url) return;
    fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
      .then((response) => {
        if (!response.ok) log.warn(`notify: webhook answered ${response.status}`);
      })
      .catch((error) => log.warn(`notify: webhook failed (${error.name})`));
  }

  return {
    paidOrder(order, eventTitle, slotLabel) {
      const items = order.items.map((line) => `${line.qty}× ${line.name}`).join(', ');
      const firstName = order.customer.name.split(' ')[0];
      const flag = order.oversold ? 'OVERSOLD (over capacity, check the board) · ' : '';
      send(`${flag}New paid order ${order.code} · ${eventTitle} · pickup ${slotLabel} · ${firstName} · ${items} · ${formatCents(order.totalCents)}`);
    },
    paymentMismatch(order, amountCents, currency) {
      const charged = typeof amountCents === 'number' ? `${formatCents(amountCents)} ${String(currency).toUpperCase()}` : 'an unknown amount';
      send(`REVIEW: Stripe charged ${charged} for order ${order.code}, which costs ${formatCents(order.totalCents)}. It was not marked paid; check it in the Stripe Dashboard.`);
    },
    cateringInquiry(inquiry) {
      send(`New catering inquiry · ${inquiry.name} · ${inquiry.eventDate} · ${inquiry.guestCount} guests · ${inquiry.serviceStyle} · ${inquiry.location}`);
    },
  };
}
