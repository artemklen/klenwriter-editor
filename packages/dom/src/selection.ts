// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DeepReadonly, EventDto, InputSubmissionV2, PositionDto, ReadRequest, Response, SelectionDto, SessionContextV2, StampDto, StateDto, Submission } from '@klenwriter/editor-sdk';
import type { BookmarkCapture, BookmarkRestore, DomRefusal, MountedMutation, MountedMutationV2, MountedSelectionController, SelectionBookmark, SelectionResourceCounts } from './types.js';
import type { DomPoint, DomView } from './view.js';
import { domRefusal, isDomRefusal } from './refusal.js';
import { fields } from './ownership.js';
import { edgeGeometry, ownedCaretHit, visibleEdgeHit } from './selection-geometry.js';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const MAX_SERIAL=18446744073709551615n;
interface Configuration {
  element(): HTMLElement|null; view(): DomView|null; capture(): DeepReadonly<StampDto>|null;
  context(): DeepReadonly<SessionContextV2>|null; read(request:ReadRequest): Response;
  submit(request:MountedMutation): Submission|DomRefusal;
  guard(): DomRefusal|null; busy():boolean; report(failure:DomRefusal):unknown;
  recover(failure:DomRefusal):void;
  invalidated?():void;
}
interface Entry { readonly bookmark:SelectionBookmark; readonly serial:bigint }
export interface ExactBookmark { readonly selection:DeepReadonly<SelectionDto>|null; readonly stamp:DeepReadonly<StampDto>; readonly context:DeepReadonly<SessionContextV2>; readonly serial:bigint }
export interface ResultFocusPermit { readonly __resultFocusPermit:unique symbol }
interface SubmissionFrame { readonly own:boolean; readonly eligible:boolean; readonly serial:bigint; readonly before:DeepReadonly<StampDto>|null; readonly context:DeepReadonly<SessionContextV2>|null; events:number; reentrant:boolean; foreign:boolean; publications:number; publication:DeepReadonly<EventDto>|null; knownInvalidations:number; ended:boolean }
interface FocusEntry { readonly serial:bigint; readonly stamp:DeepReadonly<StampDto>; readonly selection:DeepReadonly<SelectionDto>|null; readonly context:DeepReadonly<SessionContextV2>; readonly publication:DomRefusal['diagnostic']['publication'] }
interface PointerOwner { readonly id:number; x:number;y:number;anchor:DomPoint|null }
type InputIntentObserver = (before:bigint,after:bigint,event:Event|null)=>void;
/** One per mount: identity, browser correspondence and intent, never document semantics. */
export class SelectionOwner {
  readonly api:MountedSelectionController;
  #entries=new WeakMap<SelectionBookmark,Entry>();#live=new Set<SelectionBookmark>();
  #serial=0n;#focusSerial=0n;#exhausted=false;#destroyed=false;#attached=false;
  #publishing=0;#ownPermit=0;#restoreTickets=0;#frames:SubmissionFrame[]=[];#removals:(()=>void)[]=[];
  #pointer:PointerOwner|null=null;#raf:number|null=null;#tabEntry=false;#rangeWriting=0;
  #heldMouse:number|null=null;#retiredViewImport=false;
  #inputIntentObserver:InputIntentObserver|null=null;
  #knownInvalidation:SubmissionFrame|null=null;
  #focusPermits=new WeakMap<ResultFocusPermit,FocusEntry>();
  constructor(readonly configuration:Configuration) {
    this.api=Object.freeze({captureBookmark:()=>this.captureBookmark(),restoreBookmark:(bookmark:SelectionBookmark,options?:{readonly policy?:'exact'|'mapped';readonly focus?:boolean})=>this.restoreBookmark(bookmark,options),releaseBookmark:(bookmark:SelectionBookmark)=>this.releaseBookmark(bookmark)});
  }
  intent():bigint { return this.#serial; }
  intentAvailable():boolean { return !this.#exhausted && !this.#destroyed; }
  observeInputIntent(observer:InputIntentObserver):()=>void {
    if(this.#inputIntentObserver)throw new Error('One input intent observer per selection owner');
    this.#inputIntentObserver=observer;
    return ()=>{if(this.#inputIntentObserver===observer)this.#inputIntentObserver=null;};
  }
  listeners():number { return this.#removals.length; }
  resources():SelectionResourceCounts { return Object.freeze({bookmarks:this.#live.size,restoreTickets:this.#restoreTickets,activePointers:this.#pointer?1:0,animationFrames:this.#raf===null?0:1}); }
  isPublishing():boolean { return this.#publishing>0; }
  ownsFocus():boolean { const host=this.configuration.element();return !!host && (host.ownerDocument.activeElement===host || !!host.ownerDocument.activeElement && host.contains(host.ownerDocument.activeElement)); }
  #failure(code:DomRefusal['diagnostic']['code'],publication:DomRefusal['diagnostic']['publication']='none'):DomRefusal { return domRefusal(code,'selection',this.configuration.capture(),null,null,publication); }
  #fromView(failure:DomRefusal):DomRefusal {const value={...failure,diagnostic:{...failure.diagnostic,phase:'selection' as const}};this.configuration.report(value);return value;}
  #refuse(code:DomRefusal['diagnostic']['code']):DomRefusal { const failure=this.#failure(code);this.configuration.report(failure);return failure; }
  #guard():DomRefusal|null { if(this.#destroyed)return this.#failure('dom.disposed');if(this.#exhausted)return this.#failure('dom.selection_limit');return this.configuration.guard() ?? (this.#restoreTickets || this.configuration.busy()?this.#failure('dom.busy'):null); }
  invalidate(clear=false,event:Event|null=null):void {
    for(const frame of this.#frames)if(frame!==this.#knownInvalidation)frame.foreign=true;
    const before=this.#serial;
    if(this.#serial===MAX_SERIAL)this.#exhausted=true;else this.#serial++;
    if(clear){for(const bookmark of this.#live)this.#entries.delete(bookmark);this.#live.clear();}
    this.configuration.invalidated?.();
    this.#inputIntentObserver?.(before,this.#serial,event);
  }
  #invalidateFrame(frame:SubmissionFrame):void {
    frame.knownInvalidations++;
    const previous=this.#knownInvalidation;this.#knownInvalidation=frame;
    try{this.invalidate();}finally{this.#knownInvalidation=previous;}
  }
  #focusChanged():void {if(this.#focusSerial===MAX_SERIAL)this.#exhausted=true;else this.#focusSerial++;}
  cancel():void {
    const host=this.configuration.element(),pointer=this.#pointer;this.#pointer=null;
    if(this.#raf!==null){host?.ownerDocument.defaultView?.cancelAnimationFrame(this.#raf);this.#raf=null;}
    if(pointer && host)try{if(host.hasPointerCapture(pointer.id))host.releasePointerCapture(pointer.id);}catch{/* Only this owned pointer. */}
  }
  /** Actual remount only: the old held gesture cannot supply a fresh-view caret. */
  viewReplaced():void { if(!this.#destroyed && this.#heldMouse!==null)this.#retiredViewImport=true; }
  beginSubmission(request:MountedMutationV2,input:boolean):SubmissionFrame {
    const own=this.#ownPermit>0;if(own)this.#ownPermit--;
    for(const frame of this.#frames)frame.reentrant=true;
    const harmless=['snapshot','release_snapshot'].includes(request.kind);
    if(!own && !harmless)this.cancel();
    const eligible=!own && !input && request.kind==='command' && this.#frames.length===0 && !this.configuration.busy();
    if(!own && !eligible && !harmless)this.invalidate();
    const frame:SubmissionFrame={own,eligible,serial:this.#serial,before:this.configuration.capture(),context:this.configuration.context(),events:0,reentrant:false,foreign:false,publications:0,publication:null,knownInvalidations:0,ended:false};this.#frames.push(frame);return frame;
  }
  endSubmission(frame:SubmissionFrame,result:InputSubmissionV2|DomRefusal):void {
    const current=this.#frames.pop();
    if(current!==frame){this.invalidate();this.#frames=[];return;}
    if(frame.eligible && (frame.reentrant || frame.events!==1 || frame.serial!==this.#serial || isDomRefusal(result) || result.status!=='completed' || result.response.status!=='ok')){
      // Preserve old bookmark invalidations. Only this ORIGINAL frame may later
      // recognize its own deterministic invalidation for prospective focus.
      if(!frame.reentrant && !frame.foreign && !isDomRefusal(result) && result.status==='completed' && result.response.status==='ok')this.#invalidateFrame(frame);
      else this.invalidate();
    }
    frame.ended=true;
  }
  publication(event:DeepReadonly<EventDto>):void {
    const frame=this.#frames.at(-1);
    if(frame){frame.publications++;if(frame.publications===1)frame.publication=event;else frame.foreign=true;}
    if(frame?.own && frame.events===0 && same(frame.before,event.before)){frame.events++;return;}
    if(frame?.eligible && !frame.reentrant && frame.serial===this.#serial && frame.events===0 && event.change.kind==='document' && same(frame.before,event.before)){frame.events++;return;}
    this.cancel();
    if(frame?.eligible && !frame.reentrant && !frame.foreign && frame.publications===1 && same(frame.before,event.before))this.#invalidateFrame(frame);
    else this.invalidate();
  }
  #state():DeepReadonly<StateDto>|Response {
    const response=this.configuration.read({kind:'state'});return response.status==='ok' && response.value.kind==='state'?response.value.state:response;
  }
  /** Pure exact authority check; unlike restore this never maps, consumes or writes. */
  validateExact(bookmark:SelectionBookmark):ExactBookmark|DomRefusal|{status:'sdk_failure';response:Response} {
    const guard=this.#guard();if(guard)return guard;
    const entry=bookmark && typeof bookmark==='object'?this.#entries.get(bookmark):undefined;
    if(!entry || !this.#live.has(bookmark))return this.#failure('dom.invalid_bookmark');
    const serial=this.#serial,state=this.#state();if('status' in state)return {status:'sdk_failure',response:state};
    const context=this.configuration.context(),view=this.configuration.view(),host=this.configuration.element();
    if(entry.serial!==serial || !same(bookmark.stamp,state.stamp) || !same(bookmark.context,context))return this.#failure('dom.stale_selection');
    if(!view || !host || !context)return this.#failure('dom.not_ready');
    if(bookmark.selection)for(const position of [bookmark.selection.anchor,bookmark.selection.focus]){
      const point=view.domPoint(position);if(isDomRefusal(point))return point;
      if(!point.node.isConnected || !host.contains(point.node))return this.#failure('dom.stale_selection');
    }
    if(!this.intentAvailable() || this.#serial!==serial || !same(state.stamp,this.configuration.capture()) || !same(context,this.configuration.context()))return this.#failure('dom.stale_selection');
    return Object.freeze({selection:bookmark.selection,stamp:state.stamp,context,serial});
  }
  /** Only an original synchronous frame can mint this private, one-use permit. */
  resultFocusPermit(frame:SubmissionFrame,result:InputSubmissionV2|DomRefusal):ResultFocusPermit|null {
    if(!frame.ended || !frame.eligible || frame.reentrant || frame.foreign || !this.intentAvailable() || isDomRefusal(result) || result.status!=='completed' || result.response.status!=='ok' || result.response.value.kind!=='mutation')return null;
    const state=result.response.value.state,expected=frame.serial+BigInt(frame.knownInvalidations);
    if(expected>MAX_SERIAL || this.#serial!==expected || !same(frame.context,this.configuration.context()) || !frame.context || !same(state.stamp,this.configuration.capture()))return null;
    if(frame.publications===0){if(result.response.value.effect!=='unchanged' || !same(frame.before,state.stamp))return null;}
    else if(frame.publications!==1 || !frame.publication || !same(frame.before,frame.publication.before) || !same(state.stamp,frame.publication.after))return null;
    const permit=Object.freeze({__resultFocusPermit:Symbol('result-focus')}) as ResultFocusPermit;
    this.#focusPermits.set(permit,{serial:expected,stamp:state.stamp,selection:state.selection,context:frame.context,publication:result.response.value.effect==='unchanged'?'none':'alreadyPublished'});
    return permit;
  }
  /** Presentation-only RESULT range restoration; never another set_selection. */
  focusResult(permit:ResultFocusPermit,scope:HTMLElement,continuity:()=>boolean):DomRefusal|{status:'sdk_failure';response:Response}|null {
    const entry=this.#focusPermits.get(permit);this.#focusPermits.delete(permit);
    if(!entry)return this.#failure('dom.stale_selection');
    const host=this.configuration.element(),view=this.configuration.view();
    const valid=()=>this.intentAvailable() && this.#serial===entry.serial && same(entry.stamp,this.configuration.capture()) && same(entry.context,this.configuration.context()) && !this.#guard() && continuity();
    if(!host || !view || !valid())return this.#failure('dom.stale_selection',entry.publication);
    if(!entry.selection)return this.#failure('dom.selection_missing',entry.publication);
    const doc=host.ownerDocument,active=doc.activeElement;
    if(!doc.hasFocus() || scope.ownerDocument!==doc || !scope.isConnected || !active || !scope.contains(active))return this.#failure('dom.stale_selection',entry.publication);
    const state=this.#state();if('status' in state)return {status:'sdk_failure',response:state};
    if(!same(state.stamp,entry.stamp) || !same(state.selection,entry.selection))return this.#failure('dom.stale_selection',entry.publication);
    for(const position of [entry.selection.anchor,entry.selection.focus]){
      const point=view.domPoint(position);if(isDomRefusal(point))return point;
      if(!point.node.isConnected || !host.contains(point.node))return this.#failure('dom.stale_selection',entry.publication);
    }
    const focusSerial=this.#focusSerial;
    this.#rangeWriting++;
    try{
      host.focus({preventScroll:true});
      if(!valid() || focusSerial!==this.#focusSerial || !doc.hasFocus() || !this.ownsFocus() || !scope.isConnected || scope.ownerDocument!==doc)return this.#failure('dom.stale_selection',entry.publication);
      for(const position of [entry.selection.anchor,entry.selection.focus]){
        const point=view.domPoint(position);if(isDomRefusal(point))return point;
        if(!point.node.isConnected || !host.contains(point.node))return this.#failure('dom.stale_selection',entry.publication);
      }
      const failure=view.restoreSelection(entry.selection);if(failure)return failure;
      if(!valid() || focusSerial!==this.#focusSerial || !this.ownsFocus())return this.#failure('dom.stale_selection',entry.publication);
      return null;
    }catch{return this.#failure('dom.presentation_unsupported',entry.publication);}
    finally{this.#rangeWriting--;}
  }
  captureBookmark():BookmarkCapture {
    const guard=this.#guard();if(guard)return guard;
    if(this.#live.size>=64)return this.#refuse('dom.selection_limit');
    const state=this.#state();if('status' in state)return {status:'sdk_failure',response:state};
    const context=this.configuration.context(),view=this.configuration.view();if(!context || !view)return this.#refuse('dom.not_ready');
    const browser=this.ownsFocus()?view.readSelection():null;if(isDomRefusal(browser))return this.#fromView(browser);
    if(browser && !same(browser,state.selection))return this.#refuse('dom.selection_unsynchronized');
    const bookmark=Object.freeze({selection:state.selection,stamp:state.stamp,context,__selectionBookmark:Symbol('selection-bookmark')}) as SelectionBookmark;
    this.#entries.set(bookmark,{bookmark,serial:this.#serial});this.#live.add(bookmark);
    return Object.freeze({status:'captured',bookmark});
  }
  releaseBookmark(bookmark:SelectionBookmark):boolean {
    if(!bookmark || typeof bookmark!=='object' || !this.#live.delete(bookmark))return false;
    this.#entries.delete(bookmark);return true;
  }
  restoreBookmark(bookmark:SelectionBookmark,options:{readonly policy?:'exact'|'mapped';readonly focus?:boolean}={}):BookmarkRestore {
    const guard=this.#guard();if(guard)return guard;
    try{const values=fields(options);if(Object.keys(values).some(k=>!['policy','focus'].includes(k)) || values.policy!==undefined && values.policy!=='exact' && values.policy!=='mapped' || values.focus!==undefined && typeof values.focus!=='boolean')throw new TypeError();options=values as typeof options;}catch{return this.#refuse('dom.invalid_options');}
    const entry=bookmark && typeof bookmark==='object'?this.#entries.get(bookmark):undefined;
    if(!entry || !this.#live.has(bookmark))return this.#refuse('dom.invalid_bookmark');
    let state=this.#state();if('status' in state)return {status:'sdk_failure',response:state};
    const context=this.configuration.context();
    if(entry.serial!==this.#serial || !same(bookmark.context,context) || bookmark.stamp.session!==state.stamp.session || bookmark.stamp.generation!==state.stamp.generation)return this.#refuse('dom.stale_selection');
    if(options.focus && bookmark.selection===null)return this.#refuse('dom.selection_missing');
    let selection=bookmark.selection;
    if(!same(bookmark.stamp,state.stamp)){
      if(options.policy!=='mapped' || !selection)return this.#refuse('dom.stale_selection');
      const mapped:PositionDto[]=[];
      for(const position of [selection.anchor,selection.focus]){
        const response=this.configuration.read({kind:'map_position',stamp:state.stamp as StampDto,from_revision:bookmark.stamp.revision,position:position as PositionDto});
        if(response.status!=='ok')return {status:'sdk_failure',response};
        if(response.value.kind!=='mapped' || response.value.status!=='mapped' || response.value.deleted || !response.value.position || !same(response.value.stamp,state.stamp))return this.#refuse('dom.stale_selection');
        mapped.push(response.value.position);
      }
      selection={anchor:mapped[0],focus:mapped[1]};
    }
    const view=this.configuration.view();if(!view)return this.#refuse('dom.not_ready');
    if(selection)for(const point of [selection.anchor,selection.focus]){const target=view.domPoint(point);if(isDomRefusal(target))return this.#fromView(target);}
    const captured=state.stamp,serial=this.#serial,focusSerial=this.#focusSerial;
    state=this.#state();if('status' in state)return {status:'sdk_failure',response:state};
    if(this.#guard() || serial!==this.#serial || !same(captured,state.stamp) || !same(context,this.configuration.context()))return this.#refuse('dom.stale_selection');
    this.releaseBookmark(bookmark);this.invalidate();const dispatchSerial=this.#serial;
    const result=this.#publish(selection);
    if(isDomRefusal(result))return result;
    const follow=(response:Response)=>{
      if(response.status!=='ok' || this.#destroyed)return;
      const publication=response.value.kind==='mutation' && response.value.effect==='state_changed'?'alreadyPublished':'none';
      const latest=this.#state();
      if(this.#destroyed || 'status' in latest || dispatchSerial!==this.#serial || focusSerial!==this.#focusSerial || !same(context,this.configuration.context()) || !same(latest.selection,selection)){
        if(!this.#destroyed)this.configuration.report(this.#failure('dom.stale_selection',publication));return;
      }
      if(options.focus){const host=this.configuration.element();host?.focus({preventScroll:true});if(dispatchSerial!==this.#serial || focusSerial!==this.#focusSerial || !same(context,this.configuration.context()) || !same(this.configuration.capture(),latest.stamp)){this.configuration.report(this.#failure('dom.stale_selection',publication));return;}}
      if(this.ownsFocus()){
        this.#rangeWriting++;try{const failure=view.restoreSelection(selection);if(failure)this.configuration.recover({...failure,diagnostic:{...failure.diagnostic,phase:'selection',publication}});}finally{this.#rangeWriting--;}
      }
    };
    if(result.status==='completed')follow(result.response);
    else {this.#restoreTickets++;void result.completion.then(response=>{try{follow(response);}finally{this.#restoreTickets--;}});}
    return result;
  }
  #publish(selection:DeepReadonly<SelectionDto>|null):Submission|DomRefusal {
    const stamp=this.configuration.capture();if(!stamp)return this.#refuse('dom.not_ready');
    this.#publishing++;this.#ownPermit++;try{return this.configuration.submit({kind:'set_selection',stamp:stamp as StampDto,selection:selection as SelectionDto|null});}finally{this.#publishing--;this.#ownPermit=0;}
  }
  syncFromDom(freshInput=false):DeepReadonly<SelectionDto>|DomRefusal|null {
    if(this.#rangeWriting || this.#guard())return null;
    const view=this.configuration.view(),selection=view?.readSelection();if(!selection || isDomRefusal(selection))return isDomRefusal(selection)?this.#fromView(selection):null;
    const state=this.#state();if('status' in state)return this.#refuse('dom.not_ready');
    if(!same(selection,state.selection)){
      this.invalidate();
      const result=this.#publish(selection);if(isDomRefusal(result))return result;
      if(result.status!=='completed' || result.response.status!=='ok')return this.#refuse('dom.busy');
    }
    if(freshInput)this.#retiredViewImport=false;
    return selection;
  }
  attach():void {
    if(this.#attached || this.#destroyed)return;
    const host=this.configuration.element(),doc=host?.ownerDocument,win=doc?.defaultView;if(!host || !doc || !win)return;this.#attached=true;
    const listen=(target:EventTarget,type:string,fn:EventListener,capture=false)=>{target.addEventListener(type,fn,capture);this.#removals.push(()=>target.removeEventListener(type,fn,capture));};
    const owned=(target:EventTarget|null)=>target instanceof win.Node && host.contains(target);
    // A browser selectionchange may still be queued when Tab leaves the root.
    // Window capture runs before outside UI's bookmark capture. Import only a
    // live user range; a range retired by native publication stays retired.
    // Bookmark/host-request capture itself remains pure and rejects mismatch.
    listen(win,'keydown',event=>{
      const key=event as KeyboardEvent;
      if(owned(key.target) && key.isTrusted && key.key==='Tab' && !key.altKey && !key.ctrlKey && !key.metaKey
        && !key.isComposing && !key.defaultPrevented && !this.#retiredViewImport && doc.hasFocus() && this.ownsFocus() && !this.#guard())this.syncFromDom();
    },true);
    // Window capture precedes an outside UI handle's stopped document bubble.
    // Retain only physical identity, not an event, target or selection capability.
    listen(win,'pointerdown',event=>{
      const p=event as PointerEvent;
      if(!p.isTrusted || !p.isPrimary || p.pointerType!=='mouse' || p.button!==0)return;
      this.#heldMouse=null;
      if((p.buttons&1) && Number.isSafeInteger(p.pointerId) && p.pointerId>=0 && doc.hasFocus() && this.ownsFocus())this.#heldMouse=p.pointerId;
    },true);
    for(const type of ['pointerup','pointercancel'])listen(win,type,event=>{
      const p=event as PointerEvent;if(p.isTrusted && p.pointerType==='mouse' && this.#heldMouse===p.pointerId)this.#heldMouse=null;
    },true);
    listen(doc,'keydown',event=>{
      const key=event as KeyboardEvent;
      this.#tabEntry=key.key==='Tab' && !key.altKey && !key.ctrlKey && !key.metaKey && !owned(key.target);
      if(!owned(key.target))return;
      if((key.metaKey||key.ctrlKey) && !key.altKey && key.key.toLowerCase()==='a'){
        if(this.#guard())return;key.preventDefault();this.invalidate(false,key);this.cancel();const state=this.#state();if('status' in state)return;
        const root=this.configuration.read({kind:'node',stamp:state.stamp as StampDto,node:state.root});
        if(root.status!=='ok' || root.value.kind!=='node')return;
        this.#publish({anchor:{kind:'child',parent:state.root,index:0,affinity:'after'},focus:{kind:'child',parent:state.root,index:root.value.node.children.length,affinity:'after'}});return;
      }
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(key.key) && key.isTrusted && !key.isComposing && !key.defaultPrevented && doc.hasFocus() && this.ownsFocus() && !this.#guard())this.#retiredViewImport=false;
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Backspace','Delete','Enter','Escape'].includes(key.key)){this.invalidate(false,key);this.cancel();}
    });
    listen(doc,'keyup',event=>{if((event as KeyboardEvent).key==='Tab')this.#tabEntry=false;});
    listen(doc,'pointerdown',event=>{
      const pointer=event as PointerEvent;this.#tabEntry=false;this.#focusChanged();
      this.cancel();if(!owned(pointer.target))return;this.invalidate(false,pointer);
      if(pointer.button===0 && pointer.isPrimary && pointer.pointerType==='mouse' && !this.#guard()){
        if(pointer.isTrusted && !pointer.defaultPrevented && doc.hasFocus())this.#retiredViewImport=false;
        this.#pointer={id:pointer.pointerId,x:pointer.clientX,y:pointer.clientY,anchor:null};
      }
    });
    listen(doc,'mousedown',event=>{
      const mouse=event as MouseEvent,p=this.#pointer;
      if(!p)return;
      // Compatibility mousedown supplies the real click count. Leave native
      // word/line and modified selection intact, without claiming its drag.
      if(!owned(mouse.target) || mouse.button!==0 || mouse.detail!==1 || mouse.altKey || mouse.ctrlKey || mouse.metaKey || mouse.shiftKey || mouse.defaultPrevented || !mouse.cancelable || ![mouse.clientX,mouse.clientY,p.x,p.y].every(Number.isFinite) || Math.abs(mouse.clientX-p.x)>=1 || Math.abs(mouse.clientY-p.y)>=1 || this.#guard()){this.cancel();return;}
      const view=this.configuration.view(),geometry=edgeGeometry(host);
      // Some compatibility MouseEvents truncate fractional PointerEvent CSS
      // coordinates. Correlate within one unit, but hit the precise input point.
      const point=view && geometry?ownedCaretHit(host,view,p.x,p.y,geometry):null;
      if(!point){this.cancel();this.configuration.report(this.#failure('dom.selection_geometry_unsupported'));return;}
      const serial=this.#serial,focusSerial=this.#focusSerial,stamp=this.configuration.capture(),context=this.configuration.context();
      mouse.preventDefault();host.focus({preventScroll:true});
      // Host focus callbacks may publish, replace, retarget or leave this mount.
      if(this.#pointer!==p || this.#serial!==serial || this.#focusSerial!==focusSerial || !same(stamp,this.configuration.capture()) || !same(context,this.configuration.context()) || this.#guard() || !this.ownsFocus() || !doc.hasFocus() || !host.contains(point.node)){this.cancel();return;}
      p.anchor=point;this.#writePointerRange(p,point);
    });
    listen(doc,'pointermove',event=>{
      const e=event as PointerEvent,p=this.#pointer;if(!p || p.id!==e.pointerId)return;
      if(!(e.buttons&1)){this.cancel();return;}p.x=e.clientX;p.y=e.clientY;
      if(!p.anchor)return; // The compatibility mousedown has not claimed it.
      const view=this.configuration.view(),geometry=edgeGeometry(host);
      if(!view || !geometry || this.#guard() || !this.ownsFocus() || !doc.hasFocus()){this.cancel();return;}
      if(p.y<geometry.clip.top || p.y>geometry.clip.bottom){this.#schedule();return;}
      // Apply this actual move before a possible immediate pointerup. The RAF
      // belongs only to edge-held scrolling; no release-time endpoint repair.
      const x=Math.max(geometry.clip.left+.5,Math.min(geometry.clip.right-.5,p.x));
      const point=ownedCaretHit(host,view,x,p.y,geometry);
      if(!point){this.cancel();this.configuration.report(this.#failure('dom.selection_geometry_unsupported'));return;}
      this.#writePointerRange(p,point);
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(doc,type,event=>{if(this.#pointer?.id===(event as PointerEvent).pointerId)this.cancel();});
    listen(win,'blur',()=>{this.#tabEntry=false;this.#focusChanged();this.cancel();});
    listen(doc,'focusin',event=>{
      const returning=this.#tabEntry;this.#tabEntry=false;
      if(!owned(event.target)){this.#focusChanged();this.cancel();return;}
      if(returning && event.target===host && !this.#rangeWriting && !this.#guard()){
        const state=this.#state();if(!('status' in state))this.configuration.view()?.restoreSelection(state.selection);
      }
    });
    listen(doc,'selectionchange',()=>{
      if(this.#retiredViewImport || this.#rangeWriting || this.#guard() || !this.ownsFocus())return;
      const p=this.#pointer;
      if(p){
        if(!p.anchor)return;
        const geometry=edgeGeometry(host);if(!geometry){this.cancel();this.configuration.report(this.#failure('dom.selection_geometry_unsupported'));return;}if(p.y<geometry.clip.top || p.y>geometry.clip.bottom){this.#schedule();return;}
      }
      this.syncFromDom();
    });
  }
  #schedule():void {
    if(this.#raf!==null || !this.#pointer?.anchor)return;
    const win=this.configuration.element()?.ownerDocument.defaultView;if(win)this.#raf=win.requestAnimationFrame(()=>{this.#raf=null;this.#edgeTick();});
  }
  #writePointerRange(pointer:PointerOwner,focus:DomPoint):void {
    const host=this.configuration.element(),anchor=pointer.anchor,browser=host?.ownerDocument.getSelection();
    if(this.#pointer!==pointer || !host || !anchor || !browser || !host.contains(anchor.node) || !host.contains(focus.node)){this.cancel();return;}
    this.#rangeWriting++;
    try{if(browser.anchorNode!==anchor.node || browser.anchorOffset!==anchor.offset || browser.focusNode!==focus.node || browser.focusOffset!==focus.offset)browser.setBaseAndExtent(anchor.node,anchor.offset,focus.node,focus.offset);}
    catch{this.cancel();this.configuration.report(this.#failure('dom.presentation_unsupported'));return;}
    finally{this.#rangeWriting--;}
    const selection=this.syncFromDom();if(!selection || isDomRefusal(selection))this.cancel();
  }
  #edgeTick():void {
    const host=this.configuration.element(),view=this.configuration.view(),p=this.#pointer;
    if(!host || !view || !p || this.#guard() || !this.ownsFocus() || !host.ownerDocument.hasFocus()){this.cancel();return;}
    const geometry=edgeGeometry(host);if(!geometry){this.cancel();this.configuration.report(this.#failure('dom.selection_geometry_unsupported'));return;}
    const direction=p.y<geometry.clip.top?-1:p.y>geometry.clip.bottom?1:0;if(!direction)return;
    if(!p.anchor){this.cancel();return;}
    if(!host.contains(p.anchor.node)){this.cancel();return;}
    const previous=geometry.scroller.scrollTop;
    geometry.scroller.scrollTop=Math.max(0,Math.min(geometry.scroller.scrollHeight-geometry.scroller.clientHeight,previous+direction*24));
    const focus=visibleEdgeHit(host,view,geometry,p.x,direction);
    if(!focus){this.cancel();this.configuration.report(this.#failure('dom.selection_geometry_unsupported'));return;}
    this.#writePointerRange(p,focus);
    if(this.#pointer && geometry.scroller.scrollTop!==previous)this.#schedule();
  }
  destroy():void {if(this.#destroyed)return;this.cancel();this.#heldMouse=null;this.#retiredViewImport=false;this.invalidate(true);this.#destroyed=true;for(const remove of this.#removals.splice(0))remove();}
}
