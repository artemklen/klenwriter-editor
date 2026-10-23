// SPDX-License-Identifier: MIT OR Apache-2.0
// Minimal controlled view for the actual CompositionOwner event-retention guard.
// This never dispatches native input or claims installed/browser behavior.
import { CompositionOwner } from '../../packages/dom/dist/composition.js';

export function compositionEventFixture() {
  const stamp = { session: 's1:1:1', generation: '1', revision: '0', selection_epoch: '1', history_epoch: '0' };
  const point = { kind: 'text', node: 'n1:1:1:3', offset: 1, affinity: 'after' };
  const selectionValue = { anchor: point, focus: { ...point, offset: 3 } };
  const state = { stamp, selection: selectionValue };
  const context = { build_id: 'controlled-resource-fixture', profile: {}, registry_digest: 'registry', capability_digest: 'capabilities' };
  const recoveries = [];
  let text = 'abcd', serial = 0n, intentObserver = null, submissions = 0;
  const element = { ownerDocument: { defaultView: { performance: { now: () => 0 } } } };
  const region = () => Object.freeze({ kind: 'bounded', stamp, originalText: 'abcd', provisionalText: text, affectedNodeIds: ['n1:1:1:2'] });
  const selection = {
    intent: () => serial, intentAvailable: () => true, ownsFocus: () => true,
    syncFromDom: () => selectionValue, cancel() {},
    invalidate(_clear = false, event = null) { const before = serial; serial++; intentObserver?.(before, serial, event); },
    observeInputIntent(observer) { intentObserver = observer; return () => { intentObserver = null; }; },
  };
  const view = {
    beginComposition: () => ({ originalRegion: region(), affectedNodeIds: ['n1:1:1:2'] }),
    observeComposition: () => ({ region: region(), unchanged: text === 'abcd', replacement: text.slice(1, -1), fingerprint: `literal:${text}` }),
    captureComposition: region, captureRegion: region, setComposing() {}, endProvisional() {},
  };
  const owner = new CompositionOwner({
    element, view, selection, capture: () => stamp, context: () => context, readState: () => state,
    canEdit: () => true, busy: () => false, consumeRecords: () => 0, composing() {}, report() {},
    recover(failure, captured, composition) { recoveries.push({ failure, region: captured, composition }); },
    bindings: { insertText() { throw new Error('Event-retention control must not construct a command'); } },
    submit() { submissions++; throw new Error('Event-retention control must not submit native work'); },
    ordinary() { throw new Error('Event-retention control must not delegate ordinary input'); },
  });
  owner.start({ type: 'compositionstart', data: '' });
  text = 'aQd';
  return {
    owner, recoveries, submissions: () => submissions, intentObserverCount: () => Number(intentObserver !== null),
    event(length) { return { type: 'keydown', key: '', code: 'x'.repeat(length), cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; },
  };
}
