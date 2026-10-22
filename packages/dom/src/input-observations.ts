// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DeepReadonly, InputSubmissionV2, ResponseV2, SessionContextV2, StampDto, StateDto } from '@klenwriter/editor-sdk';
import type { DomRefusal, MountedInputObservations, MountedMutationV2, OrdinaryInputObservation, OrdinaryInputType } from './types.js';
import { domRefusal } from './refusal.js';

interface Configuration {
  guard(): DomRefusal | null;
  capture(): DeepReadonly<StampDto> | null;
  context(): DeepReadonly<SessionContextV2> | null;
  state(): DeepReadonly<StateDto> | null;
  corresponds(state:DeepReadonly<StateDto>):boolean;
  window(stamp: DeepReadonly<StampDto>): ResponseV2;
}
export interface OrdinaryInputCapture {
  readonly epoch: object;
  readonly event: OrdinaryInputObservation;
}
type Observer = { callback: ((event: OrdinaryInputObservation) => void) | null };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const TYPES = new Set<OrdinaryInputType>(['insertText','insertReplacementText','insertParagraph','insertLineBreak',
  'deleteContentBackward','deleteContentForward','historyUndo','historyRedo']);

/** Private InputOwner provenance. SDK publication is deliberately not an input source. */
export class InputObservationOwner {
  readonly api: MountedInputObservations;
  #configuration: Configuration | null;
  #observers = new Set<Observer>();
  #epoch: object = {};
  #delivery = false;
  #expected: MountedMutationV2 | null = null;
  #claimed = false;
  constructor(configuration: Configuration) {
    this.#configuration = configuration;
    this.api = Object.freeze({ subscribe: (observer: (event: OrdinaryInputObservation) => void) => this.subscribe(observer) });
  }
  resources(): Readonly<{ subscribers: number }> { return Object.freeze({ subscribers: this.#observers.size }); }
  delivering(): boolean { return this.#delivery; }
  invalidate(): void { this.#epoch = {}; }
  #failure(code: DomRefusal['diagnostic']['code']): DomRefusal {
    return domRefusal(code,'command',this.#configuration?.capture() ?? null);
  }
  subscribe(callback: (event: OrdinaryInputObservation) => void): (() => void) | DomRefusal {
    const c = this.#configuration;
    if (!c) return this.#failure('dom.disposed');
    const guard = c.guard(); if (guard) return guard;
    if (typeof callback !== 'function') return this.#failure('dom.invalid_options');
    if (this.#observers.size === 32) return this.#failure('dom.busy');
    const entry: Observer = { callback }; this.#observers.add(entry);
    return () => { entry.callback = null; this.#observers.delete(entry); };
  }
  before(input: InputEvent): OrdinaryInputCapture | null {
    const c = this.#configuration;
    if (!c || !this.#observers.size || this.#delivery || !TYPES.has(input.inputType as OrdinaryInputType) || c.guard()) return null;
    const epoch = this.#epoch, state = c.state(), context = c.context();
    if (!state || !context || this.#configuration !== c || epoch !== this.#epoch || c.guard() || !same(state.stamp,c.capture()) || !c.corresponds(state)) return null;
    // This is an actual bounded native read, before either command factory call.
    const response = c.window(state.stamp);
    if (this.#configuration !== c || epoch !== this.#epoch || c.guard() || !same(state.stamp,c.capture()) || !same(context,c.context())) return null;
    const beforeWindow = response.status === 'ok' && response.value.kind === 'text_window'
      && same(response.value.stamp,state.stamp) && same(response.value.selection,state.selection) ? response.value : null;
    return { epoch, event: Object.freeze({ kind:'ordinary_input',inputType:input.inputType as OrdinaryInputType,
      isTrusted:input.isTrusted,dataHint:typeof input.data === 'string' && input.data.length <= 256 ? input.data : null,
      before:state.stamp,after:state.stamp,context,selectionBefore:state.selection,selectionAfter:state.selection,beforeWindow }) };
  }
  /** Only this exact private request can be the original observation's dispatch. */
  submission<T>(capture: OrdinaryInputCapture | null, request: MountedMutationV2, dispatch: () => T): T {
    const previous = this.#expected, claimed = this.#claimed;
    this.#expected = capture?.epoch === this.#epoch ? request : null; this.#claimed = false;
    try { return dispatch(); }
    finally { this.#expected = previous; this.#claimed = claimed; }
  }
  forward(request: MountedMutationV2): void {
    if (this.#expected === request && !this.#claimed) this.#claimed = true;
    else this.invalidate(); // Includes same-stamp/no-op and refused reentrant attempts.
  }
  after(capture: OrdinaryInputCapture | null, result: InputSubmissionV2 | DomRefusal): void {
    const c = this.#configuration;
    if (!capture || !c || this.#delivery || capture.epoch !== this.#epoch || result.status !== 'completed'
      || result.response.status !== 'ok' || result.response.value.kind !== 'mutation'&&result.response.value.kind!=='input_mutation' || result.response.value.effect !== 'changed') return;
    const state = result.response.value.state;
    const fresh = () => this.#configuration === c && capture.epoch === this.#epoch && !c.guard()
      && same(capture.event.context,c.context()) && same(state.stamp,c.capture()) && c.corresponds(state);
    if (!fresh()) return;
    const event: OrdinaryInputObservation = Object.freeze({ ...capture.event,after:state.stamp,selectionAfter:state.selection });
    const snapshot = [...this.#observers]; this.#delivery = true;
    try {
      for (const entry of snapshot) {
        if (!fresh()) break;
        if (!this.#observers.has(entry) || !entry.callback) continue;
        try { entry.callback(event); } catch { /* Observer errors never alter/replay native completion. */ }
      }
    } finally { this.#delivery = false; }
  }
  destroy(): void {
    this.invalidate(); this.#configuration = null; this.#expected = null;
    for (const entry of this.#observers) entry.callback = null;
    this.#observers.clear();
  }
}
