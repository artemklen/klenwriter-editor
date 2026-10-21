// SPDX-License-Identifier: MIT OR Apache-2.0
// Public-API author test kit. Inputs/expected bytes are supplied frozen literals;
// this runner neither implements a codec nor derives an expected document.
const check = (condition, message) => { if (!condition) throw new Error(message); };
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const equal = (a, b, message) => check(JSON.stringify(ordered(a)) === JSON.stringify(ordered(b)), message);
const ok = response => { check(response.status === 'ok', JSON.stringify(response)); return response.value; };
const state = async handle => ok(await handle.call({ kind: 'state' })).state;
const node = async (handle, id) => ok(await handle.call({ kind: 'node', stamp: (await state(handle)).stamp, node: id })).node;
async function path(handle, indices) {
  let id = (await state(handle)).root;
  for (const index of [0, ...indices]) id = (await node(handle, id)).children[index];
  return id;
}
async function point(handle, literal) {
  const id = await path(handle, literal.path);
  if (literal.kind === 'text') return { kind: 'text', node: id, offset: literal.offset, affinity: literal.affinity };
  if (literal.kind === 'child') return { kind: 'child', parent: id, index: literal.index, affinity: literal.affinity };
  return { kind: 'edge', node: id, side: literal.side };
}
async function selection(handle, literal) {
  return literal === null ? null : { anchor: await point(handle, literal.anchor), focus: await point(handle, literal.focus) };
}
function marks(literal) {
  return literal === null ? null : literal.map(mark => ({ type_id: mark.type,
    attributes: Object.fromEntries(Object.entries(mark.attrs).map(([key, value]) => [key, { kind: 'string', value }])) }));
}
async function snapshot(handle) {
  const reply = ok(await handle.call({ kind: 'snapshot', stamp: (await state(handle)).stamp, max_bytes: 16777216 }));
  const canonical = reply.canonical_json;
  ok(await handle.call({ kind: 'release_snapshot', handle: reply.handle }));
  return canonical;
}
async function events(handle) {
  const reply = ok(await handle.call({ kind: 'events' }));
  check(reply.kind === 'events' && reply.gap === false, 'bounded event stream must have no gap');
  return reply;
}
async function drainEvents(handle) {
  const all = [];
  for (let page = 0; page < 8; page++) {
    const reply = await events(handle);
    if (reply.events.length === 0) return all;
    all.push(...reply.events);
    check(all.length <= 64, 'literal command exceeded the bounded event drain');
    ok(await handle.call({ kind: 'acknowledge_events', cursor: reply.cursor }));
  }
  throw new Error('literal command event drain did not converge');
}
// IDs and payload are dynamic invariants; timestamps/revisions are chronological
// and must advance during replay, so they are deliberately checked separately.
async function identities(handle) {
  const result = [], pending = [(await state(handle)).root], seen = new Set();
  for (let index = 0; index < pending.length; index++) {
    check(index < 65536, 'literal identity observation exceeded the node bound');
    const id = pending[index]; check(!seen.has(id), 'cycle or duplicate live ID'); seen.add(id);
    const current = await node(handle, id);
    const { parent, type_id, primitive, attributes, marks, text, children, stats } = current;
    result.push({ id, parent, type_id, primitive, attributes, marks, text, children, stats });
    pending.push(...children);
  }
  return result;
}
function delta(after, before, expected, message) {
  check(Number.isSafeInteger(expected), `${message}: literal delta must be an integer`);
  equal((BigInt(after) - BigInt(before)).toString(), String(expected), message);
}
function eventState(event, before, after, message) {
  equal(event.before, before.stamp, `${message}: before stamp`);
  equal(event.after, after.stamp, `${message}: after stamp`);
  equal(event.selection_before, before.selection, `${message}: before selection`);
  equal(event.selection_after, after.selection, `${message}: after selection`);
  equal(event.stored_marks_before, before.stored_marks, `${message}: before marks`);
  equal(event.stored_marks_after, after.stored_marks, `${message}: after marks`);
  equal(event.dirty_before, before.dirty, `${message}: before dirty`);
  equal(event.dirty_after, after.dirty, `${message}: after dirty`);
  equal(event.history, after.history, `${message}: history`);
}
export function notesOptions(manifest, packet, registry = 'D1', mode = 'strict') {
  const descriptor = packet.registries[registry];
  return { abi: 'editor-sdk/2', build_id: manifest.build_id,
    profile: { profile_id: 'org.example.notes', profile_version: '1.0.0', codec_id: 'org.example.notes/json', wire_version: 1,
      extensions: descriptor.selected_extensions }, admission: mode === 'import' ? 'normalize' : 'validate', access: 'editable',
    registry_json: packet.registryJson[registry], profile_options_json: JSON.stringify({
      root_blocks: registry === 'D0' ? ['org.example.notes/paragraph'] : ['org.example.notes/paragraph', 'org.example.notes/callout'], limits: null }) };
}

export function wasmPort(module, record = () => {}) {
  return { manifest: module.manifest ?? JSON.parse(module.sdkManifestV2()), multiple: true,
    async resources() { return JSON.parse(module.resourceCounts ? module.resourceCounts() : module.sdkResourceCountsV2()); },
    async open(input, options) {
      const raw = new (module.Session ?? module.SdkSessionV2)(new TextEncoder().encode(input), JSON.stringify(options));
      const read = (kind, result) => { const value = JSON.parse(result); record({ kind, value }); return value; };
      return { async initialization() { return read('initialization', raw.initialization()); },
        async context() { return read('context', raw.context()); },
        async call(request) { return read(request.kind, raw.call(JSON.stringify(request))); },
        async destroy() { raw.destroy(); raw.free(); } };
    } };
}

export async function exerciseNotes(port, packet) {
  const baseline = await port.resources(), cases = [], offer = port.manifest.profiles.find(value => value.profile_id === 'org.example.notes');
  if (!offer) {
    const handle = await port.open('deliberately invalid authored JSON', notesOptions(port.manifest, packet));
    const result = await handle.initialization();
    check(result.status === 'refused' && result.diagnostic.code === 'profile.unsupported_profile', 'missing compiled notes module must refuse before decoding');
    equal(await handle.context(), null, 'refused context');
    await handle.destroy(); equal(await port.resources(), baseline, 'missing module ownership');
    return { module: 'absent', refusal: result.diagnostic.code, codec: [], commands: [] };
  }
  for (const c of packet.codec) {
    const handle = await port.open(c.input, notesOptions(port.manifest, packet, c.registry, c.mode));
    try {
      const initial = await handle.initialization();
      if (c.expected.kind === 'accepted') {
        ok(initial); equal(await snapshot(handle), c.canonical, `${c.id}: literal canonical bytes`);
        const context = await handle.context(); check(context.build_id === port.manifest.build_id, `${c.id}: build context`);
        check(/^[0-9a-f]{64}$/.test(context.registry_digest) && /^[0-9a-f]{64}$/.test(context.capability_digest), 'digest syntax');
      } else {
        check(initial.status === 'refused', `${c.id}: expected refusal`);
        equal(initial.diagnostic.code, c.expected.code, `${c.id}: diagnostic code`);
        equal(initial.diagnostic.path, c.expected.path, `${c.id}: diagnostic path`);
        check(initial.diagnostic.may_have_committed === false, `${c.id}: refusal publication`);
        equal(await handle.context(), null, `${c.id}: refused context`);
      }
      cases.push({ id: c.id, outcome: c.expected.kind });
    } finally { await handle.destroy(); }
    equal(await port.resources(), baseline, `${c.id}: ownership`);
  }
  const commands = [];
  for (const c of packet.commands) {
    const handle = await port.open(c.input, notesOptions(port.manifest, packet));
    try {
      ok(await handle.initialization());
      if (c.selection !== null) ok(await handle.call({ kind: 'set_selection', stamp: (await state(handle)).stamp, selection: await selection(handle, c.selection) }));
      if (c.storedMarks !== null) ok(await handle.call({ kind: 'set_stored_marks', stamp: (await state(handle)).stamp, marks: marks(c.storedMarks) }));
      // Counter literals start after setup. Actual read/ack releases setup event
      // protection; no event is silently ignored during the tested command.
      await drainEvents(handle);
      const before = await state(handle), command = { id: c.command.id, payload_json: JSON.stringify(c.command.payload) };
      const beforeIds = await identities(handle), beforeEvents = await events(handle);
      equal(beforeEvents.events, [], `${c.id}: initial event stream empty`);
      const query = ok(await handle.call({ kind: 'query_command', stamp: before.stamp, command }));
      equal(await state(handle), before, `${c.id}: query purity`);
      equal(await identities(handle), beforeIds, `${c.id}: query identity/payload purity`);
      equal(await events(handle), beforeEvents, `${c.id}: query event purity`);
      const result = await handle.call({ kind: 'command', stamp: before.stamp, command, history_hint: { kind: 'isolated' } });
      if (c.expected.kind === 'refused') {
        check(!query.available && result.status === 'refused', `${c.id}: refusal`);
        equal(query.diagnostic.code, c.expected.code, `${c.id}: query code`);
        equal(result.diagnostic.code, c.expected.code, `${c.id}: execute code`);
        equal(await state(handle), before, `${c.id}: refusal retains state`);
      } else {
        check(query.available, `${c.id}: availability`); equal(query.effect, c.expected.kind, `${c.id}: query effect`);
        equal(ok(result).effect, c.expected.kind, `${c.id}: effect`);
      }
      equal(await snapshot(handle), c.expected.canonical, `${c.id}: exact result`);
      const after = await state(handle);
      equal(after.selection, c.expected.selection === 'same_as_before' ? before.selection : await selection(handle, c.expected.selection), `${c.id}: caret`);
      equal(after.stored_marks, marks(c.expected.storedMarks), `${c.id}: marks`);
      delta(after.stamp.revision, before.stamp.revision, c.expected.documentRevisionDelta, `${c.id}: literal document revision delta`);
      delta(after.history.undo_entries, before.history.undo_entries, c.expected.historyUnitDelta, `${c.id}: literal history unit delta`);
      const committedEvents = await drainEvents(handle), afterIds = await identities(handle);
      equal(committedEvents.length, c.expected.events, `${c.id}: literal event count`);
      if (c.expected.events === 1) {
        eventState(committedEvents[0], before, after, `${c.id}: committed event facets`);
        equal(committedEvents[0].change.kind, 'document', `${c.id}: document event kind`);
        equal(committedEvents[0].change.from_revision, before.stamp.revision, `${c.id}: event source revision`);
        equal(committedEvents[0].change.to_revision, after.stamp.revision, `${c.id}: event target revision`);
      }
      if (c.expected.kind !== 'changed') equal(afterIds, beforeIds, `${c.id}: no-op/refusal IDs`);
      if (c.expected.kind === 'changed') {
        let preceding = after;
        for (const [direction, canonical] of [['undo', c.input], ['redo', c.expected.canonical]]) {
          ok(await handle.call({ kind: 'history', stamp: (await state(handle)).stamp, direction }));
          equal(await snapshot(handle), canonical, `${c.id}: literal ${direction}`);
          const replayed = await state(handle), target = direction === 'undo' ? before : after;
          equal(replayed.selection, target.selection, `${c.id}: ${direction} exact selection`);
          equal(replayed.stored_marks, target.stored_marks, `${c.id}: ${direction} exact marks`);
          equal(await identities(handle), direction === 'undo' ? beforeIds : afterIds, `${c.id}: ${direction} exact IDs and payload`);
          delta(replayed.stamp.revision, preceding.stamp.revision, 1, `${c.id}: ${direction} chronological revision`);
          equal(replayed.history.undo_entries, target.history.undo_entries, `${c.id}: ${direction} undo unit count`);
          const replayEvents = await drainEvents(handle);
          equal(replayEvents.length, 1, `${c.id}: ${direction} one publication`);
          eventState(replayEvents[0], preceding, replayed, `${c.id}: ${direction} event facets`);
          preceding = replayed;
        }
      }
      commands.push({ id: c.id, outcome: c.expected.kind,
        documentRevisionDelta: Number(BigInt(after.stamp.revision) - BigInt(before.stamp.revision)),
        historyUnitDelta: Number(BigInt(after.history.undo_entries) - BigInt(before.history.undo_entries)),
        events: committedEvents.length, queryStateIdentityAndEventPurity: true,
        exactUndoRedoStateAndIds: c.expected.kind === 'changed' ? 'passed' : 'not_applicable' });
    } finally { await handle.destroy(); }
    equal(await port.resources(), baseline, `${c.id}: ownership`);
  }
  // This command is supplied by the separate JSON author package. No rebuild,
  // callback, alternate executor or profile-owned compiled command is involved.
  const frozen = packet.extension, handle = await port.open(frozen.initial, notesOptions(port.manifest, packet));
  try {
    ok(await handle.initialization());
    const before = await state(handle), doc = await path(handle, []);
    const command = { id: frozen.command_id, payload_json: JSON.stringify({ kind: 'recipe', arguments: { nodes: { doc }, values: frozen.values } }) };
    const query = ok(await handle.call({ kind: 'query_command', stamp: before.stamp, command }));
    check(query.available, 'runtime recipe availability'); equal(await state(handle), before, 'runtime recipe query purity');
    equal(ok(await handle.call({ kind: 'command', stamp: before.stamp, command, history_hint: { kind: 'isolated' } })).effect, 'changed', 'runtime recipe execution');
    equal(await snapshot(handle), frozen.after, 'runtime recipe canonical literal');
    const leaf = await path(handle, frozen.expected.caret_path), after = await state(handle);
    equal(after.selection.anchor.node, leaf, 'runtime Created caret'); equal(String(after.selection.anchor.offset), frozen.expected.caret_utf16, 'runtime caret UTF16');
    for (const [direction, canonical] of [['undo', frozen.initial], ['redo', frozen.after]]) {
      ok(await handle.call({ kind: 'history', stamp: (await state(handle)).stamp, direction }));
      equal(await snapshot(handle), canonical, `runtime recipe ${direction}`);
    }
    equal(await path(handle, frozen.expected.caret_path), leaf, 'redo exact identity restoration');
    const stateBeforeRefusal = await state(handle);
    const bad = JSON.parse(command.payload_json); bad.arguments.values.unknown = { kind: 'boolean', value: true };
    const refusal = await handle.call({ kind: 'command', stamp: stateBeforeRefusal.stamp, command: { ...command, payload_json: JSON.stringify(bad) }, history_hint: { kind: 'isolated' } });
    check(refusal.status === 'refused', 'runtime unknown argument refusal'); equal(refusal.diagnostic.code, frozen.unknown_argument_code, 'runtime argument code');
    equal(await state(handle), stateBeforeRefusal, 'runtime refusal atomic state'); equal(await snapshot(handle), frozen.after, 'runtime refusal authored bytes');
  } finally { await handle.destroy(); }
  equal(await port.resources(), baseline, 'runtime recipe ownership');
  if (port.multiple) {
    const d0 = await port.open(packet.extension.initial, notesOptions(port.manifest, packet, 'D0'));
    const before = await state(d0), context = await d0.context();
    const d1 = await port.open(packet.extension.after, notesOptions(port.manifest, packet, 'D1'));
    try {
      ok(await d1.initialization()); check((await d1.context()).registry_digest !== context.registry_digest, 'D0/D1 semantic digest differs');
      equal(await d0.context(), context, 'existing D0 context remains frozen'); equal(await state(d0), before, 'existing D0 state remains frozen');
      equal(await snapshot(d0), packet.extension.initial, 'existing D0 authored bytes');
      const catalog = ok(await d0.call({ kind: 'catalog' })).commands;
      check(!catalog.includes(packet.extension.command_id), 'D1 recipe never appears in D0 catalog');
    } finally { await d1.destroy(); await d0.destroy(); }
    equal(await port.resources(), baseline, 'simultaneous D0/D1 ownership');
  }
  return { module: 'present', codec: cases, commands, runtimeRecipe: 'passed', simultaneousFrozenD0D1: port.multiple };
}

// Mandatory SDK2 inventory: original15, OSR-39 appended16th, OSR-40 appended17th,
// OSR-47 appended insert-fragment as the ABI2-only18th; ABI1 remains17.
// SDK2 advertises ASCII-sorted registry IDs. This packet selects no KWDJ recipe;
// the separate compiled/runtime recipe gates cover base18 plus one recipe19.
const kwdjMandatoryCommands = Object.freeze([
  'org.klenwriter.kwdj/command/enter',
  'org.klenwriter.kwdj/command/shift-enter',
  'org.klenwriter.kwdj/command/toggle-mark',
  'org.klenwriter.kwdj/command/set-link',
  'org.klenwriter.kwdj/command/unset-link',
  'org.klenwriter.kwdj/command/insert-text',
  'org.klenwriter.kwdj/command/insert-fragment',
  'org.klenwriter.kwdj/command/transform-block',
  'org.klenwriter.kwdj/command/toggle-quote',
  'org.klenwriter.kwdj/command/toggle-list',
  'org.klenwriter.kwdj/command/insert-block',
  'org.klenwriter.kwdj/command/move',
  'org.klenwriter.kwdj/command/duplicate',
  'org.klenwriter.kwdj/command/remove',
  'org.klenwriter.kwdj/command/accept-slash',
  'org.klenwriter.kwdj/command/dismiss-slash',
  'org.klenwriter.kwdj/command/delete-backward',
  'org.klenwriter.kwdj/command/delete-selection',
].sort());

export async function exerciseKwdj(port, packet) {
  const baseline = await port.resources(), present = port.manifest.profiles.some(value => value.profile_id === 'org.klenwriter.kwdj');
  const makeOptions = c => ({ abi: 'editor-sdk/2', build_id: port.manifest.build_id,
    profile: packet.kwdjProfile, admission: c.primary === 'normalize' ? 'normalize' : 'validate', access: 'editable',
    registry_json: packet.kwdjRegistryJson, profile_options_json: JSON.stringify(c.profileOptions) });
  if (!present) {
    const handle = await port.open('deliberately invalid authored JSON', makeOptions(packet.kwdj[0]));
    const result = await handle.initialization();
    check(result.status === 'refused' && result.diagnostic.code === 'profile.unsupported_profile', 'missing KWDJ compiled module');
    equal(await handle.context(), null, 'missing KWDJ context'); await handle.destroy();
    equal(await port.resources(), baseline, 'missing KWDJ ownership');
    return { module: 'absent', refusal: result.diagnostic.code, codec: [] };
  }
  const cases = [];
  let checkedDeleteBackward = false;
  for (const c of packet.kwdj) {
    const handle = await port.open(c.input, makeOptions(c));
    try {
      const initial = await handle.initialization();
      if (c.expectedStatus === 'accepted') {
        ok(initial);
        const actual = await snapshot(handle);
        if (c.expectedCanonical !== undefined && c.expectedCanonical !== null) equal(actual, c.expectedCanonical, `${c.id}: KWDJ literal canonical`);
        else equal(JSON.parse(actual), JSON.parse(c.input), `${c.id}: independently constructed resource semantics`);
        check((await handle.context()).build_id === port.manifest.build_id, 'KWDJ build context');
        equal(ok(await handle.call({ kind: 'catalog' })).commands, kwdjMandatoryCommands, 'KWDJ exact mandatory18 catalog');
        if (!checkedDeleteBackward) {
          const before = await state(handle), beforeIds = await identities(handle), beforeEvents = await events(handle);
          equal(before.selection, null, 'KWDJ initial selection for strict command admission');
          const command = { id: 'org.klenwriter.kwdj/command/delete-backward', payload_json: '{"kind":"delete_backward"}' };
          const query = ok(await handle.call({ kind: 'query_command', stamp: before.stamp, command }));
          check(!query.available, 'KWDJ delete-backward requires native selection');
          equal(query.diagnostic.code, 'kwdj.command_selection_required', 'KWDJ exact scoped delete-backward handler');
          equal(query.diagnostic.path, '/command', 'KWDJ delete-backward selection diagnostic path');
          const result = await handle.call({ kind: 'command', stamp: before.stamp, command, history_hint: { kind: 'isolated' } });
          check(result.status === 'refused' && !result.diagnostic.may_have_committed, 'KWDJ delete-backward selection refusal');
          equal(result.diagnostic.code, 'kwdj.command_selection_required', 'KWDJ delete-backward execute handler');
          equal(result.diagnostic.path, '/command', 'KWDJ delete-backward execute diagnostic path');
          const extra = { ...command, payload_json: '{"kind":"delete_backward","extra":true}' };
          for (const request of [
            { kind: 'query_command', stamp: before.stamp, command: extra },
            { kind: 'command', stamp: before.stamp, command: extra, history_hint: { kind: 'isolated' } },
          ]) {
            const refused = await handle.call(request);
            check(refused.status === 'refused' && !refused.diagnostic.may_have_committed, 'KWDJ delete-backward closed empty DTO');
            equal(refused.diagnostic.code, 'sdk.invalid_dto', 'KWDJ delete-backward extra-field diagnostic');
            equal(refused.diagnostic.path, '', 'KWDJ delete-backward DTO diagnostic path');
          }
          equal(await state(handle), before, 'KWDJ strict command refusals preserve all state');
          equal(await identities(handle), beforeIds, 'KWDJ strict command refusals preserve IDs and payload');
          equal(await events(handle), beforeEvents, 'KWDJ strict command refusals publish no event');
          equal(await snapshot(handle), actual, 'KWDJ strict command refusals preserve canonical bytes');
          checkedDeleteBackward = true;
        }
      } else {
        check(initial.status === 'refused' && !initial.diagnostic.may_have_committed, `${c.id}: KWDJ refusal`);
        if (c.expectedCodes?.length) check(c.expectedCodes.includes(initial.diagnostic.code), `${c.id}: normative KWDJ refusal ${initial.diagnostic.code}`);
        equal(await handle.context(), null, `${c.id}: KWDJ refused context`);
      }
      cases.push({ id: c.id, outcome: c.expectedStatus });
    } finally { await handle.destroy(); }
    equal(await port.resources(), baseline, `${c.id}: KWDJ ownership`);
  }
  check(checkedDeleteBackward, 'KWDJ accepted literal required for strict command proof');
  return { module: 'present', codec: cases };
}
