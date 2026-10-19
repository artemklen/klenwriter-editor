// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DeepReadonly, EventDto, PositionDto, ReadRequest, Response, SelectionDto, SessionContextV2, StampDto, StateDto, Submission } from '@klenwriter/editor-sdk';
import type { BookmarkCapture, BookmarkRestore, DomRefusal, MountedMutation, MountedSelectionController, SelectionBookmark, SelectionResourceCounts } from './types.js';
import type { DomPoint, DomView } from './view.js';
import { domRefusal, isDomRefusal } from './refusal.js';
import { fields } from './ownership.js';
import { edgeGeometry, visibleEdgeHit } from './selection-geometry.js';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const MAX_SERIAL=18446744073709551615n;
interface Configuration {
  element(): HTMLElement|null; view(): DomView|null; capture(): DeepReadonly<StampDto>|null;
  context(): DeepReadonly<SessionContextV2>|null; read(request:ReadRequest): Response;
  submit(request:MountedMutation): Submission|DomRefusal;
  guard(): DomRefusal|null; busy():boolean; report(failure:DomRefusal):unknown;
  recover(failure:DomRefusal):void;
}
interface Entry { readonly bookmark:SelectionBookmark; readonly serial:bigint }
interface SubmissionFrame { readonly own:boolean; readonly eligible:boolean; readonly serial:bigint; readonly before:DeepReadonly<StampDto>|null; events:number; reentrant:boolean }
interface PointerOwner { readonly id:number; x:number;y:number;anchor:DomPoint|null }
/** One per mount: identity, browser correspondence and intent, never document semantics. */
export class SelectionOwner {
  readonly api:MountedSelectionController;
  #entries=new WeakMap<SelectionBookmark,Entry>();#live=new Set<SelectionBookmark>();
  #serial=0n;#focusSerial=0n;#exhausted=false;#destroyed=false;#attached=false;
  #publishing=0;#ownPermit=0;#restoreTickets=0;#frames:SubmissionFrame[]=[];#removals:(()=>void)[]=[];
  #pointer:PointerOwner|null=null;#raf:number|null=null;#tabEntry=false;#rangeWriting=0;
  constructor(readonly configuration:Configuration) {
    this.api=Object.freeze({captureBookmark:()=>this.captureBookmark(),restoreBookmark:(bookmark:SelectionBookmark,options?:{readonly policy?:'exact'|'mapped';readonly focus?:boolean})=>this.restoreBookmark(bookmark,options),releaseBookmark:(bookmark:SelectionBookmark)=>this.releaseBookmark(bookmark)});
  }
  intent():bigint { return this.#serial; }
  listeners():number { return this.#removals.length; }
  resources():SelectionResourceCounts { return Object.freeze({bookmarks:this.#live.size,restoreTickets:this.#restoreTickets,activePointers:this.#pointer?1:0,animationFrames:this.#raf===null?0:1}); }
  isPublishing():boolean { return this.#publishing>0; }
  ownsFocus():boolean { const host=this.configuration.element();return !!host && (host.ownerDocument.activeElement===host || !!host.ownerDocument.activeElement && host.contains(host.ownerDocument.activeElement)); }
  #failure(code:DomRefusal['diagnostic']['code'],publication:DomRefusal['diagnostic']['publication']='none'):DomRefusal { return domRefusal(code,'selection',this.configuration.capture(),null,null,publication); }
  #fromView(failure:DomRefusal):DomRefusal {const value={...failure,diagnostic:{...failure.diagnostic,phase:'selection' as const}};this.configuration.report(value);return value;}
  #refuse(code:DomRefusal['diagnostic']['code']):DomRefusal { const failure=this.#failure(code);this.configuration.report(failure);return failure; }
  #guard():DomRefusal|null { if(this.#destroyed)return this.#failure('dom.disposed');if(this.#exhausted)return this.#failure('dom.selection_limit');return this.configuration.guard() ?? (this.#restoreTickets || this.configuration.busy()?this.#failure('dom.busy'):null); }
  invalidate(clear=false):void {
    if(this.#serial===MAX_SERIAL)this.#exhausted=true;else this.#serial++;
    if(clear){for(const bookmark of this.#live)this.#entries.delete(bookmark);this.#live.clear();}
  }
  #focusChanged():void {if(this.#focusSerial===MAX_SERIAL)this.#exhausted=true;else this.#focusSerial++;}
  cancel():void {
    const host=this.configuration.element(),pointer=this.#pointer;this.#pointer=null;
    if(this.#raf!==null){host?.ownerDocument.defaultView?.cancelAnimationFrame(this.#raf);this.#raf=null;}
    if(pointer && host)try{if(host.hasPointerCapture(pointer.id))host.releasePointerCapture(pointer.id);}catch{/* Only this owned pointer. */}
  }
  beginSubmission(request:MountedMutation,input:boolean):SubmissionFrame {
    const own=this.#ownPermit>0;if(own)this.#ownPermit--;
    for(const frame of this.#frames)frame.reentrant=true;
    const harmless=['snapshot','release_snapshot'].includes(request.kind);
    const eligible=!own && !input && request.kind==='command' && this.#frames.length===0 && !this.configuration.busy();
    if(!own && !eligible && !harmless)this.invalidate();
    const frame={own,eligible,serial:this.#serial,before:this.configuration.capture(),events:0,reentrant:false};this.#frames.push(frame);return frame;
  }
  endSubmission(frame:SubmissionFrame,result:Submission|DomRefusal):void {
    const current=this.#frames.pop();
    if(current!==frame){this.invalidate();this.#frames=[];return;}
    if(frame.eligible && (frame.reentrant || frame.events!==1 || frame.serial!==this.#serial || isDomRefusal(result) || result.status!=='completed' || result.response.status!=='ok'))this.invalidate();
  }
  publication(event:DeepReadonly<EventDto>):void {
    const frame=this.#frames.at(-1);
    if(frame?.own && frame.events===0 && same(frame.before,event.before)){frame.events++;return;}
    if(frame?.eligible && !frame.reentrant && frame.serial===this.#serial && frame.events===0 && event.change.kind==='document' && same(frame.before,event.before)){frame.events++;return;}
    this.invalidate();
  }
  #state():DeepReadonly<StateDto>|Response {
    const response=this.configuration.read({kind:'state'});return response.status==='ok' && response.value.kind==='state'?response.value.state:response;
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
  syncFromDom():DeepReadonly<SelectionDto>|DomRefusal|null {
    if(this.#rangeWriting || this.#guard())return null;
    const view=this.configuration.view(),selection=view?.readSelection();if(!selection || isDomRefusal(selection))return isDomRefusal(selection)?this.#fromView(selection):null;
    const state=this.#state();if('status' in state)return this.#refuse('dom.not_ready');
    if(!same(selection,state.selection)){
      this.invalidate();
      const result=this.#publish(selection);if(isDomRefusal(result))return result;
      if(result.status!=='completed' || result.response.status!=='ok')return this.#refuse('dom.busy');
    }
    return selection;
  }
  attach():void {
    if(this.#attached || this.#destroyed)return;
    const host=this.configuration.element(),doc=host?.ownerDocument,win=doc?.defaultView;if(!host || !doc || !win)return;this.#attached=true;
    const listen=(target:EventTarget,type:string,fn:EventListener)=>{target.addEventListener(type,fn);this.#removals.push(()=>target.removeEventListener(type,fn));};
    const owned=(target:EventTarget|null)=>target instanceof win.Node && host.contains(target);
    listen(doc,'keydown',event=>{
      const key=event as KeyboardEvent;
      this.#tabEntry=key.key==='Tab' && !key.altKey && !key.ctrlKey && !key.metaKey && !owned(key.target);
      if(!owned(key.target))return;
      if((key.metaKey||key.ctrlKey) && !key.altKey && key.key.toLowerCase()==='a'){
        if(this.#guard())return;key.preventDefault();this.invalidate();this.cancel();const state=this.#state();if('status' in state)return;
        const root=this.configuration.read({kind:'node',stamp:state.stamp as StampDto,node:state.root});
        if(root.status!=='ok' || root.value.kind!=='node')return;
        this.#publish({anchor:{kind:'child',parent:state.root,index:0,affinity:'after'},focus:{kind:'child',parent:state.root,index:root.value.node.children.length,affinity:'after'}});return;
      }
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Backspace','Delete','Enter','Escape'].includes(key.key)){this.invalidate();this.cancel();}
    });
    listen(doc,'keyup',event=>{if((event as KeyboardEvent).key==='Tab')this.#tabEntry=false;});
    listen(doc,'pointerdown',event=>{
      const pointer=event as PointerEvent;this.#tabEntry=false;this.#focusChanged();
      this.cancel();if(!owned(pointer.target))return;this.invalidate();
      if(pointer.button===0 && pointer.isPrimary && pointer.pointerType==='mouse' && !this.#guard())this.#pointer={id:pointer.pointerId,x:pointer.clientX,y:pointer.clientY,anchor:null};
    });
    listen(doc,'pointermove',event=>{const e=event as PointerEvent,p=this.#pointer;if(!p || p.id!==e.pointerId)return;if(!(e.buttons&1)){this.cancel();return;}p.x=e.clientX;p.y=e.clientY;this.#schedule();});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(doc,type,event=>{if(this.#pointer?.id===(event as PointerEvent).pointerId)this.cancel();});
    listen(win,'blur',()=>{this.#tabEntry=false;this.#focusChanged();this.cancel();});
    listen(doc,'focusin',event=>{
      const returning=this.#tabEntry;this.#tabEntry=false;
      if(!owned(event.target)){this.#focusChanged();this.cancel();return;}
      if(returning && event.target===host && !this.#guard()){
        const state=this.#state();if(!('status' in state))this.configuration.view()?.restoreSelection(state.selection);
      }
    });
    listen(doc,'selectionchange',()=>{
      if(this.#rangeWriting || this.#guard() || !this.ownsFocus())return;
      const p=this.#pointer;
      if(p){
        // Latch the owned post-pointerdown anchor before any publication can
        // reinstall a browser range. The first edge RAF may be much later.
        if(!p.anchor){const range=doc.getSelection();if(range?.anchorNode&&host.contains(range.anchorNode)){
          const position=this.configuration.view()?.textPosition(range.anchorNode,range.anchorOffset);
          if(position&&!isDomRefusal(position))p.anchor={node:range.anchorNode,offset:range.anchorOffset};
        }}
        const geometry=edgeGeometry(host);if(!geometry){this.cancel();this.configuration.report(this.#failure('dom.selection_geometry_unsupported'));return;}if(p.y<geometry.clip.top || p.y>geometry.clip.bottom){this.#schedule();return;}
      }
      this.syncFromDom();
    });
  }
  #schedule():void {
    if(this.#raf!==null || !this.#pointer)return;
    const win=this.configuration.element()?.ownerDocument.defaultView;if(win)this.#raf=win.requestAnimationFrame(()=>{this.#raf=null;this.#edgeTick();});
  }
  #edgeTick():void {
    const host=this.configuration.element(),view=this.configuration.view(),p=this.#pointer;
    if(!host || !view || !p || this.#guard() || !this.ownsFocus() || !host.ownerDocument.hasFocus()){this.cancel();return;}
    const geometry=edgeGeometry(host);if(!geometry){this.cancel();this.configuration.report(this.#failure('dom.selection_geometry_unsupported'));return;}
    const direction=p.y<geometry.clip.top?-1:p.y>geometry.clip.bottom?1:0;if(!direction)return;
    const browser=host.ownerDocument.getSelection();
    if(!p.anchor){if(!browser?.anchorNode || !host.contains(browser.anchorNode)){this.cancel();return;}p.anchor={node:browser.anchorNode,offset:browser.anchorOffset};}
    if(!host.contains(p.anchor.node)){this.cancel();return;}
    const previous=geometry.scroller.scrollTop;
    geometry.scroller.scrollTop=Math.max(0,Math.min(geometry.scroller.scrollHeight-geometry.scroller.clientHeight,previous+direction*24));
    const focus=visibleEdgeHit(host,view,geometry,p.x,direction);
    if(!focus){this.cancel();this.configuration.report(this.#failure('dom.selection_geometry_unsupported'));return;}
    this.#rangeWriting++;
    try{if(browser && (browser.anchorNode!==p.anchor.node || browser.anchorOffset!==p.anchor.offset || browser.focusNode!==focus.node || browser.focusOffset!==focus.offset))browser.setBaseAndExtent(p.anchor.node,p.anchor.offset,focus.node,focus.offset);}catch{this.cancel();this.configuration.report(this.#failure('dom.presentation_unsupported'));return;}finally{this.#rangeWriting--;}
    this.syncFromDom();
    if(this.#pointer && geometry.scroller.scrollTop!==previous)this.#schedule();
  }
  destroy():void {if(this.#destroyed)return;this.cancel();this.invalidate(true);this.#destroyed=true;for(const remove of this.#removals.splice(0))remove();}
}
