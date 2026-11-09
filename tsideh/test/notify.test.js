import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createNotifier, slackEscape } from '../server/notify.js';

function capture() {
  const sent = [];
  const notifier = createNotifier({
    url: 'https://hooks.slack.test/services/x',
    log: { warn: () => {} },
    fetch: async (url, init) => {
      sent.push(JSON.parse(init.body));
      return new Response('ok');
    },
  });
  return { notifier, sent };
}

describe('kitchen alerts', () => {
  test('slackEscape turns Slack control characters into plain text', () => {
    assert.equal(slackEscape('<!channel> & <https://evil.example|Verify>'), '&lt;!channel&gt; &amp; &lt;https://evil.example|Verify&gt;');
  });

  test('what a customer types in a catering inquiry cannot ping the channel or disguise a link', () => {
    const { notifier, sent } = capture();
    notifier.cateringInquiry({
      name: '<!channel> Stripe payout failed',
      eventDate: '2026-12-20',
      guestCount: 20,
      serviceStyle: 'Buffet',
      location: '<https://evil.example/stripe-login|Verify your Stripe account here>',
    });
    assert.deepEqual(sent, [{
      text: 'New catering inquiry · &lt;!channel&gt; Stripe payout failed · 2026-12-20 · 20 guests · Buffet · &lt;https://evil.example/stripe-login|Verify your Stripe account here&gt;',
    }]);
  });

  test('a paid-order alert escapes the first name, event title and items', () => {
    const { notifier, sent } = capture();
    notifier.paidOrder(
      { code: 'TS-7KQ4', customer: { name: '<!here> Maria' }, items: [{ qty: 2, name: 'Beans & <b>Rice</b>' }], totalCents: 3678, oversold: false },
      'Red & Green <!everyone>',
      '11:15 AM',
    );
    assert.equal(sent[0].text, 'New paid order TS-7KQ4 · Red &amp; Green &lt;!everyone&gt; · pickup 11:15 AM · &lt;!here&gt; · 2× Beans &amp; &lt;b&gt;Rice&lt;/b&gt; · $36.78');
    assert.equal(/[<>]/.test(sent[0].text), false);
  });
});
