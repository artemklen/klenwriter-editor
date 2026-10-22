// SPDX-License-Identifier: MIT OR Apache-2.0
import type { CommandDto, DeepReadonly, EventDto, InputCommandRequestV2, InputSubmissionV2, RawInputRestoreV2, ResponseV2, SelectionDto, SessionContextV2, StampDto, StateDto, TextReplacementResultV2 } from '@klenwriter/editor-sdk';
import type { CompositionWindow, DomView } from './view.js';
import type { DomRefusal, InputCommandBindings, RecoveryRegion, TypedInputRecovery } from './types.js';
import type { SelectionOwner } from './selection.js';
import { domRefusal, isDomRefusal } from './refusal.js';
import {literalCompositionBytes,type LiteralCompositionSource} from './composition-literal.js';

export type InputOrigin = 'ordinary_insert_text' | 'composition_commit';
export interface TypingResources { readonly armedSlots:number; readonly backspaceCandidates:number; readonly pendingDispatches:number; readonly retainedBytes:number }
interface Configuration {
  readonly element:HTMLElement; readonly view:DomView; readonly bindings:InputCommandBindings; readonly selection:SelectionOwner;
  readonly capture:()=>DeepReadonly<StampDto>|null; readonly context:()=>DeepReadonly<SessionContextV2>|null;
  readonly readState:()=>DeepReadonly<StateDto>|null; readonly canEdit:()=>boolean; readonly busy:()=>boolean;
  readonly recover:(failure:DomRefusal,region?:RecoveryRegion|null)=>void; readonly changed:()=>void;
}
interface Frame {
  readonly id:number;
  readonly stamp:DeepReadonly<StampDto>; readonly context:DeepReadonly<SessionContextV2>;
  readonly selection:DeepReadonly<SelectionDto>; readonly blocks:readonly string[];
  readonly text:string; readonly origin:InputOrigin|null; readonly compositionOwned:boolean; readonly reconciled:boolean;
  serial:bigint; foreign:boolean; scope:boolean; queued:boolean; invalidations:number;
  publication:DeepReadonly<EventDto>|null;
  literalSource:LiteralCompositionSource|null; literalBytes:number;
  after?: (result:InputSubmissionV2|DomRefusal)=>void;
  recovery?:RecoveryRegion|null;
}
export interface PreparedInput { readonly command:CommandDto; readonly frame:Frame }
interface Slot { readonly restore:DeepReadonly<RawInputRestoreV2>; readonly context:DeepReadonly<SessionContextV2>; serial:bigint }
interface Backspace { readonly slot:Slot; readonly key:KeyboardEvent; input:InputEvent|null; serial:bigint }
interface Joined { readonly frame:Frame; readonly response:ResponseV2; readonly result:DeepReadonly<TextReplacementResultV2>|null; readonly window:CompositionWindow|null }
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

/** Input ownership and native correspondence only. No profile punctuation or rule predicates. */
export class InputResultOwner {
  #configuration:Configuration|null;
  #active:Frame|null=null; #joined:Joined|null=null; #slot:Slot|null=null; #backspace:Backspace|null=null;
  #pending=0; #retained=0; #lastKey:KeyboardEvent|null=null;
  #next=0; #sink:(()=>void)|null; #tickets=new WeakSet<object>(); #joinFailures=new WeakMap<object,DomRefusal>();
  #enabled:boolean; #recovery:TypedInputRecovery|null=null;
  constructor(configuration:Configuration){this.#configuration=configuration;this.#sink=configuration.changed;this.#enabled=typeof configuration.bindings.insertTypedText==='function';}
  enabled():boolean{return this.#enabled;}
  resources():TypingResources{return Object.freeze({armedSlots:Number(this.#slot!==null),backspaceCandidates:Number(this.#backspace!==null),pendingDispatches:this.#pending,
    retainedBytes:this.#retained+(this.#active?2*this.#active.text.length+this.#active.literalBytes:0)+(this.#recovery?.retainedBytes??0)});}
  #emit():void{try{this.#sink?.();}catch{/* Numeric accounting cannot change the native outcome. */}if(!this.#configuration&&this.#pending===0)this.#sink=null;}
  takeRecovery():TypedInputRecovery|null{if(!this.#recovery&&this.#active)this.#retain(this.#active,this.#active.queued?'queued':this.#active.scope?'unknown':'not_submitted');const recovery=this.#recovery;this.#recovery=null;this.#emit();return recovery;}
  #retain(frame:Frame,outcome:TypedInputRecovery['nativeOutcome'],response:ResponseV2|null=null):void{
    const original=Object.freeze({kind:'bounded' as const,text:frame.text});
    this.#recovery=Object.freeze({format:'typed-input-recovery/1',origin:frame.origin??'raw_restore',original,stamp:frame.stamp,selection:frame.selection,
      context:frame.context,nativeOutcome:outcome,response,retainedBytes:2*frame.text.length+(response?new TextEncoder().encode(JSON.stringify(response)).byteLength:0)});
  }
  owns(ticket:InputSubmissionV2|DomRefusal):boolean{return this.#tickets.has(ticket);}
  #failure(publication:'none'|'alreadyPublished'|'unknown'='none'):DomRefusal{return domRefusal('dom.stale_selection','command',this.#configuration?.capture()??null,null,null,publication);}
  retire():void{
    if(this.#active)this.#active.foreign=true;
    this.#slot=null;this.#backspace=null;this.#joined=null;this.#lastKey=null;this.#retained=0;this.#emit();
  }
  /** Called by the one existing SelectionOwner observer, never a second subscription. */
  intent(before:bigint,after:bigint,event:Event|null):void{
    const c=this.#configuration,frame=this.#active,backspace=this.#backspace;
    if(!c?.selection.intentAvailable()){this.retire();return;}
    if(backspace && before===backspace.serial && (event===backspace.key || event===backspace.input)){
      backspace.serial=after;backspace.slot.serial=after;this.#emit();return;
    }
    if(frame && !frame.foreign && before===frame.serial && event===null && (frame.scope||frame.queued) && frame.invalidations<2){
      frame.serial=after;frame.invalidations++;return;
    }
    this.retire();
  }
  publication(event:DeepReadonly<EventDto>):void{
    const frame=this.#active;
    if(frame && !frame.foreign && (frame.scope||frame.queued) && !frame.publication && same(event.before,frame.stamp))frame.publication=event;
    else this.retire();
  }
  #fresh(frame:Frame,after=false):boolean{
    const c=this.#configuration;
    return !!c&&!frame.foreign&&c.canEdit()&&c.selection.intentAvailable()&&c.selection.intent()===frame.serial
      &&same(c.context(),frame.context)&&c.element.ownerDocument.hasFocus()&&c.selection.ownsFocus()
      &&(after||same(c.capture(),frame.stamp));
  }
  prepare(text:string,origin:InputOrigin,window:CompositionWindow|null=null,compositionOwned=false,reconciled=false,event:InputEvent|null=null):PreparedInput|DomRefusal|null{
    const c=this.#configuration;if(!c?.bindings.insertTypedText)return null;
    this.retire();
    const state=c.readState(),context=c.context();
    if(!state?.selection||!context||!same(state.stamp,c.capture())||!c.selection.intentAvailable())return this.#failure();
    if(text.length>2097152){
      if(event)this.#recovery=Object.freeze({format:'typed-input-recovery/1',origin,original:Object.freeze({kind:'retained_event',event,reason:'capture_limit',ownership:'transferred_to_host'}),
        stamp:state.stamp,selection:state.selection,context,nativeOutcome:'not_submitted',response:null,retainedBytes:0});
      return domRefusal('dom.reconcile_limit','command',state.stamp);
    }
    const blocks:string[]=[];
    if(window){if(!same(window.stamp,state.stamp)||!same(window.selection,state.selection))return this.#failure();for(const entry of window.entries)blocks.push(entry.id);}
    else for(const point of [state.selection.anchor,state.selection.focus]){
      const dom=c.view.domPoint(point);if(isDomRefusal(dom))return dom;
      const block=c.view.ownedBlockAt(dom.node);if(!block)return this.#failure();if(!blocks.includes(block))blocks.push(block);
    }
    if(!Number.isSafeInteger(++this.#next))return this.#failure();
    const frame:Frame={id:this.#next,stamp:state.stamp,context,selection:state.selection,blocks:Object.freeze(blocks),text,origin,compositionOwned,reconciled,
      serial:c.selection.intent(),foreign:false,scope:false,queued:false,invalidations:0,publication:null,literalSource:null,literalBytes:0};
    this.#active=frame;
    if(compositionOwned&&origin==='composition_commit'&&window){
      const source=c.view.captureLiteralComposition?.(window,text,state.stored_marks)??null;
      if(isDomRefusal(source)){this.#retain(frame,'not_submitted');this.#active=null;return source;}
      if(source){
        const bytes=literalCompositionBytes(source);
        if(bytes===null){this.#retain(frame,'not_submitted');this.#active=null;return domRefusal('dom.composition_limit','composition',frame.stamp);}
        frame.literalSource=source;frame.literalBytes=bytes;
      }
      if(!this.#fresh(frame)){this.#retain(frame,'not_submitted');this.#active=null;return this.#failure();}
    }
    let command:CommandDto;
    try{command=c.bindings.insertTypedText(Object.freeze({text,origin}));}catch{this.#retain(frame,'not_submitted');frame.foreign=true;this.#active=null;return domRefusal('dom.command_unsupported','command',frame.stamp);}
    if(!this.#fresh(frame)){this.#retain(frame,'not_submitted');this.#active=null;return this.#failure();}
    this.#emit();return {command,frame};
  }
  dispatch(prepared:PreparedInput,submit:(request:InputCommandRequestV2)=>InputSubmissionV2|DomRefusal,
    after?:(result:InputSubmissionV2|DomRefusal)=>void):InputSubmissionV2|DomRefusal{
    const {frame,command}=prepared,c=this.#configuration;
    if(!c||this.#active!==frame||!this.#fresh(frame)||!frame.reconciled&&!frame.compositionOwned&&!same(c.view.readSelection(),frame.selection)){
      this.#retain(frame,'not_submitted');this.#active=null;const failure=this.#failure();this.#tickets.add(failure);if(!frame.compositionOwned)c?.recover(failure,frame.recovery);return failure;
    }
    let ticket:InputSubmissionV2|DomRefusal;
    frame.scope=true;this.#pending++;this.#emit();
    try{ticket=submit({kind:'input_command',stamp:frame.stamp as StampDto,command});}
    catch{this.#retain(frame,'unknown');frame.scope=false;this.#pending--;this.#active=null;this.retire();const failure=this.#failure('unknown');this.#tickets.add(failure);if(!frame.compositionOwned)c.recover(failure,frame.recovery);return failure;}
    frame.scope=false;
    this.#tickets.add(ticket);
    if(isDomRefusal(ticket)) {this.#retain(frame,'not_submitted');this.#pending--;this.#active=null;this.retire();if(!frame.compositionOwned)c.recover(ticket,frame.recovery);after?.(ticket);return ticket;}
    frame.after=after;
    const id=frame.id;
    if(ticket.status==='completed')this.#terminal(id,ticket.response);
    else {frame.queued=true;void ticket.completion.then(response=>this.#terminal(id,response),()=>this.#unknown(id));}
    return ticket;
  }
  #terminal(id:number,response:ResponseV2):void{
    const frame=this.#active;
    try{if(frame?.id===id&&this.#configuration){this.#finish(frame,response);frame.after?.({status:'completed',response});if(!frame.compositionOwned)this.arm(response);}}
    finally{this.#pending--;this.#emit();}
  }
  #unknown(id:number):void{
    const frame=this.#active;
    this.#pending--;if(frame?.id===id){this.#retain(frame,'unknown');this.#active=null;this.retire();if(!frame.compositionOwned)this.#configuration?.recover(this.#failure('unknown'),frame.recovery);}
    this.#emit();
  }
  #joinFailure(frame:Frame,response?:ResponseV2):void{
    const c=this.#configuration,publication=response?.status==='ok'&&response.value.kind==='input_mutation'&&response.value.effect==='changed'?'alreadyPublished':'none';
    const failure=this.#failure(publication);
    if(response)this.#joinFailures.set(response,failure);
    this.#retain(frame,'completed',response??null);this.retire();if(!frame.compositionOwned)c?.recover(failure,frame.recovery);
  }
  #finish(frame:Frame,response:ResponseV2):void{
    const c=this.#configuration;
    if(!c||this.#active!==frame)return;
    this.#active=null;
    if(response.status!=='ok'||response.value.kind!=='input_mutation'){
      this.#retain(frame,'completed',response);this.retire();
      if(!frame.compositionOwned)c.recover(this.#failure(response.status==='fatal'?'unknown':'none'),frame.recovery);
      return;
    }
    const value=response.value,state=c.readState(),result=value.result;
    // Literal unchanged ordinary input has no publication or replacement receipt.
    if(!result&&!frame.compositionOwned&&value.effect!=='changed'){this.#joined=null;return;}
    // The same owned publication/freshness fences precede BOTH nullable branches.
    if(value.effect!=='changed'||!this.#fresh(frame,true)||!state||!same(state,value.state)||!same(state.stamp,c.capture())
      ||!frame.publication||!same(frame.publication.before,frame.stamp)||!same(frame.publication.after,state.stamp)
      ||!same(frame.publication.selection_before,frame.selection)||!same(frame.publication.selection_after,state.selection)
      ||!same(c.view.readSelection(),state.selection)){
      this.#joinFailure(frame,response);return;
    }
    if(result){
      if(!same(result.before_stamp,frame.stamp)||!same(result.after_stamp,state.stamp)||!same(result.original.selection,frame.selection)
        ||result.original.text!==frame.text||result.original.origin!==frame.origin||!frame.blocks.includes(result.before.block)
        ||result.after.block!==result.before.block||!same(result.after_selection,state.selection)||!same(result.after_stored_marks,state.stored_marks)
        ||c.view.checkInputResult(result)!==null){this.#joinFailure(frame,response);return;}
      frame.literalSource=null;frame.literalBytes=0;
    }else{
      // Only the pre-dispatch registered whole-leaf topology has this additional
      // literal proof. Unsupported topologies retain their original41 route.
      if(!frame.literalSource){this.#joined=null;return;}
      if(c.view.checkLiteralComposition(frame.literalSource,frame.publication,state)!==null){this.#joinFailure(frame,response);return;}
    }
    let window:CompositionWindow|null=null;
    if(frame.compositionOwned){
      if(!state.selection){this.#joinFailure(frame,response);return;}
      const fresh=c.view.beginComposition(state.stamp,state.selection);
      try{
        if(isDomRefusal(fresh)){this.#joinFailure(frame,response);return;}
        const observed=c.view.observeComposition(fresh);
        if(isDomRefusal(observed)||!observed.unchanged){this.#joinFailure(frame,response);return;}
        window=fresh;
      }finally{c.view.endProvisional();}
    }
    if(!this.#fresh(frame,true)||!same(state.stamp,c.capture())){this.#joinFailure(frame,response);return;}
    this.#joined={frame,response,result,window};
    this.#retained=result?new TextEncoder().encode(JSON.stringify(result)).byteLength:2*frame.text.length+frame.literalBytes;
  }
  joined(response:ResponseV2):CompositionWindow|DomRefusal|null{
    const failure=this.#joinFailures.get(response);
    if(failure){this.#joinFailures.delete(response);return failure;}
    const joined=this.#joined;if(joined?.response!==response)return null;
    // A literal frame is a private one-shot handoff, never a typography slot.
    if(joined.result===null){this.#joined=null;this.#retained=0;this.#emit();}
    return joined.window;
  }
  arm(response:ResponseV2):void{
    const joined=this.#joined,c=this.#configuration;this.#joined=null;this.#retained=0;
    if(!joined||!c||joined.response!==response||!joined.result?.raw_restore||!this.#fresh(joined.frame,true)
      ||!same(c.capture(),joined.result.after_stamp)||!same(c.view.readSelection(),joined.result.after_selection))return;
    const restore=joined.result.raw_restore,bytes=new TextEncoder().encode(JSON.stringify(restore)).byteLength;
    if(bytes>4096)return;
    this.#slot={restore,context:joined.frame.context,serial:joined.frame.serial};this.#retained=bytes;this.#emit();
  }
  #slotFresh(slot:Slot):boolean{
    const c=this.#configuration,state=c?.readState(),restore=slot.restore;
    return !!c&&!!state&&c.canEdit()&&!c.busy()&&!c.view.hasProvisional()&&c.selection.intentAvailable()&&slot.serial===c.selection.intent()
      &&c.element.ownerDocument.hasFocus()&&c.selection.ownsFocus()&&same(c.context(),slot.context)&&same(c.capture(),restore.stamp)
      &&same(state.stamp,restore.stamp)&&same(state.selection,restore.selection)&&same(state.stored_marks,restore.stored_marks)
      &&same(c.view.readSelection(),restore.selection)&&same(restore.selection.anchor,restore.selection.focus)
      &&c.view.checkInputRegion(restore.cooked,restore.stamp)===null;
  }
  keydown(event:KeyboardEvent):void{
    const c=this.#configuration,slot=this.#slot;
    if(!slot){if(this.#backspace)this.retire();return;}
    if(!c||event.key!=='Backspace'||event.repeat||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.isComposing||event.keyCode===229
      ||event.defaultPrevented||!event.cancelable||!event.target||!c.element.contains(event.target as Node)||!this.#slotFresh(slot)){this.retire();return;}
    this.#slot=null;this.#lastKey=event;this.#backspace={slot,key:event,input:null,serial:slot.serial};this.#emit();
  }
  afterKeydown(event:KeyboardEvent):void{if(this.#backspace?.key===event&&event.defaultPrevented)this.retire();}
  keyup(event:KeyboardEvent):void{if(this.#backspace&&(this.#backspace.key.code||this.#backspace.key.key)===(event.code||event.key))this.retire();if(this.#lastKey===event)this.#lastKey=null;}
  beforeInput(event:InputEvent):void{
    const pending=this.#backspace,c=this.#configuration;
    if(!pending){if(this.#slot)this.retire();return;}
    if(!c||event.inputType!=='deleteContentBackward'||event.isComposing||!event.cancelable||event.defaultPrevented
      ||!event.target||!c.element.contains(event.target as Node)||!this.#slotFresh(pending.slot)){this.retire();return;}
    try{
      const ranges=event.getTargetRanges?.()??[],selection=c.element.ownerDocument.getSelection();
      if(ranges.length>1||!selection?.isCollapsed||!selection.anchorNode){this.retire();return;}
      if(ranges.length===1){
        const range=ranges[0],start=c.view.textPosition(range.startContainer,range.startOffset),end=c.view.textPosition(range.endContainer,range.endOffset);
        if(!start||!end||isDomRefusal(start)||isDomRefusal(end)||!same(end,pending.slot.restore.selection.focus)
          ||!pending.slot.restore.cooked.spans.some(s=>start.kind==='text'&&s.node===start.node&&start.offset>=s.from_utf16&&start.offset<=s.to_utf16)){this.retire();return;}
      }
    }catch{this.retire();return;}
    pending.input=event;
  }
  restore(event:InputEvent,compositionOwned=false):PreparedInput|DomRefusal|null{
    const pending=this.#backspace,c=this.#configuration;
    if(!pending||pending.input!==event||!c)return null;
    this.#backspace=null;this.#lastKey=null;this.#retained=0;this.#emit();
    if(!c.bindings.restoreTypedText||!this.#slotFresh(pending.slot))return this.#failure();
    const restore=pending.slot.restore;
    if(!Number.isSafeInteger(++this.#next))return this.#failure();
    const frame:Frame={id:this.#next,stamp:restore.stamp,context:pending.slot.context,selection:restore.selection,blocks:[restore.cooked.block],text:'',origin:null,
      compositionOwned,reconciled:false,serial:c.selection.intent(),foreign:false,scope:false,queued:false,invalidations:0,publication:null,literalSource:null,literalBytes:0};
    this.#active=frame;
    let command:CommandDto;
    try{command=c.bindings.restoreTypedText(restore);}catch{this.#retain(frame,'not_submitted');this.#active=null;return this.#failure();}
    if(!this.#fresh(frame)){this.#retain(frame,'not_submitted');this.#active=null;return this.#failure();}
    return {command,frame};
  }
  destroy():void{this.retire();this.#configuration=null;this.#active=null;this.#recovery=null;this.#emit();}
}
