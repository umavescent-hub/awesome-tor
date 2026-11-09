// Static files from public/: safe path resolution, explicit MIME types, in-memory cache of file
// bodies and their gzip/brotli variants, cache headers, ETags, HEAD, and the SPA fallback.

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
const SPA_ROUTES = /^\/(?:e\/[^/]+|order\/[^/]+|pay\/demo\/[^/]+|catering)?\/?$/;

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

export function createStaticHandler(publicDir) {
  const root = path.resolve(publicDir);
  const cache = new Map();

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
    const body = await readFile(file);
    const entry = {
      mtimeMs: info.mtimeMs,
      size: info.size,
      body,
      etag: `W/"${createHash('sha256').update(body).digest('base64url').slice(0, 22)}"`,
      variants: new Map(),
    };
    cache.set(file, entry);
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
      if (file && await serveFile(req, res, file, pathname)) return;
    }
    if (SPA_ROUTES.test(pathname) && await serveFile(req, res, path.join(root, 'index.html'), '/index.html')) return;

    res.writeHead(404, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache', 'Content-Length': NOT_FOUND_PAGE.length });
    res.end(req.method === 'HEAD' ? undefined : NOT_FOUND_PAGE);
  };
}
