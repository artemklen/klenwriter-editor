// SPDX-License-Identifier: MIT OR Apache-2.0
// Shared JS consumer assertions. Calls only installed/public SDK APIs, never native internals.
export async function exercisePackagedSdk({ createEditor, kwdjCommand, module, loader }, cycles = 12) {
  const assert = (ok, label) => { if (!ok) throw new Error(`SDK consumer assertion: ${label}`); };
  const equal = (actual, expected, label) => assert(JSON.stringify(actual) === JSON.stringify(expected), label);
  const value = (response, kind) => {
    assert(response.status === 'ok' && response.value.kind === kind, `${kind}: ${JSON.stringify(response)}`);
    return response.value;
  };
  const done = submission => { assert(submission.status === 'completed', 'idle submission is synchronous'); return submission.response; };
  const inputJson = text => JSON.stringify({ schema: 'klenwriter.document', schema_version: 1, profile: 'prose',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const bytes = text => new TextEncoder().encode(inputJson(text));
  const options = () => ({ abi: module.manifest.abi, build_id: module.manifest.build_id,
    profile: structuredClone(module.manifest.profiles[0]), admission: 'validate', access: 'editable',
    identities: { media: [], references: [] }, limits: null });
  const globalCounts = () => JSON.parse(module.resourceCounts());
  const baseline = globalCounts();
  equal(baseline, { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 }, 'empty native baseline');
  // Original SDK1 provider order remains the unchanged fifteen-command prefix.
  // OSR-39 and OSR-40 each append one command; historical SDK vectors still describe the prefix.
  const legacyCatalog = ['enter', 'shift-enter', 'toggle-mark', 'set-link', 'unset-link', 'insert-text',
    'transform-block', 'toggle-quote', 'toggle-list', 'insert-block', 'move', 'duplicate', 'remove',
    'accept-slash', 'dismiss-slash'].map(name => `org.klenwriter.kwdj/command/${name}`);
  const emptyJs = editor => {
    const r = editor.resources();
    for (const key of ['sessions', 'listeners', 'queued_mutations', 'queued_bytes', 'pending_tickets', 'host_requests', 'task_continuations', 'original_input_bytes', 'callback_errors']) assert(r[key] === 0, `released JS ${key}`);
  };
  const readText = editor => {
    const state = value(editor.read({ kind: 'state' }), 'state').state;
    const read = id => value(editor.read({ kind: 'node', stamp: state.stamp, node: id }), 'node').node;
    const root = read(state.root); const paragraph = read(root.children[0]); const text = read(paragraph.children[0]);
    assert(root.children.length === 1 && paragraph.children.length === 1 && text.primitive === 'text', 'shallow render text shape');
    return { state, root, paragraph, text };
  };
  const canonical = (editor, expectedText) => {
    const before = editor.capture();
    const receipt = value(done(editor.submit({ kind: 'snapshot', stamp: before, max_bytes: 1024 * 1024 })), 'snapshot');
    const document = JSON.parse(receipt.canonical_json);
    assert(document.schema === 'klenwriter.document' && document.schema_version === 1 && document.profile === 'prose', 'actual canonical header');
    assert(document.content.length === 1 && document.content[0].type === 'paragraph'
      && document.content[0].content.length === 1 && document.content[0].content[0].text === expectedText, 'literal canonical text including SPACE/NBSP');
    equal(editor.capture(), before, 'export preserves all epochs');
    return receipt;
  };
  let eventTotal = 0; let lateCases = 0;
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const editor = createEditor({ input: bytes('a'), options: options(), loader });
    value(await editor.ready, 'state'); assert(editor.lifecycle === 'ready', 'ready lifecycle');
    assert(editor.originalInput() === null, 'admission releases original input');
    const live = globalCounts(); assert(live.sessions === 1 && live.protected_cursors === 1 && live.snapshot_handles === 0, 'one actual native Session and protected cursor');
    const seen = [[], []];
    const unsubscribes = seen.map((events, index) => editor.subscribe(event => {
      assert(Object.isFrozen(event) && Object.isFrozen(event.after), 'immutable delivered event');
      const current = value(editor.read({ kind: 'state' }), 'state').state;
      equal(current.stamp, event.after, 'each listener reads publication stamp before next mutation');
      events.push({ event, revision: current.stamp.revision, listener: index });
    }));
    assert(unsubscribes.every(x => typeof x === 'function'), 'two listeners admitted');
    const initial = readText(editor); assert(initial.text.text === 'a' && initial.state.stamp.revision === '0', 'independent initial checkpoint');
    const catalog = value(editor.read({ kind: 'catalog' }), 'catalog').commands;
    const command = kwdjCommand({ kind: 'insert_text', text: ' \u00a0b' });
    const deleteSelection = kwdjCommand({ kind: 'delete_selection' });
    equal(deleteSelection, { id: 'org.klenwriter.kwdj/command/delete-selection', payload_json: '{"kind":"delete_selection"}' },
      'closed additive DeleteSelection command DTO');
    equal(catalog.slice(0, legacyCatalog.length), legacyCatalog, 'unchanged original SDK1 command prefix');
    assert(catalog.length === 17 && catalog[15] === 'org.klenwriter.kwdj/command/delete-backward'
      && catalog[16] === deleteSelection.id && catalog.includes(command.id),
      'real native command catalog preserves all16 and appends DeleteSelection');
    const atEnd = { kind: 'text', node: initial.text.id, offset: 1, affinity: 'after' };
    value(done(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection: { anchor: atEnd, focus: atEnd } })), 'mutation');
    const beforeQuery = editor.capture(); const countBefore = seen[0].length;
    const available = value(editor.query({ kind: 'query_command', stamp: beforeQuery, command }), 'availability');
    assert(available.available && available.effect === 'changed', 'actual command availability');
    equal(editor.capture(), beforeQuery, 'query preserves captured stamp'); assert(seen[0].length === countBefore, 'query emits no event');
    const request = editor.captureHostRequest(); assert(request.status === 'captured', 'host callback capture');
    value(done(editor.submit({ kind: 'command', stamp: beforeQuery, command, history_hint: { kind: 'isolated' } })), 'mutation');
    const edited = readText(editor); assert(edited.text.text === 'a \u00a0b' && edited.state.stamp.revision === '1', 'literal edit checkpoint');
    const stale = done(editor.completeHostRequest(request.request, { kind: 'barrier', stamp: request.request.stamp }));
    assert(stale.status === 'refused' && stale.diagnostic.code === 'sdk.stale_request', 'late revision callback refuses'); lateCases += 1;
    const first = canonical(editor, 'a \u00a0b'); value(done(editor.submit({ kind: 'release_snapshot', handle: first.handle })), 'released');
    assert(value(editor.query({ kind: 'query_history', stamp: editor.capture(), direction: 'undo' }), 'availability').available, 'undo available');
    value(done(editor.submit({ kind: 'history', stamp: editor.capture(), direction: 'undo' })), 'mutation');
    const undone = readText(editor); assert(undone.text.text === 'a' && undone.state.stamp.revision === '2', 'literal undo checkpoint');
    equal([undone.root.id, undone.paragraph.id, undone.text.id], [initial.root.id, initial.paragraph.id, initial.text.id], 'undo restores original live IDs');
    value(done(editor.submit({ kind: 'history', stamp: editor.capture(), direction: 'redo' })), 'mutation');
    assert(readText(editor).text.text === 'a \u00a0b' && editor.capture().revision === '3', 'literal redo checkpoint');
    const saved = canonical(editor, 'a \u00a0b'); value(done(editor.submit({ kind: 'acknowledge_snapshot', stamp: editor.capture(), handle: saved.handle })), 'mutation');
    assert(value(editor.read({ kind: 'state' }), 'state').state.dirty === false, 'explicit save acknowledgement establishes baseline');
    value(done(editor.submit({ kind: 'release_snapshot', handle: saved.handle })), 'released');
    assert(seen[0].length === seen[1].length && seen[0].length >= 4, 'same ordered native publication count');
    for (let i = 0; i < seen[0].length; i += 1) assert(seen[0][i].event === seen[1][i].event, 'listeners receive same event object');
    const held = canonical(editor, 'a \u00a0b'); assert(typeof held.handle === 'string' && globalCounts().snapshot_handles === 1, 'live owned snapshot');
    const oldHost = editor.captureHostRequest(); assert(oldHost.status === 'captured', 'pre-remount callback');
    const oldStamp = editor.capture();
    const failed = done(editor.submit({ kind: 'remount', stamp: oldStamp, input_json: '{', admission: 'validate' }));
    assert(failed.status === 'refused', 'invalid remount refuses'); equal(editor.capture(), oldStamp, 'failed remount preserves complete stamp');
    assert(globalCounts().snapshot_handles === 1, 'failed remount preserves receipt ownership');
    value(done(editor.submit({ kind: 'remount', stamp: editor.capture(), input_json: inputJson('z'), admission: 'validate' })), 'mutation');
    assert(editor.capture().generation !== oldStamp.generation && editor.capture().revision === '0', 'remount rotates generation');
    assert(readText(editor).text.text === 'z' && globalCounts().snapshot_handles === 0, 'remount resets document and receipt ownership');
    const late = done(editor.completeHostRequest(oldHost.request, { kind: 'barrier', stamp: oldHost.request.stamp }));
    assert(late.status === 'refused' && late.diagnostic.code === 'sdk.stale_request', 'old generation callback refuses'); lateCases += 1;
    canonical(editor, 'z'); // Leave a real receipt, one listener and one host request for destroy to release.
    editor.captureHostRequest(); unsubscribes[0]();
    value(done(editor.destroy()), 'destroyed'); value(done(editor.destroy()), 'destroyed'); emptyJs(editor);
    equal(globalCounts(), baseline, 'native counts return exact baseline each cycle');
    eventTotal += seen[0].length;
  }
  let resolveLoad;
  const deferred = new Promise(resolve => { resolveLoad = resolve; });
  const cancelled = createEditor({ input: bytes('a'), options: options(), loader: () => deferred });
  value(done(cancelled.destroy()), 'destroyed'); const cancelledReady = await cancelled.ready;
  assert(cancelledReady.status === 'refused' && cancelledReady.diagnostic.code === 'sdk.cancelled', 'destroy before loading cancels ready');
  resolveLoad(module); await new Promise(resolve => setTimeout(resolve, 0)); emptyJs(cancelled); equal(globalCounts(), baseline, 'late module cannot open Session'); lateCases += 1;
  const badProfile = options(); badProfile.profile.profile_id = 'org.example.unsupported';
  const refused = createEditor({ input: new TextEncoder().encode('{'), options: badProfile, loader });
  const refusal = await refused.ready;
  assert(refusal.status === 'refused' && refusal.diagnostic.code === 'profile.unsupported_profile', 'compiled profile refusal precedes invalid document decode');
  assert(refused.originalInput()?.length === 1, 'failed admission retains original for explicit recovery');
  value(done(refused.destroy()), 'destroyed'); emptyJs(refused); equal(globalCounts(), baseline, 'refused admission retains no native resources');
  return { status: 'passed', scope: 'Real packaged headless Rust Session SDK; no production renderer/input/AT claim.',
    cycles, native_baseline: baseline, native_final: globalCounts(), late_callbacks_refused: lateCases,
    events_observed: eventTotal, actual_commands_history_reads_exports_acknowledgements: true,
    exact_space_nbsp: true, failed_and_successful_remount: true, destroyed_before_late_load: true,
    retained_snapshot_listener_request_cleanup: true, ordinary_queries_emit_zero_events: true,
    build_id: module.manifest.build_id };
}
