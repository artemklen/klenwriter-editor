import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { loadCompositionContract } from './composition-contract-data.mjs';
import { compositionStyleDirective } from './composition-csp-policy.mjs';
import { loadUiSemanticCases } from './ui-semantic-data.mjs';

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
  ['/selection', ['spikes/workspace/selection.html', 'text/html']],
  ['/selection-host.js', ['spikes/workspace/selection-host.js', 'text/javascript']],
  ['/selection-native-host.js', ['spikes/workspace/selection-native-host.js', 'text/javascript']],
  ['/selection.css', ['spikes/workspace/selection.css', 'text/css']],
  ['/composition', ['spikes/workspace/composition.html', 'text/html']],
  ['/composition-host.js', ['spikes/workspace/composition-host.js', 'text/javascript']],
  ['/composition-native-host.js', ['spikes/workspace/composition-native-host.js', 'text/javascript']],
  ['/composition.css', ['spikes/workspace/composition.css', 'text/css']],
  ['/ui', ['spikes/workspace/ui.html', 'text/html']],
  ['/mounted-corpus', ['spikes/workspace/mounted-corpus.html', 'text/html']],
  ['/mounted-corpus-client.mjs', ['scripts/mounted-corpus/page-client.mjs', 'text/javascript']],
  ['/mounted-corpus-protocol.mjs', ['scripts/mounted-corpus/protocol.mjs', 'text/javascript']],
  ['/mounted-corpus-interactions.mjs', ['scripts/mounted-corpus/interactions.mjs', 'text/javascript']],
  ['/mounted-corpus-native-observer.mjs', ['scripts/mounted-corpus/native-observer.mjs', 'text/javascript']],
  ['/mounted-corpus-interactions.css', ['scripts/mounted-corpus/interactions.css', 'text/css']],
  ['/ui-frame', ['spikes/workspace/ui-frame.html', 'text/html']],
  ['/ui-host.js', ['spikes/workspace/ui-host.js', 'text/javascript']],
  ['/drag-native-host.js', ['spikes/workspace/drag-native-host.js', 'text/javascript']],
  ['/ui-fixture.css', ['spikes/workspace/ui-fixture.css', 'text/css']],
  ['/ui-style.css', ['packages/ui/dist/style.css', 'text/css']],
  ['/ui-contract/geometry-fixtures.json', ['contracts/ui/v1/geometry-fixtures.json', 'application/json']],
  ['/slash-contract/strings.json', ['contracts/slash/v1/strings.json', 'application/json']],
  ['/ui-contract/v1.1/manifest.json', ['contracts/ui/v1.1/manifest.json', 'application/json']],
  ['/ui-contract/v1.1/toolbar-placement-cases.json', ['contracts/ui/v1.1/toolbar-placement-cases.json', 'application/json']],
  ['/ui-contract/v1.1/toolbar-placement.md', ['contracts/ui/v1.1/toolbar-placement.md', 'text/plain']],
  ['/fixture-fonts/osr40-jetbrains-mono-regular.ttf', ['tests/fixtures/fonts/JetBrainsMono-Regular.ttf', 'font/ttf']],
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
for (const name of ['wasm', 'sdk', 'kwdj', 'dom', 'ui']) {
  await allowSnippets(new URL(`packages/${name}/dist/`, root), `/packages/${name}/`);
}
// Import maps are static, hash-authorized data. No unsafe-inline/eval or source rewriting.
const mapHashes = [];
for (const page of ['sdk-host.html', 'dom-host.html', 'selection.html', 'composition.html', 'ui.html', 'mounted-corpus.html']) {
  const html = await readFile(new URL(`spikes/workspace/${page}`, root), 'utf8');
  const maps = [...html.matchAll(/<script type="importmap">([^<]+)<\/script>/g)];
  if (maps.length !== 1) throw new Error(`One static import map required: ${page}`);
  mapHashes.push(`'sha256-${createHash('sha256').update(maps[0][1]).digest('base64')}'`);
}
for (const name of ['manifest', 'initial-literals', 'identity-literals', 'interaction-literals', 'observation.schema', 'run-binding.schema', 'report.schema', 'source-pins']) {
  routes.set(`/mounted-corpus-contract/${name}.json`, [`contracts/mounted-e2e/v1/${name}.json`, 'application/json']);
}
const domFixtureNames = ['D0','D1-after-end-split','T03-initial','T03-split','T04-X','T04-XY','T05-styled-EGC','T05-formatted-EGC','T05-backward-EGC','T05-backward-EGC-after','T06-safe-data','T10-replacement','KWDJ-basic-catalog','Notes-D0','Notes-D1-callout-highlight','Notes-D1-highlight-only','composition-initial','composition-outside-edit','ordered-u64-data'];
for (const name of domFixtureNames) for (const kind of ['inputs','expected']) {
  const file = `${name}${kind === 'expected' ? '.canonical' : ''}.json`;
  routes.set(`/dom-fixtures/${kind}/${file}`, [`contracts/dom/v1/${kind}/${file}`, 'application/json']);
}
const domNegativeNames = ['empty-text-unknown-attrs','empty-text-unknown-field','empty-text-wrong-attrs-shape','absent-color-unknown-attr','absent-color-unknown-field','absent-highlight-unknown-attr','unsafe-javascript-href','notes-version-2','notes-extra-envelope-field','notes-title-one-byte-over','notes-unknown-root-attr','scene-break-unknown-style','scene-break-unknown-onerror','heading-level-seven','notes-wrong-tags-kind'];
for (const name of domNegativeNames) routes.set(`/dom-fixtures/negative/${name}.json`, [`contracts/dom/v1/negative/${name}.json`, 'application/json']);
for (const name of ['acceptance-oracles.v3.json','manifest.json']) routes.set(`/dom-fixtures/${name}`, [`contracts/dom/v1/${name}`, 'application/json']);
for (const name of ['manifest','bookmark-oracles','native-oracles','formatting-oracles','clipboard-oracles','unicode-oracles','scroll-oracles']) {
  routes.set(`/selection-contract/${name}.json`, [`contracts/selection/v1/${name}.json`, 'application/json']);
}
// The DOM fixture includes only the separately pinned authoring correction.
// Request input cannot select a source file or change the resolved contract.
const compositionContract = loadCompositionContract();
const compositionJsonRoutes = new Map([
  ['/composition-contract/dom-oracles.json', JSON.stringify(compositionContract.dom)],
  ['/composition-contract/native-oracles.json', JSON.stringify(compositionContract.native)],
  ['/composition-contract/event-oracles.json', JSON.stringify(compositionContract.events)],
]);
const uiSemanticJson=JSON.stringify(loadUiSemanticCases());
http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  const fixtureFont = path === '/selection' ? '; font-src http://127.0.0.1:4174/fixture-fonts/osr40-jetbrains-mono-regular.ttf' : '';
  const compositionStyle = path === '/composition'
    ? `; ${compositionStyleDirective}` : '';
  const framePolicy=path==='/ui-frame'?"; frame-src 'self'":'';
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'wasm-unsafe-eval' ${mapHashes.join(' ')}; style-src 'self'${compositionStyle}; img-src http://127.0.0.1:4174/favicon.ico; connect-src 'self'; base-uri 'none'; object-src 'none'${fixtureFont}${framePolicy}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  // Firefox requests this implicit fixture resource; no authored image is allowed.
  if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (path === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html lang="en"><title>Workspace build smoke</title><link rel="stylesheet" href="/style.css"><main class="editor-surface">Build smoke; no editor.</main></html>');
    return;
  }
  if(path==='/ui-cases.json'){res.setHeader('Content-Type','application/json');res.end(uiSemanticJson);return;}
  const compositionJson = compositionJsonRoutes.get(path);
  if (compositionJson !== undefined) {
    res.setHeader('Content-Type', 'application/json');
    res.end(compositionJson);
    return;
  }
  const route = routes.get(path);
  if (!route) { res.writeHead(404); res.end(); return; }
  try { res.setHeader('Content-Type', route[1]); res.end(await readFile(new URL(route[0], root))); }
  catch { res.writeHead(500); res.end('Build the workspace before running this fixture'); }
// 4190 is a restricted port in Firefox/WebKit (ManageSieve); use an HTTP dev port.
}).listen(4174, '127.0.0.1', () => {
  process.send?.({ kind: 'workspace-fixture-ready', pid: process.pid });
});
