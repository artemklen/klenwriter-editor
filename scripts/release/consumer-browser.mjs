// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { pinnedNpmCli } from '../vanilla-alpha/pack.mjs';

const examples = {
  'vanilla-quickstart': ['index.html', 'app.mjs', 'serve.mjs'],
  'angular-quickstart': ['index.html', 'main.ts', 'angular.json', 'tsconfig.json'],
};
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function stageExample({ sourceRoot, candidateRoot, manifest, directory, name }) {
  const sourceFile = file => execFileSync('git', ['show', `${manifest.source.commit}:examples/${name}/${file}`],
    { cwd: sourceRoot });
  const packageJson = JSON.parse(sourceFile('package.json'));
  const packs = manifest.artifacts.filter(artifact => artifact.kind === 'npm');
  const installed = packs.filter(artifact => Object.hasOwn(packageJson.dependencies, artifact.name));
  assert.equal(installed.length, Object.keys(packageJson.dependencies).filter(key => key.startsWith('@klenwriter/')).length);
  await mkdir(join(directory, 'vendor'));
  for (const artifact of installed) {
    const file = basename(artifact.path);
    await copyFile(join(candidateRoot, artifact.path), join(directory, 'vendor', file));
    packageJson.dependencies[artifact.name] = 'file:./vendor/' + file;
  }
  await Promise.all(examples[name].map(file => writeFile(join(directory, file), sourceFile(file))));
  await writeFile(join(directory, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');
  if (name === 'vanilla-quickstart') {
    await copyFile(join(candidateRoot, manifest.kwdjProfile.path), join(directory, 'kwdj-registry.json'));
  }
  return installed;
}

function runNpm(cli, args, cwd, env) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${args.join(' ')} failed in ${cwd}\n${result.stdout}\n${result.stderr}`);
}

async function verifyInstallation(directory, installed) {
  const lock = await readJson(join(directory, 'package-lock.json'));
  const editorPaths = Object.keys(lock.packages).filter(path => path.includes('node_modules/@klenwriter/'));
  assert.deepEqual(editorPaths.sort(), installed.map(artifact => `node_modules/${artifact.name}`).sort());
  for (const artifact of installed) {
    const path = `node_modules/${artifact.name}`;
    const entry = lock.packages[path];
    assert.equal(entry.version, artifact.version);
    assert.equal(entry.integrity, artifact.integrity);
    assert.equal(entry.resolved, 'file:vendor/' + basename(artifact.path));
    const directoryPath = join(directory, path);
    assert.equal(await realpath(directoryPath), directoryPath, 'Expected a real external installation');
    assert.equal((await readJson(join(directoryPath, 'package.json'))).version, artifact.version);
  }
}

async function withServer(cli, cwd, env, check) {
  const child = spawn(process.execPath, [cli, 'start'], {
    cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stopped = new Promise(resolve => child.once('close', resolve));
  let output = '';
  let timer;
  const address = new Promise((resolve, reject) => {
    const append = data => {
      output += data.toString();
      const listening = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (listening) resolve(listening[0]);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', reject);
    child.once('close', code => reject(new Error('Example server exited with ' + code)));
    timer = setTimeout(() => reject(new Error('Example server startup timed out')), 120_000);
  });
  try {
    return await check(await address);
  } catch (error) {
    throw new Error(`${cwd}\n${output}`, { cause: error });
  } finally {
    clearTimeout(timer);
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await stopped;
  }
}

async function checkBrowser(browser, address, expectedWasm) {
  const context = await browser.newContext();
  const errors = [];
  try {
    const page = await context.newPage();
    const offOrigin = [];
    const origin = new URL(address).origin;
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      offOrigin.push(route.request().url());
      return route.abort();
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const [wasm] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/editor_wasm_bg.wasm')),
      page.goto(address),
    ]);
    assert.equal(wasm.status(), 200);
    const wasmBytes = await wasm.body();
    assert.equal(wasmBytes.length, expectedWasm.bytes);
    assert.equal(sha256(wasmBytes), expectedWasm.sha256);

    const status = page.getByRole('status', { name: '', exact: true });
    const editor = page.getByRole('textbox', { name: 'Document' });
    const canonical = page.locator('#canonical');
    await expect(status).toHaveText('Editor ready');
    await expect(editor).toHaveText('Hello, editor.');
    await editor.evaluate(element => {
      window.candidateInputs = [];
      element.addEventListener('beforeinput', event => {
        window.candidateInputs.push({ trusted: event.isTrusted, data: event.data });
      });
    });
    await editor.locator('p').click();
    await page.keyboard.press('End');
    await page.keyboard.press('x');
    await expect(editor).toHaveText('Hello, editor.x');
    assert.deepEqual(await page.evaluate(() => window.candidateInputs), [{ trusted: true, data: 'x' }]);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(status).toHaveText('Saved in this browser');
    const saved = await canonical.textContent();
    const parsed = JSON.parse(saved);
    assert.equal(parsed.profile, 'prose');
    assert.deepEqual(parsed.content, [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello, editor.x' }] }]);

    await page.reload();
    await expect(status).toHaveText('Editor ready');
    await expect(editor).toHaveText('Hello, editor.');
    await page.getByRole('button', { name: 'Reopen saved', exact: true }).click();
    await expect(status).toHaveText('Reopened saved document');
    await expect(editor).toHaveText('Hello, editor.x');
    assert.equal(await canonical.textContent(), saved);
    assert.deepEqual(offOrigin, []);
    assert.deepEqual(errors, []);
    return { browser: `Playwright Chromium ${browser.version()}`, wasmSha256: expectedWasm.sha256,
      savedDocumentSha256: sha256(saved), trustedBeforeInput: true };
  } catch (error) {
    if (errors.length) throw new Error(errors.join('\n'), { cause: error });
    throw error;
  } finally {
    await context.close();
  }
}

export async function runBrowserConsumers({ sourceRoot, candidateRoot, manifest }) {
  const { cli, version } = pinnedNpmCli(sourceRoot);
  const parent = await realpath(tmpdir());
  const relation = relative(sourceRoot, parent);
  assert(relation === '..' || relation.startsWith('..' + sep), 'Consumer directory must be outside the checkout');
  const directory = await mkdtemp(join(parent, 'editor-candidate-web-'));
  const bin = join(directory, 'bin');
  const env = { ...process.env, PATH: bin, NG_CLI_ANALYTICS: 'false',
    KLENWRITER_EXAMPLE_PORT: '0', npm_config_userconfig: join(directory, 'user.npmrc'),
    npm_config_globalconfig: join(directory, 'global.npmrc'), npm_config_script_shell: '/bin/sh' };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  let browser;
  try {
    await mkdir(bin);
    await symlink(process.execPath, join(bin, 'node'));
    for (const tool of ['cargo', 'rustc']) {
      assert.equal(spawnSync(tool, ['--version'], { cwd: directory, env }).error?.code, 'ENOENT');
    }
    browser = await chromium.launch();
    const wasm = manifest.artifacts.find(artifact => artifact.kind === 'wasm');
    const results = [];
    for (const name of Object.keys(examples)) {
      const cwd = join(directory, name);
      await mkdir(cwd);
      const installed = await stageExample({ sourceRoot, candidateRoot, manifest, directory: cwd, name });
      runNpm(cli, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], cwd, env);
      await verifyInstallation(cwd, installed);
      if (name === 'angular-quickstart') runNpm(cli, ['run', 'build'], cwd, env);
      const result = await withServer(cli, cwd, env, address => checkBrowser(browser, address, wasm));
      results.push({ example: name, status: 'pass', npm: version, installed: installed.map(({ name, version, sha256, integrity }) =>
        ({ name, version, sha256, integrity })), ...result });
    }
    return results;
  } finally {
    try { await browser?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}
