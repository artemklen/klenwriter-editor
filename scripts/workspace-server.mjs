import http from 'node:http';
import { readFile } from 'node:fs/promises';

// Build smoke fixture only; an exact allowlist avoids exposing the checkout.
const root = new URL('../', import.meta.url);
const routes = new Map([
  ['/editor_wasm.js', ['packages/wasm/dist/editor_wasm.js', 'text/javascript']],
  ['/editor_wasm_bg.wasm', ['packages/wasm/dist/editor_wasm_bg.wasm', 'application/wasm']],
  ['/style.css', ['packages/dom/dist/style.css', 'text/css']],
]);
http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  if (path === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html lang="en"><title>Workspace build smoke</title><link rel="stylesheet" href="/style.css"><main class="editor-surface">Build smoke; no editor.</main></html>');
    return;
  }
  const route = routes.get(path);
  if (!route) { res.writeHead(404); res.end(); return; }
  try { res.setHeader('Content-Type', route[1]); res.end(await readFile(new URL(route[0], root))); }
  catch { res.writeHead(500); res.end('Build the workspace before running this fixture'); }
}).listen(4190, '127.0.0.1');
