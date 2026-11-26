// SPDX-License-Identifier: MIT OR Apache-2.0
import { copyFile, cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from 'esbuild';

const output = 'dist';
const glue = fileURLToPath(import.meta.resolve('@klenwriter/editor-wasm/artifact'));
const wasm = fileURLToPath(import.meta.resolve('@klenwriter/editor-wasm/artifact.wasm'));
await mkdir(output, { recursive: true });
await Promise.all([
  copyFile('index.html', join(output, 'index.html')),
  copyFile(glue, join(output, 'editor_wasm.js')),
  copyFile(wasm, join(output, 'editor_wasm_bg.wasm')),
  cp(join(dirname(glue), 'snippets'), join(output, 'snippets'), { recursive: true }),
]);

const build = await context({
  entryPoints: ['app.mjs'], bundle: true, format: 'esm', outfile: join(output, 'app.js'),
});
try {
  const { hosts, port } = await build.serve({ servedir: output, host: '127.0.0.1', port: 4173 });
  console.log(`Open http://${hosts[0]}:${port}/`);
  await new Promise(resolve => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
} finally {
  await build.dispose();
}
