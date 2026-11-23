// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import http from 'node:http';
import { extname, join, relative, sep } from 'node:path';
import { publicAssets } from './consumer.mjs';

const mimeTypes = new Map([
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.css', 'text/css'],
  ['.wasm', 'application/wasm'],
]);
const publicSpecifiers = [
  '@klenwriter/editor',
  '@klenwriter/editor-dom',
  '@klenwriter/editor-sdk',
  '@klenwriter/editor-wasm',
  '@klenwriter/editor-wasm/artifact.wasm',
  '@klenwriter/editor-kwdj',
  '@klenwriter/editor-kwdj/dom',
  '@klenwriter/editor-ui',
  '@klenwriter/editor/style.css',
  '@klenwriter/editor-ui/style.css',
];

export async function serveAlphaConsumer(consumer, html, resources, extraSpecifiers = []) {
  const paths = publicAssets(consumer, [...publicSpecifiers, ...extraSpecifiers]);
  const urlOf = path => '/' + relative(consumer.directory, path).split(sep).join('/');
  const imports = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, urlOf(path)]));
  const importMap = JSON.stringify({ imports });
  const hash = createHash('sha256').update(importMap).digest('base64');
  const policy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'sha256-" + hash +
    "'; style-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
  const routes = new Map(resources);
  routes.set('/', { type: 'text/html', body: html({ importMap, imports }) });

  for (const tarball of consumer.receipt.tarballs) {
    for (const member of tarball.files) {
      const type = mimeTypes.get(extname(member.path));
      if (!type || !member.path.startsWith('dist/') && member.path !== 'src/style.css') continue;
      const filename = join(consumer.directory, 'node_modules', tarball.name, member.path);
      assert.equal(realpathSync(filename), filename);
      const route = urlOf(filename);
      assert(!routes.has(route), route);
      routes.set(route, { type, file: filename });
    }
  }

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const route = request.method === 'GET' ? routes.get(pathname) : undefined;
    if (!route) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'content-type': route.type,
      'content-security-policy': policy,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
    response.end(route.file ? readFileSync(route.file) : route.body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  return {
    url: 'http://127.0.0.1:' + port,
    imports,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
