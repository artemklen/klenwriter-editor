// SPDX-License-Identifier: MIT OR Apache-2.0
// Test-only actual packaged SDK consumer. Parent process owns the watchdog.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createEditor, loadSdk, loadSdkV2 } from '../../packages/sdk/dist/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bytes = new Uint8Array(readFileSync(resolve(root, 'packages/wasm/dist/editor_wasm_bg.wasm')));
const hash = value => createHash('sha256').update(value).digest('hex');
const input = value => new TextEncoder().encode(value);
const same = (a, b, label) => assert.equal(JSON.stringify(a), JSON.stringify(b), label);
const ok = response => { assert.equal(response.status, 'ok', JSON.stringify(response)); return response.value; };
const refused = response => { assert.equal(response.status, 'refused', JSON.stringify(response)); assert.equal(response.diagnostic.may_have_committed, false); return response.diagnostic; };
const settle = ticket => ticket.status === 'queued' ? ticket.completion : Promise.resolve(ticket.response);
const state = editor => ok(editor.read({ kind: 'state' })).state;
const node = (editor, id) => ok(editor.read({ kind: 'node', stamp: editor.capture(), node: id })).node;
const counts = module => JSON.parse(module.resourceCounts());
const zeroFields = ['sessions', 'listeners', 'queued_mutations', 'queued_bytes', 'pending_tickets', 'host_requests', 'task_continuations', 'original_input_bytes', 'callback_error_handlers'];

async function close(editor, module, baseline) {
  ok(await settle(editor.destroy()));
  for (const key of zeroFields) assert.equal(editor.resources()[key], 0, `closed JS ownership ${key}`);
  same(counts(module), baseline, 'actual Rust resources return to baseline');
}

async function canonical(editor) {
  const before = editor.capture();
  const saved = ok(await settle(editor.submit({ kind: 'snapshot', stamp: before, max_bytes: 16777216 })));
  assert.equal(saved.kind, 'snapshot');
  ok(await settle(editor.submit({ kind: 'release_snapshot', handle: saved.handle })));
  same(editor.capture(), before, 'explicit export/release do not change stamps');
  return saved.canonical_json;
}

function options(module, scenario) {
  return { abi: 'editor-sdk/2', build_id: module.manifest.build_id, profile: scenario.profile,
    admission: scenario.admission, access: 'editable', registry_json: scenario.registry_json,
    profile_options_json: scenario.profile_options_json };
}

async function open(module, scenario, overrides = {}) {
  const baseline = counts(module), callbackErrors = [], source = input(scenario.input_json), original = source.slice();
  const editor = createEditor({ input: source, options: { ...options(module, scenario), ...overrides },
    loader: async () => module, onCallbackError: error => callbackErrors.push(error) });
  const ready = await editor.ready;
  return { editor, baseline, callbackErrors, source, original, ready };
}

function initialLabel(editor, path) {
  let current = state(editor).root;
  for (const index of path) { const parent = node(editor, current); assert.ok(index < parent.children.length); current = parent.children[index]; }
  return current;
}

function blockLeaves(editor, block) {
  const current = node(editor, block);
  return current.children.map(id => { const child = node(editor, id); assert.equal(typeof child.text, 'string', 'finite plain/one-mark text subset'); return child; });
}

function point(editor, block, offset) {
  assert.ok(Number.isSafeInteger(offset) && offset >= 0);
  let remaining = offset;
  for (const leaf of blockLeaves(editor, block)) {
    if (remaining <= leaf.text.length) return { kind: 'text', node: leaf.id, offset: remaining, affinity: 'after' };
    remaining -= leaf.text.length;
  }
  assert.fail(`logical coordinate outside current bound block: ${offset}`);
}

function logical(editor, block, position) {
  const leaves = blockLeaves(editor, block), lengths = leaves.map(leaf => leaf.text.length), total = lengths.reduce((a, b) => a + b, 0);
  const preceding = index => lengths.slice(0, index).reduce((a, b) => a + b, 0);
  if (position.kind === 'child') {
    assert.equal(position.parent, block); assert.ok(Number.isSafeInteger(position.index) && position.index >= 0 && position.index <= leaves.length);
    return preceding(position.index);
  }
  if (position.kind === 'edge' && position.node === block) return position.side === 'before' ? 0 : total;
  const index = leaves.findIndex(leaf => leaf.id === position.node); assert.ok(index >= 0, 'actual selection references a live returned leaf');
  if (position.kind === 'edge') return preceding(index) + (position.side === 'before' ? 0 : lengths[index]);
  assert.equal(position.kind, 'text'); assert.ok(Number.isSafeInteger(position.offset) && position.offset >= 0 && position.offset <= lengths[index]);
  const text = leaves[index].text, at = position.offset;
  assert.ok(!(at > 0 && at < text.length && /[\uD800-\uDBFF]/u.test(text[at - 1]) && /[\uDC00-\uDFFF]/u.test(text[at])), 'actual DTO is scalar-safe');
  return preceding(index) + at;
}

function logicalSelection(editor, block, selection) {
  return selection === null ? null : { anchor_utf16: logical(editor, block, selection.anchor), focus_utf16: logical(editor, block, selection.focus) };
}

function ids(editor) {
  const result = [];
  function visit(id) { const value = node(editor, id); result.push(id); for (const child of value.children) visit(child); }
  visit(state(editor).root); return result;
}

function insertCommand(context, text) {
  return context.startsWith('notes-')
    ? { id: 'org.example.notes/command/insert-text', payload_json: JSON.stringify({ text }) }
    : { id: 'org.klenwriter.kwdj/command/insert-text', payload_json: JSON.stringify({ kind: 'insert_text', text }) };
}

async function queryPure(editor, module, request, events) {
  const before = JSON.stringify(state(editor)), resources = JSON.stringify(counts(module)), identities = ids(editor), count = events.length;
  const answer = ok(editor.query(request));
  assert.equal(JSON.stringify(state(editor)), before, 'query committed public state pure');
  assert.equal(JSON.stringify(counts(module)), resources, 'query native resource ownership pure');
  same(ids(editor), identities, 'query visible identities pure'); assert.equal(events.length, count, 'query emits zero events');
  assert.equal(answer.kind, 'availability'); return answer;
}

export async function replayScenario(module, scenario) {
  assert.equal(scenario.format, 'editor-reliability-scenario/1'); assert.ok(scenario.actions.length <= 64);
  const opened = await open(module, scenario), { editor, baseline, callbackErrors } = opened;
  const events = [], fences = [], callbackFailures = [], checkpoints = [], undo = [], redo = [];
  let phase = 'admission', actionIndex = -1;
  try {
    ok(opened.ready); same(opened.source, opened.original, 'original admitted caller bytes unchanged');
    const block = initialLabel(editor, scenario.initialLabels.block), initialPrimary = initialLabel(editor, scenario.initialLabels.primary_leaf);
    for (const listener of ['first', 'second']) editor.subscribe(event => {
      try {
        const actual = state(editor); same(actual.stamp, event.after, 'listener reads exact event revision fence');
        same(editor.capture(), event.after, 'listener capture is event fence');
        fences.push({ listener, sequence: event.sequence, after: event.after, selection: actual.selection, history: actual.history, dirty: actual.dirty });
        if (listener === 'first') events.push(event);
      } catch (error) { callbackFailures.push(error.message); throw error; }
    });
    async function checkpoint(expected) {
      const actual = state(editor), exported = await canonical(editor);
      assert.equal(exported, expected.canonical_json, 'complete independently encoded canonical bytes');
      same(logicalSelection(editor, block, actual.selection), expected.selection, 'independent logical selection in valid physical DTO');
      assert.equal(actual.history.undo_entries, String(expected.history.undo_units), 'independent undo-unit count');
      assert.equal(actual.history.redo_entries, String(expected.history.redo_units), 'independent redo-unit count');
      assert.equal(actual.stamp.revision, expected.document_revision, 'monotonic document revision oracle');
      assert.equal(actual.dirty, expected.dirty, 'accepted conservative dirty-state oracle');
      assert.equal(node(editor, block).id, block, 'initial bound block identity never silently retargets');
      checkpoints.push({ actionIndex, documentRevision: actual.stamp.revision, selection: expected.selection,
        history: expected.history, dirty: actual.dirty, canonicalSha256: hash(exported), visibleIds: ids(editor) });
    }
    await checkpoint(scenario.initialExpected);
    for ([actionIndex, ] of scenario.actions.entries()) {
      const action = scenario.actions[actionIndex]; phase = action.op;
      const beforeIds = ids(editor), beforeEvents = events.length;
      let response;
      if (action.op === 'select') {
        const selection = { anchor: point(editor, block, action.from), focus: point(editor, block, action.to) };
        response = await settle(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection }));
        const value = ok(response); assert.ok(['state_changed', 'unchanged'].includes(value.effect));
        assert.equal(events.length - beforeEvents, value.effect === 'unchanged' ? 0 : 1);
        if (value.effect !== 'unchanged') assert.equal(events.at(-1).change.kind, 'state');
      } else if (action.op === 'insert_text') {
        assert.equal(action.isolated, true); const command = insertCommand(scenario.context, action.text), stamp = editor.capture();
        const query = await queryPure(editor, module, { kind: 'query_command', stamp, command }, events);
        assert.equal(query.available, true); assert.equal(query.effect, 'changed');
        response = await settle(editor.submit({ kind: 'command', stamp, command, history_hint: { kind: 'isolated' } }));
        assert.equal(ok(response).effect, query.effect); undo.push({ before: beforeIds, after: ids(editor) }); redo.length = 0;
      } else {
        assert.ok(['undo', 'redo'].includes(action.op)); const direction = action.op, stamp = editor.capture();
        const query = await queryPure(editor, module, { kind: 'query_history', stamp, direction }, events); assert.equal(query.available, true);
        response = await settle(editor.submit({ kind: 'history', stamp, direction })); assert.equal(ok(response).effect, 'changed');
        const unit = direction === 'undo' ? undo.pop() : redo.pop(); assert.ok(unit);
        same(ids(editor), unit[direction === 'undo' ? 'before' : 'after'], 'same-lane owned historical IDs revive exactly');
        (direction === 'undo' ? redo : undo).push(unit);
      }
      if (action.op !== 'select') { assert.equal(events.length - beforeEvents, 1, 'one document event/publication'); assert.equal(events.at(-1).change.kind, 'document'); }
      await checkpoint(action.expected);
      assert.equal(callbackFailures.length, 0); assert.equal(callbackErrors.length, 0);
    }
    for (let i = 0; i < fences.length; i += 2) {
      assert.equal(fences[i].listener, 'first'); assert.equal(fences[i + 1].listener, 'second');
      const { listener: a, ...first } = fences[i], { listener: b, ...second } = fences[i + 1]; same(first, second, 'both listeners observe one unchanged fence');
    }
    return { status: 'passed', id: scenario.id, context: scenario.context, seed: scenario.seed, actions: scenario.actions.length,
      checkpoints, events: events.length, listenerFencePairs: fences.length / 2, initialPrimaryId: initialPrimary,
      completeCanonicalOracle: true, queryPublicPurity: true, isolatedQueryExecuteAgreement: true, sameLaneHistoricalIdentity: true,
      originalBytesUnchanged: true, scope: 'Actual packaged V2 controller; no raw13-operation or SDK WorkUsage DTO claim.' };
  } catch (error) {
    error.replay = { id: scenario.id, context: scenario.context, phase, actionIndex, invariant: error.message, checkpoints, events: events.length };
    throw error;
  } finally { await close(editor, module, baseline); }
}

const plain = text => JSON.stringify({ schema: 'klenwriter.document', schema_version: 1, profile: 'prose', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const PLAIN_AXYBC = '{"content":[{"content":[{"text":"aXYbc","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}';

async function queueLifecycle(module, scenario) {
  const opened = await open(module, { ...scenario, input_json: plain('abc') });
  const { editor, baseline, callbackErrors } = opened;
  try {
    ok(opened.ready); const block = initialLabel(editor, [0]), leaf = node(editor, block).children[0];
    ok(await settle(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection: { anchor: point(editor, block, 1), focus: point(editor, block, 1) } })));
    const fences = [], tickets = []; let once = false;
    const removeFirst = editor.subscribe(event => {
      fences.push(['first', event.after.revision, node(editor, leaf).text]);
      if (!once) { once = true; const request = { kind: 'command', stamp: editor.capture(), command: insertCommand('kwdj-prose', 'Y'), history_hint: { kind: 'isolated' } }; tickets.push(editor.submit(request), editor.submit(request)); }
    });
    const removeSecond = editor.subscribe(event => fences.push(['second', event.after.revision, node(editor, leaf).text]));
    const captured = editor.captureHostRequest(); assert.equal(captured.status, 'captured');
    ok(await settle(editor.submit({ kind: 'command', stamp: editor.capture(), command: insertCommand('kwdj-prose', 'X'), history_hint: { kind: 'isolated' } })));
    assert.ok(tickets.every(ticket => ticket.status === 'queued'));
    ok(await settle(tickets[0])); assert.equal(refused(await settle(tickets[1])).code, 'session.stale_revision');
    same(fences, [['first', '1', 'aXbc'], ['second', '1', 'aXbc'], ['first', '2', 'aXYbc'], ['second', '2', 'aXYbc']], 'literal old/new callback fences');
    assert.equal(await canonical(editor), PLAIN_AXYBC);
    assert.equal(refused(await settle(editor.completeHostRequest(captured.request, { kind: 'barrier', stamp: captured.request.stamp }))).code, 'sdk.stale_request');
    removeFirst(); removeSecond();
    const old = editor.capture(), oldBytes = await canonical(editor), host = editor.captureHostRequest();
    refused(await settle(editor.submit({ kind: 'remount', stamp: old, input_json: '{', admission: 'validate' })));
    same(editor.capture(), old, 'failed remount atomic'); assert.equal(await canonical(editor), oldBytes);
    ok(await settle(editor.submit({ kind: 'remount', stamp: editor.capture(), input_json: plain('new'), admission: 'validate' })));
    assert.notEqual(editor.capture().generation, old.generation);
    assert.equal(refused(editor.read({ kind: 'node', stamp: old, node: leaf })).code, 'session.stale_session');
    assert.equal(refused(await settle(editor.completeHostRequest(host.request, { kind: 'barrier', stamp: host.request.stamp }))).code, 'sdk.stale_request');
    const currentBlock = initialLabel(editor, [0]); let later = 0;
    const throwing = editor.subscribe(() => { throw new Error('deliberate host listener exception, not a Rust fault'); });
    editor.subscribe(() => later++);
    ok(await settle(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection: { anchor: point(editor, currentBlock, 1), focus: point(editor, currentBlock, 1) } })));
    assert.equal(callbackErrors.length, 1); assert.equal(callbackErrors[0].code, 'sdk.listener_error'); assert.equal(later, 1); throwing();
    return { status: 'passed', id: 'supplement-queue-lifecycle', category: 'actual-public-lifecycle',
      sameCapturedSecondRefused: true, twoListenerFences: fences, failedRemountAtomic: true, staleGeneration: true, staleHostCompletion: true, listenerExceptionSeparated: true };
  } finally { await close(editor, module, baseline); }
}

async function cancelLoading(module, scenario) {
  const baseline = counts(module); let release;
  const gate = new Promise(resolveGate => { release = resolveGate; });
  const editor = createEditor({ input: input(scenario.input_json), options: options(module, scenario), loader: async () => { await gate; return module; } });
  assert.equal(editor.lifecycle, 'loading'); ok(await settle(editor.destroy())); release();
  assert.equal(refused(await editor.ready).code, 'sdk.cancelled');
  await new Promise(resolveTask => setTimeout(resolveTask, 0));
  await close(editor, module, baseline);
  return { status: 'passed', id: 'supplement-cancel-loading', category: 'actual-module-delayed-loading',
    qualification: 'Scheduling gate delays the actual verified module; no fake bridge or controller. No Session is admitted after disposal.' };
}

async function scalarBoundary(module, scenario) {
  // Original authored integer lexeme never passes through JSON.parse/Number.
  const raw = '{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"ordered_list","attrs":{"start":18446744073709551615},"content":[{"type":"list_item","content":[{"type":"paragraph","content":[{"type":"text","text":"abc"}]}]}]}]}';
  const expected = '{"content":[{"attrs":{"start":18446744073709551615},"content":[{"content":[{"content":[{"text":"abc","type":"text"}],"type":"paragraph"}],"type":"list_item"}],"type":"ordered_list"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}';
  const opened = await open(module, { ...scenario, input_json: raw }), { editor, baseline } = opened;
  try {
    ok(opened.ready); const before = editor.capture(), list = node(editor, initialLabel(editor, [0])), original = await canonical(editor);
    assert.equal(original, expected); assert.equal(list.attributes.start.kind, 'number'); assert.equal(list.attributes.start.value, '18446744073709551615');
    const events = []; editor.subscribe(event => events.push(event)); let getterCalls = 0;
    const hostile = [
      ['u64_overflow', () => editor.read({ kind: 'node', stamp: { ...before, revision: '18446744073709551616' }, node: list.id }), 'sdk.invalid_u64'],
      ['u64_leading_zero', () => editor.read({ kind: 'node', stamp: { ...before, revision: '01' }, node: list.id }), 'sdk.invalid_u64'],
      ['u64_exact_max_stale', () => editor.read({ kind: 'node', stamp: { ...before, revision: '18446744073709551615' }, node: list.id }), 'session.stale_revision'],
      ['unsafe_integer', async () => settle(editor.submit({ kind: 'snapshot', stamp: before, max_bytes: 9007199254740992 })), 'sdk.invalid_integer'],
      ['fraction', async () => settle(editor.submit({ kind: 'snapshot', stamp: before, max_bytes: 1.5 })), 'sdk.invalid_integer'],
      ['negative_zero', async () => settle(editor.submit({ kind: 'snapshot', stamp: before, max_bytes: -0 })), 'sdk.invalid_integer'],
      ['nan', async () => settle(editor.submit({ kind: 'snapshot', stamp: before, max_bytes: NaN })), 'sdk.invalid_integer'],
      ['accessor', async () => settle(editor.submit({ get kind() { getterCalls++; return 'destroy'; } })), 'sdk.invalid_input'],
      ['lone_surrogate', async () => settle(editor.submit({ kind: 'command', stamp: before, command: { id: 'org.klenwriter.kwdj/command/insert-text', payload_json: '\ud800' }, history_hint: { kind: 'isolated' } })), 'sdk.lone_surrogate'],
      ['closed_destroy', async () => settle(editor.submit({ kind: 'destroy', extra: true })), 'sdk.invalid_input'],
      ['v2_facts_not_generic', async () => settle(editor.submit({ kind: 'update_facts', stamp: before, identities: { media: [], references: [] } })), 'sdk.invalid_request_kind'],
    ];
    const outcomes = [];
    for (const [id, request, code] of hostile) { const actual = refused(await request()); assert.equal(actual.code, code, id); same(editor.capture(), before, id); outcomes.push({ id, code: actual.code }); }
    assert.equal(getterCalls, 0); assert.equal(events.length, 0); assert.equal(await canonical(editor), original); same(opened.source, opened.original);
    return { status: 'passed', id: 'supplement-scalar-boundary', category: 'actual-hostile-public-boundaries', outcomes,
      rawInputSha256: hash(raw), authoredMaxU64: list.attributes.start.value, canonicalSha256: hash(original), sourceNotParsedThroughNumber: true };
  } finally { await close(editor, module, baseline); }
}

async function facts(module, scenario) {
  const legacy = await loadSdk({ wasm: bytes }), baseline = counts(module), id = '550e8400-e29b-41d4-a716-446655440006';
  const raw = '{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"Name","marks":[{"type":"reference_link","attrs":{"reference_entity_id":"550e8400-e29b-41d4-a716-446655440006"}}]}]},{"type":"paragraph","content":[{"type":"text","text":"abc"}]}]}';
  const exists = { media: [], references: [{ id, status: 'exists' }] }, unavailable = { media: [], references: [{ id, status: 'unavailable' }] };
  const editor = createEditor({ input: input(raw), options: { abi: 'editor-sdk/1', build_id: legacy.manifest.build_id, profile: legacy.manifest.profiles[0], admission: 'validate', access: 'editable', identities: exists, limits: null }, loader: async () => legacy });
  try {
    ok(await editor.ready); const block = initialLabel(editor, [1]);
    ok(await settle(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection: { anchor: point(editor, block, 1), focus: point(editor, block, 1) } })));
    const events = []; editor.subscribe(event => events.push(event));
    const original = await canonical(editor);
    ok(await settle(editor.submit({ kind: 'update_facts', stamp: editor.capture(), identities: unavailable })));
    const before = editor.capture(), records = JSON.stringify(ids(editor).map(id => node(editor, id))), command = insertCommand('kwdj-prose', 'X');
    const exportFailure = refused(await settle(editor.submit({ kind: 'snapshot', stamp: before, max_bytes: 16777216 })));
    assert.equal(exportFailure.code, 'kwdj.identity_resolution_failed', 'explicit export rechecks current facts too');
    const query = ok(editor.query({ kind: 'query_command', stamp: before, command })); assert.equal(query.available, false); assert.equal(query.diagnostic.code, 'kwdj.identity_resolution_failed');
    const error = refused(await settle(editor.submit({ kind: 'command', stamp: before, command, history_hint: { kind: 'isolated' } })));
    assert.equal(error.code, query.diagnostic.code); same(editor.capture(), before); assert.equal(events.length, 0);
    assert.equal(JSON.stringify(ids(editor).map(id => node(editor, id))), records, 'failed export/query/edit preserve committed public records');
    ok(await settle(editor.submit({ kind: 'update_facts', stamp: editor.capture(), identities: exists })));
    assert.equal(await canonical(editor), original, 'restored current facts reopen exact unchanged authored bytes');
    ok(await settle(editor.submit({ kind: 'command', stamp: editor.capture(), command, history_hint: { kind: 'isolated' } })));
    assert.equal(node(editor, node(editor, block).children[0]).text, 'aXbc'); assert.equal(events.length, 1);
  } finally { await close(editor, legacy, baseline); }
  // Separate public raw KWDJ V2 route; generic V2 controller rejection is
  // already the scalar supplement's independently fixed boundary expectation.
  const rawSession = new module.Session(input(raw), JSON.stringify({ ...options(module, scenario), profile_options_json: JSON.stringify({ identities: exists, limits: null }) }));
  try {
    ok(JSON.parse(rawSession.initialization()));
    const call = request => JSON.parse(rawSession.call(JSON.stringify(request)));
    const current = () => ok(call({ kind: 'state' })).state;
    const readNode = nodeId => ok(call({ kind: 'node', stamp: current().stamp, node: nodeId })).node;
    const paragraph = readNode(readNode(current().root).children[1]), leaf = readNode(paragraph.children[0]);
    const at = { kind: 'text', node: leaf.id, offset: 1, affinity: 'after' };
    ok(call({ kind: 'set_selection', stamp: current().stamp, selection: { anchor: at, focus: at } }));
    ok(call({ kind: 'update_facts', stamp: current().stamp, identities: unavailable }));
    const query = ok(call({ kind: 'query_command', stamp: current().stamp, command: insertCommand('kwdj-prose', 'X') }));
    assert.equal(query.available, false); assert.equal(query.diagnostic.code, 'kwdj.identity_resolution_failed');
  } finally { rawSession.destroy(); rawSession.free(); same(counts(module), baseline); }
  return { status: 'passed', id: 'supplement-current-facts', category: 'actual-current-facts',
    v1ControllerRefusalRetry: true, rawV2KwdjProfileFacts: true, genericV2ControllerUnsupportedTestedSeparately: true };
}

export async function supplement(module, name, scenario) {
  if (name === 'queue-lifecycle') return queueLifecycle(module, scenario);
  if (name === 'cancel-loading') return cancelLoading(module, scenario);
  if (name === 'scalar-boundary') return scalarBoundary(module, scenario);
  if (name === 'current-facts') return facts(module, scenario);
  if (name === 'notes-extensions') {
    const { exerciseNotes, wasmPort } = await import('../../examples/notes-extension/testkit.mjs');
    const packet = JSON.parse(readFileSync(resolve(root, 'artifacts/extensions/packet.json'), 'utf8'));
    const baseline = counts(module), result = await exerciseNotes(wasmPort(module), packet); same(counts(module), baseline);
    assert.equal(result.codec.length, 53); assert.equal(result.commands.length, 18); assert.equal(result.runtimeRecipe, 'passed'); assert.equal(result.simultaneousFrozenD0D1, true);
    return { status: 'passed', id: 'supplement-notes-extensions', category: 'existing-independent-extension-literals',
      codec: 53, commands: 18, runtimeRecipe: true, frozenD0D1: true, packetSha256: hash(readFileSync(resolve(root, 'artifacts/extensions/packet.json'))) };
  }
  throw new Error('Unknown supplemental case');
}

async function main() {
  const module = await loadSdkV2({ wasm: bytes });
  process.send?.({ kind: 'ready', buildId: module.manifest.build_id, wasmSha256: hash(bytes) });
  process.once('message', async task => {
    try {
      const result = task.kind === 'supplement' ? await supplement(module, task.name, task.scenario) : await replayScenario(module, task.scenario);
      process.send?.({ kind: 'result', result }, () => { process.disconnect?.(); });
    } catch (error) {
      process.send?.({ kind: 'failure', failure: { name: error.name, message: error.message, stack: error.stack,
        phase: error.replay?.phase ?? task.name ?? 'case', ...error.replay } }, () => { process.disconnect?.(); });
      process.exitCode = 1;
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.stack); process.exitCode = 1; process.disconnect?.();
});
