import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

test('packaged headless SDK runs real Session lifecycle and releases resources under strict CSP', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto('/sdk');
  const csp = response.headers()['content-security-policy'];
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("'wasm-unsafe-eval'");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(csp).not.toMatch(/(?:^|\s)'unsafe-eval'/);
  const html = readFileSync('spikes/workspace/sdk-host.html', 'utf8');
  const map = /<script type="importmap">([^<]+)<\/script>/.exec(html)[1];
  expect(csp).toContain(`'sha256-${createHash('sha256').update(map).digest('base64')}'`);
  const result = await page.evaluate(async () => {
    const violations = [];
    const record = event => violations.push({ directive: event.violatedDirective, blocked: event.blockedURI });
    document.addEventListener('securitypolicyviolation', record);
    try {
      const { runSdkHost } = await import('/sdk-host.js');
      return { report: await runSdkHost(12), violations };
    } finally { document.removeEventListener('securitypolicyviolation', record); }
  });
  expect(result.report.status).toBe('passed');
  expect(result.report.cycles).toBe(12);
  expect(result.report.late_callbacks_refused).toBe(25);
  expect(result.report.native_final).toEqual(result.report.native_baseline);
  expect(result.report.native_final).toEqual({ sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 });
  expect(result.report.exact_space_nbsp).toBe(true);
  expect(result.report.retained_snapshot_listener_request_cleanup).toBe(true);
  const expected = JSON.parse(readFileSync('artifacts/sdk-build-identity.json', 'utf8'));
  expect(result.report.build_id).toBe(expected.buildId);
  expect(result.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test('packaged V2 notes literals, runtime extension and controller share one artifact under strict CSP', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto('/sdk');
  const csp = response.headers()['content-security-policy'];
  expect(csp).toContain("default-src 'none'"); expect(csp).toContain("'wasm-unsafe-eval'");
  expect(csp).not.toContain("'unsafe-inline'"); expect(csp).not.toMatch(/(?:^|\s)'unsafe-eval'/);
  const result = await page.evaluate(async () => {
    const violations = [], readbacks = [];
    const record = event => violations.push({ directive: event.violatedDirective, blocked: event.blockedURI });
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const same = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), message);
    const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    document.addEventListener('securitypolicyviolation', record);
    try {
      const { createEditor, loadSdk, loadSdkV2, sdkBuildId } = await import('@klenwriter/editor-sdk');
      const { exerciseNotes, wasmPort, notesOptions } = await import('/notes-extension-testkit.mjs');
      const packetBytes = await (await fetch('/extensions-packet.json')).arrayBuffer();
      const packet = JSON.parse(new TextDecoder().decode(packetBytes));
      const [legacy, module] = await Promise.all([loadSdk(), loadSdkV2()]);
      check(module.manifest.build_id === sdkBuildId && legacy.manifest.build_id === sdkBuildId, 'same sealed build');
      const baseline = JSON.parse(module.resourceCounts());
      const notes = await exerciseNotes(wasmPort(module, readback => readbacks.push(readback)), packet);
      check(notes.module === 'present', 'actual default distribution includes notes');
      // Both actual constructors must see the same Rust globals, not two glue instances.
      const oldInput = packet.kwdj.find(item => item.expectedStatus === 'accepted');
      const old = new legacy.Session(new TextEncoder().encode(oldInput.input), JSON.stringify({ abi: 'editor-sdk/1', build_id: sdkBuildId,
        profile: legacy.manifest.profiles[0], admission: 'validate', access: 'editable', identities: { media: [], references: [] }, limits: null }));
      const raw = new module.Session(new TextEncoder().encode(packet.extension.initial), JSON.stringify(notesOptions(module.manifest, packet)));
      try {
        check(JSON.parse(old.initialization()).status === 'ok' && JSON.parse(raw.initialization()).status === 'ok', 'both actual admissions');
        check(JSON.parse(legacy.resourceCounts()).sessions === 2 && JSON.parse(module.resourceCounts()).sessions === 2, 'one actual shared Rust instance');
      } finally { old.destroy(); old.free(); raw.destroy(); raw.free(); }
      const editor = createEditor({ input: new TextEncoder().encode(packet.extension.initial), options: notesOptions(module.manifest, packet), loader: async () => module });
      const observations = [], queued = [];
      try {
        check((await editor.ready).status === 'ok', 'actual V2 controller ready');
        check(editor.context().registry_digest.length === 64 && editor.context().build_id === sdkBuildId, 'actual V2 context');
        const root = editor.read({ kind: 'state' }).value.state.root;
        const doc = editor.read({ kind: 'node', stamp: editor.capture(), node: root }).value.node.children[0];
        const command = { id: packet.extension.command_id, payload_json: JSON.stringify({ kind: 'recipe', arguments: { nodes: { doc }, values: packet.extension.values } }) };
        editor.subscribe(event => {
          observations.push(['first', event.change.kind, event.after.revision, editor.read({ kind: 'state' }).value.state.stamp.selection_epoch]);
          if (event.sequence === '1') {
            const stamp = structuredClone(editor.capture());
            queued.push(editor.submit({ kind: 'set_stored_marks', stamp, marks: [] }));
            queued.push(editor.submit({ kind: 'barrier', stamp }));
          }
        });
        editor.subscribe(event => observations.push(['second', event.change.kind, event.after.revision, editor.capture().selection_epoch]));
        const before = editor.capture(); check(editor.query({ kind: 'query_command', stamp: before, command }).value.available, 'actual recipe query');
        same(editor.capture(), before, 'query stamp pure'); check(observations.length === 0, 'query emits zero events');
        check(editor.submit({ kind: 'command', stamp: before, command, history_hint: { kind: 'isolated' } }).response.status === 'ok', 'actual recipe commit');
        check(queued.length === 2 && queued.every(ticket => ticket.status === 'queued'), 'actual reentrant queue');
        check((await queued[0].completion).status === 'ok', 'queued state change');
        check((await queued[1].completion).diagnostic.code === 'session.stale_selection_epoch', 'same captured stamp refuses after state publication');
        check(observations.length === 4 && observations[0][1] === 'document' && observations[2][1] === 'state', 'exact document then state callbacks');
        same(observations[0].slice(1), observations[1].slice(1), 'listeners share document fence');
        same(observations[2].slice(1), observations[3].slice(1), 'listeners share state fence');
        const snapshot = editor.submit({ kind: 'snapshot', stamp: editor.capture(), max_bytes: 16777216 }).response.value;
        same(snapshot.canonical_json, packet.extension.after, 'frozen author recipe bytes through controller');
        editor.submit({ kind: 'release_snapshot', handle: snapshot.handle });
        for (const [direction, expected] of [['undo', packet.extension.initial], ['redo', packet.extension.after]]) {
          check(editor.submit({ kind: 'history', stamp: editor.capture(), direction }).response.status === 'ok', `actual ${direction}`);
          const saved = editor.submit({ kind: 'snapshot', stamp: editor.capture(), max_bytes: 16777216 }).response.value;
          same(saved.canonical_json, expected, `literal controller ${direction}`); editor.submit({ kind: 'release_snapshot', handle: saved.handle });
        }
      } finally { editor.destroy(); }
      check(editor.resources().sessions === 0 && editor.resources().listeners === 0 && editor.resources().pending_tickets === 0, 'actual controller ownership released');
      same(JSON.parse(module.resourceCounts()), baseline, 'actual native resources released');
      const wasm = await (await fetch('/packages/wasm/editor_wasm_bg.wasm')).arrayBuffer();
      return { status: 'passed', build_id: sdkBuildId, wasmSha256: await sha(wasm), packetSha256: await sha(packetBytes),
        notes, controller: { reentrant: true, staleCapturedStateRefused: true, exactHistory: true, observations, resources: editor.resources() },
        actualSharedV1V2RustCounters: true, nativeFinal: JSON.parse(module.resourceCounts()), nativeBaseline: baseline,
        parsedNativeReplyReadbacks: readbacks, violations };
    } finally { document.removeEventListener('securitypolicyviolation', record); }
  });
  expect(result.status).toBe('passed'); expect(result.notes.codec).toHaveLength(53); expect(result.notes.commands).toHaveLength(18);
  expect(result.notes.runtimeRecipe).toBe('passed'); expect(result.notes.simultaneousFrozenD0D1).toBe(true);
  expect(result.actualSharedV1V2RustCounters).toBe(true); expect(result.controller.reentrant).toBe(true);
  expect(result.nativeFinal).toEqual({ sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 });
  expect(result.build_id).toBe(JSON.parse(readFileSync('artifacts/sdk-build-identity.json', 'utf8')).buildId);
  expect(result.wasmSha256).toBe(createHash('sha256').update(readFileSync('packages/wasm/dist/editor_wasm_bg.wasm')).digest('hex'));
  expect(result.packetSha256).toBe(createHash('sha256').update(readFileSync('artifacts/extensions/packet.json')).digest('hex'));
  expect(result.violations).toEqual([]); expect(errors).toEqual([]);
  mkdirSync('artifacts/extensions', { recursive: true });
  const output = `artifacts/extensions/browser-${testInfo.project.name}.json`;
  writeFileSync(output, JSON.stringify({ ...result, browserProject: testInfo.project.name,
    scope: 'Actual packaged default WASM and public JS APIs under the served strict CSP; parsed native replies retained. No renderer/input acceptance.' }, null, 2) + '\n');
  await testInfo.attach('actual-v2-extensions', { path: output, contentType: 'application/json' });
});
