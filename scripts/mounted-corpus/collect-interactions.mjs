// SPDX-License-Identifier: MIT OR Apache-2.0
// Independent bounded data-only assessment. No DOM, SDK, browser or editor imports.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import { RESOURCE_KEYS, ENGINES, ownBoundedData, nativeResourceCounts } from './protocol.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mapRoles = (checkpoint, paths) => Object.fromEntries(Object.entries(paths).map(([role, path]) => [role,
  checkpoint.nodes.find(value => isDeepStrictEqual(value.path, path))?.node.id]));
const resolveRoles = (value, roles) => Array.isArray(value) ? value.map(item => resolveRoles(item, roles))
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    ['node', 'parent'].includes(key) && typeof item === 'string' && Object.hasOwn(roles, item) ? roles[item] : resolveRoles(item, roles)])) : value;
const terminal = result => result?.status === 'completed' ? result.response : result?.status === 'queued' ? result.completion : result;

/** Independent finite comparisons. An authentic Firefox behavior GAP stays visible. */
export function assessInteraction({ observation, route, binding, harnessError, contract, pin, validators }) {
  const checks = [];
  let cleanupUnknown = false;
  const equal = (domain, name, actual, expected) => checks.push({ domain, name,
    status: isDeepStrictEqual(actual, expected) ? 'MET' : domain === 'integrity' ? 'FAIL' : 'GAP', actual: actual ?? null, expected: expected ?? null });
  const inspect = (domain, name, body) => {
    try { body(); } catch (error) {
      if (domain === 'cleanup') cleanupUnknown = true;
      const actualDomain = domain === 'cleanup' ? 'integrity' : domain;
      checks.push({ domain: actualDomain, name, status: actualDomain === 'integrity' ? 'FAIL' : 'GAP', actual: { error: error.message }, expected: 'Complete authentic comparable evidence' });
    }
  };
  equal('integrity', 'harness completed its finite program', harnessError, null);
  if (!observation) { equal('integrity', 'original interaction observation exists', null, 'present'); return { checks, integrity: 'FAIL', requirement: 'OBSERVATION', cleanup: 'UNKNOWN', blocking: true }; }
  equal('integrity', 'protocol', observation.protocol, contract.protocol);
  equal('integrity', 'run identity', observation.runId, binding.runId);
  equal('integrity', 'engine', ENGINES.includes(observation.engine), true);
  equal('integrity', 'route inventory identity', observation.routeId, route.routeId);
  equal('integrity', 'source/build binding', observation.binding, { sourceSHA: binding.sourceSHA, buildId: binding.build.buildId, wasmSha256: binding.build.wasm.sha256 });
  equal('integrity', 'independent literal pin', observation.literalPin, pin);
  equal('integrity', 'complete original terminal', observation.stop, { status: 'completed', phase: 'complete', reason: null });
  equal('integrity', 'capture errors', observation.errors, []); equal('integrity', 'CSP violations', observation.cspViolations, []);
  equal('integrity', 'native trace overflow', observation.nativeTraceOverflow, false);
  equal('integrity', 'exact approved original input bytes', observation.original?.input, route.input);
  inspect('integrity', 'closed original interaction DTOs', () => {
    closeKeys(observation, ['protocol', 'runId', 'engine', 'routeId', 'binding', 'literalPin', 'scope', 'stop', 'original', 'fresh', 'checkpoints', 'nativeTrace', 'nativeTraceBytes', 'nativeTraceOverflow', 'ordinaryInputs', 'uiReady', 'uiResults', 'commands', 'browserEvents', 'focusSetup', 'errors', 'cspViolations'], 'observation');
    for (const owner of [observation.original, observation.fresh]) {
      equal('integrity', `${owner?.elementToken ?? 'missing'}: closed public owner`, validators.owner(owner), true);
      for (const call of owner.calls) {
        const reply = terminal(call.result);
        equal('integrity', `${owner.elementToken}: method/request correlation`, call.method,
          ['state', 'node', 'catalog', 'resources'].includes(call.request.kind) ? 'read' : call.request.kind.startsWith('query_') ? 'query' : 'submit');
        if (reply.status === 'ok') {
          const expectedKind = { state: 'state', node: 'node', snapshot: 'snapshot', release_snapshot: 'released', query_history: 'availability', set_selection: 'mutation', set_stored_marks: 'mutation', history: 'mutation' }[call.request.kind];
          equal('integrity', `${owner.elementToken}: original request/reply kind`, reply.value.kind, expectedKind);
          if (call.request.kind === 'node') equal('integrity', `${owner.elementToken}: original requested node`, reply.value.node.id, call.request.node);
          if (call.request.kind !== 'release_snapshot') equal('integrity', `${owner.elementToken}: capture/request stamp`, call.request.stamp ?? call.capture, call.capture);
        }
      }
    }
    for (const point of observation.checkpoints) {
      closeKeys(point, ['label', 'state', 'nodes', 'snapshot', 'eventCount', 'nativeTraceEnd', 'ordinaryInputCount', 'uiResultCount', 'focus', 'resources'], 'checkpoint');
      equal('integrity', `${point.label}: closed state DTO`, validators.state(point.state), true);
      for (const row of point.nodes) {
        closeKeys(row, ['path', 'node'], 'node row'); equal('integrity', `${point.label}: closed node DTO`, validators.node(row.node), true);
        equal('integrity', `${point.label}: node whole stamp`, row.node.stamp, point.state.stamp);
      }
    }
  });
  equal('integrity', 'closed checkpoint inventory', observation.checkpoints.map(value => value.label), ['prepared', 'before', 'after', 'undo', 'redo', 'reopen']);
  inspect('integrity', 'native request and response original wire inventory', () => {
    let bytes = 0;
    for (const [index, row] of observation.nativeTrace.entries()) {
      equal('integrity', `native ordinal ${index}`, row.ordinal, index);
      equal('integrity', `native terminal ${index}`, row.error, null);
      closeKeys(row, ['ordinal', 'method', 'requestJson', 'responseJson', 'error'], 'native wire row');
      const response = parseUnique(row.responseJson);
      equal('integrity', `native full response DTO ${index}`, validators.response(response), true);
      if (row.requestJson !== null) {
        const request = parseUnique(row.requestJson); bytes += Buffer.byteLength(row.requestJson);
        if (['command', 'history', 'set_selection', 'set_stored_marks', 'snapshot', 'release_snapshot'].includes(request.kind)) {
          equal('integrity', `native semantic request DTO ${index}`, validators.request(request), true);
          if (response.status === 'ok') equal('integrity', `native semantic request/reply ${index}`, response.value.kind,
            request.kind === 'snapshot' ? 'snapshot' : request.kind === 'release_snapshot' ? 'released' : 'mutation');
        }
      }
      bytes += Buffer.byteLength(row.responseJson);
    }
    equal('integrity', 'native original byte count', observation.nativeTraceBytes, bytes);
    equal('integrity', 'native byte/call bounds', bytes <= contract.budgets.nativeBytes && observation.nativeTrace.length <= contract.budgets.nativeCalls, true);
  });
  const cp = Object.fromEntries(observation.checkpoints.map(value => [value.label, value]));
  inspect('integrity', 'snapshot/release references preserve original bytes and handle', () => {
    for (const owner of [observation.original, observation.fresh]) {
      equal('integrity', `${owner.elementToken}: ready`, owner.ready.status, 'ready');
      for (const snapshot of owner.snapshots) {
        const original = owner.calls[snapshot.call], release = owner.calls[snapshot.releaseCall], value = terminal(original.result).value;
        equal('integrity', `${owner.elementToken}: snapshot request`, original.request.kind, 'snapshot');
        equal('integrity', `${owner.elementToken}: snapshot bytes`, snapshot.bytes, Buffer.byteLength(snapshot.utf8));
        equal('integrity', `${owner.elementToken}: snapshot SHA256`, snapshot.sha256, hash(Buffer.from(snapshot.utf8)));
        equal('integrity', `${owner.elementToken}: original canonical`, snapshot.utf8, value.canonical_json);
        equal('integrity', `${owner.elementToken}: explicit release`, release.request, { kind: 'release_snapshot', handle: value.handle });
        equal('integrity', `${owner.elementToken}: release terminal`, terminal(release.result).value.kind, 'released');
      }
    }
    equal('integrity', 'new HTMLElement identity', observation.original.elementToken !== observation.fresh.elementToken, true);
    equal('integrity', 'destroy precedes fresh mount', observation.original.destroyOrdinal < observation.fresh.mountOrdinal, true);
    equal('integrity', 'exact saved bytes become fresh input', observation.fresh.input, { utf8: cp.redo.snapshot.utf8, bytes: cp.redo.snapshot.bytes, sha256: cp.redo.snapshot.sha256 });
  });
  inspect('cleanup', 'complete actual resource maps, typed destroy and module baseline', () => {
    const baseline = binding.nativeBaselines.find(value => value.engine === observation.engine).sample;
    for (const owner of [observation.original, observation.fresh]) {
      if (!owner) throw new Error('No original cleanup observation for a required owner');
      const destroyed = terminal(owner.destroy?.sdk);
      if (!destroyed || !validators.response(destroyed)) {
        cleanupUnknown = true; equal('integrity', `${owner.elementToken}: authentic destroy terminal`, false, true);
      } else equal('cleanup', `${owner.elementToken}: destroy terminal`, destroyed.status === 'ok' && destroyed.value.kind === 'destroyed', true);
      equal('integrity', `${owner.elementToken}: native sample valid`, owner.nativeAfter?.validation, 'valid');
      if (owner.nativeAfter?.validation !== 'valid') cleanupUnknown = true;
      let nativeKnown = false;
      try { nativeResourceCounts(owner.nativeAfter?.value); nativeKnown = true; } catch { /* Unknown stays explicit. */ }
      if (!nativeKnown) cleanupUnknown = true;
      equal('integrity', `${owner.elementToken}: full native count map`, nativeKnown, true);
      equal('cleanup', `${owner.elementToken}: native baseline restored`, owner.nativeAfter.value, baseline.value);
      equal('cleanup', `${owner.elementToken}: original input released`, owner.originalInputAfterDestroy, null);
      for (const [group, keys] of Object.entries(RESOURCE_KEYS)) {
        if (group === 'native') continue;
        const actual = group === 'ui' ? owner.resourcesAfter.ui : owner.resourcesAfter.mounted[group];
        const expected = Object.fromEntries(keys.map(key => [key, group === 'sdk' && key === 'lifecycle' ? 'destroyed' : 0]));
        if (group === 'ui' && (owner === observation.fresh || route.kind === 'selection')) equal('cleanup', `${owner.elementToken}: no UI owner`, actual, null);
        else {
          const actualKeys = actual && typeof actual === 'object' ? Object.keys(actual).sort() : null;
          const validTypes = !!actual && keys.every(key => group === 'sdk' && key === 'lifecycle' ? typeof actual[key] === 'string' : Number.isSafeInteger(actual[key]) && actual[key] >= 0);
          if (!isDeepStrictEqual(actualKeys, [...keys].sort()) || !validTypes) cleanupUnknown = true;
          equal('integrity', `${owner.elementToken}: ${group} complete count keys`, actualKeys, [...keys].sort());
          equal('integrity', `${owner.elementToken}: ${group} genuine count types`, validTypes, true);
          equal('cleanup', `${owner.elementToken}: ${group} complete zero map`, actual, expected);
        }
      }
    }
  });
  inspect('behavior', 'independent canonical literals and fresh reopen', () => {
    equal('behavior', 'prepared approved input', cp.prepared.snapshot.utf8, route.input.utf8);
    equal('behavior', 'before operation literal', cp.before.snapshot.utf8, route.before.utf8);
    equal('behavior', 'after operation literal', cp.after.snapshot.utf8, route.after.utf8);
    equal('behavior', 'one Undo exact literal', cp.undo.snapshot.utf8, route.before.utf8);
    equal('behavior', 'one Redo exact literal', cp.redo.snapshot.utf8, route.after.utf8);
    equal('behavior', 'new-owner reopen literal', cp.reopen.snapshot.utf8, route.after.utf8);
  });
  inspect('behavior', 'source-authored identity roles and directed native selection', () => {
    const beforeRoles = mapRoles(cp.before, route.rolesBefore), afterRoles = mapRoles(cp.after, route.rolesAfter);
    const beforeIds = cp.before.nodes.map(value => value.node.id);
    equal('behavior', 'exact original node inventory', cp.before.nodes.length, Object.keys(route.rolesBefore).length);
    equal('behavior', 'exact edited node inventory', cp.after.nodes.length, Object.keys(route.rolesAfter).length);
    equal('behavior', 'all original roles bound uniquely', new Set(Object.values(beforeRoles)).size === beforeIds.length && !Object.values(beforeRoles).includes(undefined), true);
    for (const role of route.surviving) equal('behavior', `${role} original survives`, afterRoles[role], beforeRoles[role]);
    for (const role of route.fresh) equal('behavior', `${role} replacement genuinely fresh`, typeof afterRoles[role] === 'string' && !beforeIds.includes(afterRoles[role]), true);
    for (const role of route.retired) equal('behavior', `${role} original retired`, Object.values(afterRoles).includes(beforeRoles[role]), false);
    equal('behavior', 'Undo revives all original roles', mapRoles(cp.undo, route.rolesBefore), beforeRoles);
    equal('behavior', 'Redo same final identities', mapRoles(cp.redo, route.rolesAfter), afterRoles);
    equal('behavior', 'backward/collapsed selection before actual mutation', cp.before.state.selection, resolveRoles(route.selectionBefore, beforeRoles));
    equal('behavior', 'selection after actual mutation', cp.after.state.selection, resolveRoles(route.selectionAfter, afterRoles));
    equal('behavior', 'Undo restores original directed selection', cp.undo.state.selection, cp.before.state.selection);
    equal('behavior', 'Redo restores original result selection', cp.redo.state.selection, cp.after.state.selection);
    for (const name of ['before', 'after', 'undo', 'redo']) equal('behavior', `${name}: stored marks remain null`, cp[name].state.stored_marks, null);
  });
  inspect('behavior', 'one original semantic dispatch, publication and history unit', () => {
    const before = cp.before.state, after = cp.after.state, roles = mapRoles(cp.before, route.rolesBefore);
    const nativeCalls = observation.nativeTrace.slice(cp.before.nativeTraceEnd, cp.after.nativeTraceEnd).filter(value => value.method === 'call').map(value => ({ request: JSON.parse(value.requestJson), response: JSON.parse(value.responseJson) }));
    const commands = nativeCalls.filter(value => value.request.kind === 'command');
    equal('behavior', 'one native semantic command', commands.length, 1);
    if (commands.length === 1) {
      equal('behavior', 'original command ID', commands[0].request.command.id, route.commandId);
      equal('behavior', 'original semantic intent', JSON.parse(commands[0].request.command.payload_json), resolveRoles(route.intent, roles));
      equal('behavior', 'original isolated history hint', commands[0].request.history_hint, { kind: 'isolated' });
      equal('behavior', 'original native command changed', commands[0].response.value.effect, 'changed');
    }
    for (const [field, delta] of [['revision', route.history.revisionDelta], ['selection_epoch', route.history.selectionEpochDelta], ['history_epoch', route.history.historyEpochDelta]]) equal('behavior', `${field} original change`, String(BigInt(after.stamp[field]) - BigInt(before.stamp[field])), String(delta));
    equal('behavior', 'original live context unchanged', [after.stamp.session, after.stamp.generation], [before.stamp.session, before.stamp.generation]);
    if (route.history.beforeUndoEntries !== null) equal('behavior', 'initial history source literal', before.history.undo_entries, route.history.beforeUndoEntries);
    equal('behavior', 'one Undo entry added', String(BigInt(after.history.undo_entries) - BigInt(before.history.undo_entries)), '1');
    equal('behavior', 'Redo stack empty after mutation', after.history.redo_entries, '0');
    equal('behavior', 'Undo restores previous Undo count', cp.undo.state.history.undo_entries, before.history.undo_entries);
    equal('behavior', 'Undo creates one Redo entry', cp.undo.state.history.redo_entries, '1');
    equal('behavior', 'Redo restores final Undo count', cp.redo.state.history.undo_entries, after.history.undo_entries);
    equal('behavior', 'Redo restores final Redo count', cp.redo.state.history.redo_entries, after.history.redo_entries);
    const documents = observation.original.events.filter(value => value.change.kind === 'document');
    const beforeDocuments = observation.original.events.slice(0, cp.before.eventCount).filter(value => value.change.kind === 'document').length;
    const afterDocuments = observation.original.events.slice(0, cp.after.eventCount).filter(value => value.change.kind === 'document').length;
    equal('behavior', 'one document publication for operation', afterDocuments - beforeDocuments, 1);
    equal('behavior', 'operation/Undo/Redo publications', documents.length - beforeDocuments, 3);
  });
  inspect('behavior', 'actual browser protocol route and result focus', () => {
    const keys = observation.browserEvents.filter(value => value.name === 'keydown');
    const inputs = observation.ordinaryInputs;
    if (route.kind === 'selection') {
      equal('behavior', 'five trusted backward-selection keys', keys.filter(value => value.key === 'ArrowLeft' && value.shiftKey && value.isTrusted).length, 5);
      equal('behavior', 'one trusted ordinary replacement', inputs.map(value => ({ inputType: value.inputType, dataHint: value.dataHint, isTrusted: value.isTrusted })), [{ inputType: 'insertText', dataHint: 'X', isTrusted: true }]);
    } else if (route.kind === 'slash') {
      equal('behavior', 'five trusted committed slash input scalars', inputs.map(value => ({ data: value.dataHint, trusted: value.isTrusted })), [...'/para'].map(data => ({ data, trusted: true })));
      equal('behavior', 'one original UI slash submission', observation.uiResults.filter(value => value.status === 'submitted').map(value => value.action), ['org.klenwriter.kwdj/slash/paragraph']);
      equal('behavior', 'slash native result retains editor focus', cp.after.focus.editor, true);
    } else if (route.kind === 'drag-pointer') {
      const down = observation.browserEvents.filter(value => value.name === 'pointerdown' && value.control === 'drag');
      equal('behavior', 'one original trusted drag down', down.length, 1);
      if (down.length === 1) {
        equal('behavior', 'trusted original mouse down', { trusted: down[0].isTrusted, type: down[0].pointerType, button: down[0].button, buttons: down[0].buttons }, { trusted: true, type: 'mouse', button: '0', buttons: 1 });
        const held = observation.browserEvents.filter(value => value.name === 'pointermove' && value.pointerId === down[0].pointerId && value.buttons === 1);
        equal('behavior', 'all eight genuine held moves observed', held.length >= 8 && held.every(value => value.isTrusted), true);
        const up = observation.browserEvents.filter(value => value.name === 'pointerup' && value.pointerId === down[0].pointerId);
        equal('behavior', 'one matching trusted mouse up', up.map(value => ({ trusted: value.isTrusted, type: value.pointerType, button: value.button, buttons: value.buttons })), [{ trusted: true, type: 'mouse', button: '0', buttons: 0 }]);
      }
      equal('behavior', 'pointer result restores editor focus', cp.after.focus.editor, true);
    } else {
      equal('behavior', 'forward Tab source program', keys.filter(value => value.key === 'Tab').every(value => value.isTrusted && !value.shiftKey), true);
      equal('behavior', 'genuine Enter/Down/Enter', keys.filter(value => ['Enter', 'ArrowDown'].includes(value.key)).map(value => ({ key: value.key, trusted: value.isTrusted })), [{ key: 'Enter', trusted: true }, { key: 'ArrowDown', trusted: true }, { key: 'Enter', trusted: true }]);
      equal('behavior', 'keyboard result restores original handle focus', cp.after.focus.handle, true);
    }
    if (route.kind !== 'selection') equal('behavior', 'one successful original UI submission', observation.uiResults.filter(value => value.status === 'submitted').map(value => terminal(value.submission)?.status), ['ok']);
  });
  const integrity = checks.some(value => value.domain === 'integrity' && value.status !== 'MET') ? 'FAIL' : 'PASS';
  const cleanup = cleanupUnknown ? 'UNKNOWN' : checks.some(value => value.domain === 'cleanup' && value.status !== 'MET') ? 'GAP' : 'MET';
  const requirement = integrity === 'FAIL' ? 'OBSERVATION' : checks.some(value => value.domain === 'behavior' && value.status !== 'MET') ? 'GAP' : 'MET';
  return { checks, integrity, requirement, cleanup, blocking: integrity === 'FAIL' || cleanup !== 'MET' || requirement === 'GAP' && observation.engine !== 'firefox' };
}

const receiptKeys = ['format', 'runId', 'engine', 'routeId', 'observation', 'assessment', 'harnessError', 'pageErrors', 'externalRequests'].sort();
const literalPath = 'contracts/mounted-e2e/v1/interaction-literals.json';
function parseUnique(text) {
  const value = JSON.parse(text), stack = [];
  for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    const item = token[0], top = stack.at(-1);
    if (item === '{') stack.push({ keys: new Set(), key: true });
    else if (item === '[') stack.push(null);
    else if (item === '}' || item === ']') stack.pop();
    else if (item === ',' && top) top.key = true;
    else if (item === ':' && top) top.key = false;
    else if (item.startsWith('"') && top?.key) {
      const key = JSON.parse(item); if (top.keys.has(key)) throw new Error('Duplicate JSON interaction key'); top.keys.add(key);
    }
  }
  return value;
}
export function interactionValidators(observationSchema) {
  const defs = JSON.parse(JSON.stringify(observationSchema.$defs));
  const labels = ['initial-state', 'initial-node', 'setup-selection', 'setup-marks', 'query-undo', 'undo', 'query-redo', 'redo'];
  for (const label of ['prepared', 'before', 'after', 'undo', 'redo', 'reopen']) labels.push(`${label}-state`, `${label}-node`, `snapshot-${label}`, `release-${label}`);
  defs.call.properties.label.enum = [...new Set(labels)];
  // This additive route schema does not alter or weaken initial25 schema authority.
  defs.command.properties.id.enum = ['insert-text', 'accept-slash', 'move'].map(id => `org.klenwriter.kwdj/command/${id}`);
  const ajv = new Ajv2020({ strict: true, allErrors: false });
  return Object.fromEntries(['owner', 'state', 'node', 'request', 'response'].map(name => [name, ajv.compile({ $schema: observationSchema.$schema, $defs: defs, $ref: `#/$defs/${name}` })]));
}
function closeKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) throw new Error(`Invalid closed interaction ${label}`);
}
async function readBounded(readArtifact, path, maxBytes) {
  const original = await readArtifact(path, maxBytes);
  const bytes = typeof original === 'string' ? Buffer.from(original) : Buffer.from(original);
  if (bytes.length > maxBytes) throw new Error(`Interaction artifact byte bound: ${path}`);
  const pin = { path, bytes: bytes.length, sha256: hash(bytes) };
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!Buffer.from(json).equals(bytes)) throw new Error(`Interaction UTF8 byte join: ${path}`);
    const bounded = ownBoundedData(parseUnique(json), maxBytes), value = JSON.parse(bounded.json);
    return { value, pin };
  } catch (error) { error.artifactPin = pin; throw error; }
}
function equalPin(pin, binding) {
  const actual = binding.scenarioPins.filter(value => value.path === pin.path);
  if (actual.length !== 1 || !isDeepStrictEqual(actual[0], pin)) throw new Error(`Interaction frozen source pin mismatch: ${pin.path}`);
}
/** Complete immutable inventory of four genuine routes across three engines. */
export async function collectInteractions({ runBinding, readArtifact }) {
  const source = await readBounded(readArtifact, literalPath, 65536);
  equalPin(source.pin, runBinding);
  const contract = source.value;
  const schema = await readBounded(readArtifact, 'contracts/mounted-e2e/v1/observation.schema.json', 262144);
  equalPin(schema.pin, runBinding); const validators = interactionValidators(schema.value);
  const expectedIds = ['selection-keyboard-replace', 'slash-keyboard-accept', 'drag-pointer-move', 'drag-keyboard-move'];
  if (contract.protocol !== 'mounted-corpus-interactions/1' || contract.acceptedSource !== runBinding.acceptedSource
    || !isDeepStrictEqual(contract.routes.map(value => value.routeId), expectedIds)) throw new Error('Interaction source contract inventory');
  for (const sourcePin of contract.sourcePins) {
    const file = await readBoundedSource(readArtifact, sourcePin.path, Math.max(sourcePin.bytes, 1));
    if (!isDeepStrictEqual(file, sourcePin)) throw new Error(`Interaction source authority changed: ${sourcePin.path}`);
  }
  const rows = [], pins = [];
  for (const engine of ENGINES) for (const route of contract.routes) {
    const path = `interactions/${engine}/${route.routeId}.json`;
    try {
      const artifact = await readBounded(readArtifact, path, contract.budgets.artifactBytes), receipt = artifact.value;
      pins.push(artifact.pin); closeKeys(receipt, receiptKeys, 'receipt');
      if (receipt.format !== 'mounted-corpus-interaction-receipt/1' || receipt.engine !== engine || receipt.routeId !== route.routeId || receipt.runId !== runBinding.runId) throw new Error('Interaction artifact inventory binding');
      const assessment = assessInteraction({ observation: receipt.observation, route, binding: runBinding, harnessError: receipt.harnessError, contract, pin: source.pin, validators });
      if (!Array.isArray(receipt.pageErrors) || !Array.isArray(receipt.externalRequests)) throw new Error('Interaction page error inventory');
      if (receipt.pageErrors.length || receipt.externalRequests.length) { assessment.integrity = 'FAIL'; assessment.requirement = 'OBSERVATION'; assessment.blocking = true; }
      if (!isDeepStrictEqual(receipt.assessment, assessment)) throw new Error('Saved interaction assessment differs from independent recomputation');
      if (receipt.observation?.engine !== engine) throw new Error('Original interaction engine binding');
      rows.push({ engine, routeId: route.routeId, tier: contract.engines[engine], ...assessment, artifact: artifact.pin });
    } catch (error) {
      if (error.artifactPin && !pins.some(value => value.path === path)) pins.push(error.artifactPin);
      rows.push({ engine, routeId: route.routeId, tier: contract.engines[engine], integrity: 'FAIL', requirement: 'OBSERVATION', cleanup: 'UNKNOWN', blocking: true,
        artifact: pins.find(value => value.path === path) ?? null,
        checks: [{ domain: 'integrity', name: 'bounded authentic interaction artifact', status: 'FAIL', actual: { message: error.message }, expected: 'Closed source-bound original artifact and independent assessment' }] });
    }
  }
  return { protocol: contract.protocol, runId: runBinding.runId, source: source.pin, rows, pins,
    counts: { rows: rows.length, integrityFailures: rows.filter(value => value.integrity !== 'PASS').length,
      met: rows.filter(value => value.requirement === 'MET').length, gaps: rows.filter(value => value.requirement === 'GAP').length,
      observations: rows.filter(value => value.requirement === 'OBSERVATION').length, cleanupGaps: rows.filter(value => value.cleanup !== 'MET').length },
    blocking: rows.some(value => value.blocking) };
}
async function readBoundedSource(readArtifact, path, maxBytes) {
  const value = await readArtifact(path, maxBytes), bytes = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
  if (bytes.length > maxBytes) throw new Error(`Interaction source bound: ${path}`);
  return { path, bytes: bytes.length, sha256: hash(bytes) };
}

