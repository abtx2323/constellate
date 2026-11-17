#!/usr/bin/env node
// Local preview server. Binds to 127.0.0.1 only, serves a fixed list of file
// types from this folder, and sends strict security headers. No dependencies.
//
//   node scripts/serve.mjs [port]

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 4173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const ALLOWED = [/^index\.html$/, /^styles\.css$/, /^src\/(core|ui)\/[a-z]+\.js$/, /^dist\/constellate\.html$/];

const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cache-Control': 'no-store',
};

createServer(async (req, res) => {
  const send = (code, body, type) => {
    res.writeHead(code, { ...HEADERS, 'Content-Type': type || 'text/plain; charset=utf-8' });
    res.end(body);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed');
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { return send(400, 'Bad request'); }
  const rel = normalize(path === '/' ? 'index.html' : path.replace(/^\/+/, '')).split(sep).join('/');
  if (!ALLOWED.some((re) => re.test(rel))) return send(404, 'Not found');
  try {
    const ext = rel.slice(rel.lastIndexOf('.'));
    send(200, await readFile(join(root, rel)), TYPES[ext]);
  } catch {
    send(404, 'Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Constellate is running at http://127.0.0.1:${port}  (Ctrl+C to stop)`);
});
