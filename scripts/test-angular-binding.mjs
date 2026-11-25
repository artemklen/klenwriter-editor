// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const toolchain = createRequire(new URL('scripts/angular-build/package.json', root));
const angular = {
  name: 'one-angular-runtime',
  setup(context) {
    context.onResolve({ filter: /^(?:@angular\/|rxjs(?:\/|$))/ }, ({ path }) => ({ path: toolchain.resolve(path) }));
  },
};
const fixture = await build({
  stdin: {
    contents: `import { runAngularBindingProbe } from './tests/support/angular-binding-fixture.ts';
      window.angularBindingResult = runAngularBindingProbe();`,
    resolveDir: fileURLToPath(root),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  plugins: [angular],
  tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
  metafile: true,
  write: false,
});

// Inspect resolved code, including indirect imports of the Angular fixture and binding.
assert(Object.keys(fixture.metafile.inputs).some(path => path === 'packages/angular/dist/editor.directive.js'));
for (const path of Object.keys(fixture.metafile.inputs)) {
  assert.doesNotMatch(path, /(?:^|\/)(?:@tiptap\/|prosemirror(?:[-/]|$)|(?:klenwriter[-/])?cms(?:[-/]|$)|frontend\/admin-spa\/)/i);
}

const routes = new Map([
  ['/', ['text/html', '<!doctype html><meta charset="utf-8"><title>Angular binding test</title><script type="module" src="/probe.js"></script>']],
  ['/probe.js', ['text/javascript', fixture.outputFiles[0].contents]],
  ['/kwdj-registry.json', ['application/json', await readFile(new URL('packages/kwdj/dist/registry.json', root))]],
  ['/editor_wasm_bg.wasm', ['application/wasm', await readFile(new URL('packages/wasm/dist/editor_wasm_bg.wasm', root))]],
]);
const server = createServer(({ method, url }, response) => {
  const route = method === 'GET' && routes.get(url);
  if (!route) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'Content-Type': route[0], 'Cache-Control': 'no-store' }).end(route[1]);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.angularBindingResult instanceof Promise);
  const result = await page.evaluate(() => Promise.race([
    window.angularBindingResult,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Angular binding timed out')), 10_000)),
  ]));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
