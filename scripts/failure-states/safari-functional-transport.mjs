// SPDX-License-Identifier: MIT OR Apache-2.0
// Bounded ordinary Safari Apple Events pattern from clipboard-installed.
// No physical input, WebDriver, capture, pre-navigation interception or import.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const origin = 'http://127.0.0.1:4174';
const urls = { dom: origin + '/clipboard', runtime: origin + '/failure' };
const defaultTitles = { dom: 'Clipboard contract fixture', runtime: 'OSR-67 failure-state fixture' };
const methods = {
  dom: ['failureMount', 'failureSelect', 'failureInspect', 'failurePaste', 'failureTakeRecovery', 'failureDispose', 'failureAllDisposed', 'metadata'],
  runtime: ['inspect', 'checkpoint', 'edit', 'holdDelayedSave', 'trap', 'peerAfterRetirement', 'retainedProjectionAfterRetirement',
    'loadAfterRetirement', 'completeDelayedSave', 'retainProvisionalSeparately', 'save', 'dispose'],
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pin = path => { const bytes = readFileSync(path); return { path, bytes: bytes.length, sha256: sha(bytes) }; };

const createSource = `on run argv
  set fixtureURL to item 1 of argv
  if fixtureURL is not "${urls.dom}" and fixtureURL is not "${urls.runtime}" then error "Closed functional fixture URL"
  tell application "Safari"
    set previousIDs to id of every window
    if (count of previousIDs) is greater than or equal to 32 then error "Owned Safari window observation bound"
    make new document with properties {URL:fixtureURL}
    set createdIDs to {}
    repeat with candidate in windows
      if previousIDs does not contain (id of candidate) then set end of createdIDs to (id of candidate)
    end repeat
    if (count of createdIDs) is not 1 then error "Exactly one newly owned Safari window required"
    set ownedID to item 1 of createdIDs
    set bounds of window id ownedID to {80,60,1280,960}
    set index of window id ownedID to 1
    activate
    return ownedID as text
  end tell
end run`;
const evaluateSource = `on run argv
  set codePath to item 1 of argv
  set ownedID to (item 2 of argv) as integer
  set expectedURL to item 3 of argv
  set expectedTitle to item 4 of argv
  set bootstrapTitle to item 5 of argv
  set javascriptText to read (POSIX file codePath) as «class utf8»
  tell application "Safari"
    if not (exists window id ownedID) then error "Original owned Safari window missing"
    set ownedWindow to window id ownedID
    if (count of tabs of ownedWindow) is not 1 then error "Owned Safari tab count changed"
    if URL of current tab of ownedWindow is not expectedURL then error "Exact functional fixture URL changed"
    set actualTitle to name of current tab of ownedWindow
    if bootstrapTitle is not "" and actualTitle is not expectedTitle and actualTitle is not bootstrapTitle then error "Owned Safari title changed"
    return do JavaScript javascriptText in current tab of ownedWindow
  end tell
end run`;
const closeSource = `on run argv
  set ownedID to (item 1 of argv) as integer
  set expectedURL to item 2 of argv
  set expectedTitle to item 3 of argv
  set bootstrapTitle to item 4 of argv
  tell application "Safari"
    if not (exists window id ownedID) then return "original_owned_window_already_absent"
    set ownedWindow to window id ownedID
    if (count of tabs of ownedWindow) is not 1 then error "Cleanup owned tab count changed"
    if URL of current tab of ownedWindow is not expectedURL then error "Cleanup exact fixture URL changed"
    set actualTitle to name of current tab of ownedWindow
    if bootstrapTitle is not "" and actualTitle is not expectedTitle and actualTitle is not bootstrapTitle then error "Cleanup exact title changed"
    close ownedWindow
    if exists window id ownedID then error "Original owned Safari fixture did not close"
    return "original_owned_window_closed"
  end tell
end run`;

export const safariFunctionalUnobserved = [
  'REQUIRED_NETWORK_METHOD_UNOBSERVED: no pre-navigation record-before-decision interception or complete binary delivered-body hash ledger',
  'BOOTSTRAP_OBSERVER_UNOBSERVED: error/CSP/rejection listeners are installed only after the actual host is ready',
  'CONSOLE_DIALOG_POPUP_COMPLETENESS_UNOBSERVED: this Apple Events facade has no independent console/dialog/new-page event stream',
  'FRESH_CONTEXT_AND_SW_BLOCKING_UNOBSERVED: ordinary installed Safari window is fresh, but its browser context/storage are shared; current controller state is observed only after ready',
];

export function safariFunctionalVersion({ outputDirectory, record }) {
  const plist = '/Applications/Safari.app/Contents/Info.plist';
  const execute = (command, args) => {
    const start = performance.now(), result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 65536 });
    const receipt = { command, args, elapsedMs: performance.now() - start, exitCode: result.status, signal: result.signal,
      error: result.error?.message ?? null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    record(receipt); assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.error, undefined);
    return receipt.stdout.trim();
  };
  const browserVersion = execute('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist]);
  const bundleBuild = execute('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', plist]);
  const actualApplicationVersion = execute('/usr/bin/osascript', ['-e', 'tell application "Safari" to return version']);
  const result = { browser: 'Safari', installed: true, browserVersion, bundleBuild, actualApplicationVersion,
    plist: pin(plist), executable: pin('/Applications/Safari.app/Contents/MacOS/Safari'),
    method: 'ordinary installed Safari; guarded Apple Events JavaScript facade; no WebDriver session',
    physicalInput: false, osClipboard: false, capture: false, outputDirectory };
  assert(browserVersion.length && bundleBuild.length && actualApplicationVersion.length); return result;
}

export async function createSafariFunctional({ kind, directory, deadline, record }) {
  assert(Object.hasOwn(urls, kind));
  const url = urls[kind], nonce = randomBytes(16).toString('hex'), title = `KlenWriter OSR-67 functional ${nonce}`;
  const sourcePaths = { create: resolve(directory, 'create.applescript'), evaluate: resolve(directory, 'evaluate.applescript'), close: resolve(directory, 'close.applescript') };
  for (const [name, source] of [['create', createSource], ['evaluate', evaluateSource], ['close', closeSource]]) writeFileSync(sourcePaths[name], source, { flag: 'wx', mode: 0o444 });
  let serial = 0, callSerial = 0, busy = false, disabled = false, prepared = false, closed = false, documentIdentity = null;
  const commands = [];
  const execute = (command, args, maximum = 5000, cleanup = false) => {
    const remaining = cleanup ? 5000 : Math.floor(Math.min(maximum, deadline - performance.now()));
    assert(remaining > 0, 'Original functional row deadline expired');
    const start = performance.now(), result = spawnSync(command, args, { encoding: 'utf8', timeout: remaining, maxBuffer: 4 * 1024 * 1024 });
    const raw = result.stdout ?? '', receipt = { command, args, elapsedMs: performance.now() - start, timeoutMs: remaining,
      exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
      stdoutBytes: Buffer.byteLength(raw), stdoutSha256: sha(raw), stderr: result.stderr ?? '' };
    if (args[0] === sourcePaths.create || args[0] === sourcePaths.close) receipt.stdout = raw;
    assert(commands.length < 4096, 'Bounded completed Apple Events receipts'); commands.push(receipt); record(receipt);
    assert.equal(result.status, 0, receipt.stderr); assert.equal(result.signal, null); assert.equal(result.error, undefined);
    return raw.trim();
  };
  const created = execute('/usr/bin/osascript', [sourcePaths.create, url], 15000);
  assert.match(created, /^[1-9][0-9]{0,9}$/); const windowId = Number(created); assert(Number.isSafeInteger(windowId));
  const lifecycle = { kind: 'ordinary-owned-window', windowId, url, title, nonce, webDriver: false,
    sourcePins: Object.values(sourcePaths).map(pin), documents: [], created: true, closed: false };
  const evaluate = code => {
    assert(!closed && ++serial <= 4096); assert(Buffer.byteLength(code) <= 262144, 'Bounded fixed page facade');
    const path = resolve(directory, `page-${String(serial).padStart(4, '0')}.js`); writeFileSync(path, code, { flag: 'wx', mode: 0o444 });
    const raw = execute('/usr/bin/osascript', [sourcePaths.evaluate, path, String(windowId), url, title, prepared ? title : '']);
    try { return JSON.parse(raw); }
    catch (error) { record({ kind: 'page-json-decode-failure', script: pin(path), raw }); throw error; }
  };
  async function bootstrap(previous = null) {
    prepared = false;
    const readyDeadline = Math.min(deadline, performance.now() + 15000);
    const readyName = kind === 'dom' ? 'clipboardHostReady' : 'failureRuntimeReady';
    for (;;) {
      const value = evaluate(`JSON.stringify({ready:globalThis[${JSON.stringify(readyName)}]===true,timeOrigin:performance.timeOrigin,url:location.href})`);
      if (value.ready && (previous === null || value.timeOrigin !== previous)) break;
      assert(performance.now() < readyDeadline, 'Actual new document ready deadline'); await wait(100);
    }
    const identity = `${nonce}:${lifecycle.documents.length + 1}`;
    const metadata = evaluate(`(()=>{
      if(location.href!==${JSON.stringify(url)})throw Error('Exact functional URL');
      if(globalThis.__osr67FunctionalObserver)throw Error('Observer installed once per document');
      const csp=[],errors=[],rejections=[];let overflow=false;
      const put=(items,value)=>{if(items.length<32)items.push(value);else overflow=true;};
      addEventListener('securitypolicyviolation',e=>put(csp,{directive:e.violatedDirective,blocked:e.blockedURI}));
      addEventListener('error',e=>put(errors,{message:e.message??'resource error',filename:e.filename??null}),true);
      addEventListener('unhandledrejection',e=>put(rejections,{message:String(e.reason)}));
      const before={__clipboardUnexpectedExecution:globalThis.__clipboardUnexpectedExecution??0,__osr39:globalThis.__osr39??0};
      if(before.__clipboardUnexpectedExecution!==0||before.__osr39!==0)throw Error('Existing sentinel failure before observer installation');
      for(const name of Object.keys(before))if(globalThis[name]===undefined)globalThis[name]=0;
      document.title=${JSON.stringify(title)};
      const metadata=()=>({identity:${JSON.stringify(identity)},url:location.href,title:document.title,userAgent:navigator.userAgent,
        timeOrigin:performance.timeOrigin,language:navigator.language,platform:navigator.platform,visibility:document.visibilityState,
        serviceWorkerController:navigator.serviceWorker?.controller?.scriptURL??null,frames:frames.length,
        csp:csp.slice(),errors:errors.slice(),rejections:rejections.slice(),overflow,
        sentinels:{__clipboardUnexpectedExecution:globalThis.__clipboardUnexpectedExecution,__osr39:globalThis.__osr39}});
      Object.defineProperty(globalThis,'__osr67FunctionalObserver',{value:{identity:${JSON.stringify(identity)},read:metadata}});
      return JSON.stringify(metadata());})()`);
    prepared = true; documentIdentity = identity; lifecycle.documents.push(metadata); return metadata;
  }
  const guard = () => `if(location.href!==${JSON.stringify(url)}||document.title!==${JSON.stringify(title)}||globalThis.__osr67FunctionalObserver?.identity!==${JSON.stringify(documentIdentity)})throw Error('Original functional document ownership changed');`;
  async function operation(label, body) {
    assert(!disabled && !busy && prepared, 'No replay after unknown completion or concurrent facade operation');
    assert(++callSerial <= 256, 'Bounded functional calls per original row'); busy = true;
    const id = `${nonce}:call:${callSerial}`, started = performance.now(), callDeadline = Math.min(deadline, started + 12000);
    try {
      const accepted = evaluate(`(()=>{${guard()}if(globalThis.__osr67FunctionalResult&&!globalThis.__osr67FunctionalResult.done)throw Error('Prior completion pending');
        globalThis.__osr67FunctionalResult={id:${JSON.stringify(id)},done:false};
        Promise.resolve().then(()=>{${body}}).then(value=>{globalThis.__osr67FunctionalResult={id:${JSON.stringify(id)},done:true,ok:true,value};},error=>{
          globalThis.__osr67FunctionalResult={id:${JSON.stringify(id)},done:true,ok:false,error:{name:error.name,message:error.message,stack:error.stack??null}};
        });return JSON.stringify({accepted:${JSON.stringify(id)}});})()`);
      assert.equal(accepted.accepted, id);
      for (;;) {
        assert(performance.now() < callDeadline, 'Original facade completion deadline; do not replay');
        const value = evaluate(`(()=>{${guard()}const s=globalThis.__osr67FunctionalResult;if(s?.id!==${JSON.stringify(id)})throw Error('Original completion slot changed');return JSON.stringify(s);})()`);
        if (value.done) {
          record({ kind: 'completed-functional-call', id, label, elapsedMs: performance.now() - started, result: value });
          assert.equal(value.ok, true, JSON.stringify(value.error)); return value.value;
        }
        await wait(50);
      }
    } catch (error) { disabled = true; record({ kind: 'functional-call-failed', id, label, completion: 'unknown-or-failed; no replay', error: { name: error.name, message: error.message } }); throw error; }
    finally { busy = false; }
  }
  return {
    lifecycle,
    async ready() { return bootstrap(); },
    async browser() { return evaluate(`(()=>{${guard()}return JSON.stringify(globalThis.__osr67FunctionalObserver.read());})()`); },
    async call(method, ...args) {
      assert(methods[kind].includes(method), 'Closed functional method'); assert(Buffer.byteLength(JSON.stringify(args)) <= 131072);
      const host = kind === 'dom' ? 'clipboardHost' : 'failureRuntimeFixture';
      return operation(method, `return globalThis[${JSON.stringify(host)}][${JSON.stringify(method)}](...${JSON.stringify(args)});`);
    },
    async window(label) {
      const value = await operation(label, `return new Promise((resolve,reject)=>{const started=performance.now(),timer=setTimeout(()=>reject(Error('Two-frame observation deadline')),2000);
        requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);setTimeout(()=>resolve({frames:2,started,finished:performance.now(),fixedWindowMs:250}),250);}));});`);
      assert.equal(value.frames, 2); assert.equal(value.fixedWindowMs, 250); assert(value.finished - value.started >= 250); return value;
    },
    async reload(action) {
      assert.equal(kind, 'runtime'); assert(['explicit-recovery', 'reload'].includes(action)); assert(!busy && !disabled);
      const before = await this.browser();
      const accepted = evaluate(`(()=>{${guard()}setTimeout(()=>{${action === 'explicit-recovery' ? "document.querySelector('#failure-recover').click();" : 'location.reload();'}},0);return JSON.stringify({accepted:true,timeOrigin:performance.timeOrigin});})()`);
      assert.equal(accepted.accepted, true); return bootstrap(before.timeOrigin);
    },
    async close() {
      if (closed) return { status: 'already_closed', lifecycle };
      const raw = execute('/usr/bin/osascript', [sourcePaths.close, String(windowId), url, title, prepared ? defaultTitles[kind] : ''], 5000, true);
      assert(['original_owned_window_closed', 'original_owned_window_already_absent'].includes(raw));
      closed = true; lifecycle.closed = true; lifecycle.closeResult = raw;
      return { status: raw, lifecycle };
    },
  };
}
