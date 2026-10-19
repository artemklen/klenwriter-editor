// SPDX-License-Identifier: MIT OR Apache-2.0
import type { CommandDto, DeepReadonly, EditorControllerV2, HostRequest, SessionContextV2, StampDto, Submission } from '@klenwriter/editor-sdk';
import { fields, ownConfiguration } from './ownership.js';
import { domRefusal, isDomRefusal } from './refusal.js';
import type { ExactBookmark, ResultFocusPermit, SelectionOwner } from './selection.js';
import type { DomRefusal, HostFocus, MountedHostCapture, MountedHostRequest, MountedHostRequests, MountedMutation, SelectionBookmark, SelectionReadFailure } from './types.js';
import type { DomView } from './view.js';

const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
type CommandRequest=Extract<MountedMutation,{kind:'command'}>;
type Failure=DomRefusal|SelectionReadFailure;
export interface HostDispatch { readonly result:Submission|Failure; readonly permit:ResultFocusPermit|null }
interface Configuration {
  element():HTMLElement|null;
  view():DomView|null;
  controller():EditorControllerV2|null;
  capture():DeepReadonly<StampDto>|null;
  context():DeepReadonly<SessionContextV2>|null;
  selection:SelectionOwner;
  guard():DomRefusal|null;
  report(failure:DomRefusal):DomRefusal;
  dispatch(request:CommandRequest,handle:HostRequest,validate:()=>Failure|null):HostDispatch;
}
interface Entry {
  readonly request:MountedHostRequest;
  readonly serial:bigint;
  readonly epoch:object;
  bookmark:SelectionBookmark|null;
  sdk:HostRequest|null;
  scope:HTMLElement|null;
}
function queuedFocus(submission:Extract<Submission,{status:'queued'}>,counts:{focusContinuations:number},failure:DomRefusal):Promise<HostFocus>{
  counts.focusContinuations++;
  return submission.completion.then(response=>Object.freeze({status:'not_restored' as const,failure:response.status==='ok'?failure:{status:'sdk_failure' as const,response}}),()=>Object.freeze({status:'not_restored' as const,failure})).finally(()=>{counts.focusContinuations--;});
}

/** Identity capabilities around the existing SDK request, never another queue. */
export class HostRequestOwner {
  readonly api:MountedHostRequests;
  #configuration:Configuration|null;
  #live=new Map<MountedHostRequest,Entry>();
  #retired=new WeakSet<MountedHostRequest>();
  #active=new Set<Entry>();
  #epoch:object={};
  // Pending original promises retain this numeric cell, not a mount or DOM scope.
  #counts={focusContinuations:0};
  constructor(configuration:Configuration){
    this.#configuration=configuration;
    this.api=Object.freeze({status:()=>this.status(),capture:(options?:{readonly focusScope?:HTMLElement})=>this.capture(options),
      complete:(request:MountedHostRequest,command:CommandDto,options?:{readonly focus?:'native_result'|'none'})=>this.complete(request,command,options),
      cancel:(request:MountedHostRequest,options?:{readonly focus?:boolean})=>this.cancel(request,options),release:(request:MountedHostRequest)=>this.release(request)});
  }
  resources():Readonly<{pending:number;focusContinuations:number}>{return Object.freeze({pending:this.#live.size,focusContinuations:this.#counts.focusContinuations});}
  #failure(code:DomRefusal['diagnostic']['code'],publication:DomRefusal['diagnostic']['publication']='none'):DomRefusal {
    return domRefusal(code,'host_request',this.#configuration?.capture() ?? null,null,null,publication);
  }
  #phase(failure:DomRefusal):DomRefusal{return Object.freeze({...failure,diagnostic:Object.freeze({...failure.diagnostic,phase:'host_request' as const})});}
  #report(failure:DomRefusal):DomRefusal{return this.#configuration?.report(this.#phase(failure)) ?? this.#phase(failure);}
  #dispose(entry:Entry):void {
    const c=this.#configuration;
    if(entry.sdk)c?.controller()?.releaseHostRequest(entry.sdk);
    if(entry.bookmark)c?.selection.releaseBookmark(entry.bookmark);
    entry.sdk=null;entry.bookmark=null;entry.scope=null;
  }
  /** Called synchronously by the independent selection invalidation hook. */
  intentChanged():void {this.#retireLive();}
  #retireLive():void {
    for(const [request,entry] of this.#live){this.#retired.add(request);this.#dispose(entry);}
    this.#live.clear();
  }
  /** Mode/replace/recovery/destroy also revoke claimed prospective focus. */
  retire():void {
    this.#epoch={};this.#retireLive();
    for(const entry of this.#active)this.#dispose(entry);
  }
  #sweep():void {
    const c=this.#configuration;if(!c)return;
    const stamp=c.capture(),context=c.context(),serial=c.selection.intent();
    for(const [request,entry] of this.#live){
      if(!c.selection.intentAvailable() || entry.serial!==serial || !same(request.stamp,stamp) || !same(request.context,context)){
        this.#live.delete(request);this.#retired.add(request);this.#dispose(entry);
      }
    }
  }
  publication():void {this.#sweep();}
  status():ReturnType<MountedHostRequests['status']>{
    this.#sweep();const c=this.#configuration;
    if(!c)return this.#failure('dom.disposed');
    const failure=c.guard();if(failure)return this.#phase(failure);
    const stamp=c.capture(),context=c.context();
    return stamp && context?Object.freeze({status:'available' as const,stamp,context}):this.#failure('dom.not_ready');
  }
  #validScope(scope:unknown,host:HTMLElement):scope is HTMLElement {
    const win=host.ownerDocument.defaultView;
    return !!win && scope instanceof win.HTMLElement && scope.ownerDocument===host.ownerDocument && scope.isConnected && !host.contains(scope) && !scope.contains(host);
  }
  capture(options:{readonly focusScope?:HTMLElement}={}):MountedHostCapture {
    const available=this.status();if(isDomRefusal(available))return this.#report(available);
    const c=this.#configuration!;let scope:HTMLElement|null=null;
    try{
      const values=fields(options),host=c.element();
      if(Object.keys(values).some(key=>key!=='focusScope') || !host)throw new TypeError();
      if(values.focusScope!==undefined){if(!this.#validScope(values.focusScope,host))throw new TypeError();scope=values.focusScope;}
    }catch{return this.#report(this.#failure('dom.invalid_options'));}
    if(this.#live.size>=64)return this.#report(this.#failure('dom.selection_limit'));
    const captured=c.selection.captureBookmark();if(captured.status!=='captured')return isDomRefusal(captured)?this.#phase(captured):captured;
    let sdk:HostRequest|null=null,retained=false;
    try{
      const exact=c.selection.validateExact(captured.bookmark);
      if('status' in exact)return isDomRefusal(exact)?this.#report(exact):exact;
      const raw=c.selection.ownsFocus()?c.view()?.readSelection():undefined;
      if(isDomRefusal(raw))return this.#report(raw);
      if(raw!==undefined && !same(raw,exact.selection))return this.#report(this.#failure('dom.selection_unsynchronized'));
      const controller=c.controller();if(!controller)return this.#report(this.#failure('dom.disposed'));
      const request=controller.captureHostRequest();
      if(request.status!=='captured')return {status:'sdk_failure',response:request.response};
      sdk=request.request;
      const checked=c.selection.validateExact(captured.bookmark),guard=c.guard();
      if(guard)return this.#report(guard);
      if('status' in checked)return isDomRefusal(checked)?this.#report(checked):checked;
      if(this.#configuration!==c || !same(available.stamp,checked.stamp) || !same(available.context,checked.context) || !same(sdk.stamp,checked.stamp) || scope && (!c.element() || !this.#validScope(scope,c.element()!)))return this.#report(this.#failure('dom.stale_host_request'));
      const descriptor=Object.freeze({stamp:checked.stamp,context:checked.context,__mountedHostRequest:Symbol('mounted-host-request')}) as MountedHostRequest;
      this.#live.set(descriptor,{request:descriptor,serial:checked.serial,epoch:this.#epoch,bookmark:captured.bookmark,sdk,scope});retained=true;
      return Object.freeze({status:'captured',request:descriptor});
    }finally{if(!retained){if(sdk)c.controller()?.releaseHostRequest(sdk);c.selection.releaseBookmark(captured.bookmark);}}
  }
  #claim(request:MountedHostRequest):Entry|DomRefusal {
    const entry=this.#live.get(request);
    if(!entry)return this.#failure(request && typeof request==='object' && this.#retired.has(request)?'dom.stale_host_request':'dom.invalid_host_request');
    // Consume identity before option/command inspection, callbacks or any read.
    this.#live.delete(request);this.#active.add(entry);return entry;
  }
  #exact(entry:Entry):ExactBookmark|Failure {
    const c=this.#configuration;
    if(!c || entry.epoch!==this.#epoch || !entry.bookmark || !entry.sdk)return this.#failure('dom.stale_host_request');
    const guard=c.guard();if(guard)return this.#phase(guard);
    const exact=c.selection.validateExact(entry.bookmark);if('status' in exact)return isDomRefusal(exact)?this.#phase(exact):exact;
    if(exact.serial!==entry.serial || !same(entry.request.stamp,exact.stamp) || !same(entry.request.context,exact.context) || !same(entry.sdk.stamp,exact.stamp))return this.#failure('dom.stale_host_request');
    return exact;
  }
  #focus(entry:Entry,result:Submission,permit:ResultFocusPermit|null):HostFocus {
    const c=this.#configuration,scope=entry.scope;
    if(result.status!=='completed' || result.response.status!=='ok')return Object.freeze({status:'not_restored',failure:result.status==='completed'?{status:'sdk_failure' as const,response:result.response}:this.#failure('dom.stale_host_request')});
    const publication=result.response.value.kind==='mutation' && result.response.value.effect!=='unchanged'?'alreadyPublished':'none';
    if(!c || !scope || !permit || entry.epoch!==this.#epoch || !c.element() || !this.#validScope(scope,c.element()!))return Object.freeze({status:'not_restored',failure:this.#failure('dom.stale_host_request',publication)});
    const failure=c.selection.focusResult(permit,scope,()=>this.#configuration===c && entry.epoch===this.#epoch && entry.scope===scope && !!c.element() && this.#validScope(scope,c.element()!) && !c.guard());
    return failure?Object.freeze({status:'not_restored',failure:isDomRefusal(failure)?this.#phase(failure):failure}):Object.freeze({status:'restored',failure:null});
  }
  complete(request:MountedHostRequest,command:CommandDto,options:{readonly focus?:'native_result'|'none'}={}):ReturnType<MountedHostRequests['complete']>{
    const entry=this.#claim(request);if(isDomRefusal(entry))return this.#report(entry);
    try{
      let owned:CommandDto,focus:'native_result'|'none';
      try{
        const values=fields(options);
        if(Object.keys(values).some(key=>key!=='focus') || values.focus!==undefined && values.focus!=='native_result' && values.focus!=='none')throw new TypeError();
        focus=values.focus as typeof focus ?? 'native_result';owned=ownConfiguration(command);
        const data=fields(owned);if(Object.keys(data).length!==2 || typeof data.id!=='string' || typeof data.payload_json!=='string')throw new TypeError();
      }catch{return this.#report(this.#failure('dom.invalid_options'));}
      const checked=this.#exact(entry);if('status' in checked)return isDomRefusal(checked)?this.#report(checked):checked;
      const c=this.#configuration!,handle=entry.sdk!;
      const dispatched=c.dispatch({kind:'command',stamp:checked.stamp as StampDto,command:owned,history_hint:{kind:'isolated'}},handle,()=>{const exact=this.#exact(entry);return 'status' in exact?exact:null;});
      if(isDomRefusal(dispatched.result) || dispatched.result.status==='sdk_failure')return dispatched.result;
      const submission=dispatched.result;let completion:Promise<HostFocus>;
      if(focus==='none')completion=Promise.resolve(Object.freeze({status:'not_requested',failure:null}));
      else if(submission.status==='completed')completion=Promise.resolve(this.#focus(entry,submission,dispatched.permit));
      else{
        completion=queuedFocus(submission,this.#counts,this.#failure('dom.stale_host_request'));
      }
      return Object.freeze({status:'submitted',submission,focus:completion});
    }finally{this.#active.delete(entry);this.#dispose(entry);}
  }
  cancel(request:MountedHostRequest,options:{readonly focus?:boolean}={}):ReturnType<MountedHostRequests['cancel']>{
    const entry=this.#claim(request);if(isDomRefusal(entry))return this.#report(entry);
    try{
      let focus:boolean;
      try{const values=fields(options);if(Object.keys(values).some(key=>key!=='focus') || values.focus!==undefined && typeof values.focus!=='boolean')throw new TypeError();focus=values.focus as boolean ?? true;}
      catch{return this.#report(this.#failure('dom.invalid_options'));}
      const exact=this.#exact(entry);if('status' in exact)return isDomRefusal(exact)?this.#report(exact):exact;
      const c=this.#configuration!,bookmark=entry.bookmark!;
      if(entry.sdk)c.controller()?.releaseHostRequest(entry.sdk);entry.sdk=null;
      const restore=c.selection.restoreBookmark(bookmark,{policy:'exact',focus});
      return Object.freeze({status:'cancelled',restore});
    }finally{this.#active.delete(entry);this.#dispose(entry);}
  }
  release(request:MountedHostRequest):boolean {
    this.#sweep();const entry=this.#live.get(request);if(!entry)return false;
    this.#live.delete(request);this.#active.add(entry);
    try{const valid=!('status' in this.#exact(entry));if(!valid)this.#retired.add(request);return valid;}
    finally{this.#active.delete(entry);this.#dispose(entry);}
  }
  destroy():void {this.retire();this.#configuration=null;}
}
