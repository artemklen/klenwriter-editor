import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

// Build smoke fixture only; an exact allowlist avoids exposing the checkout.
const root = new URL('../', import.meta.url);
const routes = new Map([
  ['/editor_wasm.js', ['packages/wasm/dist/editor_wasm.js', 'text/javascript']],
  ['/editor_wasm_bg.wasm', ['packages/wasm/dist/editor_wasm_bg.wasm', 'application/wasm']],
  ['/projection-budget/probe.js', ['artifacts/projection-budget/probe.js', 'text/javascript']],
  ['/projection-budget/probe_bg.wasm', ['artifacts/projection-budget/probe_bg.wasm', 'application/wasm']],
  ['/admission-budget/probe.js', ['artifacts/admission-budget/probe.js', 'text/javascript']],
  ['/admission-budget/probe_bg.wasm', ['artifacts/admission-budget/probe_bg.wasm', 'application/wasm']],
  ['/sdk', ['spikes/workspace/sdk-host.html', 'text/html']],
  ['/sdk-host.js', ['spikes/workspace/sdk-host.js', 'text/javascript']],
  ['/sdk-scenario.js', ['spikes/workspace/sdk-scenario.js', 'text/javascript']],
  ['/packages/wasm/editor_wasm_bg.wasm', ['packages/wasm/dist/editor_wasm_bg.wasm', 'application/wasm']],
  ['/style.css', ['packages/dom/dist/style.css', 'text/css']],
]);
// wasm-bindgen emits static import modules for the bounded transport intrinsics.
// Register only generated .js files; URL input never selects a filesystem path.
async function allowSnippets(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) await allowSnippets(file, prefix + entry.name + '/');
    else if (entry.isFile() && entry.name.endsWith('.js')) routes.set(prefix + entry.name, [file, 'text/javascript']);
  }
}
await allowSnippets(new URL('packages/wasm/dist/snippets/', root), '/snippets/');
for (const name of ['wasm', 'sdk', 'kwdj']) {
  await allowSnippets(new URL(`packages/${name}/dist/`, root), `/packages/${name}/`);
}
// Import maps are static, hash-authorized data. No unsafe-inline/eval or source rewriting.
const sdkHtml = await readFile(new URL('spikes/workspace/sdk-host.html', root), 'utf8');
const maps = [...sdkHtml.matchAll(/<script type="importmap">([^<]+)<\/script>/g)];
if (maps.length !== 1) throw new Error('One static SDK import map required');
const mapHash = createHash('sha256').update(maps[0][1]).digest('base64');
http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'sha256-${mapHash}'; style-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'`);
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
// 4190 is a restricted port in Firefox/WebKit (ManageSieve); use an HTTP dev port.
}).listen(4174, '127.0.0.1');
