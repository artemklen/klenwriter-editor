// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DeepReadonly, SelectionDto, SessionContextV2, StampDto, Submission } from '@klenwriter/editor-sdk';
import type { ClipboardDecodeOutcome, ClipboardPasteOutcome, ClipboardRecovery, ClipboardRecoveryTransfer, DomCode, DomRefusal } from './types.js';
import type { ClipboardOwnerConfiguration } from './clipboard.js';
import { captureClipboard, type ClipboardCapture } from './clipboard-capture.js';
import { ownConfiguration } from './ownership.js';
import { domRefusal, isDomRefusal } from './refusal.js';

export interface ClipboardTarget {
  readonly stamp: DeepReadonly<StampDto>; readonly context: DeepReadonly<SessionContextV2>;
  readonly selection: DeepReadonly<SelectionDto>; readonly intent: bigint;
}
interface Operation {
  target: ClipboardTarget | null; capture: ClipboardCapture | null; diagnostics: readonly string[];
  cancelled: DomCode | null; deadline: number | null; phase: 'capture' | 'decode' | 'native'; timer: number | null;
  settled: Promise<void>; finish: () => void;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const DEADLINE_MS = 15000;
/** Owns exactly one raw slot: live/retired work OR a retained terminal failure. */
export function attachPaste(options: ClipboardOwnerConfiguration & {
  readonly captureTarget: () => ClipboardTarget | DomRefusal; readonly copyBusy: () => boolean;
}) {
  const win = options.element.ownerDocument.defaultView!;
  let live: Operation | null = null, retained: ClipboardRecovery | null = null, destroyed = false;
  const now = () => (win.performance ?? globalThis.performance).now();
  const failure = (code: DomCode, publication: 'none' | 'unknown' = 'none') => domRefusal(code, 'clipboard', options.capture(), null, null, publication);
  const result = (status: ClipboardPasteOutcome['status'], refusal: ClipboardPasteOutcome['failure'], operation?: Operation,
    submission: Submission | null = null): ClipboardPasteOutcome => Object.freeze({action: 'paste', status, failure: refusal,
      diagnostics: operation?.diagnostics ?? Object.freeze([]), submission,
      recovery: operation?.capture ? operation.phase === 'decode' ? 'pending' : 'retained' : 'none'});
  function retain(operation: Operation, reason: string) {
    if (!operation.capture) return;
    retained = Object.freeze({format: 'clipboard-recovery/1', capture: operation.capture, reason,
      diagnostics: operation.diagnostics, stamp: operation.target?.stamp ?? null, context: operation.target?.context ?? null});
    operation.capture = null;
  }
  function current(operation: Operation): DomRefusal | null {
    if (operation.deadline !== null && now() >= operation.deadline) operation.cancelled ??= 'dom.clipboard_timeout';
    if (destroyed) return failure('dom.disposed');
    if (operation.cancelled) return failure(operation.cancelled);
    const guard = options.guard('paste'); if (guard) return guard;
    const target = operation.target;
    if (!target || target.intent !== options.intent() || !same(target.stamp, options.capture()) || !same(target.context, options.context())) return failure('dom.stale_selection');
    const actual = options.captureTarget();
    return isDomRefusal(actual) || !same(actual.selection, target.selection) ? failure('dom.stale_selection') : null;
  }
  function notify(value: ClipboardPasteOutcome) {
    Object.freeze(value);
    if (!destroyed) {
      if (isDomRefusal(value.failure)) { try { options.report(value.failure); } catch { /* Receipt is final. */ } }
      try { options.onPasteResult?.(value); } catch { /* Host observation cannot alter publication. */ }
    }
    return value;
  }
  async function decodeAndInsert(operation: Operation, input: Parameters<NonNullable<typeof options.codec>['decode']>[0]): Promise<ClipboardPasteOutcome> {
    let submission: Submission | null = null;
    try {
      const decoded: ClipboardDecodeOutcome = ownConfiguration(await options.codec!.decode(input));
      if (!decoded || !Array.isArray(decoded.diagnostics) || decoded.diagnostics.length > 32
        || decoded.diagnostics.some(v => typeof v !== 'string' || v.length > 256)) throw new TypeError();
      if (operation.timer !== null) win.clearTimeout(operation.timer);
      operation.timer = null;
      operation.diagnostics = decoded.diagnostics;
      operation.phase = 'capture'; // Decoder has actually returned, rather than merely timed out.
      const stale = current(operation);
      if (stale) { retain(operation, stale.diagnostic.code); return {...result('refused', stale, operation), recovery: 'retained'}; }
      if (decoded.status !== 'candidate') { retain(operation, 'decode_refused'); return {...result('refused', failure('dom.clipboard_decode_failed'), operation), recovery: 'retained'}; }
      // Native query uses this exact candidate and original stamp. No recapture or retry.
      const query = options.query({kind: 'query_command', stamp: operation.target!.stamp as StampDto, command: decoded.command});
      if (isDomRefusal(query) || query.status !== 'ok' || query.value.kind !== 'availability' || !query.value.available) {
        retain(operation, 'admission_refused');
        return {...result('refused', isDomRefusal(query) ? query : {status: 'native_unavailable', response: query}, operation), recovery: 'retained'};
      }
      const beforeCommit = current(operation);
      if (beforeCommit) { retain(operation, beforeCommit.diagnostic.code); return {...result('refused', beforeCommit, operation), recovery: 'retained'}; }
      operation.phase = 'native';
      const submitted = options.submit({kind: 'command', stamp: operation.target!.stamp as StampDto, command: decoded.command, history_hint: {kind: 'isolated'}}, () => current(operation));
      if (isDomRefusal(submitted)) { retain(operation, submitted.diagnostic.code); return {...result('refused', submitted, operation), recovery: 'retained'}; }
      submission = submitted;
      const response = submitted.status === 'completed' ? submitted.response : await submitted.completion;
      if (response.status === 'ok' && response.value.kind === 'mutation') {
        operation.capture = null;
        return result(response.value.effect === 'changed' ? 'inserted' : 'empty', null, operation, submitted);
      }
      retain(operation, response.status === 'fatal' ? 'native_indeterminate' : 'native_refused');
      return {...result(response.status === 'fatal' ? 'indeterminate' : 'refused', {status: 'sdk_failure', response}, operation, submitted), recovery: 'retained'};
    } catch {
      const unknown = operation.phase === 'native';
      operation.phase = 'capture';
      retain(operation, unknown ? 'native_indeterminate' : 'decode_failed');
      return {...result(unknown ? 'indeterminate' : 'refused', failure(unknown ? 'dom.recovery_required' : 'dom.clipboard_decode_failed', unknown ? 'unknown' : 'none'), operation, submission), recovery: retained ? 'retained' : 'none'};
    } finally {
      if (operation.timer !== null) win.clearTimeout(operation.timer);
      operation.timer = null; operation.target = null;
      if (live === operation) live = null;
      operation.finish();
    }
  }
  function paste(source: unknown): Promise<ClipboardPasteOutcome> {
    if (destroyed) return Promise.resolve(result('refused', failure('dom.disposed')));
    if (retained) return Promise.resolve(notify(result('refused', failure('dom.clipboard_recovery_pending'))));
    if (live || options.copyBusy()) return Promise.resolve(notify(result('refused', failure('dom.busy'))));
    const guard = options.guard('paste'); if (guard) return Promise.resolve(notify(result('refused', guard)));
    const target = options.captureTarget(); if (isDomRefusal(target)) return Promise.resolve(notify(result('refused', target)));
    let finish!: () => void;
    const operation: Operation = {target, capture: null, diagnostics: Object.freeze([]), cancelled: null, deadline: null, phase: 'capture', timer: null,
      settled: new Promise<void>(resolve => { finish = resolve; }), finish: () => finish()};
    live = operation;
    // Sole DataTransfer access. This completes synchronously before any await/import/callback.
    operation.capture = captureClipboard(source);
    const refuse = (code: DomCode, reason: string) => {
      retain(operation, reason); operation.target = null; live = null; operation.finish();
      return Promise.resolve(notify(Object.freeze({...result('refused', failure(code), operation), recovery: 'retained' as const})));
    };
    if (operation.capture.status !== 'captured') return refuse('dom.clipboard_decode_failed', operation.capture.reason ?? 'capture_refused');
    const codec = options.codec;
    if (!codec) return refuse('dom.command_unsupported', 'codec_unavailable');
    try {
    const context = options.read({kind: 'clipboard_context', stamp: target.stamp as StampDto});
    if (isDomRefusal(context) || context.status !== 'ok' || context.value.kind !== 'clipboard_context'
      || context.value.format_id !== codec.contextFormat || !same(context.value.stamp, target.stamp) || !same(context.value.selection, target.selection)) {
      return refuse('dom.command_unsupported', 'context_refused');
    }
    const stale = current(operation); if (stale) return refuse(stale.diagnostic.code, 'target_changed_during_capture');
    const input = Object.freeze({capture: operation.capture, nativeContext: Object.freeze({formatId: context.value.format_id, json: context.value.context_json}), sessionContext: target.context});
    operation.phase = 'decode'; operation.deadline = now() + DEADLINE_MS;
    // A deadline retires work. It never pretends to interrupt a synchronous parser or releases its raw slot.
    const timeout = new Promise<ClipboardPasteOutcome>(resolve => {
      operation.timer = win.setTimeout(() => { operation.cancelled ??= 'dom.clipboard_timeout'; operation.timer = null;
        resolve(result('refused', failure(operation.cancelled), operation)); }, DEADLINE_MS);
    });
    return Promise.race([decodeAndInsert(operation, input), timeout]).then(notify);
    } catch { return refuse('dom.clipboard_decode_failed', 'preflight_failed'); }
  }
  function cancel(code: DomCode) { if (live) live.cancelled ??= code; }
  function takeRecovery(): ClipboardRecovery | null { const value = retained; retained = null; return value; }
  function transfer(): ClipboardRecoveryTransfer {
    if (live) return Object.freeze({status: 'pending', completion: live.settled.then(takeRecovery)});
    return Object.freeze({status: 'transferred', recovery: takeRecovery()});
  }
  return {paste, cancel, takeRecovery, releaseRecovery: () => takeRecovery() !== null, transfer,
    busy: () => live !== null,
    destroy() { destroyed = true; cancel('dom.disposed'); },
    resources: () => Object.freeze({pending: live ? 1 : 0, continuations: live ? 1 : 0,
      retainedUtf16Units: live?.capture?.retainedUtf16Units ?? retained?.capture.retainedUtf16Units ?? 0,
      retainedRecoveries: retained ? 1 : 0, retiredParsers: live?.phase === 'decode' && live.cancelled ? 1 : 0})};
}
