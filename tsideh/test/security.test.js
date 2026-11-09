import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createHoldLimiter, rateKey } from '../server/security.js';

describe('rateKey', () => {
  test('IPv4 addresses count one by one', () => {
    assert.equal(rateKey('203.0.113.7'), '203.0.113.7');
    assert.notEqual(rateKey('203.0.113.7'), rateKey('203.0.113.8'));
  });

  test('every address in one IPv6 /64 is one client, however it is written', () => {
    const key = '2001:db8:abcd:12::/64';
    for (const ip of [
      '2001:db8:abcd:12::1',
      '2001:db8:abcd:12::f',
      '2001:db8:abcd:12:ffff:ffff:ffff:ffff',
      '2001:0DB8:ABCD:0012:0000:0000:0000:0001',
      '2001:db8:abcd:12:1::',
      '2001:db8:abcd:12::1%eth0',
      '2001:db8:abcd:12::192.0.2.1',
    ]) {
      assert.equal(rateKey(ip), key, ip);
    }
    assert.equal(rateKey('2001:db8::1'), '2001:db8:0:0::/64');
    assert.equal(rateKey('2001:db8:0:0:5::1'), '2001:db8:0:0::/64');
  });

  test('different /64s are different clients', () => {
    assert.notEqual(rateKey('2001:db8:abcd:12::1'), rateKey('2001:db8:abcd:13::1'));
    assert.notEqual(rateKey('2001:db8:1::1'), rateKey('2001:db8:2::1'));
  });

  test('loopback and IPv4-mapped addresses are not lumped together', () => {
    assert.equal(rateKey('::1'), '::1');
    assert.notEqual(rateKey('::ffff:c000:201'), rateKey('::ffff:c000:202'));
    assert.notEqual(rateKey('::1'), rateKey('::2'));
  });

  test('never throws on odd input', () => {
    for (const ip of ['', ':', ':::', 'not-an-ip', '1:2:3:4:5:6:7:8:9']) assert.equal(typeof rateKey(ip), 'string', ip);
  });
});

describe('createHoldLimiter', () => {
  const NOW = 1_000_000;

  function setup() {
    const status = new Map();
    const holds = createHoldLimiter({ limit: 2, isOpen: (code) => status.get(code) === 'pending' });
    const place = (key, code, expiresAt = NOW + 60_000) => {
      const hold = holds.claim(key, NOW, expiresAt);
      if (hold && code) {
        hold.code = code;
        status.set(code, 'pending');
      }
      return hold;
    };
    return { holds, status, place };
  }

  test('a key gets at most `limit` open holds; other keys are unaffected', () => {
    const { holds, place } = setup();
    assert.ok(place('a', 'TS-AAAA'));
    assert.ok(place('a', 'TS-BBBB'));
    assert.equal(place('a', 'TS-CCCC'), null);
    assert.ok(place('b', 'TS-DDDD'));
    assert.deepEqual(holds.open('a', NOW).map((hold) => hold.code), ['TS-AAAA', 'TS-BBBB']);
  });

  test('a hold stops counting once paid, canceled or expired', () => {
    const { holds, status, place } = setup();
    place('a', 'TS-AAAA');
    place('a', 'TS-BBBB', NOW + 1_000);
    status.set('TS-AAAA', 'paid');
    assert.ok(place('a', 'TS-CCCC'), 'paid hold freed a place');
    assert.equal(place('a', 'TS-DDDD'), null);
    assert.equal(holds.open('a', NOW + 1_000).length, 1, 'the lapsed hold no longer counts');
  });

  test('a checkout still running counts, and dropping it frees the place', () => {
    const { holds, place } = setup();
    const running = holds.claim('a', NOW, NOW + 60_000);
    assert.equal(running.code, null);
    place('a', 'TS-AAAA');
    assert.equal(holds.claim('a', NOW, NOW + 60_000), null, 'in-flight checkouts cannot race past the limit');
    holds.drop('a', running);
    assert.ok(place('a', 'TS-BBBB'));
  });

  test('sweep forgets keys with nothing open', () => {
    const { holds, status, place } = setup();
    place('a', 'TS-AAAA');
    status.set('TS-AAAA', 'canceled');
    holds.sweep(NOW);
    assert.deepEqual(holds.open('a', NOW), []);
  });
});
