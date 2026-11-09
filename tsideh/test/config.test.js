import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { ConfigError, loadContent, readEnv, ROOT } from '../server/config.js';
import { fixtureContent, tempDir, writeConfig } from './helpers.js';

/** Writes the fixture config to a temp dir, runs `fn(dir)`, then removes the dir. */
function withConfig(content, fn) {
  const dir = tempDir();
  writeConfig(dir, content);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function problemsFor(mutate) {
  const content = fixtureContent();
  mutate(content);
  return withConfig(content, (dir) => {
    try {
      loadContent(dir);
    } catch (error) {
      assert.ok(error instanceof ConfigError);
      return error.problems;
    }
    return assert.fail('expected the config to be rejected');
  });
}

describe('content files', () => {
  test('the shipped config/*.json is valid', () => {
    const content = loadContent(path.join(ROOT, 'config'));
    assert.equal(content.site.timezone, 'America/Denver');
    assert.ok(content.menu.items.length > 0);
  });

  test('the fixture config is valid', () => {
    withConfig(fixtureContent(), (dir) => assert.equal(loadContent(dir).events.events.length, 8));
  });

  test('reports every problem with file and field', () => {
    const problems = problemsFor((content) => {
      content.site.timezone = 'Santa Fe';
      content.site.order.holdMinutes = 10;
      content.menu.items[0].tags = ['spicy', 'keto'];
      content.menu.items[1].priceCents = 12.5;
      content.events.events[0].date = '2026-11-31';
      content.events.events[0].menu = ['tacos', 'pizza'];
      content.events.events[0].itemLimits = { atole: 5 };
      content.events.events[1].id = 'winter';
      content.events.events[2].mapUrl = 'javascript:alert(1)';
      content.events.events[3].end = '11:10';
    });
    const expected = [
      'config/site.json → timezone:',
      'config/site.json → order.holdMinutes:',
      'config/menu.json → items[0].tags[1]:',
      'config/menu.json → items[1].priceCents:',
      'config/events.json → events[0].date:',
      'config/events.json → events[0].menu[1]: "pizza" is not an item in menu.json',
      'config/events.json → events[0].itemLimits.atole: is not on this event\'s menu',
      'config/events.json → events[1].id: "winter" is used twice',
      'config/events.json → events[2].mapUrl:',
      'config/events.json → events[3].end: must be at least one slot',
    ];
    for (const prefix of expected) assert.ok(problems.some((problem) => problem.startsWith(prefix)), `missing: ${prefix}\n${problems.join('\n')}`);
    assert.equal(problems.length, expected.length);
  });

  test('checks the hero headline and press entries', () => {
    const problems = problemsFor((content) => {
      content.site.heroHeadline = 42;
      content.site.press = [
        { name: 'Food & Wine', kind: 'featured', url: '', quote: '' },
        { name: '', kind: 'award', url: 'http://example.com', quote: 'x'.repeat(301) },
      ];
    });
    assert.deepEqual(problems.map((problem) => problem.split(':')[0]), [
      'config/site.json → heroHeadline',
      'config/site.json → press[1].name',
      'config/site.json → press[1].kind',
      'config/site.json → press[1].url',
      'config/site.json → press[1].quote',
    ]);
  });

  test('rejects menu images outside /assets/menu', () => {
    const problems = problemsFor((content) => {
      content.menu.items[0].image = 'https://evil.example/x.png';
    });
    assert.match(problems[0], /items\[0\]\.image/);
  });

  test('names a missing or malformed file', () => {
    withConfig(fixtureContent(), (dir) => {
      writeFileSync(path.join(dir, 'menu.json'), '{ "categories": [ }');
      assert.throws(() => loadContent(dir), /config\/menu\.json is not valid JSON/);
      assert.throws(() => loadContent(path.join(dir, 'nowhere')), /config\/site\.json is missing/);
    });
  });
});

describe('environment', () => {
  test('development defaults: demo payments, localhost URL, no admin', () => {
    const { config, warnings } = readEnv({});
    assert.equal(config.port, 8787);
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.publicUrl, 'http://localhost:8787');
    assert.equal(config.paymentsMode, 'demo');
    assert.equal(config.adminPassword, null);
    assert.equal(config.dataDir, path.join(ROOT, 'data'));
    assert.equal(config.now, null);
    assert.deepEqual(warnings, []);
  });

  test('a Stripe secret key switches payments to Stripe', () => {
    assert.equal(readEnv({ STRIPE_SECRET_KEY: 'sk_test_abc123' }).config.paymentsMode, 'stripe');
  });

  test('production requires an https PUBLIC_URL', () => {
    assert.throws(() => readEnv({ NODE_ENV: 'production' }), /PUBLIC_URL is required in production/);
    assert.throws(() => readEnv({ NODE_ENV: 'production', PUBLIC_URL: 'http://tsideh.com' }), /must start with https:\/\//);
    assert.throws(() => readEnv({ PUBLIC_URL: 'https://tsideh.com/shop' }), /no path/);
  });

  test('production without keys runs with payments off and loud warnings', () => {
    const { config, warnings } = readEnv({ NODE_ENV: 'production', PUBLIC_URL: 'https://tsideh.com/' });
    assert.equal(config.publicUrl, 'https://tsideh.com');
    assert.equal(config.paymentsMode, 'disabled');
    assert.ok(warnings.some((w) => w.includes('STRIPE_SECRET_KEY')));
    assert.ok(warnings.some((w) => w.includes('STRIPE_WEBHOOK_SECRET')));
    assert.ok(warnings.some((w) => w.includes('ADMIN_PASSWORD')));
  });

  test('NOW freezes the clock only outside production', () => {
    assert.equal(readEnv({ NOW: '2026-11-20T18:00:00Z' }).config.now, Date.parse('2026-11-20T18:00:00Z'));
    const production = readEnv({ NODE_ENV: 'production', PUBLIC_URL: 'https://tsideh.com', NOW: '2026-11-20T18:00:00Z' });
    assert.equal(production.config.now, null);
    assert.ok(production.warnings.some((w) => w.startsWith('NOW is ignored')));
    assert.throws(() => readEnv({ NOW: 'next tuesday' }), /NOW must be an ISO date-time/);
  });

  test('catches pasted-in-the-wrong-box Stripe values', () => {
    assert.throws(() => readEnv({ STRIPE_SECRET_KEY: 'pk_live_abc' }), /STRIPE_SECRET_KEY/);
    assert.throws(() => readEnv({ STRIPE_WEBHOOK_SECRET: 'sk_live_abc' }), /STRIPE_WEBHOOK_SECRET/);
    assert.throws(() => readEnv({ NODE_ENV: 'production', PUBLIC_URL: 'https://tsideh.com', STRIPE_API_BASE: 'http://stripe.local' }), /STRIPE_API_BASE/);
  });

  test('a short ADMIN_PASSWORD keeps the admin off', () => {
    const { config, warnings } = readEnv({ ADMIN_PASSWORD: 'tooshort' });
    assert.equal(config.adminPassword, null);
    assert.match(warnings[0], /at least|shorter than 12/);
    assert.equal(readEnv({ ADMIN_PASSWORD: 'twelve-chars' }).config.adminPassword, 'twelve-chars');
  });

  test('PORT, TRUST_PROXY and NOTIFY_WEBHOOK_URL are checked', () => {
    assert.throws(() => readEnv({ PORT: 'eighty' }), /PORT/);
    assert.throws(() => readEnv({ PORT: '70000' }), /PORT/);
    assert.equal(readEnv({ TRUST_PROXY: '1' }).config.trustProxy, 1);
    assert.equal(readEnv({ TRUST_PROXY: 'true' }).config.trustProxy, 1);
    assert.equal(readEnv({ TRUST_PROXY: '2' }).config.trustProxy, 2);
    assert.equal(readEnv({ TRUST_PROXY: 'false' }).config.trustProxy, 0);
    assert.throws(() => readEnv({ TRUST_PROXY: 'yes please' }), /TRUST_PROXY/);
    assert.throws(() => readEnv({ NODE_ENV: 'production', PUBLIC_URL: 'https://tsideh.com', NOTIFY_WEBHOOK_URL: 'http://hooks.example' }), /NOTIFY_WEBHOOK_URL/);
  });

  test('all problems are reported together', () => {
    assert.throws(() => readEnv({ PORT: 'x', NOW: 'y' }), (error) => error instanceof ConfigError && error.problems.length === 2);
  });
});
