// SPDX-License-Identifier: MIT OR Apache-2.0
import type { CommandDto, DeepReadonly, QueryRequest, ReadRequestV2, Response, ResponseV2, SelectionDto, SessionContextV2, StampDto, StateDto, Submission } from '@klenwriter/editor-sdk';
import type { ClipboardConfiguration, ClipboardFailure, ClipboardOutcome, ClipboardResourceCounts, DomCode, DomRefusal, InputCommandBindings, MountedClipboardController, MountedMutation } from './types.js';
import type { DomView } from './view.js';
import { domRefusal, isDomRefusal } from './refusal.js';
import { ownConfiguration } from './ownership.js';
import { attachPaste, type ClipboardTarget } from './clipboard-paste.js';
import type { ClipboardRecoveryTransfer, ClipboardPayload } from './types.js';

export interface ClipboardOwner extends MountedClipboardController {
  cancel(code: DomCode): void;
  destroy(): void;
  resources(): ClipboardResourceCounts;
  listeners(): number;
  transferRecovery(): ClipboardRecoveryTransfer;
}
export interface ClipboardOwnerConfiguration extends ClipboardConfiguration {
  readonly element: HTMLElement;
  readonly view: DomView;
  readonly bindings: InputCommandBindings;
  readonly capture: () => DeepReadonly<StampDto> | null;
  readonly context: () => DeepReadonly<SessionContextV2> | null;
  readonly readState: () => DeepReadonly<StateDto> | null;
  readonly read: (request: ReadRequestV2) => ResponseV2 | DomRefusal;
  readonly query: (request: QueryRequest) => Response | DomRefusal;
  readonly submit: (request: MountedMutation, validate?: () => DomRefusal | null) => Submission | DomRefusal;
  readonly intent: () => bigint;
  /** Pure preflight: lifecycle, interaction/access, busy and provisional input. */
  readonly guard: (action: 'copy' | 'cut' | 'paste') => DomRefusal | null;
  readonly report: (failure: DomRefusal) => unknown;
}
interface Target extends ClipboardTarget {
  readonly stamp: DeepReadonly<StampDto>;
  readonly context: DeepReadonly<SessionContextV2>;
  readonly selection: DeepReadonly<SelectionDto>;
  readonly intent: bigint;
}
type WriteSettlement = { readonly kind: 'confirmed' | 'rejected' | 'timeout' }
  | { readonly kind: 'cancelled'; readonly code: DomCode };
interface Operation {
  readonly action: 'copy' | 'cut';
  phase: 'preflight' | 'write' | 'native';
  target: Target | null;
  text: string | null;
  bytes: number;
  html: string | null;
  timer: number | null;
  cancelReason: DomCode | null;
  settleWrite: ((settlement: WriteSettlement) => void) | null;
}
const MAX_TEXT_BYTES = 1024 * 1024;
const WRITE_DEADLINE_MS = 15000;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Platform completion and native target fencing; range/projection semantics stay native. */
export function attachClipboard(options: ClipboardOwnerConfiguration): ClipboardOwner {
  const { element, view } = options, doc = element.ownerDocument, win = doc.defaultView!;
  const removals: (() => void)[] = [];
  let pending: Operation | null = null, destroyed = false;
  const failure = (code: DomCode, publication: 'none' | 'alreadyPublished' | 'unknown' = 'none') =>
    domRefusal(code, 'clipboard', options.capture(), null, null, publication);
  function outcome(action: Operation['action'], status: ClipboardOutcome['status'], clipboard: ClipboardOutcome['clipboard'],
    refusal: ClipboardFailure | null = null, submission: Submission | null = null): ClipboardOutcome {
    return Object.freeze({ action, status, clipboard, failure: refusal, submission });
  }
  function release(operation: Operation) {
    if (operation.timer !== null) win.clearTimeout(operation.timer);
    operation.timer = null; operation.settleWrite = null;
    operation.text = null; operation.html = null; operation.bytes = 0; operation.target = null;
    if (pending === operation) pending = null;
  }
  function notify(result: ClipboardOutcome): ClipboardOutcome {
    if (destroyed) return result;
    if (isDomRefusal(result.failure)) { try { options.report(result.failure); } catch { /* Reporting cannot change effects. */ } }
    if (!destroyed) { try { options.onResult?.(result); } catch { /* Host callback failure cannot rewrite the receipt. */ } }
    return result;
  }
  function ownsActiveRange(): boolean {
    const active = doc.activeElement, selection = doc.getSelection();
    return element.isConnected && doc.hasFocus() && !!active && (active === element || element.contains(active))
      && !!selection?.anchorNode && !!selection.focusNode
      && element.contains(selection.anchorNode) && element.contains(selection.focusNode);
  }
  function captureTarget(): Target | DomRefusal {
    if (!ownsActiveRange()) return failure('dom.selection_unsynchronized');
    const state = options.readState(), context = options.context();
    if (!state || !context) return failure('dom.not_ready');
    if (!state.selection) return failure('dom.selection_missing');
    const actual = view.readSelection();
    if (isDomRefusal(actual)) return domRefusal(actual.diagnostic.code, 'clipboard', state.stamp);
    if (!actual || !same(actual, state.selection)) return failure('dom.selection_unsynchronized');
    return { stamp: state.stamp, context, selection: state.selection, intent: options.intent() };
  }
  function current(operation: Operation): DomRefusal | null {
    if (destroyed) return failure('dom.disposed');
    if (operation.cancelReason) return failure(operation.cancelReason);
    const guard = options.guard(operation.action);
    if (guard) return guard;
    const target = operation.target;
    if (!target || options.intent() !== target.intent || !same(options.capture(), target.stamp)
      || !same(options.context(), target.context)) return failure('dom.stale_selection');
    const owned = captureTarget();
    if (isDomRefusal(owned)) return failure('dom.stale_selection');
    return same(owned.selection, target.selection) ? null : failure('dom.stale_selection');
  }
  function writer(rich: boolean): ((payload: ClipboardPayload) => Promise<void>) | null {
    if (options.write) return options.write;
    if (!rich && options.writeText) return payload => options.writeText!(payload.text);
    try {
      const clipboard = win.navigator.clipboard;
      if (rich) return clipboard && typeof clipboard.write === 'function' && typeof win.ClipboardItem === 'function'
        ? payload => clipboard.write([new win.ClipboardItem({'text/plain': new win.Blob([payload.text], {type: 'text/plain'}), 'text/html': new win.Blob([payload.html!], {type: 'text/html'})})]) : null;
      return clipboard && typeof clipboard.writeText === 'function' ? payload => clipboard.writeText(payload.text) : null;
    } catch { return null; }
  }
  function waitForWrite(operation: Operation, write: Promise<void>): Promise<WriteSettlement> {
    return new Promise(resolve => {
      let settled = false;
      const finish = (result: WriteSettlement) => { if (!settled) { settled = true; resolve(result); } };
      operation.settleWrite = finish;
      operation.timer = win.setTimeout(() => finish({ kind: 'timeout' }), WRITE_DEADLINE_MS);
      // Both terminal handlers are installed even if cancellation wins. A late
      // external write cannot replay a cut, emit callbacks or reject unhandled.
      void Promise.resolve(write).then(() => finish({ kind: 'confirmed' }), () => finish({ kind: 'rejected' }));
      if (operation.cancelReason) finish({ kind: 'cancelled', code: operation.cancelReason });
    });
  }
  async function run(action: Operation['action'], event?: ClipboardEvent): Promise<ClipboardOutcome> {
    if (destroyed) return outcome(action, 'refused', 'not_attempted', failure('dom.disposed'));
    if (pending || pasteOwner.busy()) return outcome(action, 'refused', 'not_attempted', failure('dom.busy'));
    const operation: Operation = { action, phase: 'preflight', target: null, text: null, bytes: 0,
      timer: null, cancelReason: null, settleWrite: null, html: null };
    pending = operation;
    let result: ClipboardOutcome, clipboard: ClipboardOutcome['clipboard'] = 'not_attempted';
    let command: CommandDto | null = null, submission: Submission | null = null;
    try {
      const guard = options.guard(action);
      if (guard) return outcome(action, 'refused', clipboard, guard);
      const target = captureTarget();
      if (isDomRefusal(target)) return outcome(action, 'refused', clipboard, target);
      operation.target = target;
      {
        const projection = options.read({ kind: 'selection_text', stamp: target.stamp as StampDto, max_bytes: MAX_TEXT_BYTES });
        if (isDomRefusal(projection)) return outcome(action, 'refused', clipboard, projection);
        if (projection.status !== 'ok') return outcome(action, 'refused', clipboard, { status: 'sdk_failure', response: projection });
        if (projection.value.kind !== 'selection_text' || !same(projection.value.stamp, target.stamp)
          || !same(projection.value.selection, target.selection)) return outcome(action, 'refused', clipboard, failure('dom.presentation_unsupported'));
        if (projection.value.empty) return outcome(action, 'empty', clipboard);
        operation.text = projection.value.text;
        operation.bytes = new TextEncoder().encode(operation.text).byteLength;
        if (operation.bytes > MAX_TEXT_BYTES) return outcome(action, 'refused', clipboard, failure('dom.selection_limit'));
      }
      if (options.codec?.encode) {
        const projection = options.read({kind: 'selection_fragment', stamp: target.stamp as StampDto, max_bytes: 2 * MAX_TEXT_BYTES});
        if (isDomRefusal(projection) || projection.status !== 'ok' || projection.value.kind !== 'selection_fragment'
          || projection.value.format_id !== options.codec.fragmentFormat || !same(projection.value.stamp, target.stamp)
          || !same(projection.value.selection, target.selection)) return outcome(action, 'refused', clipboard, failure('dom.command_unsupported'));
        const encoded = options.codec.encode(Object.freeze({fragment: Object.freeze({formatId: projection.value.format_id, json: projection.value.fragment_json}), text: operation.text!, sessionContext: target.context}));
        if (encoded.status !== 'encoded' || typeof encoded.html !== 'string' || encoded.html.length > 2 * MAX_TEXT_BYTES) return outcome(action, 'refused', clipboard, failure('dom.presentation_unsupported'));
        operation.html = encoded.html;
        operation.bytes += new TextEncoder().encode(encoded.html).byteLength;
        if (operation.bytes > 4 * MAX_TEXT_BYTES) return outcome(action, 'refused', clipboard, failure('dom.selection_limit'));
      }
      if (action === 'cut') {
        try { command = options.bindings.deleteSelection ? ownConfiguration(options.bindings.deleteSelection()) : null; } catch { command = null; }
        if (!command) return outcome(action, 'refused', clipboard, failure('dom.command_unsupported'));
        const query = options.query({ kind: 'query_command', stamp: target.stamp as StampDto, command });
        if (isDomRefusal(query)) return outcome(action, 'refused', clipboard, query);
        if (query.status !== 'ok' || query.value.kind !== 'availability' || !query.value.available || query.value.effect !== 'changed') {
          return outcome(action, 'refused', clipboard, { status: 'native_unavailable', response: query });
        }
      }
      const beforeWrite = current(operation);
      if (beforeWrite) return outcome(action, 'refused', clipboard, beforeWrite);
      const writeText = writer(operation.html !== null);
      if (!writeText) return outcome(action, 'refused', clipboard, failure('dom.clipboard_unavailable'));
      // Rich copy/cut has one confirmed writer; event payload data can trigger
      // a second native pasteboard write after the cancelled handler returns.
      // Preserve the legacy plain event payload; it is never an OS write receipt.
      if (operation.html === null && event?.clipboardData) { try { event.clipboardData.setData('text/plain', operation.text!); } catch { /* Platform writer still decides completion. */ } }
      operation.phase = 'write'; clipboard = 'unconfirmed';
      let write: Promise<void>;
      try {
        write = writeText(Object.freeze({text: operation.text!, ...(operation.html === null ? {} : {html: operation.html})}));
        if (!write || typeof write.then !== 'function') throw new TypeError('clipboard writer did not return a promise');
      } catch { return outcome(action, 'write_failed', clipboard, failure('dom.clipboard_write_failed')); }
      const completion = await waitForWrite(operation, write);
      if (operation.timer !== null) win.clearTimeout(operation.timer);
      operation.timer = null; operation.settleWrite = null; operation.text = null; operation.html = null; operation.bytes = 0;
      if (completion.kind !== 'confirmed') {
        const code = completion.kind === 'cancelled' ? completion.code : completion.kind === 'timeout' ? 'dom.clipboard_timeout' : 'dom.clipboard_write_failed';
        return outcome(action, 'write_failed', clipboard, failure(code));
      }
      clipboard = 'confirmed';
      if (action === 'copy') return outcome(action, 'copied', clipboard);
      const beforeDelete = current(operation);
      if (beforeDelete) return outcome(action, 'copied_but_not_cut', clipboard, beforeDelete);
      operation.phase = 'native';
      // No await/callback between final target check and this one native call.
      const submitted = options.submit({ kind: 'command', stamp: target.stamp as StampDto, command: command!, history_hint: { kind: 'isolated' } }, () => current(operation));
      if (isDomRefusal(submitted)) return outcome(action, 'copied_but_not_cut', clipboard, submitted);
      submission = submitted;
      const response = submitted.status === 'completed' ? submitted.response : await submitted.completion;
      if (response.status === 'fatal') result = outcome(action, 'indeterminate', clipboard, { status: 'sdk_failure', response }, submitted);
      else if (response.status === 'ok' && response.value.kind === 'mutation' && response.value.effect === 'changed') result = outcome(action, 'cut', clipboard, null, submitted);
      else result = outcome(action, 'copied_but_not_cut', clipboard, { status: 'native_unavailable', response }, submitted);
      return result;
    } catch {
      // An unexpected exception after entering native dispatch cannot prove the
      // model unchanged. Preserve the original ticket whenever one was returned.
      result = outcome(action, operation.phase === 'native' ? 'indeterminate' : clipboard === 'confirmed' ? 'copied_but_not_cut' : clipboard === 'unconfirmed' ? 'write_failed' : 'refused',
        clipboard, failure('dom.recovery_required', operation.phase === 'native' ? 'unknown' : 'none'), submission);
      return result;
    } finally { release(operation); }
  }
  async function perform(action: Operation['action'], event?: ClipboardEvent): Promise<ClipboardOutcome> {
    return notify(await run(action, event));
  }
  const pasteOwner = attachPaste({...options, captureTarget, copyBusy: () => pending !== null});
  function cancel(code: DomCode) {
    pasteOwner.cancel(code);
    const operation = pending;
    if (!operation) return;
    operation.cancelReason = code; operation.text = null; operation.html = null; operation.bytes = 0; operation.target = null;
    if (operation.phase === 'write') operation.settleWrite?.({ kind: 'cancelled', code });
    // A native queued command is not revocable. Its actual completion is kept.
  }
  for (const action of ['copy', 'cut'] as const) {
    const listener = (event: Event) => {
      if (destroyed || !event.target || !(event.target === element || element.contains(event.target as Node))) return;
      // Never delegate an unowned event back to browser-native cut/deletion.
      event.preventDefault(); void perform(action, event as ClipboardEvent);
    };
    element.addEventListener(action, listener);
    removals.push(() => element.removeEventListener(action, listener));
  }
  const pasteListener = (event: Event) => {
    if (destroyed || !event.target || !(event.target === element || element.contains(event.target as Node))) return;
    event.preventDefault(); void pasteOwner.paste((event as ClipboardEvent).clipboardData);
  };
  element.addEventListener('paste', pasteListener);
  removals.push(() => element.removeEventListener('paste', pasteListener));
  return {
    paste: pasteOwner.paste, takeRecovery: pasteOwner.takeRecovery, releaseRecovery: pasteOwner.releaseRecovery, transferRecovery: pasteOwner.transfer,
    copy: () => perform('copy'), cut: () => perform('cut'), cancel,
    destroy() { if (destroyed) return; destroyed = true; cancel('dom.disposed'); pasteOwner.destroy(); for (const remove of removals.splice(0)) remove(); if (pending?.phase !== 'native') { pending = null; } },
    resources: () => { const paste = pasteOwner.resources(); return Object.freeze({...(options.codec || paste.pending || paste.retainedRecoveries ? {retainedUtf16Units:paste.retainedUtf16Units,retainedRecoveries:paste.retainedRecoveries,retiredParsers:paste.retiredParsers} : {}), pending: (pending ? 1 : 0) + paste.pending,
      continuations: (pending?.phase === 'write' || pending?.phase === 'native' ? 1 : 0) + paste.continuations,
      retainedTextBytes: pending?.bytes ?? 0}); },
    listeners: () => removals.length,
  };
}
