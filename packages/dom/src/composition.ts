// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DeepReadonly, Response, SelectionDto, SessionContextV2, StampDto, StateDto, Submission } from '@klenwriter/editor-sdk';
import type { CompositionObservation, CompositionWindow } from './composition-view.js';
import type { DomView } from './view.js';
import type { SelectionOwner } from './selection.js';
import type { CompositionRecovery, CompositionUnappliedInput, DomRefusal, InputCommandBindings, MountedMutation, RecoveryRegion } from './types.js';
import { domRefusal, isDomRefusal } from './refusal.js';

export interface CompositionResources { readonly continuations:number; readonly retainedInputBytes:number; readonly retainedRecoveryRegions:number }
export interface CompositionConfiguration {
  readonly element:HTMLElement; readonly view:DomView; readonly selection:SelectionOwner; readonly bindings:InputCommandBindings;
  readonly canEdit:()=>boolean; readonly busy:()=>boolean;
  readonly capture:()=>DeepReadonly<StampDto>|null; readonly context:()=>DeepReadonly<SessionContextV2>|null;
  readonly readState:()=>DeepReadonly<StateDto>|null;
  readonly submit:(request:MountedMutation)=>Submission|DomRefusal;
  readonly ordinary:(event:InputEvent)=>Submission|DomRefusal|null;
  readonly report:(failure:DomRefusal)=>unknown;
  readonly recover:(failure:DomRefusal,region?:RecoveryRegion|null,composition?:CompositionRecovery|null)=>void;
  readonly composing:(active:boolean)=>void; readonly consumeRecords:()=>number;
  readonly onResources?:(resources:CompositionResources)=>void;
}
type Reason=CompositionRecovery['reason'];
type Phase='composing'|'settling'|'committing'|'committed'|'cancelled'|'recovery';
interface Accepted {
  readonly stamp:DeepReadonly<StampDto>; readonly context:DeepReadonly<SessionContextV2>;
  readonly selection:DeepReadonly<SelectionDto>; readonly fingerprint:string;
  serial:bigint;
}
interface Generation {
  readonly id:bigint; window:CompositionWindow; readonly base:DeepReadonly<StampDto>;
  readonly context:DeepReadonly<SessionContextV2>; readonly selection:DeepReadonly<SelectionDto>;
  phase:Phase; serial:bigint; latest:CompositionObservation|null; mutations:number; captureExhausted:boolean;
  reads:number; priorRaf:string|null; priorRafMutations:number; stable:number; deadline:number|null;
  closingKey:string|null; foreignDuringClaim:boolean;
  submission:Submission|null; response:DeepReadonly<Response>|null; outcome:CompositionRecovery['nativeOutcome'];
  accepted:Accepted|null;
}
interface Permit { readonly event:KeyboardEvent; readonly key:string; readonly code:string; readonly shift:boolean; serial:bigint; readonly accepted:Accepted }
interface NativeFrame { readonly base:DeepReadonly<StampDto>; readonly context:DeepReadonly<SessionContextV2>; readonly selection:DeepReadonly<SelectionDto>; readonly affected:readonly string[] }
type Packet={readonly region:RecoveryRegion;readonly composition:CompositionRecovery};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const MAX=18446744073709551615n, TEXT_LIMIT=2097152;
const compositionType=(type:string)=>['insertCompositionText','deleteCompositionText','insertFromComposition','deleteByComposition','insertFromCompositionText'].includes(type);
const scalarKey=(key:string):boolean=>key.length===1
  ? key.charCodeAt(0)<0xd800||key.charCodeAt(0)>0xdfff
  : key.length===2&&key.charCodeAt(0)>=0xd800&&key.charCodeAt(0)<=0xdbff&&key.charCodeAt(1)>=0xdc00&&key.charCodeAt(1)<=0xdfff;

/** One mount-local generation owner. Browser observations are never native edits. */
export class CompositionOwner {
  #configuration:CompositionConfiguration|null;
  #sink:CompositionConfiguration['onResources'];
  #generation:Generation|null=null; #next=0n; #destroyed=false;
  #raf:number|null=null; #timer:number|null=null; #pending=0; #dispatching=0; #nativeScope=false; #blocked=false;
  #permit:Permit|null=null; #held=new Set<string>(); #enterReleased=false;
  #ownedEvents=new WeakSet<Event>(); #unsubscribe:(()=>void)|null;
  #packet:Packet|null=null; #unapplied:CompositionUnappliedInput|null=null; #ordinaryFrame:NativeFrame|null=null;
  /** The optional seed is internal controlled boundary setup, never a runtime setter. */
  constructor(configuration:CompositionConfiguration,generation=0n) {
    if(typeof generation!=='bigint'||generation<0n||generation>MAX)throw new RangeError('composition generation seed');
    this.#next=generation;
    this.#configuration=configuration;this.#sink=configuration.onResources;
    this.#unsubscribe=configuration.selection.observeInputIntent((before,after,event)=>{
      const g=this.#generation;if(!g)return;
      if(!configuration.selection.intentAvailable()){g.foreignDuringClaim=true;return;}
      if(event && this.#ownedEvents.has(event) && before===g.serial){
        g.serial=after;
        if(this.#permit?.serial===before){this.#permit.serial=after;this.#permit.accepted.serial=after;}
        return;
      }
      if(g.phase==='committing'){
        if(event===null && (this.#nativeScope || g.outcome==='queued') && before===g.serial)g.serial=after;
        else g.foreignDuringClaim=true;
      }
    });
  }
  #now():number {return this.#configuration?.element.ownerDocument.defaultView?.performance.now()??0;}
  #failure(reason:Reason):DomRefusal {
    const code=reason==='stale'?'dom.composition_stale':reason==='ambiguous_tail'?'dom.composition_ambiguous':reason==='settle_limit'?'dom.composition_settle_limit':reason==='capture_limit'||reason==='generation_limit'?'dom.composition_limit':reason==='busy'?'dom.busy':'dom.recovery_required';
    return domRefusal(code,'composition',this.#configuration?.capture()??this.#generation?.base??null,null,null,reason==='native_fatal'||reason==='native_unknown'?'unknown':'none');
  }
  #transfer():RecoveryRegion {
    const element=this.#configuration?.element;
    if(!element){if(this.#packet)return this.#packet.region;throw new Error('composition region already transferred');}
    return Object.freeze({kind:'retained_dom',element,reason:'capture_limit',ownership:'transferred_to_host'});
  }
  #recoveryRegion():RecoveryRegion {
    const c=this.#configuration,g=this.#generation;
    if(g?.captureExhausted)return this.#transfer();
    if(c&&g){const region=c.view.captureComposition(g.window);if(!isDomRefusal(region))return region;}
    return c?.view.captureRegion()??this.#transfer();
  }
  #input(event:InputEvent|KeyboardEvent|CompositionEvent):CompositionUnappliedInput {
    try {
      const keyboard='key'in event, input='inputType'in event;
      const data='data'in event&&typeof event.data==='string'?event.data:null;
      const key=keyboard&&typeof event.key==='string'?event.key:null;
      const code=keyboard&&typeof event.code==='string'?event.code:null;
      const inputType=input&&typeof event.inputType==='string'?event.inputType:null;
      if((data?.length??0)+(key?.length??0)+(code?.length??0)+(inputType?.length??0)>TEXT_LIMIT)throw new Error('bounded event limit');
      return Object.freeze({kind:'bounded',source:keyboard?'keydown':input?'beforeinput':'composition',inputType,data,key,code,defaultPrevented:event.defaultPrevented});
    }catch{return Object.freeze({kind:'retained_event',event,reason:'capture_limit',ownership:'transferred_to_host'});}
  }
  #retainEvent(event:InputEvent|KeyboardEvent|CompositionEvent):void {this.#unapplied=this.#input(event);this.#emit();}
  #snapshot(reason:Reason,region:RecoveryRegion):Packet {
    const g=this.#generation,frame=this.#ordinaryFrame;
    const composition:CompositionRecovery=Object.freeze({generation:(g?.id??this.#next).toString(),reason,
      context:frame?.context??g?.context??this.#configuration?.context()??null,
      base:frame?.base??g?.base??null,selection:frame?.selection??g?.selection??null,
      affectedNodeIds:Object.freeze([...(frame?.affected??g?.window.affectedNodeIds??[])]),
      submission:g?.submission??null,response:g?.response??null,nativeOutcome:g?.outcome??'not_submitted',
      unappliedInput:this.#unapplied,disposition:region.kind==='retained_dom'?'dom_transferred':'provisional_retained'});
    return Object.freeze({region,composition});
  }
  #observe():CompositionObservation|DomRefusal|null {
    const c=this.#configuration,g=this.#generation;if(!c||!g)return null;
    if(g.captureExhausted)return this.#failure('capture_limit');
    const count=c.consumeRecords();
    if(!Number.isSafeInteger(count)||count<0||count>4096-g.mutations){g.captureExhausted=true;return this.#failure('capture_limit');}
    g.mutations+=count;
    const result=c.view.observeComposition(g.window);
    if(!isDomRefusal(result)){g.latest=result;this.#emit();}
    return result;
  }
  #coherent(g:Generation):boolean {
    const c=this.#configuration,st=c?.readState(),frame=this.#ordinaryFrame;
    return !!c&&!!st&&c.selection.intentAvailable()&&g.serial===c.selection.intent()&&!g.foreignDuringClaim
      &&same(c.capture(),frame?.base??g.base)&&same(st.stamp,frame?.base??g.base)&&same(st.selection,frame?.selection??g.selection)&&same(c.context(),frame?.context??g.context);
  }
  #stop():void {
    const win=this.#configuration?.element.ownerDocument.defaultView;
    if(this.#raf!==null){win?.cancelAnimationFrame(this.#raf);this.#raf=null;}
    if(this.#timer!==null){win?.clearTimeout(this.#timer);this.#timer=null;}
    this.#emit();
  }
  #unprotect():void {
    const c=this.#configuration;if(!c)return;c.view.setComposing(false);c.view.endProvisional();c.composing(false);
  }
  #restoreOwnedSelection(g:Generation):DomRefusal|null {
    const c=this.#configuration,state=c?.readState();
    if(!c||!state||!c.selection.ownsFocus()||!this.#coherent(g))return null;
    return c.view.restoreSelection(state.selection);
  }
  #recover(reason:Reason,event?:InputEvent|KeyboardEvent|CompositionEvent,region?:RecoveryRegion,restore=false):void {
    if(this.#destroyed||!this.#configuration)return;
    if(event)this.#retainEvent(event);
    const g=this.#generation;
    if(this.#blocked)return;this.#blocked=true;
    this.#stop();this.#permit=null;
    // The safe copy/actual DOM capability is owned BEFORE any restoration/callback.
    const preserveClaim=reason==='native_fatal'||reason==='native_unknown';
    const captured=g?.captureExhausted?this.#transfer():region??(preserveClaim?g?.latest?.region:null)??this.#recoveryRegion();
    this.#packet=this.#snapshot(reason,captured);
    if(g)g.phase='committing';this.#emit();
    if(restore&&g){
      this.#unprotect();
      if(this.#destroyed)return;
      let failure=this.#configuration?.view.restoreComposition(g.window);
      if(!failure&&!this.#destroyed)failure=this.#restoreOwnedSelection(g);
      if(!failure&&this.#packet){
        this.#packet=Object.freeze({region:this.#packet.region,composition:Object.freeze({...this.#packet.composition,disposition:'committed_restored'})});
      }
    }
    if(this.#destroyed)return;
    if(g)g.phase='recovery';
    const packet=this.#packet,c=this.#configuration;
    if(packet&&c)try{c.recover(this.#failure(reason),packet.region,packet.composition);}catch{/* Root already stored the sole copy; never replace the native cause. */}
    this.#emit();
  }
  #watch(deadline:number):void {
    const c=this.#configuration;if(!c)return;
    if(this.#timer!==null)c.element.ownerDocument.defaultView?.clearTimeout(this.#timer);
    this.#timer=c.element.ownerDocument.defaultView?.setTimeout(()=>{
      this.#timer=null;if(this.#destroyed)return;
      if(this.#now()<deadline){this.#watch(deadline);return;}
      const g=this.#generation;if(!g)return;
      // A still-active UA is never destructively restored by the watchdog.
      if(g.phase==='composing')this.#recover('settle_limit',undefined,this.#transfer());
      else this.#recover('settle_limit');
    },Math.max(0,deadline-this.#now()))??null;
    this.#emit();
  }
  #schedule():void {
    const win=this.#configuration?.element.ownerDocument.defaultView;
    if(this.#raf!==null||!win)return;
    this.#raf=win.requestAnimationFrame(()=>{this.#raf=null;this.#tick();});this.#emit();
  }
  #tick():void {
    const g=this.#generation;if(this.#destroyed||!g||g.phase!=='settling')return;
    if(g.deadline===null||this.#now()>=g.deadline){this.#recover('settle_limit');return;}
    if(g.reads>=8){this.#recover('settle_limit');return;}
    g.reads++;
    const observation=this.#observe();
    if(!observation||isDomRefusal(observation)){this.#recover(observation&&isDomRefusal(observation)&&observation.diagnostic.code==='dom.composition_stale'?'stale':'capture_limit',undefined,this.#recoveryRegion());return;}
    g.stable=g.priorRaf===observation.fingerprint&&g.mutations===g.priorRafMutations?g.stable+1:1;
    g.priorRaf=observation.fingerprint;g.priorRafMutations=g.mutations;
    if(g.stable>=2){this.#claim(observation);return;}
    if(g.reads===8){this.#recover('settle_limit');return;}
    this.#schedule();
  }
  #accept(g:Generation):void {
    const c=this.#configuration;if(!c||this.#destroyed)return;
    const state=c.readState(),context=c.context(),observation=this.#observe();
    if(!state||!state.selection||!context||!observation||isDomRefusal(observation)||!same(context,g.context)||!same(c.capture(),state.stamp)||g.foreignDuringClaim||!c.selection.intentAvailable()||c.selection.intent()!==g.serial){
      this.#recover('stale',undefined,observation&&!isDomRefusal(observation)?observation.region:this.#recoveryRegion());return;
    }
    g.accepted={stamp:state.stamp,context,selection:state.selection,fingerprint:observation.fingerprint,serial:g.serial};
    g.phase=g.submission?'committed':'cancelled';this.#packet=null;this.#unapplied=null;this.#emit();
  }
  #complete(id:bigint,response:DeepReadonly<Response>):void {
    const g=this.#generation;if(this.#destroyed||!g||g.id!==id)return;
    g.response=response;g.outcome='completed';
    if(this.#blocked)return;
    if(response.status==='refused'){this.#recover('native_refused',undefined,g.latest?.region,true);return;}
    if(response.status==='fatal'){this.#recover('native_fatal');return;}
    const c=this.#configuration,st=c?.readState();
    if(!c||response.value.kind!=='mutation'||!st||!same(st,response.value.state)||!same(st.stamp,c.capture())){this.#recover('native_unknown');return;}
    if(this.#ordinaryFrame){
      // Enter/delete may change the structural topology. The completed native
      // ordinary operation gets a new checked correspondence window; the old
      // composition range never authorizes that new target or its next permit.
      if(!st.selection){this.#recover('stale');return;}
      const window=c.view.beginComposition(st.stamp,st.selection);
      try{if(isDomRefusal(window)){this.#recover('stale',undefined,this.#recoveryRegion());return;}g.window=window;}
      finally{c.view.endProvisional();}
    }
    this.#accept(g);
  }
  #ticket(g:Generation,result:Submission|DomRefusal|null):void {
    if(!result||isDomRefusal(result)){if(!this.#destroyed){g.outcome='not_submitted';this.#recover('busy');}return;}
    g.submission=result;
    if(result.status==='completed'){if(!this.#destroyed)this.#complete(g.id,result.response);return;}
    g.outcome='queued';
    if(!this.#destroyed&&this.#packet)this.#packet=this.#snapshot(this.#packet.composition.reason,this.#packet.region);
    this.#pending++;this.#emit();
    this.#await(g.id,result.completion);
  }
  #await(id:bigint,completion:Promise<Response>):void {
    // This closure captures only the owner/id, never a Generation/window/local
    // configuration. Destroy drops those owner fields while the SDK ticket runs.
    void completion.then(response=>this.#complete(id,response),()=>{if(!this.#destroyed){const current=this.#generation;if(current?.id===id){current.outcome='unknown';this.#recover('native_unknown');}}}).finally(()=>{
      this.#pending--;this.#emit();if(this.#destroyed&&this.#pending===0&&this.#dispatching===0)this.#sink=undefined;
    });
  }
  #claim(observation:CompositionObservation):void {
    const c=this.#configuration,g=this.#generation;if(!c||!g||g.phase!=='settling'||this.#destroyed)return;
    if(!this.#coherent(g)){this.#recover('stale');return;}
    if(c.busy()){this.#recover('busy');return;}
    this.#stop();g.latest=observation;g.phase='committing';g.foreignDuringClaim=false;
    this.#packet=this.#snapshot('native_unknown',observation.region);this.#emit();
    if(observation.unchanged){
      this.#unprotect();if(this.#destroyed)return;
      const failure=c.view.restoreComposition(g.window)??this.#restoreOwnedSelection(g);
      if(failure){this.#recover('capture_limit',undefined,observation.region);return;}
      this.#accept(g);return;
    }
    let command;
    try{command=c.bindings.insertText?.(observation.replacement);}catch{this.#recover('ambiguous_tail');return;}
    if(this.#destroyed)return;
    if(!command){this.#recover('ambiguous_tail');return;}
    this.#unprotect();if(this.#destroyed)return;
    g.outcome='unknown';this.#packet=this.#snapshot('native_unknown',observation.region);
    this.#nativeScope=true;this.#dispatching++;this.#emit();
    try{const result=c.submit({kind:'command',stamp:g.base as StampDto,command,history_hint:{kind:'isolated'}});this.#nativeScope=false;this.#ticket(g,result);}
    catch{this.#nativeScope=false;if(!this.#destroyed)this.#recover('native_unknown');}
    finally{this.#dispatching--;this.#emit();if(this.#destroyed&&this.#pending===0)this.#sink=undefined;}
  }
  start(event:CompositionEvent):void {
    const c=this.#configuration;if(this.#destroyed||!c||this.#blocked)return;
    if(this.#generation&&['composing','settling','committing','recovery'].includes(this.#generation.phase)){this.#recover('ambiguous_tail',event,this.#transfer());return;}
    this.#retainEvent(event);
    if(this.#next===MAX||!c.selection.intentAvailable()){this.#recover('generation_limit',event,this.#transfer());return;}
    if(!c.canEdit()||c.busy()){this.#recover('busy',event,this.#transfer());return;}
    const synced=c.selection.syncFromDom();
    if(this.#destroyed)return;
    const state=c.readState(),base=c.capture(),context=c.context();
    if(!synced||isDomRefusal(synced)||!state?.selection||!base||!context||!same(synced,state.selection)||!same(base,state.stamp)){this.#recover('stale',event,this.#transfer());return;}
    this.#ownedEvents.add(event);c.selection.invalidate(false,event);
    if(!c.selection.intentAvailable()){this.#recover('generation_limit',event,this.#transfer());return;}
    const window=c.view.beginComposition(base,state.selection);
    if(isDomRefusal(window)){this.#recover('capture_limit',event,this.#transfer());return;}
    this.#next++;this.#generation={id:this.#next,window,base,context,selection:state.selection,phase:'composing',serial:c.selection.intent(),latest:null,mutations:0,captureExhausted:false,reads:0,priorRaf:null,priorRafMutations:0,stable:0,deadline:null,closingKey:null,foreignDuringClaim:false,submission:null,response:null,outcome:'not_submitted',accepted:null};
    this.#packet=null;this.#ordinaryFrame=null;this.#permit=null;this.#enterReleased=false;
    c.selection.cancel();c.view.setComposing(true);c.composing(true);this.#observe();this.#emit();
  }
  update(event:CompositionEvent):void {
    if(this.#destroyed)return;this.#retainEvent(event);if(this.#blocked)return;
    if(!this.#generation){this.#recover('ambiguous_tail',event,this.#transfer());return;}
    if(this.#generation.phase==='composing'){
      const observation=this.#observe();if(!observation||isDomRefusal(observation))this.#recover(observation&&isDomRefusal(observation)&&observation.diagnostic.code==='dom.composition_stale'?'stale':'capture_limit',event,this.#recoveryRegion());
    }
  }
  end(event:CompositionEvent):void {
    const c=this.#configuration,g=this.#generation;if(this.#destroyed||!c||this.#blocked)return;
    if(!g){this.#recover('ambiguous_tail',event,this.#transfer());return;}
    if(g.phase==='committing'||g.phase==='settling')return;
    if(g.phase==='committed'||g.phase==='cancelled'){this.#tail(event);return;}
    if(g.phase!=='composing')return;
    this.#retainEvent(event);const observation=this.#observe();
    if(!observation||isDomRefusal(observation)){this.#recover(observation&&isDomRefusal(observation)&&observation.diagnostic.code==='dom.composition_stale'?'stale':'capture_limit',event,this.#recoveryRegion());return;}
    g.phase='settling';g.deadline=this.#now()+250;g.reads=0;g.priorRaf=null;g.priorRafMutations=g.mutations;g.stable=0;
    c.view.setComposing(false);c.composing(false);this.#watch(g.deadline);this.#schedule();
  }
  blur(_event:Event):void {
    const g=this.#generation;if(this.#destroyed||!g||g.phase!=='composing')return;
    this.#observe();if(this.#timer===null)this.#watch(this.#now()+250);
  }
  #tail(event:InputEvent|CompositionEvent):void {
    const g=this.#generation,c=this.#configuration;if(!g||!c)return;
    const observation=this.#observe();
    if(!observation||isDomRefusal(observation)){this.#recover(observation&&isDomRefusal(observation)&&observation.diagnostic.code==='dom.composition_stale'?'stale':'capture_limit',event,this.#recoveryRegion());return;}
    if(g.accepted&&observation.fingerprint===g.accepted.fingerprint&&same(c.capture(),g.accepted.stamp)&&same(c.context(),g.accepted.context)&&c.selection.intentAvailable()&&c.selection.intent()===g.accepted.serial)return;
    this.#recover('ambiguous_tail',event,observation.region);
  }
  beforeInput(event:InputEvent):boolean {
    const g=this.#generation,c=this.#configuration;if(this.#destroyed||!c)return false;
    if(this.#blocked){if(event.cancelable)event.preventDefault();return true;}
    if(!g){if(compositionType(event.inputType)||event.isComposing){this.#recover('ambiguous_tail',event,this.#transfer());if(event.cancelable)event.preventDefault();return true;}return false;}
    if(g.phase==='recovery'){if(event.cancelable)event.preventDefault();return true;}
    if(g.phase==='composing'&&(event.isComposing||compositionType(event.inputType))){
      this.#ownedEvents.add(event);c.selection.invalidate(false,event);return true;
    }
    if(g.phase==='settling'&&(event.isComposing||compositionType(event.inputType)))return true;
    if(g.phase==='committing'){
      if(compositionType(event.inputType)){if(event.cancelable)event.preventDefault();return true;}
      this.#recover('busy',event);if(event.cancelable)event.preventDefault();return true;
    }
    if((g.phase==='committed'||g.phase==='cancelled')&&this.#permit&&(event.isComposing||compositionType(event.inputType))){
      this.#permit=null;this.#recover('ambiguous_tail',event);if(event.cancelable)event.preventDefault();return true;
    }
    if((g.phase==='committed'||g.phase==='cancelled')&&!event.isComposing&&!compositionType(event.inputType)&&this.#permit){
      const permit=this.#permit;this.#permit=null;this.#retainEvent(event);
      const inputType=permit.key==='Backspace'?'deleteContentBackward':permit.key==='Delete'?'deleteContentForward':permit.key==='Enter'?(permit.shift?'insertLineBreak':'insertParagraph'):'insertText';
      if(!event.cancelable||event.inputType!==inputType||inputType==='insertText'&&event.data!==permit.key||!this.#accepted(permit.accepted,permit.serial)||!this.#targetRange(event)){
        this.#recover('ambiguous_tail',event);if(event.cancelable)event.preventDefault();return true;
      }
      const state=c.readState();if(!state?.selection){this.#recover('stale',event);event.preventDefault();return true;}
      const node=(p:DeepReadonly<SelectionDto>['anchor'])=>p.kind==='child'?p.parent:p.node;
      this.#ordinaryFrame={base:state.stamp,context:permit.accepted.context,selection:state.selection,affected:Object.freeze([...new Set([node(state.selection.anchor),node(state.selection.focus)])])};
      this.#ownedEvents.add(event);
      g.phase='committing';g.foreignDuringClaim=false;g.submission=null;g.response=null;g.outcome='unknown';
      this.#packet=this.#snapshot('native_unknown',g.latest?.region??this.#transfer());this.#emit();
      this.#nativeScope=true;this.#dispatching++;this.#emit();
      try{const result=c.ordinary(event);this.#nativeScope=false;this.#ticket(g,result);}
      catch{this.#nativeScope=false;if(!this.#destroyed)this.#recover('native_unknown',event);}
      finally{this.#dispatching--;this.#emit();if(this.#destroyed&&this.#pending===0)this.#sink=undefined;}
      return true;
    }
    if((g.phase==='committed'||g.phase==='cancelled')&&compositionType(event.inputType)){this.#tail(event);if(event.cancelable)event.preventDefault();return true;}
    this.#recover(g.phase==='settling'||g.phase==='composing'?'busy':'ambiguous_tail',event);if(event.cancelable)event.preventDefault();return true;
  }
  input(event:InputEvent):boolean {
    const g=this.#generation;if(this.#destroyed)return false;
    if(this.#blocked)return true;
    if(!g){if(compositionType(event.inputType)||event.isComposing){this.#recover('ambiguous_tail',event,this.#transfer());return true;}return false;}
    if(g.phase==='committed'||g.phase==='cancelled'){this.#tail(event);return true;}
    if(g.phase==='recovery')return true;
    if(g.phase==='committing'){
      const previous=g.latest,observation=this.#observe();
      if(observation&&!isDomRefusal(observation)&&previous&&observation.replacement!==previous.replacement)this.#recover('busy',event,observation.region);
      return true;
    }
    const observation=this.#observe();if(!observation||isDomRefusal(observation))this.#recover(observation&&isDomRefusal(observation)&&observation.diagnostic.code==='dom.composition_stale'?'stale':'capture_limit',event,this.#recoveryRegion());
    return true;
  }
  #accepted(accepted:Accepted,serial=accepted.serial):boolean {
    const c=this.#configuration,g=this.#generation,state=c?.readState();if(!c||!g||!state)return false;
    if(!c.selection.intentAvailable()||c.selection.intent()!==serial||!same(c.capture(),accepted.stamp)||!same(state.stamp,accepted.stamp)||!same(state.selection,accepted.selection)||!same(c.context(),accepted.context)||!c.selection.ownsFocus()||!same(c.view.readSelection(),state.selection))return false;
    const observation=this.#observe();return !!observation&&!isDomRefusal(observation)&&observation.fingerprint===accepted.fingerprint;
  }
  #targetRange(event:InputEvent):boolean {
    const c=this.#configuration,browser=c?.element.ownerDocument.getSelection();
    if(!c||!browser||!browser.isCollapsed||!browser.anchorNode||!c.element.contains(browser.anchorNode))return false;
    try{const ranges=event.getTargetRanges?.()??[];return ranges.length===0||ranges.length===1&&ranges[0].startContainer===browser.anchorNode&&ranges[0].endContainer===browser.focusNode&&ranges[0].startOffset===browser.anchorOffset&&ranges[0].endOffset===browser.focusOffset;}catch{return false;}
  }
  keydown(event:KeyboardEvent):void {
    const c=this.#configuration;if(this.#destroyed||!c)return;
    const id=event.code||event.key,previous=this.#held.has(id);this.#held.add(id);
    const g=this.#generation;if(!g)return;
    if(g.phase==='composing'){
      g.closingKey=id;this.#ownedEvents.add(event);c.selection.invalidate(false,event);return;
    }
    const ordinary=!event.isComposing&&event.keyCode!==229&&!['Dead','Process','Escape','Shift','Control','Alt','Meta'].includes(event.key)
      &&!event.altKey&&!event.ctrlKey&&!event.metaKey&&(scalarKey(event.key)||['Backspace','Delete','Enter'].includes(event.key));
    if(!ordinary)return;
    if(g.phase==='recovery')return;
    if(g.phase==='settling'||g.phase==='committing'){this.#recover('busy',event);event.preventDefault();return;}
    if(previous||event.repeat||event.key==='Enter'&&(!g.closingKey||g.closingKey==='Enter'||g.closingKey==='NumpadEnter')&&!this.#enterReleased){this.#recover('ambiguous_tail',event);event.preventDefault();return;}
    if(this.#permit||!g.accepted||!this.#accepted(g.accepted)||c.busy()){this.#recover('ambiguous_tail',event);event.preventDefault();return;}
    this.#permit={event,key:event.key,code:event.code,shift:event.shiftKey,serial:g.accepted.serial,accepted:g.accepted};
    this.#ownedEvents.add(event);c.selection.invalidate(false,event);
  }
  keyup(event:KeyboardEvent):void {
    this.#held.delete(event.code||event.key);if(event.key==='Enter')this.#enterReleased=true;
    if(this.#permit&&(this.#permit.code||this.#permit.key)===(event.code||event.key))this.#permit=null;
  }
  externalSubmission(request:MountedMutation,result:Submission|DomRefusal):void {
    const c=this.#configuration,g=this.#generation;
    if(!c||!g||this.#destroyed||!['committed','cancelled'].includes(g.phase)||['snapshot','release_snapshot','acknowledge_snapshot','reconcile_snapshot','barrier'].includes(request.kind)||isDomRefusal(result)||result.status!=='completed'||result.response.status!=='ok')return;
    const state=c.readState();if(!state?.selection||!same(state.stamp,c.capture())||!same(c.context(),g.context)||!c.selection.intentAvailable())return;
    const window=c.view.beginComposition(state.stamp,state.selection);
    try{if(isDomRefusal(window))return;const observation=c.view.observeComposition(window);if(isDomRefusal(observation)||!observation.unchanged)return;
      this.#generation=null;this.#permit=null;this.#unapplied=null;this.#packet=null;this.#ordinaryFrame=null;
    }finally{c.view.endProvisional();this.#emit();}
  }
  isProtected():boolean {return this.#blocked||!!this.#generation&&['composing','settling','committing','recovery'].includes(this.#generation.phase);}
  isCommitting():boolean {return this.#generation?.phase==='committing';}
  retained(reason:Reason='destroyed'):Packet|null {
    if(this.#packet&&(!this.#generation||['native_refused','native_fatal','native_unknown'].includes(this.#packet.composition.reason)||this.#packet.composition.disposition==='committed_restored'||this.#generation.phase==='committing'||this.#destroyed))return this.#packet;
    const g=this.#generation;if(!g||!this.isProtected())return null;
    const observation=this.#observe();
    const region=observation&&!isDomRefusal(observation)?observation.region:this.#recoveryRegion();
    this.#packet=this.#snapshot(this.#packet?.composition.reason??reason,region);this.#emit();return this.#packet;
  }
  resources():CompositionResources {
    const regions=new Set<RecoveryRegion>();
    if(!this.#destroyed){if(this.#packet)regions.add(this.#packet.region);if(this.#generation?.latest)regions.add(this.#generation.latest.region);if(this.#generation)regions.add(this.#generation.window.originalRegion);}
    let retainedInputBytes=0;for(const region of regions)if(region.kind==='bounded')retainedInputBytes+=2*(region.originalText.length+region.provisionalText.length);
    if(!this.#destroyed&&this.#generation){
      const g=this.#generation;
      if(g.latest)retainedInputBytes+=2*(g.latest.fingerprint.length+g.latest.replacement.length);
      if(g.accepted&&g.accepted.fingerprint!==g.latest?.fingerprint)retainedInputBytes+=2*g.accepted.fingerprint.length;
    }
    if(!this.#destroyed&&this.#unapplied?.kind==='bounded')retainedInputBytes+=2*((this.#unapplied.data?.length??0)+(this.#unapplied.key?.length??0)+(this.#unapplied.code?.length??0)+(this.#unapplied.inputType?.length??0));
    return Object.freeze({continuations:this.#pending+this.#dispatching+Number(this.#raf!==null)+Number(this.#timer!==null),retainedInputBytes,retainedRecoveryRegions:regions.size});
  }
  #emit():void {try{this.#sink?.(this.resources());}catch{/* Internal numeric accounting must not replace semantic outcome. */}}
  destroy():void {
    if(this.#destroyed)return;
    this.retained('destroyed');this.#stop();this.#destroyed=true;this.#unsubscribe?.();this.#unsubscribe=null;
    this.#permit=null;this.#held.clear();this.#generation=null;this.#ordinaryFrame=null;this.#unapplied=null;
    this.#configuration=null;this.#packet=null;this.#emit();if(this.#pending===0&&this.#dispatching===0)this.#sink=undefined;
  }
}
