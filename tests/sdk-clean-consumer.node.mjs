import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sha512 = bytes => createHash('sha512').update(bytes).digest('base64');
const selected = ['wasm', 'sdk', 'kwdj'];

function npmCli() {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) return realpathSync(process.env.npm_execpath);
  for (const directory of [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)]) {
    const candidate = join(directory, 'npm');
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  throw new Error('Actual npm CLI path required for clean-consumer preparation');
}

test('packed SDK/wasm/KWDJ execute real Session with cargo and rustc absent from child PATH', () => {
  const inventory = JSON.parse(readFileSync(resolve(root, 'artifacts/package-inventory.json'), 'utf8'));
  const packages = selected.map(role => {
    const name = `@klenwriter/editor-${role}`;
    const rows = inventory.filter(pkg => pkg.name === name);
    assert.equal(rows.length, 1, `actual packed inventory for ${name}`);
    const record = rows[0]; const path = resolve(root, 'artifacts/packages', record.filename);
    const bytes = readFileSync(path);
    assert.equal(record.integrity, `sha512-${sha512(bytes)}`);
    const source = JSON.parse(readFileSync(resolve(root, `packages/${role}/package.json`), 'utf8'));
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(source.scripts?.[hook], undefined, `${name} has no consumer build hook`);
    return { role, name, path, sha256: hash(bytes), bytes: bytes.length, inventory: record };
  });
  const directory = mkdtempSync(join(tmpdir(), 'editor-sdk-consumer-'));
  const emptyPath = join(directory, 'no-executables'); mkdirSync(emptyPath);
  const environment = { ...process.env, PATH: emptyPath, npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  delete environment.NODE_PATH; delete environment.NODE_OPTIONS;
  const npm = npmCli();
  try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n');
    const install = spawnSync(process.execPath, [npm, 'install', '--prefix', directory, '--offline',
      '--ignore-scripts', '--no-audit', '--no-fund', ...packages.map(pkg => pkg.path)],
    { cwd: directory, env: environment, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(install.status, 0, `${install.error ?? ''}\n${install.stderr}\n${install.stdout}`);
    const installed = [];
    for (const pkg of packages) {
      for (const entry of pkg.inventory.files.filter(file => file.path.startsWith('dist/'))) {
        const bytes = readFileSync(join(directory, 'node_modules', pkg.name, entry.path));
        const producer = readFileSync(resolve(root, 'packages', pkg.role, entry.path));
        assert.deepEqual(bytes, producer, `${pkg.name}/${entry.path} equals actual producer artifact`);
        installed.push({ package: pkg.name, file: entry.path, bytes: bytes.length, sha256: hash(bytes) });
      }
    }
    const scenario = readFileSync(resolve(root, 'spikes/workspace/sdk-scenario.js'));
    writeFileSync(join(directory, 'scenario.mjs'), scenario);
    const notesTestkit = readFileSync(resolve(root, 'examples/notes-extension/testkit.mjs'));
    const extensionPacket = readFileSync(resolve(root, 'artifacts/extensions/packet.json'));
    writeFileSync(join(directory, 'notes-testkit.mjs'), notesTestkit);
    writeFileSync(join(directory, 'extensions-packet.json'), extensionPacket);
    const program = `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createEditor, loadSdk, loadSdkV2, sdkBuildId } from '@klenwriter/editor-sdk';
import { kwdjCommand } from '@klenwriter/editor-kwdj';
import { exercisePackagedSdk } from './scenario.mjs';
import { exerciseNotes, wasmPort, notesOptions } from './notes-testkit.mjs';
const missingTools = {};
for (const name of ['cargo', 'rustc']) {
  const result = spawnSync(name, ['--version'], { encoding: 'utf8' });
  assert.equal(result.error?.code, 'ENOENT'); missingTools[name] = result.error.code;
}
const wasm = readFileSync(new URL(import.meta.resolve('@klenwriter/editor-wasm/artifact.wasm')));
const module = await loadSdk({ wasm });
assert.equal(module.manifest.build_id, sdkBuildId);
const report = await exercisePackagedSdk({ createEditor, kwdjCommand, module, loader: () => Promise.resolve(module) }, 12);
const v2 = await loadSdkV2({ wasm });
assert.equal(v2.manifest.build_id, sdkBuildId);
const packetBytes = readFileSync(new URL('./extensions-packet.json', import.meta.url));
const packet = JSON.parse(packetBytes);
const baseline = JSON.parse(v2.resourceCounts()), parsedNativeReplyReadbacks = [];
const notes = await exerciseNotes(wasmPort(v2, value => parsedNativeReplyReadbacks.push(value)), packet);
assert.equal(notes.module, 'present'); assert.equal(notes.codec.length, 53); assert.equal(notes.commands.length, 18);
assert.equal(notes.runtimeRecipe, 'passed'); assert.equal(notes.simultaneousFrozenD0D1, true);
const oldInput = packet.kwdj.find(item => item.expectedStatus === 'accepted');
const old = new module.Session(new TextEncoder().encode(oldInput.input), JSON.stringify({abi:'editor-sdk/1',build_id:sdkBuildId,
  profile:module.manifest.profiles[0],admission:'validate',access:'editable',identities:{media:[],references:[]},limits:null}));
const raw = new v2.Session(new TextEncoder().encode(packet.extension.initial), JSON.stringify(notesOptions(v2.manifest, packet)));
try {
  assert.equal(JSON.parse(old.initialization()).status, 'ok'); assert.equal(JSON.parse(raw.initialization()).status, 'ok');
  assert.equal(JSON.parse(module.resourceCounts()).sessions, 2); assert.equal(JSON.parse(v2.resourceCounts()).sessions, 2);
} finally { old.destroy(); old.free(); raw.destroy(); raw.free(); }
const editor = createEditor({input:new TextEncoder().encode(packet.extension.initial),options:notesOptions(v2.manifest, packet),loader:async()=>v2});
const observations = [], queued = [];
try {
  assert.equal((await editor.ready).status,'ok'); assert.equal(editor.context().build_id,sdkBuildId);
  const doc=editor.read({kind:'node',stamp:editor.capture(),node:editor.read({kind:'state'}).value.state.root}).value.node.children[0];
  const command={id:packet.extension.command_id,payload_json:JSON.stringify({kind:'recipe',arguments:{nodes:{doc},values:packet.extension.values}})};
  editor.subscribe(event=>{
    observations.push(['first',event.change.kind,event.after.revision,editor.read({kind:'state'}).value.state.stamp.selection_epoch]);
    if(event.sequence==='1'){
      const stamp=structuredClone(editor.capture());
      queued.push(editor.submit({kind:'set_stored_marks',stamp,marks:[]}));
      queued.push(editor.submit({kind:'barrier',stamp}));
    }
  });
  editor.subscribe(event=>observations.push(['second',event.change.kind,event.after.revision,editor.capture().selection_epoch]));
  const before=editor.capture();assert.equal(editor.query({kind:'query_command',stamp:before,command}).value.available,true);
  assert.deepEqual(editor.capture(),before);assert.equal(observations.length,0);
  assert.equal(editor.submit({kind:'command',stamp:before,command,history_hint:{kind:'isolated'}}).response.status,'ok');
  assert.equal(queued.length,2);assert(queued.every(ticket=>ticket.status==='queued'));
  assert.equal((await queued[0].completion).status,'ok');assert.equal((await queued[1].completion).diagnostic.code,'session.stale_selection_epoch');
  assert.equal(observations.length,4);assert.equal(observations[0][1],'document');assert.equal(observations[2][1],'state');
  assert.deepEqual(observations[0].slice(1),observations[1].slice(1));assert.deepEqual(observations[2].slice(1),observations[3].slice(1));
  const saved=editor.submit({kind:'snapshot',stamp:editor.capture(),max_bytes:16777216}).response.value;
  assert.equal(saved.canonical_json,packet.extension.after);editor.submit({kind:'release_snapshot',handle:saved.handle});
  for(const [direction,expected] of [['undo',packet.extension.initial],['redo',packet.extension.after]]){
    assert.equal(editor.submit({kind:'history',stamp:editor.capture(),direction}).response.status,'ok');
    const saved=editor.submit({kind:'snapshot',stamp:editor.capture(),max_bytes:16777216}).response.value;
    assert.equal(saved.canonical_json,expected);editor.submit({kind:'release_snapshot',handle:saved.handle});
  }
}finally{editor.destroy();}
assert.equal(editor.resources().sessions,0);assert.equal(editor.resources().listeners,0);assert.equal(editor.resources().pending_tickets,0);
assert.deepEqual(JSON.parse(v2.resourceCounts()),baseline);
process.stdout.write(JSON.stringify({ ...report, missingTools, wasmSha256: createHash('sha256').update(wasm).digest('hex'),
  extensions:{notes,actualV2Controller:true,reentrant:true,staleCapturedStateRefused:true,exactHistory:true,actualSharedV1V2RustCounters:true,
    observations,nativeBaseline:baseline,nativeFinal:JSON.parse(v2.resourceCounts()),parsedNativeReplyReadbacks,
    packetSha256:createHash('sha256').update(packetBytes).digest('hex')},
  cwdOutsideCheckout: !process.cwd().startsWith(${JSON.stringify(root)}), hooksDisabled: process.env.npm_config_ignore_scripts === 'true' }) + '\\n');
`;
    writeFileSync(join(directory, 'consumer.mjs'), program);
    const child = spawnSync(process.execPath, [join(directory, 'consumer.mjs')], {
      cwd: directory, env: environment, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(child.status, 0, `${child.error ?? ''}\n${child.stderr}\n${child.stdout}`);
    const result = JSON.parse(child.stdout);
    assert.equal(result.status, 'passed'); assert.equal(result.cycles, 12);
    assert.deepEqual(result.missingTools, { cargo: 'ENOENT', rustc: 'ENOENT' });
    assert.equal(result.cwdOutsideCheckout, true); assert.equal(result.hooksDisabled, true);
    assert.equal(result.build_id, JSON.parse(readFileSync(resolve(root, 'artifacts/sdk-build-identity.json'), 'utf8')).buildId);
    assert.equal(result.wasmSha256, hash(readFileSync(resolve(root, 'packages/wasm/dist/editor_wasm_bg.wasm'))));
    assert.equal(result.extensions.notes.codec.length, 53); assert.equal(result.extensions.notes.commands.length, 18);
    assert.equal(result.extensions.notes.runtimeRecipe, 'passed'); assert.equal(result.extensions.notes.simultaneousFrozenD0D1, true);
    assert.equal(result.extensions.actualV2Controller, true); assert.equal(result.extensions.actualSharedV1V2RustCounters, true);
    assert.equal(result.extensions.packetSha256, hash(extensionPacket));
    mkdirSync(resolve(root, 'artifacts'), { recursive: true });
    writeFileSync(resolve(root, 'artifacts/sdk-clean-consumer-report.json'), JSON.stringify({
      format: 'klenwriter-editor-sdk-clean-consumer/1', status: 'passed',
      install: { exitCode: install.status, offline: true, ignoreScripts: true, npmCli: npm, nodeExecutable: process.execPath },
      execution: { exitCode: child.status, pathContainsNoExecutables: true },
      tarballs: packages.map(({ inventory, ...value }) => value), installedArtifactHashes: installed,
      scenarioSha256: hash(scenario), extensionInputs: { testkitSha256: hash(notesTestkit), packetSha256: hash(extensionPacket) }, report: result,
      scope: 'Three actual packed private tarballs installed into a fresh external JS project. Child PATH has no cargo/rustc; no claim that tools were uninstalled globally. Legacy12cycles plus actual V2 notes53/commands18/runtime recipe/frozenD0D1/shared Rust ownership and reentrant controller. Parsed native replies retained. No renderer/CMS acceptance.',
    }, null, 2) + '\n');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
