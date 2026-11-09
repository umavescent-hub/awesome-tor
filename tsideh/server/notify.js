// Kitchen alerts to a Slack-compatible incoming webhook. Fire-and-forget: a slow or failing
// webhook never delays or breaks an order.

const TIMEOUT_MS = 5_000;

/** The owner's style, with no currency sign: whole amounts as "48", others as "65.29". */
const formatAmount = (cents) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

/**
 * Slack reads <!channel>, <!here> and <url|label> in `text` as commands. Alerts carry what
 * customers typed, so &, < and > are escaped the way Slack documents and show up as plain text.
 */
export const slackEscape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function createNotifier({ url, log, fetch: fetchImpl = globalThis.fetch }) {
  function send(text) {
    if (!url) return;
    fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: slackEscape(text) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
      .then((response) => {
        if (!response.ok) log.warn(`notify: webhook answered ${response.status}`);
      })
      .catch((error) => log.warn(`notify: webhook failed (${error.name})`));
  }

  return {
    /** The first name is left out when the payment page gave none. */
    paidOrder(order, eventTitle, slotLabel) {
      const items = order.items.map((line) => `${line.qty}× ${line.name}`).join(', ');
      const firstName = order.customer.name.split(' ')[0];
      const flag = order.oversold ? 'OVERSOLD (over capacity, check the board) · ' : '';
      const parts = [`New paid order ${order.code}`, eventTitle, `pickup ${slotLabel}`, firstName, items, `total ${formatAmount(order.totalCents)}`];
      send(flag + parts.filter(Boolean).join(' · '));
    },
    paymentMismatch(order, amountCents, currency) {
      const charged = typeof amountCents === 'number' ? `${formatAmount(amountCents)} ${String(currency).toUpperCase()}` : 'an unknown amount';
      send(`REVIEW: Stripe charged ${charged} for order ${order.code}, which costs ${formatAmount(order.totalCents)} USD. It was not marked paid; check it in the Stripe Dashboard.`);
    },
    cateringInquiry(inquiry) {
      send(`New catering inquiry · ${inquiry.name} · ${inquiry.eventDate} · ${inquiry.guestCount} guests · ${inquiry.serviceStyle} · ${inquiry.location}`);
    },
  };
}
