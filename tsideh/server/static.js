// Static files from public/: safe path resolution, explicit MIME types, in-memory cache of file
// bodies and their gzip/brotli variants, cache headers, ETags, HEAD, and the app's pages.

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';
import { negotiateEncoding } from './http.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.webmanifest', '.svg', '.txt']);
const COMPRESS_MIN_BYTES = 1024;
const APP_ROUTES = /^\/(?:e\/[^/]+|order\/[^/]+|catering)?\/?$/;
const DEMO_PAY_ROUTE = /^\/pay\/demo\/[^/]+\/?$/;

const NOT_FOUND_PAGE = Buffer.from(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found · Tsideh</title>
<link rel="icon" href="/assets/favicon-32.png">
<link rel="stylesheet" href="/css/tokens.css">
</head>
<body>
<main>
<h1>Not found</h1>
<p>That page is not on the menu. <a href="/">Back to Tsideh</a></p>
</main>
</body>
</html>
`);

function cacheControl(pathname, extension) {
  if (pathname.startsWith('/fonts/') || pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (extension === '.html') return 'no-cache';
  return 'public, max-age=300';
}

const entryOf = (body) => ({
  size: body.length,
  body,
  etag: `W/"${createHash('sha256').update(body).digest('base64url').slice(0, 22)}"`,
  variants: new Map(),
});

/**
 * index.html is the shell of every app page. Link previews and search engines need absolute
 * addresses, so it carries two placeholders filled in here: %PUBLIC_URL% (the site, e.g.
 * https://tsideh.com) and %PAGE_URL% (the page's own address). The home page, /catering and
 * each pop-up in `eventIds` are rendered once per version of index.html and then served like any
 * cached file; every other app route (an order, a payment, an unknown pop-up) presents itself as
 * the home page. Both values are plain addresses (an origin and slug paths), so nothing needs
 * escaping. The demo payment page exists only when `demoPay` is on.
 */
export function createStaticHandler(publicDir, { publicUrl, eventIds, demoPay }) {
  const root = path.resolve(publicDir);
  const shellFile = path.join(root, 'index.html');
  const pages = ['/', '/catering', ...eventIds.map((id) => `/e/${id}`)];
  const pageUrls = new Map(pages.map((page) => [page, `${publicUrl}${page}`]));
  const cache = new Map();
  const rendered = new Map();

  /** Maps a URL path to a file inside public/, or null when it could escape or is hidden. */
  function resolve(pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (decoded.includes('\0') || decoded.includes('\\')) return null;
    const segments = decoded.split('/').filter(Boolean);
    if (segments.some((segment) => segment.startsWith('.'))) return null;
    const file = path.join(root, ...segments);
    return file.startsWith(root + path.sep) ? file : null;
  }

  async function load(file) {
    let info;
    try {
      info = await stat(file);
    } catch {
      return null;
    }
    if (!info.isFile()) return null;
    const cached = cache.get(file);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached;
    const entry = { ...entryOf(await readFile(file)), mtimeMs: info.mtimeMs };
    cache.set(file, entry);
    return entry;
  }

  /** The app shell for one route, with its addresses filled in. */
  async function renderPage(pathname) {
    const shell = await load(shellFile);
    if (!shell) return null;
    const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    const page = pageUrls.has(trimmed) ? trimmed : '/';
    let entry = rendered.get(page);
    if (entry?.source !== shell) {
      const html = shell.body.toString('utf8').replaceAll('%PAGE_URL%', pageUrls.get(page)).replaceAll('%PUBLIC_URL%', publicUrl);
      entry = { ...entryOf(Buffer.from(html)), source: shell };
      rendered.set(page, entry);
    }
    return entry;
  }

  function variant(entry, encoding) {
    if (!entry.variants.has(encoding)) {
      entry.variants.set(encoding, encoding === 'br'
        ? brotliCompressSync(entry.body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: entry.size } })
        : gzipSync(entry.body, { level: 9 }));
    }
    return entry.variants.get(encoding);
  }

  function send(req, res, entry, extension, cacheHeader) {
    const headers = { 'Cache-Control': cacheHeader, ETag: entry.etag };
    const compressible = COMPRESSIBLE.has(extension) && entry.size >= COMPRESS_MIN_BYTES;
    if (compressible) headers.Vary = 'Accept-Encoding';
    const conditional = req.headers['if-none-match'];
    if (conditional && conditional.split(',').some((tag) => tag.trim() === entry.etag || tag.trim() === '*')) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    headers['Content-Type'] = TYPES[extension];
    let body = entry.body;
    const encoding = compressible ? negotiateEncoding(req.headers['accept-encoding']) : null;
    if (encoding) {
      body = variant(entry, encoding);
      headers['Content-Encoding'] = encoding;
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function serveFile(req, res, file, pathname) {
    const extension = path.extname(file).toLowerCase();
    if (!TYPES[extension]) return false;
    const entry = await load(file);
    if (!entry) return false;
    send(req, res, entry, extension, cacheControl(pathname, extension));
    return true;
  }

  return async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method not allowed');
      return;
    }

    if (pathname === '/admin' || pathname === '/admin/') {
      if (await serveFile(req, res, path.join(root, 'admin', 'index.html'), '/admin/index.html')) return;
    } else if (!pathname.endsWith('/')) {
      const file = resolve(pathname);
      // index.html itself is a template: it is only ever served rendered, as an app page.
      if (file && file !== shellFile && await serveFile(req, res, file, pathname)) return;
    }
    if (APP_ROUTES.test(pathname) || (demoPay && DEMO_PAY_ROUTE.test(pathname))) {
      const entry = await renderPage(pathname);
      if (entry) {
        send(req, res, entry, '.html', 'no-cache');
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache', 'Content-Length': NOT_FOUND_PAGE.length });
    res.end(req.method === 'HEAD' ? undefined : NOT_FOUND_PAGE);
  };
}
