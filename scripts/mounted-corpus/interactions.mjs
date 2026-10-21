// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed cross-cutting routes. Native bytes are delegated unchanged; no oracle is inferred here.
import { createEditorUi } from '@klenwriter/editor-ui';
import { kwdjCommand, kwdjSlashCandidates, kwdjSlashTextBlockTypes } from '@klenwriter/editor-kwdj';
import { ownBoundedData } from '/mounted-corpus-protocol.mjs';
import { observeNativeModule } from '/mounted-corpus-native-observer.mjs';
import { ready as baseReady, interactionSetup, createRecorder, openOwner, readTree,
  snapshotAndRelease, closeOwner, call, requireReply, serializeSubmission } from '/mounted-corpus-client.mjs';

const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const own = value => ownBoundedData(value).value;
const allowedIds = Object.freeze(['selection-keyboard-replace', 'slash-keyboard-accept', 'drag-pointer-move', 'drag-keyboard-move']);
const checkpointOrder = Object.freeze(['prepared', 'before', 'after', 'undo', 'redo']);
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
const sourcePromise = (async () => {
  await baseReady;
  const response = await fetch('/mounted-corpus-contract/interaction-literals.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Interaction literal source unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 65536) throw new Error('Interaction literal source byte bound');
  const contract = own(JSON.parse(decoder.decode(bytes)));
  if (contract.protocol !== 'mounted-corpus-interactions/1' || contract.routes.length !== 4
    || contract.routes.some((x, i) => x.routeId !== allowedIds[i])) throw new Error('Interaction source inventory mismatch');
  return { contract, pin: { path: 'contracts/mounted-e2e/v1/interaction-literals.json', bytes: bytes.length, sha256: await digest(bytes) } };
})();
export const ready = sourcePromise.then(({ contract, pin }) => own({ protocol: contract.protocol, routes: allowedIds, pin }));
let active = null;

const fail = message => { throw new Error(message); };
function boundedPush(list, value, maximum, label) {
  if (list.length >= maximum) fail(`Interaction ${label} observation bound`);
  list.push(own(value));
}
function resolve(value, roles) {
  if (Array.isArray(value)) return value.map(v => resolve(v, roles));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k,
    ['node', 'parent'].includes(k) && typeof v === 'string' && Object.hasOwn(roles, v) ? roles[v] : resolve(v, roles)]));
  return value;
}
function unavailable() { return { status: 'unavailable', code: 'mounted-corpus.unavailable', message: { ru: 'Недоступно', en: 'Unavailable' } }; }
function makeProfile(route, record, copy) {
  const remember = (captured, destination, command) => {
    boundedPush(record.commands, { captured, destination, command }, 64, 'command-factory'); return command;
  };
  return () => ({ toolbar: [], insertions: [], blockActions: [],
    moves(captured) {
      const { node, parent, index } = captured.block;
      return [
        { id: 'up', direction: 'up', label: { ru: 'Выше', en: 'Move up' }, command: index > 0 ? kwdjCommand({ kind: 'move', node: node.id, parent: parent.id, before_index: index - 1 }) : unavailable() },
        { id: 'down', direction: 'down', label: { ru: 'Ниже', en: 'Move down' }, command: kwdjCommand({ kind: 'move', node: node.id, parent: parent.id, before_index: index + 2 }) },
      ];
    },
    ...(route.kind === 'slash' ? { slash: { textBlockTypes: kwdjSlashTextBlockTypes,
      choices: kwdjSlashCandidates.map(candidate => {
        const text = copy.choices.find(value => candidate.id === `org.klenwriter.kwdj/slash/${value.id}`);
        if (!text) fail('Unbound slash catalog choice');
        return { id: candidate.id, label: text.label, keywords: text.keywords, command(captured, query) {
          return remember(captured, query, kwdjCommand(query
            ? { kind: 'accept_slash', target: candidate.target, range: query.range, literal: query.literal }
            : { kind: 'insert_block', target: candidate.target }));
        } };
      }) } } : {}),
    ...(route.kind.startsWith('drag-') ? { drag: { move(captured, destination) {
      return remember(captured, destination, kwdjCommand({ kind: 'move', node: captured.source.id, parent: destination.parent, before_index: destination.before_index }));
    } } } : {}),
  });
}
async function awaitUi(state) {
  await Promise.all(state.pendingUi); state.recorder.check();
}
async function checkpointInternal(label, owner = active?.owner) {
  const state = active;
  if (!state || !owner) fail('No current interaction owner');
  if (label !== 'reopen' && checkpointOrder[state.record.checkpoints.length] !== label) fail('Unexpected interaction checkpoint order');
  await awaitUi(state); state.recorder.phase = label;
  const tree = await readTree(owner, { stateLabel: `${label}-state`, nodeLabel: `${label}-node` });
  const saved = await snapshotAndRelease(owner, { snapshotLabel: `snapshot-${label}`, releaseLabel: `release-${label}` });
  const point = { label, state: own(tree.state), nodes: [...tree.nodes].map(([path, node]) => ({ path: path === '' ? [] : path.split('/').map(Number), node: own(node) })),
    snapshot: own(owner.record.snapshots.at(-1)), eventCount: owner.record.events.length, nativeTraceEnd: state.record.nativeTrace.length,
    ordinaryInputCount: state.record.ordinaryInputs.length, uiResultCount: state.record.uiResults.length,
    focus: { editor: owner.element.contains(document.activeElement), handle: document.activeElement === state.handle,
      document: document.hasFocus(), activeTag: document.activeElement?.tagName ?? null },
    resources: { mounted: own(owner.editor.resources()), ui: owner.ui ? own(owner.ui.resources()) : null } };
  state.record.checkpoints.push(point); if (label === 'redo') state.saved = saved;
  return own(point);
}
export async function open(routeId, explicitBinding) {
  if (active || !allowedIds.includes(routeId)) fail('Interaction route unavailable or already active');
  const { contract, pin } = await sourcePromise, setup = await interactionSetup(explicitBinding);
  const pins = explicitBinding.scenarioPins.filter(value => value.path === pin.path);
  if (pins.length !== 1 || pins[0].bytes !== pin.bytes || pins[0].sha256 !== pin.sha256) fail('Interaction literal binding mismatch');
  const route = contract.routes.find(value => value.routeId === routeId), recorder = createRecorder({ runId: explicitBinding.runId, engine: setup.engine });
  const record = { protocol: contract.protocol, runId: explicitBinding.runId, engine: setup.engine, routeId,
    binding: { sourceSHA: explicitBinding.sourceSHA, buildId: explicitBinding.build.buildId, wasmSha256: explicitBinding.build.wasm.sha256 },
    literalPin: pin, scope: 'Actual browser-protocol input, no installed OS or human claim', stop: { status: 'running', phase: 'open', reason: null },
    original: null, fresh: null, checkpoints: [], nativeTrace: [], nativeTraceBytes: 0, nativeTraceOverflow: false,
    ordinaryInputs: [], uiReady: null, uiResults: [], commands: [], browserEvents: [], focusSetup: null, errors: recorder.errors, cspViolations: recorder.cspViolations };
  const wrapper = document.createElement('section'); wrapper.className = 'mounted-interaction'; wrapper.id = 'mounted-interaction';
  document.querySelector('#mounted-corpus-host').append(wrapper);
  const state = active = { route, record, recorder, wrapper, owner: null, pendingUi: [], removals: [], inputRelease: null, saved: null, handle: null, module: observeNativeModule(setup.module, record, contract.budgets), options: setup.options };
  for (const name of ['keydown', 'keyup', 'beforeinput', 'input', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
    const listener = event => {
      if (!(event.target instanceof Node) || !wrapper.contains(event.target)) return;
      try { boundedPush(record.browserEvents, { name, isTrusted: event.isTrusted, key: event.key ?? null, code: event.code ?? null,
        shiftKey: event.shiftKey ?? false, repeat: event.repeat ?? false, inputType: event.inputType ?? null, data: event.data ?? null,
        pointerId: event.pointerId ?? null, pointerType: event.pointerType ?? null,
        button: event.button === undefined ? null : String(event.button), buttons: event.buttons ?? null,
        x: event.clientX === undefined ? null : String(event.clientX), y: event.clientY === undefined ? null : String(event.clientY),
        control: event.target instanceof HTMLElement ? event.target.dataset.editorUiControl ?? null : null }, contract.budgets.domEvents, 'browser event'); }
      catch (error) { recorder.addError(error); recorder.captureFailure = error; }
    };
    window.addEventListener(name, listener, true); state.removals.push(() => window.removeEventListener(name, listener, true));
  }
  try {
    const owner = state.owner = await openOwner({ recorder, module: state.module, options: setup.options, input: encoder.encode(route.input.utf8), host: wrapper, elementToken: `${explicitBinding.runId}:${routeId}:original` });
    // The mounted DOM owner observes its host attributes. Keep the original
    // pre-mount data attribute and never decorate its live editor element.
    record.original = owner.record;
    if (owner.record.ready.status !== 'ready') fail('Interaction owner not ready');
    const tree = await readTree(owner, { stateLabel: 'initial-state', nodeLabel: 'initial-node' });
    const roles = Object.fromEntries(Object.entries(route.rolesBefore).map(([role, path]) => [role, tree.nodes.get(path.join('/'))?.id ?? fail('Missing authored interaction role')]));
    requireReply((await call(owner, 'setup-selection', 'submit', { kind: 'set_selection', stamp: owner.editor.capture(), selection: resolve(route.selectionSetup, roles) })).result, 'mutation', 'setup');
    requireReply((await call(owner, 'setup-marks', 'submit', { kind: 'set_stored_marks', stamp: owner.editor.capture(), marks: null })).result, 'mutation', 'setup');
    const captured = owner.editor.selection.captureBookmark();
    if (captured.status !== 'captured') fail('Interaction focus bookmark refused');
    const restored = owner.editor.selection.restoreBookmark(captured.bookmark, { policy: 'exact', focus: true });
    record.focusSetup = { status: captured.status, selection: own(captured.bookmark.selection), stamp: own(captured.bookmark.stamp), context: own(captured.bookmark.context), restore: await serializeSubmission(restored, 'setup') };
    requireReply(record.focusSetup.restore, 'mutation', 'setup');
    state.inputRelease = owner.editor.inputObservations.subscribe(value => {
      try { boundedPush(record.ordinaryInputs, value, contract.budgets.ordinaryInputs, 'ordinary input'); }
      catch (error) { recorder.addError(error); recorder.captureFailure = error; }
    });
    if (typeof state.inputRelease !== 'function') fail('Interaction input subscription refused');
    if (route.kind !== 'selection') {
      const slots = Object.fromEntries(['toolbar', 'gutter', 'entry'].map(name => { const node = document.createElement('div'); wrapper.append(node); return [name, node]; }));
      const ui = createEditorUi({ editor: owner.editor, editorElement: owner.element, slots, locale: 'en', profile: makeProfile(route, record, contract.slashCopy), onResult(result) {
        if (record.uiResults.length >= contract.budgets.uiResults) { recorder.captureFailure = new Error('Interaction UI result bound'); return; }
        const index = record.uiResults.length;
        if (result.status === 'submitted') {
          record.uiResults.push({ status: result.status, action: result.action, submission: null, focus: null });
          state.pendingUi.push((async () => { record.uiResults[index].submission = await serializeSubmission(result.submission, 'interaction'); record.uiResults[index].focus = own(await result.focus); })().catch(error => { recorder.addError(error); recorder.captureFailure = error; }));
        } else boundedPush(record.uiResults, result, contract.budgets.uiResults, 'UI result');
      } });
      if (!ui || typeof ui.resources !== 'function') fail('Interaction UI creation refused');
      owner.ui = ui; record.uiReady = own(await ui.ready); if (record.uiReady.status !== 'ready') fail('Interaction UI not ready');
      state.handle = wrapper.querySelector('[data-editor-ui-control="drag"]');
    }
    owner.record.resourcesBefore = { mounted: own(owner.editor.resources()), ui: owner.ui ? own(owner.ui.resources()) : null };
    await checkpointInternal('prepared');
    return own({ routeId, editorToken: owner.record.elementToken, wrapperId: wrapper.id });
  } catch (error) {
    record.stop = { status: 'failed', phase: 'open', reason: typeof error?.message === 'string' ? error.message : 'Unknown thrown value' };
    recorder.addError(error); throw error;
  }
}
export async function checkpoint(label) {
  if (!['before', 'after', 'undo', 'redo'].includes(label)) fail('Unknown interaction checkpoint');
  return checkpointInternal(label);
}
export async function history(direction) {
  if (!active || !['undo', 'redo'].includes(direction) || active.record.checkpoints.at(-1)?.label !== (direction === 'undo' ? 'after' : 'undo')) fail('Unexpected interaction history order');
  const owner = active.owner, stamp = own(owner.editor.capture());
  requireReply((await call(owner, `query-${direction}`, 'query', { kind: 'query_history', stamp, direction })).result, 'availability', direction);
  requireReply((await call(owner, direction, 'submit', { kind: 'history', stamp, direction })).result, 'mutation', direction);
  return checkpointInternal(direction);
}
export async function finish() {
  if (!active) fail('No current interaction to finish');
  const state = active;
  try {
    await awaitUi(state);
    state.inputRelease?.(); state.inputRelease = null;
    await closeOwner(state.owner);
    if (state.record.checkpoints.length === 5 && state.saved) {
      const fresh = await openOwner({ recorder: state.recorder, module: state.module, options: state.options, input: state.saved, host: state.wrapper, elementToken: `${state.record.runId}:${state.route.routeId}:fresh` });
      state.record.fresh = fresh.record;
      if (fresh.record.ready.status !== 'ready') fail('Interaction fresh owner not ready');
      await checkpointInternal('reopen', fresh); await closeOwner(fresh);
      state.record.stop = { status: 'completed', phase: 'complete', reason: null };
    } else if (state.record.stop.status === 'running') state.record.stop = { status: 'incomplete', phase: state.recorder.phase, reason: 'Original interaction program did not reach Redo' };
  } catch (error) {
    state.recorder.addError(error);
    state.record.stop = { status: 'failed', phase: state.recorder.phase, reason: typeof error?.message === 'string' ? error.message : 'Unknown thrown value' };
  } finally {
    state.inputRelease?.();
    for (const owner of [...state.recorder.owners].reverse()) {
      try { await closeOwner(owner); } catch (error) { state.recorder.addError(error); }
    }
    state.record.original ??= state.recorder.owners[0]?.record ?? null;
    state.record.fresh ??= state.recorder.owners[1]?.record ?? null;
    for (const remove of state.removals) remove();
    state.recorder.dispose(); state.wrapper.remove(); active = null;
  }
  return ownBoundedData(state.record, 4 * 1024 * 1024).value;
}
window.mountedInteractions45 = Object.freeze({ ready, open, checkpoint, history, finish });
