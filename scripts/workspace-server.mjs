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
  ['/dom', ['spikes/workspace/dom-host.html', 'text/html']],
  ['/dom-native-host.js', ['spikes/workspace/dom-native-host.js', 'text/javascript']],
  ['/dom-host.js', ['spikes/workspace/dom-host.js', 'text/javascript']],
  ['/notes-dom.mjs', ['examples/notes-extension/dom.mjs', 'text/javascript']],
  ['/dom-inventory.mjs', ['examples/notes-extension/dom-inventory.mjs', 'text/javascript']],
  ['/sdk-host.js', ['spikes/workspace/sdk-host.js', 'text/javascript']],
  ['/sdk-scenario.js', ['spikes/workspace/sdk-scenario.js', 'text/javascript']],
  ['/extensions-packet.json', ['artifacts/extensions/packet.json', 'application/json']],
  ['/notes-extension-testkit.mjs', ['examples/notes-extension/testkit.mjs', 'text/javascript']],
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
for (const name of ['wasm', 'sdk', 'kwdj', 'dom']) {
  await allowSnippets(new URL(`packages/${name}/dist/`, root), `/packages/${name}/`);
}
// Import maps are static, hash-authorized data. No unsafe-inline/eval or source rewriting.
const mapHashes = [];
for (const page of ['sdk-host.html', 'dom-host.html']) {
  const html = await readFile(new URL(`spikes/workspace/${page}`, root), 'utf8');
  const maps = [...html.matchAll(/<script type="importmap">([^<]+)<\/script>/g)];
  if (maps.length !== 1) throw new Error(`One static import map required: ${page}`);
  mapHashes.push(`'sha256-${createHash('sha256').update(maps[0][1]).digest('base64')}'`);
}
const domFixtureNames = ['D0','D1-after-end-split','T03-initial','T03-split','T04-X','T04-XY','T05-styled-EGC','T05-formatted-EGC','T05-backward-EGC','T05-backward-EGC-after','T06-safe-data','T10-replacement','KWDJ-basic-catalog','Notes-D0','Notes-D1-callout-highlight','Notes-D1-highlight-only','composition-initial','composition-outside-edit','ordered-u64-data'];
for (const name of domFixtureNames) for (const kind of ['inputs','expected']) {
  const file = `${name}${kind === 'expected' ? '.canonical' : ''}.json`;
  routes.set(`/dom-fixtures/${kind}/${file}`, [`contracts/dom/v1/${kind}/${file}`, 'application/json']);
}
const domNegativeNames = ['empty-text-unknown-attrs','empty-text-unknown-field','empty-text-wrong-attrs-shape','absent-color-unknown-attr','absent-color-unknown-field','absent-highlight-unknown-attr','unsafe-javascript-href','notes-version-2','notes-extra-envelope-field','notes-title-one-byte-over','notes-unknown-root-attr','scene-break-unknown-style','scene-break-unknown-onerror','heading-level-seven','notes-wrong-tags-kind'];
for (const name of domNegativeNames) routes.set(`/dom-fixtures/negative/${name}.json`, [`contracts/dom/v1/negative/${name}.json`, 'application/json']);
for (const name of ['acceptance-oracles.v3.json','manifest.json']) routes.set(`/dom-fixtures/${name}`, [`contracts/dom/v1/${name}`, 'application/json']);
http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'wasm-unsafe-eval' ${mapHashes.join(' ')}; style-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'`);
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
