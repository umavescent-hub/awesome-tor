import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { describe, test } from 'node:test';
import { ROOT } from '../server/config.js';
import { tempDir } from './helpers.js';

/** Runs `npm start`'s command as a child process and collects its output. */
function boot(env) {
  const dataRoot = tempDir();
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server/index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOST: '127.0.0.1', PORT: '0', DATA_DIR: path.join(dataRoot, 'data'), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.once('exit', () => rmSync(dataRoot, { recursive: true, force: true }));
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => { output.stdout += chunk; });
  child.stderr.on('data', (chunk) => { output.stderr += chunk; });
  const listening = new Promise((resolve, reject) => {
    child.stdout.on('data', () => {
      const match = output.stdout.match(/running at http:\/\/localhost:(\d+)/);
      if (match) resolve(Number(match[1]));
    });
    child.once('exit', (code) => reject(new Error(`exited with ${code}: ${output.stderr}`)));
  });
  listening.catch(() => {});
  return { child, output, listening };
}

describe('npm start', () => {
  test('boots, serves the API and static files, and stops cleanly on SIGTERM', async () => {
    const { child, output, listening } = boot({ NOW: '2026-11-10T17:00:00Z' });
    const port = await listening;
    const base = `http://127.0.0.1:${port}`;

    const events = await fetch(`${base}/api/events`);
    assert.equal(events.status, 200);
    assert.ok(Array.isArray((await events.json()).events));
    const site = await (await fetch(`${base}/api/site`)).json();
    assert.equal(site.payments.mode, 'demo');
    const tokens = await fetch(`${base}/css/tokens.css`);
    assert.equal(tokens.status, 200);
    assert.equal(tokens.headers.get('content-type'), 'text/css; charset=utf-8');

    assert.match(output.stdout, /payments: demo mode, no real charges/);
    assert.match(output.stdout, /clock frozen at 2026-11-10T17:00:00\.000Z/);
    assert.match(output.stdout, /^GET \/api\/events 200 \d+ms$/m);

    child.kill('SIGTERM');
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
    assert.match(output.stdout, /SIGTERM received/);
    assert.match(output.stdout, /Stopped\./);
  });

  test('refuses to start in production without an https PUBLIC_URL', async () => {
    const { child, output } = boot({ NODE_ENV: 'production', PUBLIC_URL: 'http://tsideh.com' });
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(output.stderr, /Tsideh cannot start/);
    assert.match(output.stderr, /PUBLIC_URL must start with https:\/\//);
  });

  test('warns loudly in production when secrets are missing', async () => {
    const { child, output, listening } = boot({ NODE_ENV: 'production', PUBLIC_URL: 'https://tsideh.test' });
    await listening;
    child.kill('SIGINT');
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
    assert.match(output.stderr, /WARNING: STRIPE_SECRET_KEY is not set/);
    assert.match(output.stderr, /WARNING: STRIPE_WEBHOOK_SECRET is not set/);
    assert.match(output.stderr, /WARNING: ADMIN_PASSWORD is not set/);
    assert.match(output.stderr, /WARNING: TRUST_PROXY is not set/);
    assert.match(output.stdout, /payments: OFF/);
  });

  test('starts clean in production with every setting (Render\'s values, Stripe test keys)', async () => {
    const { child, output, listening } = boot({
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://tsideh.test',
      TRUST_PROXY: '1',
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
      ADMIN_PASSWORD: 'sixteen-chars-ok',
    });
    const port = await listening;
    const site = await (await fetch(`http://127.0.0.1:${port}/api/site`, { headers: { 'X-Forwarded-Proto': 'https' } })).json();
    assert.equal(site.payments.mode, 'stripe');
    child.kill('SIGTERM');
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
    assert.equal(output.stderr, 'WARNING: STRIPE_SECRET_KEY is a TEST key: no real money will be collected.\n', 'the only warning');
    assert.match(output.stdout, /public address: https:\/\/tsideh\.test\n/);
    assert.match(output.stdout, /payments: Stripe \(test mode\) · kitchen admin: https:\/\/tsideh\.test\/admin · data: /);
  });
});
