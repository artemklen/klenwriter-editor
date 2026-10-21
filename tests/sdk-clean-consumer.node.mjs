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
// Four editor packages remain actual local tarballs. ADR-006 separately adds
// exactly two pinned public parser packages from the existing npm cache.
const selected = ['wasm', 'sdk', 'dom', 'kwdj'];
const selectedNames = new Set(selected.map(role => `@klenwriter/editor-${role}`));
const parserVersions = Object.freeze({ parse5: '8.0.1', entities: '8.1.0' });
const parserLicenses = Object.freeze({ parse5: 'MIT', entities: 'BSD-2-Clause' });

function npmCli() {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) return realpathSync(process.env.npm_execpath);
  for (const directory of [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)]) {
    const candidate = join(directory, 'npm');
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  throw new Error('Actual npm CLI path required for clean-consumer preparation');
}

test('packed SDK/wasm/KWDJ execute real Session with cargo and rustc absent from child PATH', () => {
  const lockBytes = readFileSync(resolve(root, 'package-lock.json'));
  const lock = JSON.parse(lockBytes);
  const parserPackages = Object.entries(parserVersions).map(([name, version]) => {
    const locked = lock.packages['node_modules/' + name];
    assert.equal(locked.version, version);
    assert.equal(locked.resolved, `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`);
    assert.equal(locked.license, parserLicenses[name]);
    assert.equal(locked.dev ?? false, false);
    assert.deepEqual(locked.dependencies ?? {}, name === 'parse5' ? { entities: '^8.0.0' } : {});
    assert.match(locked.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
    return { name, version, resolved: locked.resolved, integrity: locked.integrity,
      license: locked.license, dependencies: locked.dependencies ?? {} };
  });
  const inventory = JSON.parse(readFileSync(resolve(root, 'artifacts/package-inventory.json'), 'utf8'));
  const packages = selected.map(role => {
    const name = `@klenwriter/editor-${role}`;
    const rows = inventory.filter(pkg => pkg.name === name);
    assert.equal(rows.length, 1, `actual packed inventory for ${name}`);
    const record = rows[0]; const path = resolve(root, 'artifacts/packages', record.filename);
    const bytes = readFileSync(path);
    assert.equal(record.integrity, `sha512-${sha512(bytes)}`);
    const source = JSON.parse(readFileSync(resolve(root, `packages/${role}/package.json`), 'utf8'));
    for (const [dependency, version] of Object.entries(source.dependencies ?? {})) {
      if (dependency === 'parse5') {
        assert.equal(role, 'kwdj', 'Only the optional concrete KWDJ boundary may depend on parse5');
        assert.equal(version, parserVersions.parse5, 'Direct parser dependency remains an exact reviewed pin');
      } else {
        assert(selectedNames.has(dependency), `${name} editor dependency ${dependency} must be supplied as an actual packed tarball`);
      }
    }
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(source.scripts?.[hook], undefined, `${name} has no consumer build hook`);
    return { role, name, path, sha256: hash(bytes), bytes: bytes.length, inventory: record };
  });
  // macOS /var -> /private/var must have one identity before npm computes
  // relative lock locations against real installed package paths.
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'editor-sdk-consumer-')));
  assert.ok(!directory.startsWith(realpathSync(root)), 'Actual consumer project is outside checkout');
  const emptyPath = join(directory, 'no-executables'); mkdirSync(emptyPath);
  const environment = { ...process.env, PATH: emptyPath, npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  delete environment.NODE_PATH; delete environment.NODE_OPTIONS;
  const npm = npmCli();
  const npmPackage = JSON.parse(readFileSync(resolve(dirname(npm), '../package.json'), 'utf8'));
  assert.equal(npmPackage.name, 'npm');assert.equal(npmPackage.version, '11.14.0', 'Pinned npm owns the reviewed content-cache layout');
  try {
    const cacheRead = spawnSync(process.execPath, [npm, 'config', 'get', 'cache'], {
      cwd: directory, env: environment, encoding: 'utf8', timeout: 30000, maxBuffer: 16384,
    });
    assert.equal(cacheRead.status, 0, `${cacheRead.error ?? ''}\n${cacheRead.stderr}\n${cacheRead.stdout}`);
    const cache = cacheRead.stdout.trim();
    assert.ok(cache.startsWith('/') && !cache.includes('\n'), 'One explicit existing absolute npm cache');
    // npm11's content-addressed cache holds the archive addressed by locked SRI.
    // Read it before installation; never fetch/populate a missing cache or accept
    // producer node_modules as a substitute for the original public archive.
    for (const pkg of parserPackages) {
      const digest = Buffer.from(pkg.integrity.slice('sha512-'.length), 'base64');
      assert.equal(digest.length, 64);
      const hex = digest.toString('hex');
      const path = join(cache, '_cacache/content-v2/sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
      const bytes = readFileSync(path);
      assert.equal(`sha512-${sha512(bytes)}`, pkg.integrity, `${pkg.name}: cached original archive equals locked SRI`);
      pkg.cacheArchive = { path, bytes: bytes.length, sha256: hash(bytes) };
    }
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n');
    const install = spawnSync(process.execPath, [npm, 'install', '--prefix', directory, '--offline',
      '--cache', cache, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact',
      ...packages.map(pkg => pkg.path), ...parserPackages.map(pkg => `${pkg.name}@${pkg.version}`)],
    { cwd: directory, env: environment, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(install.status, 0, `${install.error ?? ''}\n${install.stderr}\n${install.stdout}`);
    const installedLockBytes = readFileSync(join(directory, 'package-lock.json'));
    const installedLock = JSON.parse(installedLockBytes);
    assert.deepEqual(Object.keys(installedLock.packages).sort(), ['', ...packages.map(pkg => 'node_modules/' + pkg.name),
      ...parserPackages.map(pkg => 'node_modules/' + pkg.name)].sort(), 'Exactly four packed editor packages and the two declared public parser packages');
    for (const pkg of parserPackages) {
      assert.equal(realpathSync(join(directory, 'node_modules', pkg.name)), join(directory, 'node_modules', pkg.name), 'Public parser package is materialized in the actual external project');
      const entry = installedLock.packages['node_modules/' + pkg.name];
      for (const field of ['version', 'resolved', 'integrity', 'license']) assert.equal(entry[field], pkg[field], `${pkg.name}: installed lock ${field}`);
      assert.deepEqual(entry.dependencies ?? {}, pkg.dependencies);
      assert.equal(installedLock.packages[''].dependencies[pkg.name], pkg.version, 'Consumer explicitly pins transitive parser resolution');
      const actualBytes = readFileSync(join(directory, 'node_modules', pkg.name, 'package.json'));
      const actual = JSON.parse(actualBytes);
      assert.equal(actual.name, pkg.name); assert.equal(actual.version, pkg.version); assert.equal(actual.license, pkg.license);
      assert.deepEqual(actual.dependencies ?? {}, pkg.dependencies);
      pkg.installedPackage = { bytes: actualBytes.length, sha256: hash(actualBytes) };
    }
    const installed = [];
    for (const pkg of packages) {
      assert.equal(realpathSync(join(directory, 'node_modules', pkg.name)), join(directory, 'node_modules', pkg.name), 'Editor tarball is materialized in the actual external project');
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
import { kwdjClipboardCodec } from '@klenwriter/editor-kwdj/clipboard';
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
// Independent source-written clipboard literals. Controlled capture data proves
// packed public conversion + native semantics; it makes no browser/OS claim.
const clipboardSource={schema:'klenwriter.document',schema_version:1,profile:'prose',content:[{type:'paragraph',content:[{type:'text',text:'old'}]}]};
const clipboardExpected={schema:'klenwriter.document',schema_version:1,profile:'prose',content:[{type:'paragraph',content:[
  {type:'text',text:'A&B'},{type:'text',text:'Я e\\u0301',marks:[{type:'strong'}]},{type:'hard_break'},
  {type:'text',text:'link',marks:[{type:'link',attrs:{href:'/safe'}}]}]}]};
const sourceHtml='<p>A&amp;B<strong>Я e\\u0301</strong><br><a href="/safe">link</a></p>';
const sourcePlain='independent plain fallback must not win';
const clipboardModuleUrl=import.meta.resolve('@klenwriter/editor-kwdj/clipboard');
assert.ok(clipboardModuleUrl.startsWith(new URL('./node_modules/',import.meta.url).href),'Clipboard resolves from external installed package');
const clip=createEditor({input:new TextEncoder().encode(JSON.stringify(clipboardSource)),loader:async()=>v2,
  options:{abi:'editor-sdk/2',build_id:sdkBuildId,profile:packet.kwdjProfile,admission:'validate',access:'editable',
    registry_json:packet.kwdjRegistryJson,profile_options_json:JSON.stringify({identities:{media:[],references:[]},limits:null})}});
let clipboard;
try{
  assert.equal((await clip.ready).status,'ok');
  const initial=clip.read({kind:'state'}).value.state;
  const selected={anchor:{kind:'child',parent:initial.root,index:0,affinity:'after'},focus:{kind:'child',parent:initial.root,index:1,affinity:'after'}};
  assert.equal(clip.submit({kind:'set_selection',stamp:clip.capture(),selection:selected}).response.status,'ok');
  const originalStamp=clip.capture(),context=clip.read({kind:'clipboard_context',stamp:originalStamp});
  assert.equal(context.status,'ok');assert.equal(context.value.format_id,'org.klenwriter.kwdj/clipboard-context/1');
  assert.deepEqual(JSON.parse(context.value.context_json),{mode:'prose',insertion_context:'root',allowed_fragment_kinds:['blocks']});
  assert.deepEqual(JSON.parse(JSON.stringify(context.value.selection)),selected,'Exact DTO data shape independent of controller-owned null prototypes');
  const representation=text=>({status:'complete_local',availability:'declared',readAttempted:true,text,utf16Units:text.length});
  const capture={format:'clipboard-capture/1',scope:'selected_exposed_strings',status:'captured',reason:null,
    metadata:{status:'complete',types:['text/plain','text/html'],items:[],counts:{types:2,items:0,files:0},media:'not_observed',internalFragment:'not_observed'},
    representations:{'text/plain':representation(sourcePlain),'text/html':representation(sourceHtml)},retainedUtf16Units:sourcePlain.length+sourceHtml.length};
  const codec=kwdjClipboardCodec({allow_origin_relative:true,allowed_schemes:['https']});
  const decoded=await codec.decode({capture,nativeContext:{formatId:context.value.format_id,json:context.value.context_json},sessionContext:clip.context()});
  assert.equal(decoded.status,'candidate');assert.deepEqual(decoded.diagnostics,[]);assert.equal(decoded.command.id,'org.klenwriter.kwdj/command/insert-fragment');
  const intent=JSON.parse(decoded.command.payload_json),fragment=JSON.parse(intent.fragment_json);
  assert.deepEqual(Object.keys(intent).sort(),['fragment_json','kind']);assert.equal(intent.kind,'insert_fragment');
  assert.deepEqual(fragment,{format_id:'org.klenwriter.kwdj/clipboard-fragment/1',source_profile:{profile_id:'org.klenwriter.kwdj',profile_version:'1.0.0',codec_id:'org.klenwriter.kwdj/json',wire_version:1},
    mode:'prose',kind:'blocks',content:clipboardExpected.content,open_start:false,open_end:false});
  assert.equal(clip.capture(),originalStamp,'Async public parser/decoder is read-only');
  const applied=clip.submit({kind:'command',stamp:originalStamp,command:decoded.command,history_hint:{kind:'isolated'}});
  assert.equal(applied.status,'completed');assert.equal(applied.response.status,'ok');assert.equal(applied.response.value.state.history.undo_entries,'1');
  const snapshot=()=>{const response=clip.submit({kind:'snapshot',stamp:clip.capture(),max_bytes:1048576}).response;assert.equal(response.status,'ok');
    const value=response.value;assert.equal(clip.submit({kind:'release_snapshot',handle:value.handle}).response.status,'ok');return value.canonical_json;};
  const canonical=snapshot();assert.deepEqual(JSON.parse(canonical),clipboardExpected);
  const actualDecomposed=JSON.parse(canonical).content[0].content[1].text;
  assert.equal([...actualDecomposed].at(-1).codePointAt(0),0x301,'Exact decomposed scalar survives parser and native insertion');
  const undone=clip.submit({kind:'history',stamp:clip.capture(),direction:'undo'}).response;
  assert.equal(undone.status,'ok');assert.equal(undone.value.state.history.undo_entries,'0');assert.equal(undone.value.state.history.redo_entries,'1');assert.deepEqual(JSON.parse(JSON.stringify(undone.value.state.selection)),selected);
  const undoCanonical=snapshot();assert.deepEqual(JSON.parse(undoCanonical),clipboardSource);
  const redone=clip.submit({kind:'history',stamp:clip.capture(),direction:'redo'}).response;assert.equal(redone.status,'ok');assert.equal(redone.value.state.history.undo_entries,'1');
  const redoCanonical=snapshot();assert.equal(redoCanonical,canonical);
  clipboard={scope:'Actual packed optional codec/parser and SDK2/sealed WASM; controlled raw data, no OS/browser delivery',moduleUrl:clipboardModuleUrl,
    sourceHtml,sourcePlain,context,decoded,canonical,undoCanonical,redoCanonical,exactDecomposed:actualDecomposed==='Я e\\u0301',equalPrecomposed:actualDecomposed==='Я é',NFCEquivalent:actualDecomposed.normalize('NFC')==='Я é'};
}finally{clip.destroy();}
for(const [name,value]of Object.entries(clip.resources()))if(typeof value==='number')assert.equal(value,0,'Released clipboard consumer '+name);
assert.deepEqual(JSON.parse(v2.resourceCounts()),baseline);
process.stdout.write(JSON.stringify({ ...report, missingTools, wasmSha256: createHash('sha256').update(wasm).digest('hex'),
  clipboard,
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
    assert.equal(result.clipboard.exactDecomposed, true);assert.equal(result.clipboard.equalPrecomposed, false);assert.equal(result.clipboard.NFCEquivalent, true);
    mkdirSync(resolve(root, 'artifacts'), { recursive: true });
    writeFileSync(resolve(root, 'artifacts/sdk-clean-consumer-report.json'), JSON.stringify({
      format: 'klenwriter-editor-sdk-clean-consumer/1', status: 'passed',
      install: { exitCode: install.status, offline: true, ignoreScripts: true, npmCli: npm, npmVersion: npmPackage.version, nodeExecutable: process.execPath,
        cache, cacheRead: { exitCode: cacheRead.status, stdout: cacheRead.stdout, stderr: cacheRead.stderr },
        originalLockSha256: hash(lockBytes), installedLockSha256: hash(installedLockBytes), publicParserPackages: parserPackages },
      execution: { exitCode: child.status, pathContainsNoExecutables: true },
      tarballs: packages.map(({ inventory, ...value }) => value), installedArtifactHashes: installed,
      scenarioSha256: hash(scenario), extensionInputs: { testkitSha256: hash(notesTestkit), packetSha256: hash(extensionPacket) }, report: result,
      scope: 'Exactly four actual packed private editor tarballs plus locked public parse5/entities original archives from existing npm cache supply the declared closure in a fresh external JS project. Offline install and exact installed lock/SRI/version checks retain the editor-tarball invariant. Child PATH has no cargo/rustc; no claim that tools were uninstalled globally. Legacy12cycles plus actual V2 notes53/commands18/runtime recipe/frozenD0D1/shared Rust ownership/reentrant controller and optional packed clipboard HTML entity/marks/link/BR/NFD conversion with one native history unit, Undo/Redo and final resource release. Parsed native replies retained. No renderer, browser/OS clipboard or CMS acceptance.',
    }, null, 2) + '\n');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
