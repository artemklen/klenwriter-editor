// SPDX-License-Identifier: MIT OR Apache-2.0
import { createEditor } from '@klenwriter/editor-sdk';
import type { CreateEditorOptionsV2, DeepReadonly, EditorControllerV2, EventDto, HostRequest, InputCommandRequestV2, InputSubmissionV2, MutationRequestV2, QueryRequestV2, ReadRequest, ReadRequestV2, Response, ResponseV2, SelectionTextRequestV2, SessionContextV2, StampDto, StateDto, Submission, TextWindowRequestV2 } from '@klenwriter/editor-sdk';
import { admitCatalog, isRendererCatalog } from './catalog.js';
import { domRefusal } from './refusal.js';
import { fields, ownConfiguration, ownInput } from './ownership.js';
import { createDomView } from './view.js';
import type { DomView } from './view.js';
import { SelectionOwner } from './selection.js';
import type { ResultFocusPermit } from './selection.js';
import { HostRequestOwner } from './host-request.js';
import { createMountedGeometry } from './geometry.js';
import { attachClipboard, type ClipboardOwner } from './clipboard.js';
import { attachInput } from './input.js';
import type { InputOwner, InputResources } from './input.js';
import { InputObservationOwner } from './input-observations.js';
import { PopupPresentationOwner } from './popup-presentation.js';
import type { ClipboardOutcome, CompositionRecovery, MountedClipboardController, DestroyReceipt, DomDiagnostic, DomRefusal, InteractionMode, MountedEditor, MountedLifecycle, MountedMutation, MountedMutationV2, MountedReady, MountedResourceCounts, MountEditorOptions, RecoveryPacket, RecoveryRegion, RendererCatalog, SelectionReadFailure, TypedInputRecovery } from './types.js';
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
  #initialReadFailure: Response | null = null;
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
  #compositionRecovery: CompositionRecovery | null = null;
  #typedRecovery:TypedInputRecovery|null=null;
  #recoveryNotified = false;
  #recoveryCallbackFailure: DomRefusal | null = null;
  // A late original ticket updates only numbers, never a released DOM owner.
  #inputResources:InputResources = { continuations:0, retainedInputBytes:0, retainedRecoveryRegions:0 };
  #temporary: EditorControllerV2 | null = null;
  #replacement = false;
  #request: HostRequest | null = null;
  #forwarding = 0;
  #delivery = 0;
  #presentationWriting = 0;
  #composing = false;
  #records = 0;
  #receipt: DestroyReceipt | null = null;
  #onRecovery: MountEditorOptions['onRecovery'];
  #onRefusal: MountEditorOptions['onRefusal'];
  #attributes = new Map<string, string | null>();
  #hadClass = false;
  #clipboardOwner: ClipboardOwner | null = null;
  #clipboardConfiguration: MountEditorOptions['clipboard'];
  #selectionOwner = new SelectionOwner({element:()=>this.#element,view:()=>this.#view,capture:()=>this.#controller?.capture() ?? null,
    context:()=>this.#controller?.context() ?? null,read:request=>this.#nativeRead(request),submit:request=>this.#submit(request,true),
    guard:()=>this.#selectionGuard(),busy:()=>this.#busy(),report:failure=>this.#report(failure),recover:failure=>this.#recover(failure),
    invalidated:()=>this.#hostOwner?.intentChanged()});
  #hostOwner = new HostRequestOwner({element:()=>this.#element,view:()=>this.#view,controller:()=>this.#controller,
    capture:()=>this.#controller?.capture() ?? null,context:()=>this.#controller?.context() ?? null,selection:this.#selectionOwner,
    guard:()=>this.#userActionGuard(),report:failure=>this.#report(failure),
    dispatch:(request,handle,validate)=>{
      let permit:ResultFocusPermit|null=null;
      const result=this.#forward(request,false,false,owned=>this.#controller!.completeHostRequest(handle,owned),validate,value=>{permit=value;});
      return {result,permit};
    }});
  readonly hostRequests=this.#hostOwner.api;
  #inputObservations=new InputObservationOwner({guard:()=>this.#observationGuard(),capture:()=>this.capture(),context:()=>this.context(),
    state:()=>this.#state(),corresponds:state=>!!this.#element?.isConnected && !!this.#view && same(this.#view.geometryStamp(),state.stamp) && same(this.#view.readSelection(),state.selection),
    window:stamp=>this.#nativeRead({kind:'text_window',stamp:stamp as StampDto,before_utf16:256,after_utf16:0})});
  #popupPresentation=new PopupPresentationOwner({element:()=>this.#element,capture:()=>this.capture(),context:()=>this.context(),
    guard:()=>this.#userActionGuard(true),write:(change,cleanup)=>this.#presentationWrite(change,cleanup)});
  readonly inputObservations=this.#inputObservations.api;
  readonly popupPresentation=this.#popupPresentation.api;
  readonly geometry=createMountedGeometry({element:()=>this.#element,view:()=>this.#view,capture:()=>this.#controller?.capture() ?? null,
    context:()=>this.#controller?.context() ?? null,readState:()=>this.#nativeRead({kind:'state'}),guard:()=>this.#geometryGuard()});
  readonly selection = this.#selectionOwner.api;
  readonly clipboard: MountedClipboardController = Object.freeze({copy:()=>this.#clipboardCall('copy'),cut:()=>this.#clipboardCall('cut'),
    paste:(source:unknown)=>this.#clipboardOwner?.paste(source) ?? Promise.resolve({action:'paste' as const,status:'refused' as const,failure:this.#guard('clipboard') ?? this.#failure('dom.not_ready','clipboard'),diagnostics:Object.freeze([]),submission:null,recovery:'none' as const}),
    takeRecovery:()=>this.#clipboardOwner?.takeRecovery() ?? null,releaseRecovery:()=>this.#clipboardOwner?.releaseRecovery() ?? false});
  #clipboardCall(action:'copy'|'cut'):Promise<ClipboardOutcome> {
    if(this.#clipboardOwner)return this.#clipboardOwner[action]();
    return Promise.resolve({action,status:'refused',clipboard:'not_attempted',failure:this.#guard('clipboard') ?? this.#failure('dom.not_ready','clipboard'),submission:null});
  }
  #userActionGuard(ignoreObservations=false):DomRefusal|null {
    return this.#guard('host_request') ?? (this.#access==='read_only'?this.#failure('dom.native_read_only','host_request'):null)
      ?? (this.#mode!=='editable'?this.#failure('dom.mode_blocked','host_request'):null)
      ?? (this.#replacement || this.#input?.isCommitting() || this.#busy(ignoreObservations)?this.#failure('dom.busy','host_request'):null)
      ?? (this.#composing || this.#view?.hasProvisional() || this.#input?.isProtected()?this.#failure('dom.composition_conflict','host_request'):null)
      ?? (!this.#selectionOwner.intentAvailable()?this.#failure('dom.selection_limit','host_request'):null);
  }
  #observationGuard():DomRefusal|null {
    return this.#guard() ?? (this.#access==='read_only'?this.#failure('dom.native_read_only'):null)
      ?? (this.#mode!=='editable'?this.#failure('dom.mode_blocked'):null)
      ?? (this.#replacement || this.#busy(true)?this.#failure('dom.busy'):null)
      ?? (this.#composing || this.#view?.hasProvisional() || this.#input?.isProtected()?this.#failure('dom.composition_conflict'):null);
  }
  #presentationWrite(change:()=>void,cleanup:boolean):DomRefusal|null {
    const pending=this.#observer?.takeRecords()??[];
    if(pending.length)this.#mutations(pending);
    if(!cleanup){const guard=this.#userActionGuard(true);if(guard)return guard;}
    this.#observer?.disconnect();this.#presentationWriting++;
    try{change();return null;}
    finally{this.#presentationWriting--;this.#observe();}
  }
  #geometryGuard():DomRefusal|null {
    return this.#guard('geometry') ?? (this.#replacement || this.#input?.isCommitting() || this.#busy(true)?this.#failure('dom.busy','geometry'):null)
      ?? (this.#composing || this.#view?.hasProvisional() || this.#input?.isProtected()?this.#failure('dom.composition_conflict','geometry'):null);
  }
  #selectionGuard():DomRefusal|null {
    return this.#guard('selection') ?? (this.#mode==='disabled'?this.#failure('dom.mode_blocked','selection'):null)
      ?? (this.#composing || this.#view?.hasProvisional() || this.#input?.isProtected()?this.#failure('dom.composition_conflict','selection'):null)
      ?? (this.#busy()?this.#failure('dom.busy','selection'):null);
  }
  #clipboardGuard(action:'copy'|'cut'|'paste'):DomRefusal|null {
    return this.#guard('clipboard') ?? (action!=='copy' && this.#access==='read_only'?this.#failure('dom.native_read_only','clipboard'):null)
      ?? (this.#mode==='disabled' || action!=='copy' && this.#mode!=='editable'?this.#failure('dom.mode_blocked','clipboard'):null)
      ?? (this.#composing || this.#view?.hasProvisional() || this.#input?.isProtected()?this.#failure('dom.composition_conflict','clipboard'):null)
      ?? (this.#busy()?this.#failure('dom.busy','clipboard'):null);
  }
  constructor(configuration: MountEditorOptions) {
    this.ready = new Promise(resolve => { this.#resolve = resolve; });
    try {
      const options = fields(configuration);
      if (Object.keys(options).some(key => !['element','editor','renderers','mode','onRecovery','onRefusal','clipboard'].includes(key))) throw new TypeError();
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
      if(options.clipboard!==undefined){
        const clipboard=fields(options.clipboard);
        if(Object.keys(clipboard).some(key=>!['writeText','write','onResult','onPasteResult','codec'].includes(key)))throw new TypeError();
        for(const key of ['writeText','write','onResult','onPasteResult'])if(clipboard[key]!==undefined&&typeof clipboard[key]!=='function')throw new TypeError();
        if(clipboard.codec!==undefined){const codec=fields(clipboard.codec);
          if(Object.keys(codec).some(key=>!['contextFormat','fragmentFormat','decode','encode'].includes(key))
            ||typeof codec.contextFormat!=='string'||codec.contextFormat.length>256||typeof codec.fragmentFormat!=='string'||codec.fragmentFormat.length>256
            ||typeof codec.decode!=='function'||codec.encode!==undefined&&typeof codec.encode!=='function')throw new TypeError();
          clipboard.codec=Object.freeze({...codec});
        }
        this.#clipboardConfiguration=Object.freeze({...clipboard}) as MountEditorOptions['clipboard'];
      }
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
      for (const name of ['contenteditable','tabindex','role','aria-readonly','aria-disabled','aria-multiline','aria-busy']) this.#attributes.set(name, element.getAttribute(name));
      this.#hadClass = element.classList.contains('editor-surface');
      element.classList.add('editor-surface'); element.setAttribute('contenteditable','false');
      element.setAttribute('role','textbox');
      element.setAttribute('aria-multiline','true');
      element.setAttribute('aria-busy','true');
      this.#controller = createEditor(this.#configuration);
      void this.#initialize();
    } catch {
      this.#lifecycle = 'recoveryRequired';
      this.#element?.setAttribute('aria-busy','false');
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
    return source || region || this.#compositionRecovery || this.#typedRecovery ? Object.freeze({ originalInput: source?.slice() ?? null, region,
      ...(this.#compositionRecovery ? {composition:this.#compositionRecovery} : {}),...(this.#typedRecovery?{typedInput:this.#typedRecovery}:{}) }) : null;
  }
  #retainInput(reason:CompositionRecovery['reason']): void {
    const retained=this.#input?.retained(reason);
    if (retained) { this.#recovery=retained.region; this.#compositionRecovery=retained.composition; }
    this.#typedRecovery=this.#input?.takeTypedRecovery()??this.#typedRecovery;
  }
  #notifyCompositionRecovery(): void {
    if ((!this.#compositionRecovery&&!this.#typedRecovery) || this.#recoveryNotified) return;
    const packet=this.#packet();
    this.#recoveryNotified=true;
    try { if(packet)this.#onRecovery?.(packet); }
    catch { this.#recoveryCallbackFailure=this.#failure('dom.recovery_callback_failed','composition'); }
  }
  #recover(failure: DomRefusal, region?: RecoveryRegion | null, composition?: CompositionRecovery | null): void {
    if (this.#lifecycle === 'disposing' || this.#lifecycle === 'destroyed') return;
    this.#hostOwner.retire();
    this.#inputObservations.invalidate();this.#popupPresentation.retire();
    // Retain before cancellation, disabling, reporting or any host callback.
    this.#retainInput('native_unknown');
    if (region) this.#recovery = region;
    if (composition) this.#compositionRecovery=composition;
    else if (!this.#recovery) this.#recovery = this.#view?.captureRegion() ?? null;
    if (!this.#recovery && this.#element && ['dom.reconcile_limit','dom.recovery_required','dom.composition_conflict'].includes(failure.diagnostic.code)) this.#recovery = Object.freeze({kind:'retained_dom',element:this.#element,reason:'capture_limit',ownership:'transferred_to_host'});
    this.#lifecycle = this.#controller?.lifecycle === 'fatal' ? 'fatal' : 'recoveryRequired';
    this.#element?.setAttribute('contenteditable','false');
    this.#element?.setAttribute('aria-busy','false');
    this.#selectionOwner.cancel(); this.#clipboardOwner?.cancel(failure.diagnostic.code);
    this.#notifyCompositionRecovery();
    if (this.#receipt || !this.#element) return;
    this.#report(failure);
  }
  #busy(ignoreObservations=false): boolean {
    const counts = this.#controller?.resources();
    return this.#forwarding > 0 || this.#delivery > 0 || this.#presentationWriting > 0 || !ignoreObservations && this.#inputObservations.delivering() || this.#selectionOwner.resources().restoreTickets > 0 || !!counts && (counts.pending_tickets > 0 || counts.queued_mutations > 0 || counts.task_continuations > 0);
  }
  #modeAttributes() {
    const element = this.#element;
    if (!element) return;
    element.setAttribute('contenteditable', String(this.#lifecycle === 'ready' && this.#mode === 'editable' && this.#access === 'editable'));
    element.setAttribute('aria-readonly', String(this.#mode !== 'editable' || this.#access === 'read_only'));
    element.setAttribute('aria-disabled', String(this.#mode === 'disabled'));
    // Initialization and mode writes precede observation (or run disconnected).
    // Native command queues do not make the accessible document a loading view.
    element.setAttribute('aria-busy','false');
    element.setAttribute('tabindex', this.#mode === 'disabled' ? '-1' : '0');
    if (this.#mode === 'disabled' && element.ownerDocument.activeElement === element) element.blur();
  }
  #reflectFatal<T extends ResponseV2>(response: T, compositionSubmission?:InputSubmissionV2): T {
    if (this.#lifecycle === 'disposing' || this.#lifecycle === 'destroyed') return response;
    if (response.status === 'fatal') {
      this.#inputObservations.destroy();this.#popupPresentation.destroy();
      this.#hostOwner.destroy();
      this.#retainInput('native_fatal');
      if(this.#compositionRecovery)this.#compositionRecovery=Object.freeze({...this.#compositionRecovery,
        reason:'native_fatal',...(compositionSubmission ? {submission:compositionSubmission,response:response as Extract<Response,{status:'fatal'}>,nativeOutcome:'completed' as const} : {})});
      this.#lifecycle = 'fatal';
      this.#element?.setAttribute('contenteditable','false');
      this.#element?.setAttribute('aria-busy','false');
      this.#observer?.disconnect(); this.#observer = null;
      this.#selectionOwner.destroy(); this.#clipboardOwner?.destroy();
      this.#input?.destroy(); this.#input = null;
      this.#unsubscribe?.(); this.#unsubscribe = null;
      this.#notifyCompositionRecovery();
    }
    return response;
  }
  #nativeRead(request: ReadRequest): Response;
  #nativeRead(request: SelectionTextRequestV2): ResponseV2;
  #nativeRead(request: TextWindowRequestV2): ResponseV2;
  #nativeRead(request: ReadRequestV2): ResponseV2;
  #nativeRead(request: ReadRequestV2): ResponseV2 {
    const response = this.#controller!.read(request);
    if (this.#lifecycle === 'loading' && response.status !== 'ok') this.#initialReadFailure = response;
    return this.#reflectFatal(response);
  }
  #state(): DeepReadonly<StateDto> | null {
    const result = this.#controller ? this.#nativeRead({ kind:'state' }) : null;
    return result?.status === 'ok' && result.value.kind === 'state' ? result.value.state : null;
  }
  async #initialize() {
    const controller = this.#controller!;
    const response = await controller.ready;
    if (this.#lifecycle !== 'loading') return;
    if (response.status !== 'ok') {
      this.#lifecycle = response.status === 'fatal' ? 'fatal' : 'recoveryRequired';
      this.#element?.setAttribute('aria-busy','false');
      this.#settle({ status:'sdk_failure', response, recovery:this.#packet() }); return;
    }
    const context = controller.context();
    let failure = context ? admitCatalog(this.#catalog!,context) : this.#failure('dom.renderer_binding_mismatch','mount');
    if (!failure) {
      this.#view = createDomView({ element:this.#element!, catalog:this.#catalog!, readNode:(stamp,node) => this.#nativeRead({ kind:'node',stamp:stamp as StampDto,node }) });
      const state = this.#state();
      failure = state ? this.#view.initialize(state) : this.#failure('dom.not_ready','mount');
    }
    if (failure) {
      const nativeFailure = this.#initialReadFailure; this.#initialReadFailure = null;
      this.#lifecycle = nativeFailure?.status === 'fatal' ? 'fatal' : 'recoveryRequired'; controller.destroy();
      this.#element?.setAttribute('aria-busy','false');
      this.#view?.destroy({ retainRegion:true }); this.#view = null;
      if (nativeFailure) this.#settle({status:'sdk_failure',response:nativeFailure,recovery:this.#packet()});
      else { this.#settle({ ...failure, response, recovery:this.#packet() }); this.#report(failure); }
      return;
    }
    this.#initialReadFailure = null; this.#context = context;
    const subscription = controller.subscribe(event => this.#publication(event));
    if (typeof subscription !== 'function') {
      this.#lifecycle = 'recoveryRequired'; controller.destroy();
      this.#element?.setAttribute('aria-busy','false');
      this.#settle({ status:'sdk_failure', response:subscription, recovery:this.#packet() }); return;
    }
    this.#unsubscribe = subscription;
    this.#lifecycle = 'ready';
    const view = this.#view!;
    this.#selectionOwner.attach();
    this.#clipboardOwner = attachClipboard({element:this.#element!,view,bindings:this.#catalog!.definition.input ?? {},
      capture:()=>controller.capture(),context:()=>controller.context(),readState:()=>this.#state(),read:request=>this.read(request),query:request=>this.query(request),submit:(request,validate)=>this.#submit(request,true,false,validate),
      intent:()=>this.#selectionOwner.intent(),guard:action=>this.#clipboardGuard(action),report:failure=>this.#report(failure),...this.#clipboardConfiguration});
    this.#clipboardConfiguration=undefined;
    this.#input = attachInput({ element:this.#element!,view,selection:this.#selectionOwner,
      bindings:this.#catalog!.definition.input ?? {},
      canEdit:() => this.#lifecycle === 'ready' && this.#mode === 'editable' && this.#access === 'editable',
      canSelect:() => this.#lifecycle === 'ready' && this.#mode !== 'disabled',
      busy:() => this.#busy(), capture:() => controller.capture(), context:() => controller.context(), readState:() => this.#state(),
      submit:(request,observation) => this.#inputObservations.submission(observation??null,request,()=>this.#submit(request,true)),
      submitInput:(request,observation)=>this.#inputObservations.submission(observation??null,request,()=>this.#submit(request,true)),
      beforeObservation:input=>this.#inputObservations.before(input),
      afterObservation:(capture,result)=>this.#inputObservations.after(capture,result),
      observationBusy:()=>{if(!this.#inputObservations.delivering())return false;this.#inputObservations.invalidate();return true;},
      submitComposition:request => this.#submit(request,true,true),
      submitCompositionInput:request=>this.#submit(request,true,true),
      report:failure => this.#report(failure),
      recover:(failure,region,composition) => this.#recover(failure,region,composition),
      composing:active => { this.#composing = active; view.setComposing(active); if(active){this.#inputObservations.invalidate();this.#popupPresentation.retire();this.#hostOwner.retire();this.#selectionOwner.cancel();this.#clipboardOwner?.cancel('dom.composition_conflict');} },
      consumeRecords:() => this.#consumeRecords(),
      onResources:resources => { this.#inputResources={...resources}; },
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
      this.#input?.publication(event);
      this.#selectionOwner.publication(event);
      this.#hostOwner.publication();
      const failure = this.#view!.patch(event,this.#selectionOwner.ownsFocus());
      if (failure) this.#recover({ ...failure, diagnostic:{...failure.diagnostic,publication:'alreadyPublished',stamp:event.after} });
      else this.#popupPresentation.validate();
    } catch {
      this.#recover(domRefusal('dom.presentation_unsupported','render',event.after,null,null,'alreadyPublished'));
    } finally { this.#delivery--; this.#observe(); }
  }
  read(request: ReadRequest): Response | DomRefusal;
  read(request: SelectionTextRequestV2): ResponseV2 | DomRefusal;
  read(request: TextWindowRequestV2): ResponseV2 | DomRefusal;
  read(request: ReadRequestV2): ResponseV2 | DomRefusal;
  read(request: ReadRequestV2): ResponseV2 | DomRefusal { const guard = this.#lifecycle === 'recoveryRequired' && this.#controller?.lifecycle === 'ready' ? null : this.#guard(); return guard ? this.#report(guard) : this.#nativeRead(request); }
  query(request: QueryRequestV2): Response | DomRefusal {
    try { request = ownConfiguration(request); if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.kind !== 'string') throw new TypeError(); } catch { return this.#report(this.#failure('dom.invalid_options')); }
    const lifecycle = this.#lifecycle === 'recoveryRequired' && this.#controller?.lifecycle === 'ready' ? null : this.#guard();
    if (lifecycle) return this.#report(lifecycle);
    let gate: DomRefusal | null;
    try { gate = this.#catalog!.definition.commandGate(request); } catch { gate = this.#failure('dom.command_unsupported'); }
    return gate ? this.#report(gate) : this.#reflectFatal(this.#controller!.query(request));
  }
  submit(request:InputCommandRequestV2):InputSubmissionV2|DomRefusal;
  submit(request:MountedMutation):Submission|DomRefusal;
  submit(request:MountedMutationV2):InputSubmissionV2|DomRefusal;
  submit(request:MountedMutationV2):InputSubmissionV2|DomRefusal { return this.#submit(request,false); }
  #submit(request:MountedMutation,input:boolean,compositionClaim?:boolean,validate?:()=>DomRefusal|null):Submission|DomRefusal;
  #submit(request:MountedMutationV2,input:boolean,compositionClaim?:boolean,validate?:()=>DomRefusal|null):InputSubmissionV2|DomRefusal;
  #submit(request: MountedMutationV2, input: boolean, compositionClaim=false, validate?:()=>DomRefusal|null): InputSubmissionV2 | DomRefusal {
    return this.#forward(request,input,compositionClaim,owned=>this.#controller!.submit(owned),validate) as InputSubmissionV2|DomRefusal;
  }
  #forward<T extends MountedMutation>(request:T,input:boolean,compositionClaim:boolean,dispatch:(request:T)=>Submission,
    validate?:()=>DomRefusal|SelectionReadFailure|null,prospective?:(permit:ResultFocusPermit|null)=>void):Submission|DomRefusal|SelectionReadFailure;
  #forward<T extends MountedMutationV2>(request:T,input:boolean,compositionClaim:boolean,dispatch:(request:T)=>InputSubmissionV2,
    validate?:()=>DomRefusal|SelectionReadFailure|null,prospective?:(permit:ResultFocusPermit|null)=>void):InputSubmissionV2|DomRefusal|SelectionReadFailure;
  #forward<T extends MountedMutationV2>(request:T,input:boolean,compositionClaim:boolean,dispatch:(request:T)=>InputSubmissionV2,
    validate?:()=>DomRefusal|SelectionReadFailure|null,prospective?:(permit:ResultFocusPermit|null)=>void):InputSubmissionV2|DomRefusal|SelectionReadFailure {
    if(!input){
      let harmless=false;
      try{harmless=['snapshot','release_snapshot'].includes(Object.getOwnPropertyDescriptor(request,'kind')?.value);}catch{/* Invalid host input still retires edit lineage. */}
      if(!harmless)this.#input?.externalIntent();
    }
    this.#inputObservations.forward(request);
    if(this.#inputObservations.delivering()||this.#presentationWriting)return this.#failure('dom.busy');
    // The claim precedes configuration getters, selection invalidation and native
    // callbacks. Only the mount-local owner holds this private capability.
    if(this.#input?.isCommitting() && !compositionClaim)return this.#report(this.#failure('dom.busy'));
    try { request = ownConfiguration(request); if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.kind !== 'string') throw new TypeError(); } catch { return this.#report(this.#failure('dom.invalid_options')); }
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
    const final=validate?.();if(final)return isFailure(final)?this.#report(final):final;
    const selectionFrame=this.#selectionOwner.beginSubmission(request,input);
    this.#forwarding++;
    try {
      const result = dispatch(request);
      this.#selectionOwner.endSubmission(selectionFrame,result);
      prospective?.(this.#selectionOwner.resultFocusPermit(selectionFrame,result));
      const terminal = (response: ResponseV2) => { if (response.status === 'fatal') this.#reflectFatal(response,compositionClaim?result:undefined); };
      if (result.status === 'completed') terminal(result.response); else void result.completion.then(terminal);
      if(!compositionClaim)this.#input?.externalSubmission(request,result);
      return result;
    } finally { this.#forwarding--; }
  }
  #outsideTyping(request: MountedMutationV2): boolean {
    if (!this.#composing || request.kind !== 'command') return false;
    const selection = this.#state()?.selection;
    if (!selection || selection.anchor.kind !== 'text' || selection.focus.kind !== 'text' || selection.anchor.node !== selection.focus.node) return false;
    const protectedIds = this.#view!.protectedIds();
    if (protectedIds.includes(selection.anchor.node)) return false;
    try { return request.command.id === this.#catalog!.definition.input?.insertText?.('').id; } catch { return false; }
  }
  subscribe(listener: (event: DeepReadonly<EventDto>) => void) {
    const guard = this.#guard(); if (guard) return this.#report(guard);
    const subscription = this.#controller!.subscribe(listener);
    return typeof subscription === 'function' ? subscription : this.#reflectFatal(subscription);
  }
  setInteractionMode(mode: InteractionMode) {
    this.#input?.externalIntent();
    this.#inputObservations.invalidate();
    if(this.#inputObservations.delivering()||this.#presentationWriting){this.#inputObservations.invalidate();return this.#failure('dom.busy','mode');}
    const guard = this.#guard('mode');
    if (guard) return this.#report(guard);
    if (!MODES.has(mode)) return this.#report(this.#failure('dom.invalid_options','mode'));
    if (mode === 'editable' && this.#access === 'read_only') return this.#report(this.#failure('dom.native_read_only','mode'));
    if (this.#composing || this.#view?.hasProvisional() || this.#input?.isProtected()) return this.#report(this.#failure('dom.composition_conflict','mode'));
    const records = this.#observer?.takeRecords() ?? [];
    if (records.length) { this.#mutations(records); if (this.#lifecycle !== 'ready') return this.#report(this.#failure('dom.recovery_required','mode')); }
    if(mode!==this.#mode){this.#inputObservations.invalidate();this.#popupPresentation.retire();this.#hostOwner.retire();}
    this.#selectionOwner.cancel();this.#clipboardOwner?.cancel('dom.mode_blocked');
    this.#observer?.disconnect(); this.#mode = mode; this.#modeAttributes(); this.#observe();
    return Object.freeze({ status:'updated' as const,mode });
  }
  async replace(input: Uint8Array): Promise<Submission | DomRefusal> {
    this.#input?.externalIntent();
    if(this.#inputObservations.delivering()||this.#presentationWriting){this.#inputObservations.invalidate();return this.#failure('dom.busy','replace');}
    this.#inputObservations.invalidate();this.#popupPresentation.retire();
    this.#hostOwner.retire();
    const guard = this.#guard('replace');
    if (guard) return this.#report(guard);
    if (this.#replacement || this.#busy()) return this.#report(this.#failure('dom.busy','replace'));
    if (this.#composing || this.#view?.hasProvisional() || this.#input?.isProtected()) return this.#report(this.#failure('dom.composition_conflict','replace'));
    this.#selectionOwner.cancel();this.#selectionOwner.invalidate(true);this.#clipboardOwner?.cancel('dom.stale_selection');
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
      let readFailure: Response | null = null;
      const preflight = createDomView({ element:preflightElement,catalog:this.#catalog!,readNode:(stamp,node) => { const response = temporary!.read({kind:'node',stamp:stamp as StampDto,node}); if (response.status !== 'ok') readFailure = response; return response; } });
      const stateResponse = temporary.read({ kind:'state' });
      let failure: DomRefusal | null;
      try { failure = stateResponse.status === 'ok' && stateResponse.value.kind === 'state' ? preflight.initialize(stateResponse.value.state) : this.#failure('dom.renderer_missing','replace'); }
      finally { preflight.destroy(); }
      if (stateResponse.status !== 'ok') return {status:'completed',response:stateResponse};
      if (readFailure) return {status:'completed',response:readFailure};
      temporary.destroy(); this.#temporary = null; temporary = null;
      if (failure) return this.#report(failure);
      if (this.#guard('replace')) return this.#report(this.#guard('replace')!);
      if (this.#busy()) return this.#report(this.#failure('dom.busy','replace'));
      if (this.#composing || this.#view?.hasProvisional() || this.#input?.isProtected()) return this.#report(this.#failure('dom.composition_conflict','replace'));
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
        try {
          if(state){this.#selectionOwner.viewReplaced();renderFailure=this.#view!.initialize(state);}
          else renderFailure=this.#failure('dom.presentation_unsupported','replace');
        }
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
    if (this.#receipt) { Object.freeze(this.#receipt); return this.#receipt; }
    this.#inputObservations.destroy();this.#popupPresentation.destroy();this.#hostOwner.destroy();
    this.#retainInput('destroyed');
    this.#lifecycle = 'disposing';
    this.#selectionOwner.destroy();this.#clipboardOwner?.destroy();this.#clipboardConfiguration=undefined;
    this.#observer?.disconnect(); this.#observer = null;
    if (this.#view?.hasProvisional() && !this.#compositionRecovery) this.#recovery = this.#view.captureRegion() ?? this.#recovery;
    else this.#recovery ??= this.#view?.captureRegion() ?? null;
    const packet = this.#packet();
    this.#input?.destroy(); this.#input = null;
    this.#unsubscribe?.(); this.#unsubscribe = null;
    this.#temporary?.destroy(); this.#temporary = null;
    if (this.#request) this.#controller?.releaseHostRequest(this.#request);
    this.#request = null;
    // The host callback cannot alter the receipt's only binary copy.
    const sdk = this.#controller?.destroy() ?? emptyDestroyed();
    const clipboardRecovery = this.#clipboardOwner?.transferRecovery();
    const receipt: {status:'destroy_requested';sdk:Submission;recovery:RecoveryPacket|null;callbackFailure:DomRefusal|null;clipboardRecovery?:import('./types.js').ClipboardRecoveryTransfer} = {status:'destroy_requested',sdk,recovery:packet,callbackFailure:this.#recoveryCallbackFailure,
      ...(clipboardRecovery && (clipboardRecovery.status==='pending'||clipboardRecovery.recovery) ? {clipboardRecovery} : {})};
    this.#receipt = receipt;
    const callback = this.#onRecovery;
    this.#onRecovery = undefined; this.#onRefusal = undefined;
    let callbackFailure: DomRefusal | null = null;
    if (packet && callback && !this.#recoveryNotified) { this.#recoveryNotified=true; try { callback(this.#packet()!); } catch { callbackFailure = this.#failure('dom.recovery_callback_failed','destroy'); } }
    this.#view?.destroy({retainRegion:packet?.region?.kind === 'retained_dom'}); this.#view = null;
    if (this.#element) {
      mountedHosts.delete(this.#element);
      for (const [name,value] of this.#attributes) { if (value === null) this.#element.removeAttribute(name); else this.#element.setAttribute(name,value); }
      if (!this.#hadClass) this.#element.classList.remove('editor-surface');
    }
    this.#replacement = false; this.#initialReadFailure = null; this.#configuration = null; this.#catalog = null; this.#context = null;
    this.#original = null; this.#replacementInput = null; this.#recovery = null; this.#compositionRecovery=null;this.#typedRecovery=null; this.#element = null; this.#attributes.clear(); this.#records = 0;
    // A reentrant destroy may already have returned this exact frozen receipt.
    if(!Object.isFrozen(receipt)){receipt.callbackFailure=callbackFailure ?? this.#recoveryCallbackFailure;Object.freeze(receipt);}
    if (sdk.status === 'completed') this.#lifecycle = 'destroyed'; else void sdk.completion.then(() => { this.#lifecycle = 'destroyed'; });
    this.#settle({ ...this.#failure('dom.disposed','destroy'),response:null,recovery:packet });
    return this.#receipt;
  }
  resources(): MountedResourceCounts {
    const sdk = this.#controller?.resources() ?? {lifecycle:'destroyed' as const,sessions:0,listeners:0,queued_mutations:0,queued_bytes:0,pending_tickets:0,host_requests:0,task_continuations:0,original_input_bytes:0,callback_errors:0,callback_error_handlers:0};
    return Object.freeze({sdk,dom:Object.freeze({listeners:(this.#input?.listeners() ?? 0)+this.#selectionOwner.listeners()+(this.#clipboardOwner?.listeners() ?? 0),observers:this.#observer ? 1 : 0,continuations:(this.#replacement ? 1 : 0)+this.#selectionOwner.resources().restoreTickets+this.#selectionOwner.resources().animationFrames+(this.#clipboardOwner?.resources().continuations ?? 0)+this.#inputResources.continuations+this.#hostOwner.resources().focusContinuations,retainedInputBytes:(this.#original?.byteLength ?? 0)+(this.#replacementInput?.byteLength ?? 0)+this.#inputResources.retainedInputBytes+(this.#typedRecovery?.retainedBytes??0),retainedRecoveryRegions:Math.max(this.#recovery || this.#typedRecovery || this.#view?.hasProvisional() ? 1 : 0,this.#inputResources.retainedRecoveryRegions)}),selection:this.#selectionOwner.resources(),clipboard:this.#clipboardOwner?.resources() ?? Object.freeze({pending:0,continuations:0,retainedTextBytes:0}),hostRequests:this.#hostOwner.resources(),inputObservations:this.#inputObservations.resources(),popupPresentation:this.#popupPresentation.resources(),...(this.#inputResources.typing?{typing:this.#inputResources.typing}:{})});
  }
  nativeResources() { return this.#controller?.nativeResources() ?? null; }
}
export function mountEditor(options: MountEditorOptions): MountedEditor { return new MountedOwner(options); }
