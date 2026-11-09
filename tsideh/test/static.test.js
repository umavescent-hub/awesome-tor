import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { rawRequest, startTestServer, tempDir } from './helpers.js';

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; "
  + "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; "
  + "require-trusted-types-for 'script'; trusted-types 'none'";
const SECURITY_HEADERS = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'origin-agent-cluster': '?1',
  'x-dns-prefetch-control': 'off',
  'x-permitted-cross-domain-policies': 'none',
};

const SITE_CSS = `:root { --clay: #c16742; }\n${'.tile { border: 2px solid var(--ink); }\n'.repeat(80)}`;

let server;
let port;
let root;

before(async () => {
  root = tempDir();
  const publicDir = path.join(root, 'public');
  const files = {
    'index.html': '<!doctype html><title>Tsideh</title><main id="app"></main>',
    'admin/index.html': '<!doctype html><title>Tsideh Kitchen</title>',
    'css/site.css': SITE_CSS,
    'js/app.js': `export const ready = true;\n${'// tile\n'.repeat(300)}`,
    'js/tiny.js': 'export {};',
    'fonts/syne.woff2': 'wOF2',
    'assets/logo.png': 'PNG',
    'assets/photo.jpg': 'JPG',
    'assets/mark.webp': 'WEBP',
    'assets/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'favicon.ico': 'ICO',
    'manifest.webmanifest': '{"name":"Tsideh"}',
    'robots.txt': 'User-agent: *',
    'data.json': '{}',
    'notes.md': '# not served',
    '.env': 'STRIPE_SECRET_KEY=sk_live_nope',
    '.well-hidden/secret.txt': 'hidden',
  };
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(publicDir, name)), { recursive: true });
    writeFileSync(path.join(publicDir, name), content);
  }
  writeFileSync(path.join(root, 'secret.txt'), 'outside public');
  server = await startTestServer({ publicDir });
  port = server.port;
});
after(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

const get = (requestPath, headers) => rawRequest(port, requestPath, { headers });

describe('security headers', () => {
  test('present on HTML, static assets, API responses and errors', async () => {
    for (const requestPath of ['/', '/css/site.css', '/api/site', '/api/nope', '/missing', '/admin']) {
      const { headers } = await get(requestPath);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(headers[name], value, `${name} on ${requestPath}`);
      assert.equal(headers['strict-transport-security'], undefined, 'no HSTS outside production');
    }
  });

  test('admin pages ask search engines to stay away', async () => {
    assert.equal((await get('/admin')).headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal((await get('/api/admin/session')).headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal((await get('/')).headers['x-robots-tag'], undefined);
  });
});

describe('files and types', () => {
  const types = [
    ['/css/site.css', 'text/css; charset=utf-8'],
    ['/js/app.js', 'text/javascript; charset=utf-8'],
    ['/data.json', 'application/json; charset=utf-8'],
    ['/manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
    ['/assets/icon.svg', 'image/svg+xml'],
    ['/assets/logo.png', 'image/png'],
    ['/assets/photo.jpg', 'image/jpeg'],
    ['/assets/mark.webp', 'image/webp'],
    ['/fonts/syne.woff2', 'font/woff2'],
    ['/favicon.ico', 'image/x-icon'],
    ['/robots.txt', 'text/plain; charset=utf-8'],
  ];
  for (const [requestPath, type] of types) {
    test(`${requestPath} is served as ${type}`, async () => {
      const { status, headers } = await get(requestPath);
      assert.equal(status, 200);
      assert.equal(headers['content-type'], type);
    });
  }

  test('cache policy: immutable fonts/assets, short css/js, revalidated HTML', async () => {
    assert.equal((await get('/fonts/syne.woff2')).headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal((await get('/assets/logo.png')).headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal((await get('/css/site.css')).headers['cache-control'], 'public, max-age=300');
    assert.equal((await get('/js/app.js')).headers['cache-control'], 'public, max-age=300');
    assert.equal((await get('/')).headers['cache-control'], 'no-cache');
    assert.equal((await get('/admin')).headers['cache-control'], 'no-cache');
  });

  test('unknown file types are not served', async () => {
    assert.equal((await get('/notes.md')).status, 404);
  });
});

describe('compression and conditional requests', () => {
  test('brotli preferred, gzip next, identity otherwise; always Vary', async () => {
    const br = await get('/css/site.css', { 'Accept-Encoding': 'gzip, br' });
    assert.equal(br.headers['content-encoding'], 'br');
    assert.equal(br.headers.vary, 'Accept-Encoding');
    assert.equal(brotliDecompressSync(br.body).toString(), SITE_CSS);
    assert.equal(Number(br.headers['content-length']), br.body.length);

    const gzip = await get('/css/site.css', { 'Accept-Encoding': 'gzip, br;q=0' });
    assert.equal(gzip.headers['content-encoding'], 'gzip');
    assert.equal(gunzipSync(gzip.body).toString(), SITE_CSS);

    const plain = await get('/css/site.css');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.body.toString(), SITE_CSS);
    assert.equal(plain.headers.vary, 'Accept-Encoding');
  });

  test('small files and binary types are sent as-is', async () => {
    assert.equal((await get('/js/tiny.js', { 'Accept-Encoding': 'br' })).headers['content-encoding'], undefined);
    assert.equal((await get('/assets/logo.png', { 'Accept-Encoding': 'br' })).headers['content-encoding'], undefined);
  });

  test('large API responses are gzipped when accepted', async () => {
    const { headers, body } = await get('/api/events/winter', { 'Accept-Encoding': 'gzip' });
    assert.equal(headers['content-encoding'], 'gzip');
    assert.equal(JSON.parse(gunzipSync(body)).event.id, 'winter');
  });

  test('ETag + If-None-Match gives 304', async () => {
    const first = await get('/js/app.js');
    assert.match(first.headers.etag, /^W\/"[A-Za-z0-9_-]+"$/);
    const again = await get('/js/app.js', { 'If-None-Match': first.headers.etag });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    assert.equal(again.headers.etag, first.headers.etag);
  });

  test('HEAD returns headers without a body', async () => {
    const head = await rawRequest(port, '/css/site.css', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers['content-length']), Buffer.byteLength(SITE_CSS));
    assert.equal(head.body.length, 0);
  });

  test('HEAD works on API reads too', async () => {
    const head = await rawRequest(port, '/api/site', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(head.body.length, 0);
  });

  test('other methods on static paths are 405', async () => {
    const response = await rawRequest(port, '/css/site.css', { method: 'POST' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, 'GET, HEAD');
  });
});

describe('routing', () => {
  test('SPA routes fall back to index.html', async () => {
    for (const requestPath of ['/', '/e/winter', '/order/TS-AB23?k=abc', '/pay/demo/TS-AB23', '/catering', '/catering/']) {
      const { status, body, headers } = await get(requestPath);
      assert.equal(status, 200, requestPath);
      assert.equal(headers['content-type'], 'text/html; charset=utf-8');
      assert.match(body.toString(), /<main id="app">/);
    }
  });

  test('/admin and /admin/ serve the kitchen app', async () => {
    for (const requestPath of ['/admin', '/admin/']) {
      const { status, body } = await get(requestPath);
      assert.equal(status, 200);
      assert.match(body.toString(), /Tsideh Kitchen/);
    }
  });

  test('anything else is a small HTML 404; API misses are JSON', async () => {
    const page = await get('/e/winter/extra');
    assert.equal(page.status, 404);
    assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
    assert.match(page.body.toString(), /Not found/);
    const api = await get('/api/missing');
    assert.equal(api.status, 404);
    assert.deepEqual(JSON.parse(api.body), { error: { code: 'not_found', message: 'Not found.' } });
    assert.equal((await get('/css/')).status, 404, 'no directory listings');
  });
});

describe('path safety', () => {
  const attempts = [
    '/../secret.txt',
    '/..%2fsecret.txt',
    '/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/css/..%2f..%2fsecret.txt',
    '/css/%2e%2e/%2e%2e/secret.txt',
    '/..%5csecret.txt',
    '/%5c..%5csecret.txt',
    '/.env',
    '/%2eenv',
    '/.well-hidden/secret.txt',
    '/css/site.css%00.png',
    '/%E0%A4%A',
  ];
  for (const attempt of attempts) {
    test(`blocks ${attempt}`, async () => {
      const { status, body } = await get(attempt);
      assert.equal(status, 404);
      const text = body.toString();
      assert.equal(text.includes('outside public'), false);
      assert.equal(text.includes('sk_live'), false);
      assert.equal(text.includes('hidden'), false);
    });
  }

  test('requests that are not origin-form are rejected', async () => {
    const { status } = await rawRequest(port, 'http://evil.example/secret.txt');
    assert.equal(status, 400);
  });
});
