// SPDX-License-Identifier: MIT OR Apache-2.0
import { createEditor } from '@klenwriter/editor-sdk';
import type { CreateEditorOptionsV2, DeepReadonly, EditorControllerV2, EventDto, HostRequest, MutationRequestV2, QueryRequest, ReadRequest, Response, SessionContextV2, StampDto, StateDto, Submission } from '@klenwriter/editor-sdk';
import { admitCatalog, isRendererCatalog } from './catalog.js';
import { domRefusal } from './refusal.js';
import { fields, ownConfiguration, ownInput } from './ownership.js';
import { createDomView } from './view.js';
import type { DomView } from './view.js';
import { attachInput } from './input.js';
import type { InputOwner } from './input.js';
import type { DestroyReceipt, DomDiagnostic, DomRefusal, InteractionMode, MountedEditor, MountedLifecycle, MountedMutation, MountedReady, MountedResourceCounts, MountEditorOptions, RecoveryPacket, RecoveryRegion, RendererCatalog } from './types.js';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isFailure = (value: unknown): value is DomRefusal => !!value && (value as DomRefusal).status === 'dom_refused';
const emptyDestroyed = (): Submission => Object.freeze({ status: 'completed', response: { status: 'ok' as const, value: { kind: 'destroyed' as const } } });
const mountedHosts = new WeakSet<HTMLElement>();
const MODES = new Set<InteractionMode>(['editable', 'readOnly', 'disabled']);

/** Owns one view around the existing SDK; the SDK retains the sole mutation pump. */
class MountedOwner implements MountedEditor {
  readonly ready: Promise<MountedReady>;
  #resolve!: (value: MountedReady) => void;
  #settled = false;
  #lifecycle: MountedLifecycle = 'loading';
  #element: HTMLElement | null = null;
  #controller: EditorControllerV2 | null = null;
  #configuration: CreateEditorOptionsV2 | null = null;
  #catalog: RendererCatalog | null = null;
  #context: DeepReadonly<SessionContextV2> | null = null;
  #view: DomView | null = null;
  #input: InputOwner | null = null;
  #observer: MutationObserver | null = null;
  #unsubscribe: (() => void) | null = null;
  #mode: InteractionMode = 'editable';
  #access: 'editable' | 'read_only' = 'editable';
  #original: Uint8Array | null = null;
  #replacementInput: Uint8Array | null = null;
  #recovery: RecoveryRegion | null = null;
  #temporary: EditorControllerV2 | null = null;
  #replacement = false;
  #request: HostRequest | null = null;
  #forwarding = 0;
  #delivery = 0;
  #composing = false;
  #records = 0;
  #receipt: DestroyReceipt | null = null;
  #onRecovery: MountEditorOptions['onRecovery'];
  #onRefusal: MountEditorOptions['onRefusal'];
  #attributes = new Map<string, string | null>();
  #hadClass = false;
  constructor(configuration: MountEditorOptions) {
    this.ready = new Promise(resolve => { this.#resolve = resolve; });
    try {
      const options = fields(configuration);
      if (Object.keys(options).some(key => !['element','editor','renderers','mode','onRecovery','onRefusal'].includes(key))) throw new TypeError();
      const element = options.element as HTMLElement;
      if (!element?.ownerDocument?.defaultView || !(element instanceof element.ownerDocument.defaultView.HTMLElement) || element.childNodes.length !== 0 || mountedHosts.has(element)) throw new TypeError();
      if (!isRendererCatalog(options.renderers)) throw new TypeError();
      const editor = fields(options.editor);
      if (Object.keys(editor).some(key => !['input','options','loader','limits','onCallbackError'].includes(key))) throw new TypeError();
      this.#original = ownInput(editor.input as Uint8Array);
      const nativeOptions = ownConfiguration(editor.options as CreateEditorOptionsV2['options']);
      if (nativeOptions.abi !== 'editor-sdk/2') throw new TypeError();
      if (editor.loader !== undefined && typeof editor.loader !== 'function' || editor.onCallbackError !== undefined && typeof editor.onCallbackError !== 'function') throw new TypeError();
      for (const callback of ['onRecovery','onRefusal']) if (options[callback] !== undefined && typeof options[callback] !== 'function') throw new TypeError();
      this.#onRecovery = options.onRecovery as MountEditorOptions['onRecovery'];
      this.#onRefusal = options.onRefusal as MountEditorOptions['onRefusal'];
      this.#configuration = { input: this.#original, options: nativeOptions,
        ...(editor.loader ? { loader: editor.loader as CreateEditorOptionsV2['loader'] } : {}),
        ...(editor.limits ? { limits: ownConfiguration(editor.limits as CreateEditorOptionsV2['limits']) } : {}),
        ...(editor.onCallbackError ? { onCallbackError: editor.onCallbackError as CreateEditorOptionsV2['onCallbackError'] } : {}) };
      this.#access = nativeOptions.access;
      this.#mode = options.mode as InteractionMode ?? (this.#access === 'read_only' ? 'readOnly' : 'editable');
      if (!MODES.has(this.#mode) || this.#access === 'read_only' && this.#mode === 'editable') throw new TypeError();
      this.#catalog = options.renderers as RendererCatalog;
      this.#element = element; mountedHosts.add(element);
      for (const name of ['contenteditable','tabindex','role','aria-readonly','aria-disabled']) this.#attributes.set(name, element.getAttribute(name));
      this.#hadClass = element.classList.contains('editor-surface');
      element.classList.add('editor-surface'); element.setAttribute('contenteditable','false');
      element.setAttribute('role','textbox');
      this.#controller = createEditor(this.#configuration);
      void this.#initialize();
    } catch {
      this.#lifecycle = 'recoveryRequired';
      const failure = domRefusal('dom.invalid_options','mount');
      this.#settle({ ...failure, response: null, recovery: this.#packet() });
    }
  }
  get lifecycle(): MountedLifecycle { return this.#lifecycle; }
  capture() { return this.#lifecycle === 'ready' ? this.#controller?.capture() ?? null : null; }
  context() { return this.#lifecycle === 'ready' ? this.#controller?.context() ?? null : null; }
  originalInput(): Uint8Array | null { return (this.#original ?? this.#replacementInput)?.slice() ?? null; }
  #settle(value: MountedReady) { if (!this.#settled) { this.#settled = true; this.#resolve(value); } }
  #failure(code: DomDiagnostic['code'], phase: DomDiagnostic['phase'] = 'command'): DomRefusal { return domRefusal(code, phase, this.#controller?.capture() ?? null); }
  #guard(phase: DomDiagnostic['phase'] = 'command'): DomRefusal | null {
    if (this.#lifecycle === 'loading') return this.#failure('dom.not_ready',phase);
    if (this.#lifecycle === 'recoveryRequired') return this.#failure('dom.recovery_required',phase);
    if (this.#lifecycle !== 'ready') return this.#failure('dom.disposed',phase);
    return null;
  }
  #report(failure: DomRefusal): DomRefusal {
    try { this.#onRefusal?.(failure); } catch { /* Host errors cannot rewrite native results or skip cleanup. */ }
    return failure;
  }
  #packet(): RecoveryPacket | null {
    const source = this.#original ?? this.#replacementInput;
    const region = this.#recovery;
    return source || region ? Object.freeze({ originalInput: source?.slice() ?? null, region }) : null;
  }
  #recover(failure: DomRefusal, region?: RecoveryRegion | null): void {
    if (this.#lifecycle === 'disposing' || this.#lifecycle === 'destroyed') return;
    if (region) this.#recovery = region;
    else if (!this.#recovery) this.#recovery = this.#view?.captureRegion() ?? null;
    if (!this.#recovery && this.#element && ['dom.reconcile_limit','dom.recovery_required','dom.composition_conflict'].includes(failure.diagnostic.code)) this.#recovery = Object.freeze({kind:'retained_dom',element:this.#element,reason:'capture_limit',ownership:'transferred_to_host'});
    this.#lifecycle = 'recoveryRequired';
    this.#element?.setAttribute('contenteditable','false');
    this.#report(failure);
  }
  #busy(): boolean {
    const counts = this.#controller?.resources();
    return this.#forwarding > 0 || this.#delivery > 0 || !!counts && (counts.pending_tickets > 0 || counts.queued_mutations > 0 || counts.task_continuations > 0);
  }
  #modeAttributes() {
    const element = this.#element;
    if (!element) return;
    element.setAttribute('contenteditable', String(this.#lifecycle === 'ready' && this.#mode === 'editable' && this.#access === 'editable'));
    element.setAttribute('aria-readonly', String(this.#mode !== 'editable' || this.#access === 'read_only'));
    element.setAttribute('aria-disabled', String(this.#mode === 'disabled'));
    element.setAttribute('tabindex', this.#mode === 'disabled' ? '-1' : '0');
    if (this.#mode === 'disabled' && element.ownerDocument.activeElement === element) element.blur();
  }
  #state(): DeepReadonly<StateDto> | null {
    const result = this.#controller?.read({ kind:'state' });
    return result?.status === 'ok' && result.value.kind === 'state' ? result.value.state : null;
  }
  async #initialize() {
    const controller = this.#controller!;
    const response = await controller.ready;
    if (this.#lifecycle !== 'loading') return;
    if (response.status !== 'ok') {
      this.#lifecycle = response.status === 'fatal' ? 'fatal' : 'recoveryRequired';
      this.#settle({ status:'sdk_failure', response, recovery:this.#packet() }); return;
    }
    const context = controller.context();
    let failure = context ? admitCatalog(this.#catalog!,context) : this.#failure('dom.renderer_binding_mismatch','mount');
    if (!failure) {
      this.#view = createDomView({ element:this.#element!, catalog:this.#catalog!, readNode:(stamp,node) => controller.read({ kind:'node',stamp:stamp as StampDto,node }) });
      const state = this.#state();
      failure = state ? this.#view.initialize(state) : this.#failure('dom.not_ready','mount');
    }
    if (failure) {
      this.#lifecycle = 'recoveryRequired'; controller.destroy();
      this.#view?.destroy({ retainRegion:true }); this.#view = null;
      this.#settle({ ...failure, response, recovery:this.#packet() }); this.#report(failure); return;
    }
    this.#context = context;
    const subscription = controller.subscribe(event => this.#publication(event));
    if (typeof subscription !== 'function') {
      this.#lifecycle = 'recoveryRequired'; controller.destroy();
      this.#settle({ status:'sdk_failure', response:subscription, recovery:this.#packet() }); return;
    }
    this.#unsubscribe = subscription;
    this.#lifecycle = 'ready';
    const view = this.#view!;
    this.#input = attachInput({ element:this.#element!,view,
      bindings:this.#catalog!.definition.input ?? {},
      canEdit:() => this.#lifecycle === 'ready' && this.#mode === 'editable' && this.#access === 'editable',
      canSelect:() => this.#lifecycle === 'ready' && this.#mode !== 'disabled',
      busy:() => this.#busy(), capture:() => controller.capture(), readState:() => this.#state(),
      submit:request => this.#submit(request, true),
      report:failure => this.#report(failure),
      recover:(failure,region) => this.#recover(failure,region),
      composing:active => { this.#composing = active; view.setComposing(active); },
      consumeRecords:() => this.#consumeRecords(),
    });
    const Observer = this.#element!.ownerDocument.defaultView!.MutationObserver;
    this.#observer = new Observer(records => this.#mutations(records));
    this.#modeAttributes(); this.#observe();
    this.#original = null;
    // Configuration retains only immutable native options/limits/loader, not admitted bytes.
    this.#configuration = { ...this.#configuration!, input:new Uint8Array() };
    this.#settle({ status:'ready',response });
  }
  #observe() { if (this.#observer && this.#element && this.#lifecycle === 'ready') this.#observer.observe(this.#element,{subtree:true,childList:true,characterData:true,attributes:true}); }
  #consumeRecords(): number {
    const records = this.#records + (this.#observer?.takeRecords().length ?? 0); this.#records = 0; return records;
  }
  #mutations(records: MutationRecord[]) {
    if (this.#lifecycle !== 'ready') return;
    this.#records += records.length;
    if (this.#records > 4096) { this.#recover(this.#failure('dom.reconcile_limit','render')); return; }
    if (!this.#view?.hasProvisional()) {
      const stamp = this.#controller?.capture();
      const ids = new Set<string>();
      for (const record of records) { const id = this.#view?.ownedBlockAt(record.target); if (id) ids.add(id); }
      if (stamp) this.#view?.beginProvisional(stamp,[...ids]);
      this.#recover(this.#failure('dom.recovery_required','render'));
    }
  }
  #publication(event: DeepReadonly<EventDto>) {
    if (this.#lifecycle !== 'ready') return;
    this.#delivery++;
    try {
      const pending = this.#observer?.takeRecords() ?? [];
      if (pending.length) { this.#mutations(pending); if (this.#lifecycle !== 'ready') return; }
      this.#observer?.disconnect();
      const failure = this.#view!.patch(event);
      if (failure) this.#recover({ ...failure, diagnostic:{...failure.diagnostic,publication:'alreadyPublished',stamp:event.after} });
    } catch {
      this.#recover(domRefusal('dom.presentation_unsupported','render',event.after,null,null,'alreadyPublished'));
    } finally { this.#delivery--; this.#observe(); }
  }
  read(request: ReadRequest): Response | DomRefusal { const guard = this.#lifecycle === 'recoveryRequired' && this.#controller?.lifecycle === 'ready' ? null : this.#guard(); return guard ? this.#report(guard) : this.#controller!.read(request); }
  query(request: QueryRequest): Response | DomRefusal {
    try { request = ownConfiguration(request); } catch { return this.#report(this.#failure('dom.invalid_options')); }
    const lifecycle = this.#lifecycle === 'recoveryRequired' && this.#controller?.lifecycle === 'ready' ? null : this.#guard();
    if (lifecycle) return this.#report(lifecycle);
    let gate: DomRefusal | null;
    try { gate = this.#catalog!.definition.commandGate(request); } catch { gate = this.#failure('dom.command_unsupported'); }
    return gate ? this.#report(gate) : this.#controller!.query(request);
  }
  submit(request: MountedMutation) { return this.#submit(request,false); }
  #submit(request: MountedMutation, input: boolean): Submission | DomRefusal {
    try { request = ownConfiguration(request); } catch { return this.#report(this.#failure('dom.invalid_options')); }
    const kind = (request as MutationRequestV2)?.kind;
    const recoveryRead = this.#lifecycle === 'recoveryRequired' && this.#controller?.lifecycle === 'ready' && ['snapshot','acknowledge_snapshot','reconcile_snapshot','release_snapshot'].includes(kind);
    const guard = recoveryRead ? null : this.#guard();
    if (guard) return this.#report(guard);
    if (kind === 'remount' || kind === 'destroy') return this.#report(this.#failure('dom.explicit_method_required'));
    if ((kind as string) === 'update_facts') return this.#report(this.#failure('dom.command_unsupported'));
    if (input && kind !== 'set_selection' && this.#mode !== 'editable') return this.#report(this.#failure('dom.mode_blocked'));
    if ((this.#composing && !this.#view?.hasProvisional() || this.#view?.conflicts(request)) && !this.#outsideTyping(request)) return this.#report(this.#failure('dom.composition_conflict'));
    let capability: DomRefusal | null;
    try { capability = this.#catalog!.definition.commandGate(request); }
    catch { capability = this.#failure('dom.command_unsupported'); }
    if (capability) return this.#report(capability);
    this.#forwarding++;
    try {
      const result = this.#controller!.submit(request);
      const terminal = (response: Response) => { if (response.status === 'fatal' && this.#lifecycle === 'ready') { this.#lifecycle = 'fatal'; this.#element?.setAttribute('contenteditable','false'); } };
      if (result.status === 'completed') terminal(result.response); else void result.completion.then(terminal);
      return result;
    } finally { this.#forwarding--; }
  }
  #outsideTyping(request: MountedMutation): boolean {
    if (!this.#composing || request.kind !== 'command') return false;
    const selection = this.#state()?.selection;
    if (!selection || selection.anchor.kind !== 'text' || selection.focus.kind !== 'text' || selection.anchor.node !== selection.focus.node) return false;
    const protectedIds = this.#view!.protectedIds();
    if (protectedIds.includes(selection.anchor.node)) return false;
    try { return request.command.id === this.#catalog!.definition.input?.insertText?.('').id; } catch { return false; }
  }
  subscribe(listener: (event: DeepReadonly<EventDto>) => void) {
    const guard = this.#guard(); return guard ? this.#report(guard) : this.#controller!.subscribe(listener);
  }
  setInteractionMode(mode: InteractionMode) {
    const guard = this.#guard('mode');
    if (guard) return this.#report(guard);
    if (!MODES.has(mode)) return this.#report(this.#failure('dom.invalid_options','mode'));
    if (mode === 'editable' && this.#access === 'read_only') return this.#report(this.#failure('dom.native_read_only','mode'));
    if (this.#composing || this.#view?.hasProvisional()) return this.#report(this.#failure('dom.composition_conflict','mode'));
    const records = this.#observer?.takeRecords() ?? [];
    if (records.length) { this.#mutations(records); if (this.#lifecycle !== 'ready') return this.#report(this.#failure('dom.recovery_required','mode')); }
    this.#observer?.disconnect(); this.#mode = mode; this.#modeAttributes(); this.#observe();
    return Object.freeze({ status:'updated' as const,mode });
  }
  async replace(input: Uint8Array): Promise<Submission | DomRefusal> {
    const guard = this.#guard('replace');
    if (guard) return this.#report(guard);
    if (this.#replacement || this.#busy()) return this.#report(this.#failure('dom.busy','replace'));
    if (this.#composing || this.#view?.hasProvisional()) return this.#report(this.#failure('dom.composition_conflict','replace'));
    let owned: Uint8Array;
    try { owned = ownInput(input); } catch { return this.#report(this.#failure('dom.invalid_options','replace')); }
    const controller = this.#controller!;
    const captured = controller.captureHostRequest();
    if (captured.status === 'refused') return { status:'completed',response:captured.response };
    this.#replacement = true; this.#replacementInput = owned; this.#request = captured.request;
    let temporary: EditorControllerV2 | null = null;
    try {
      temporary = createEditor({ ...this.#configuration!, input:owned }); this.#temporary = temporary;
      const response = await temporary.ready;
      if (this.#lifecycle !== 'ready') return this.#report(this.#failure('dom.disposed','replace'));
      if (response.status !== 'ok') return { status:'completed',response };
      const context = temporary.context();
      const binding = context ? admitCatalog(this.#catalog!,context) : this.#failure('dom.renderer_binding_mismatch','replace');
      if (binding) return this.#report(binding);
      if (!same(context,this.#context)) return this.#report(this.#failure('dom.renderer_binding_mismatch','replace'));
      const preflightElement = this.#element!.ownerDocument.createElement('div');
      const preflight = createDomView({ element:preflightElement,catalog:this.#catalog!,readNode:(stamp,node) => temporary!.read({kind:'node',stamp:stamp as StampDto,node}) });
      const stateResponse = temporary.read({ kind:'state' });
      const failure = stateResponse.status === 'ok' && stateResponse.value.kind === 'state' ? preflight.initialize(stateResponse.value.state) : this.#failure('dom.renderer_missing','replace');
      preflight.destroy();
      temporary.destroy(); this.#temporary = null; temporary = null;
      if (failure) return this.#report(failure);
      if (this.#guard('replace')) return this.#report(this.#guard('replace')!);
      if (this.#busy()) return this.#report(this.#failure('dom.busy','replace'));
      if (this.#composing || this.#view?.hasProvisional()) return this.#report(this.#failure('dom.composition_conflict','replace'));
      if (!same(controller.capture(),captured.request.stamp) || !same(controller.context(),this.#context)) return this.#report(this.#failure('dom.stale_replace','replace'));
      // No await or host callback from final idle/capture check through actual remount.
      const text = new TextDecoder('utf-8',{fatal:true}).decode(owned);
      this.#forwarding++;
      let result: Submission;
      try { result = controller.completeHostRequest(captured.request,{kind:'remount',stamp:captured.request.stamp as StampDto,input_json:text,admission:this.#configuration!.options.admission}); }
      finally { this.#forwarding--; this.#request = null; }
      if (result.status === 'queued') { this.#recover(this.#failure('dom.recovery_required','replace')); return result; }
      if (result.response.status === 'ok') {
        this.#observer?.disconnect();
        const state = this.#state();
        let renderFailure: DomRefusal | null;
        try { renderFailure = state ? this.#view!.initialize(state) : this.#failure('dom.presentation_unsupported','replace'); }
        catch { renderFailure = this.#failure('dom.presentation_unsupported','replace'); }
        if (renderFailure) this.#recover({ ...renderFailure,diagnostic:{...renderFailure.diagnostic,phase:'replace',publication:'alreadyPublished',stamp:controller.capture()} });
        else this.#replacementInput = null;
        this.#observe();
      }
      return result;
    } catch {
      return this.#report(this.#failure('dom.invalid_options','replace'));
    } finally {
      temporary?.destroy(); this.#temporary = null;
      if (this.#request) controller.releaseHostRequest(this.#request);
      this.#request = null; this.#replacement = false;
    }
  }
  destroy(): DestroyReceipt {
    if (this.#receipt) return this.#receipt;
    this.#lifecycle = 'disposing';
    this.#observer?.disconnect(); this.#observer = null;
    this.#recovery ??= this.#view?.captureRegion() ?? null;
    const packet = this.#packet();
    this.#input?.destroy(); this.#input = null;
    this.#unsubscribe?.(); this.#unsubscribe = null;
    this.#temporary?.destroy(); this.#temporary = null;
    if (this.#request) this.#controller?.releaseHostRequest(this.#request);
    this.#request = null;
    // The host callback cannot alter the receipt's only binary copy.
    const sdk = this.#controller?.destroy() ?? emptyDestroyed();
    const receipt: {status:'destroy_requested';sdk:Submission;recovery:RecoveryPacket|null;callbackFailure:DomRefusal|null} = {status:'destroy_requested',sdk,recovery:packet,callbackFailure:null};
    this.#receipt = receipt;
    const callback = this.#onRecovery;
    this.#onRecovery = undefined; this.#onRefusal = undefined;
    let callbackFailure: DomRefusal | null = null;
    if (packet && callback) { try { callback(this.#packet()!); } catch { callbackFailure = this.#failure('dom.recovery_callback_failed','destroy'); } }
    this.#view?.destroy({retainRegion:packet?.region?.kind === 'retained_dom'}); this.#view = null;
    if (this.#element) {
      mountedHosts.delete(this.#element);
      for (const [name,value] of this.#attributes) { if (value === null) this.#element.removeAttribute(name); else this.#element.setAttribute(name,value); }
      if (!this.#hadClass) this.#element.classList.remove('editor-surface');
    }
    this.#replacement = false; this.#configuration = null; this.#catalog = null; this.#context = null;
    this.#original = null; this.#replacementInput = null; this.#recovery = null; this.#element = null; this.#attributes.clear(); this.#records = 0;
    receipt.sdk = sdk; receipt.callbackFailure = callbackFailure; Object.freeze(receipt);
    if (sdk.status === 'completed') this.#lifecycle = 'destroyed'; else void sdk.completion.then(() => { this.#lifecycle = 'destroyed'; });
    this.#settle({ ...this.#failure('dom.disposed','destroy'),response:null,recovery:packet });
    return this.#receipt;
  }
  resources(): MountedResourceCounts {
    const sdk = this.#controller?.resources() ?? {lifecycle:'destroyed' as const,sessions:0,listeners:0,queued_mutations:0,queued_bytes:0,pending_tickets:0,host_requests:0,task_continuations:0,original_input_bytes:0,callback_errors:0,callback_error_handlers:0};
    return Object.freeze({sdk,dom:Object.freeze({listeners:(this.#input?.listeners() ?? 0),observers:this.#observer ? 1 : 0,continuations:this.#replacement ? 1 : 0,retainedInputBytes:(this.#original?.byteLength ?? 0)+(this.#replacementInput?.byteLength ?? 0),retainedRecoveryRegions:this.#recovery || this.#view?.hasProvisional() ? 1 : 0})});
  }
  nativeResources() { return this.#controller?.nativeResources() ?? null; }
}
export function mountEditor(options: MountEditorOptions): MountedEditor { return new MountedOwner(options); }
