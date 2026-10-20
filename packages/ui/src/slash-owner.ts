// SPDX-License-Identifier: MIT OR Apache-2.0
import type { CommandDto, DeepReadonly, EventDto, SessionContextV2, StampDto, TextWindowReplyV2 } from '@klenwriter/editor-sdk';
import type { MountedEditor, MountedHostRequest, MountedPopupPresentationHandle, OrdinaryInputObservation } from '@klenwriter/editor-dom';
import type { UiActionContext, UiFailure, UiLocale, UiResult, UiSlashChoice, UiSlashProfile, UiSlashRange } from './types.js';
import { command, unavailable } from './data.js';
import { label } from './strings.js';
import { SlashList } from './slash-list.js';
import { filterChoiceIds } from './slash-search.js';
import { newSlashWitness, sameData as same, slashRange } from './slash-window.js';

interface Availability {available:boolean;reason:string;failure:UiFailure|null}
interface Options {
  editor:MountedEditor;element:HTMLElement;entry:HTMLElement;add:HTMLButtonElement;prefix:string;
  snapshot:()=>UiActionContext|UiFailure;
  invoke:<T>(callback:()=>T)=>T;
  availability:(value:CommandDto,context:UiActionContext)=>Availability;
  result:(result:UiResult)=>void;failure:(failure:UiFailure)=>void;
  feedback:(message:string)=>void;schedule:()=>void;beforeOpen:()=>void;
}
interface Frame {
  kind:'slash'|'add';context:UiActionContext;query:UiSlashRange|null;
  window:DeepReadonly<TextWindowReplyV2>|null;request:MountedHostRequest|null;
  active:string|null;choices:readonly UiSlashChoice[];availability:Map<string,Availability>;
  claimed:boolean;
}
interface Gesture {frame:Frame;request:MountedHostRequest;pointerId:number;id:string}
interface ObservedQuery {query:UiSlashRange;stamp:DeepReadonly<StampDto>;context:DeepReadonly<SessionContextV2>}
const refused=(code:'ui.unavailable'|'ui.callback_failed'|'ui.disposed',action:string|null=null):UiFailure=>({status:'ui_refused',code,action});

/** A presentation frame follows ordinary native input; only42 requests execute. */
export class SlashOwner {
  #options:Options|null;#list:SlashList;#locale:UiLocale;#profile:UiSlashProfile;
  #frame:Frame|null=null;#observation:OrdinaryInputObservation|null=null;#gesture:Gesture|null=null;
  #observedQuery:ObservedQuery|null=null;
  #activationRequest:MountedHostRequest|null=null;
  #presentation:MountedPopupPresentationHandle|null=null;#unsubscribe:(()=>void)|null=null;
  #removals:(()=>void)[]=[];#building=false;#enterHeld=false;#destroyed=false;
  #tasks=new Set<Promise<void>>();#lastActive:HTMLElement|null=null;
  constructor(options:Options,profile:UiSlashProfile,locale:UiLocale){
    this.#options=options;this.#profile=profile;this.#locale=locale;
    if(typeof options.editor.inputObservations?.subscribe!=='function'||!options.editor.popupPresentation)throw new TypeError('ui.unavailable');
    const doc=options.element.ownerDocument;
    this.#list=new SlashList(doc,`${options.prefix}-slash`);options.entry.append(this.#list.element);
    const subscription=options.editor.inputObservations.subscribe(event=>{
      this.#observe(event);
    });
    if(typeof subscription!=='function'){this.#list.destroy();throw new TypeError('ui.unavailable');}
    this.#unsubscribe=subscription;
    this.#listen(options.element,'keydown',event=>this.#key(event as KeyboardEvent),true);
    this.#listen(options.element,'keyup',event=>{if((event as KeyboardEvent).key==='Enter')this.#enterHeld=false;});
    this.#listen(options.element,'compositionstart',()=>this.retire(),true);
    this.#listen(this.#list.element,'keydown',event=>this.#key(event as KeyboardEvent),true);
    this.#listen(this.#list.element,'pointerdown',event=>this.#down(event as PointerEvent));
    this.#listen(this.#list.element,'click',event=>this.#click(event as MouseEvent));
    const win=doc.defaultView!;
    this.#listen(win,'pointerup',event=>{
      const e=event as PointerEvent,g=this.#gesture;
      if(g&&e.pointerId===g.pointerId&&this.#list.optionFor(e.target)!==g.id)this.#releaseGesture();
    },true);
    this.#listen(win,'pointercancel',event=>{if((event as PointerEvent).pointerId===this.#gesture?.pointerId)this.#releaseGesture();},true);
  }
  #listen(target:EventTarget,type:string,fn:EventListener,capture=false):void {
    target.addEventListener(type,fn,capture);this.#removals.push(()=>target.removeEventListener(type,fn,capture));
  }
  publication(_event:DeepReadonly<EventDto>):void {this.#options?.schedule();}
  #tokens(frame:Frame):boolean {
    const editor=this.#options?.editor;
    return !!editor&&same(frame.context.state.stamp,editor.capture())&&same(frame.context.context,editor.context());
  }
  #admitted():boolean {return !this.#destroyed&&this.#options?.editor.hostRequests.status().status==='available';}
  #read(stamp:DeepReadonly<StampDto>):DeepReadonly<TextWindowReplyV2>|null {
    const response=this.#options!.editor.read({kind:'text_window',stamp,before_utf16:256,after_utf16:0});
    return response.status==='ok'&&response.value.kind==='text_window'?response.value:null;
  }
  #observe(event:OrdinaryInputObservation):void {
    const o=this.#options;if(!o||this.#destroyed)return;
    const previous=this.#observedQuery,frame=this.#frame;
    this.#observation=event;this.#observedQuery=null;
    // One bounded pure read preserves a continuous native typing chain even
    // when several completed inputs arrive before the next presentation RAF.
    if(same(event.after,o.editor.capture())&&same(event.context,o.editor.context())
      &&['insertText','insertReplacementText','deleteContentBackward','deleteContentForward'].includes(event.inputType)){
      const window=this.#read(event.after),query=window?slashRange(window):null;
      if(window&&query&&this.#profile.textBlockTypes.includes(window.block.type_id)){
        const continuation=!!previous&&same(previous.stamp,event.before)&&same(previous.context,event.context)&&same(previous.query.range.anchor,query.range.anchor)
          ||!!frame&&!frame.claimed&&frame.kind==='slash'&&same(frame.context.state.stamp,event.before)
            &&same(frame.context.context,event.context)&&same(frame.query?.range.anchor,query.range.anchor);
        if(continuation||query.literal==='/'&&newSlashWitness(event,window))this.#observedQuery={query,stamp:event.after,context:event.context};
      }
    }
    o.schedule();
  }
  #focused(frame:Frame):boolean {
    const o=this.#options;if(!o)return false;
    const doc=o.element.ownerDocument,active=doc.activeElement;
    return doc.hasFocus()&&!!active&&(frame.kind==='slash'?(active===o.element||o.element.contains(active)):this.#list.element.contains(active)||active===o.add);
  }
  refresh(profile:UiSlashProfile,locale:UiLocale):void {
    if(this.#destroyed||this.#building)return;
    if(profile!==this.#profile){this.retire();this.#profile=profile;}
    this.#locale=locale;
    const event=this.#observation,observed=this.#observedQuery;this.#observation=null;
    if(!this.#admitted()){this.retire();return;}
    const o=this.#options!,current=this.#frame;
    if(current?.claimed){if(!this.#tasks.size)this.retire();return;}
    if(current?.kind==='add'){
      if(!this.#tokens(current)||!this.#focused(current)){this.retire();return;}
      this.#draw(current);return;
    }
    if(!event){
      if(current&&(!this.#tokens(current)||!this.#focused(current)))this.retire();
      else if(current)this.#draw(current);
      return;
    }
    if(!same(event.after,o.editor.capture())||!same(event.context,o.editor.context())
      ||!['insertText','insertReplacementText','deleteContentBackward','deleteContentForward'].includes(event.inputType)){
      this.retire();return;
    }
    const window=this.#read(event.after),query=window?slashRange(window):null;
    if(!window||!query||!profile.textBlockTypes.includes(window.block.type_id)){this.retire();return;}
    if(!observed||!same(observed.stamp,event.after)||!same(observed.context,event.context)||!same(observed.query,query)){this.retire();return;}
    const continuation=!!current&&same(current.query?.range.anchor,query.range.anchor);
    const context=o.snapshot();
    if('status'in context||!same(context.state.stamp,event.after)||!same(context.context,event.context)){this.retire();return;}
    const doc=o.element.ownerDocument;
    if(!doc.hasFocus()||doc.activeElement!==o.element&&!o.element.contains(doc.activeElement)){this.retire();return;}
    const active=continuation?current!.active:null;
    this.retire();this.#observedQuery=observed;o.beforeOpen();
    const frame:Frame={kind:'slash',context,query,window,request:null,active,choices:[],availability:new Map(),claimed:false};
    this.#frame=frame;this.#draw(frame);
  }
  openAdd(request:MountedHostRequest,context:UiActionContext):void {
    const o=this.#options;if(!o){return;}
    this.retire();this.#observation=null;
    const frame:Frame={kind:'add',context,query:null,window:null,request,active:null,choices:[],availability:new Map(),claimed:false};
    if(!this.#admitted()||!this.#tokens(frame)||!same(request.stamp,context.state.stamp)||!same(request.context,context.context)){
      o.editor.hostRequests.release(request);o.failure(refused('ui.unavailable'));return;
    }
    o.beforeOpen();this.#frame=frame;this.#draw(frame);
    if(this.#frame===frame){
      const option=this.#list.activeOption??this.#list.element;option.tabIndex=0;option.focus({preventScroll:true});
    }
  }
  #draw(frame:Frame):void {
    const o=this.#options;if(!o||this.#frame!==frame||frame.claimed||this.#building)return;
    this.#building=true;
    try{
      const ids=filterChoiceIds(this.#profile.choices,frame.query?.literal.slice(1)??'',this.#locale),selected=new Set(ids);
      const choices=this.#profile.choices.filter(choice=>selected.has(choice.id));
      frame.choices=choices;if(!choices.some(choice=>choice.id===frame.active))frame.active=choices[0]?.id??null;
      const rows=[];frame.availability.clear();
      for(const choice of choices){
        const value=o.invoke(()=>choice.command(frame.context,frame.query)),absent=unavailable(value);
        const availability=absent?{available:false,reason:absent.message[this.#locale],failure:null}:o.availability(command(value),frame.context);
        if(this.#destroyed||this.#frame!==frame||!this.#tokens(frame)||!this.#admitted()){this.retire();return;}
        frame.availability.set(choice.id,availability);
        rows.push({id:choice.id,label:choice.label[this.#locale],available:availability.available,reason:availability.reason});
      }
      if(this.#lastActive)this.#lastActive.tabIndex=-1;
      this.#list.update(rows,frame.active,label('picker',this.#locale),label('empty',this.#locale),this.#locale);
      this.#list.element.hidden=false;o.add.setAttribute('aria-expanded','true');o.add.setAttribute('aria-controls',this.#list.element.id);
      this.#lastActive=this.#list.activeOption;
      if(frame.kind==='add'){if(this.#lastActive)this.#lastActive.tabIndex=0;this.#list.scrollActive();return;}
      if(!this.#presentation){
        const result=o.editor.popupPresentation.open({element:o.element,listbox:this.#list.element,activeOption:this.#list.activeOption});
        if(result.status!=='opened'){o.failure(result);this.retire();return;}
        this.#presentation=result.presentation;
      }else{
        const result=this.#presentation.update({activeOption:this.#list.activeOption});
        if(result.status!=='updated'){o.failure(result);this.retire();return;}
      }
      this.#position(frame);this.#list.scrollActive();
    }catch{if(!this.#destroyed){o.failure(refused('ui.callback_failed'));this.retire();}}
    finally{this.#building=false;}
  }
  #position(frame:Frame):void {
    if(this.#gesture)return;
    const list=this.#list.element,o=this.#options!;
    list.classList.remove('kw-ui-floating');list.style.removeProperty('left');list.style.removeProperty('top');
    const geometry=o.editor.geometry.read({kind:'selection',stamp:frame.context.state.stamp});
    if(geometry.status!=='measured'||!geometry.visible)return;
    const point=geometry.focus??geometry.rects.at(-1);if(!point)return;
    const box=list.getBoundingClientRect(),v=geometry.viewport;
    const maxX=v.x+v.width-box.width-8,maxY=v.y+v.height-box.height-8;
    if(![point.x,point.y,point.height,box.width,box.height,maxX,maxY].every(Number.isFinite)
      ||box.width<=0||box.height<=0||maxX<v.x+8||maxY<v.y+8)return;
    list.classList.add('kw-ui-floating');
    list.style.left=`${Math.round(Math.max(v.x+8,Math.min(point.x,maxX))*2)/2}px`;
    list.style.top=`${Math.round(Math.max(v.y+8,Math.min(point.y+point.height+8,maxY))*2)/2}px`;
    const placed=list.getBoundingClientRect();
    if(![placed.left,placed.top,placed.right,placed.bottom].every(Number.isFinite)
      ||placed.left<v.x+7.5||placed.right>v.x+v.width-7.5||placed.top<v.y+7.5||placed.bottom>v.y+v.height-7.5){
      list.classList.remove('kw-ui-floating');list.style.removeProperty('left');list.style.removeProperty('top');
      return;
    }
    let ancestor=list.parentElement,visited=0;
    while(ancestor){
      const style=ancestor.ownerDocument.defaultView!.getComputedStyle(ancestor),rect=ancestor.getBoundingClientRect();
      const clipsX=/^(hidden|clip|auto|scroll)$/.test(style.overflowX),clipsY=/^(hidden|clip|auto|scroll)$/.test(style.overflowY);
      if(++visited>128||style.transform!=='none'||style.perspective!=='none'||style.clipPath!=='none'
        ||clipsX&&(placed.left<rect.left+ancestor.clientLeft-.5||placed.right>rect.left+ancestor.clientLeft+ancestor.clientWidth+.5)
        ||clipsY&&(placed.top<rect.top+ancestor.clientTop-.5||placed.bottom>rect.top+ancestor.clientTop+ancestor.clientHeight+.5)){
        list.classList.remove('kw-ui-floating');list.style.removeProperty('left');list.style.removeProperty('top');return;
      }
      ancestor=ancestor.parentElement;
    }
  }
  #key(event:KeyboardEvent):void {
    if(this.#destroyed||event.altKey||event.ctrlKey||event.metaKey)return;
    if(event.isComposing){this.retire();return;}
    const frame=this.#frame,o=this.#options!;
    if(event.key==='Tab'){if(frame)this.#cancel(false);else this.retire();return;}
    if(event.shiftKey)return;
    if(event.key==='Enter'&&event.repeat&&this.#enterHeld&&this.#admitted()&&o.element.ownerDocument.activeElement===o.element){event.preventDefault();event.stopPropagation();return;}
    if(!frame||this.#building){if(!frame&&['Escape','Tab'].includes(event.key))this.retire();return;}
    // Ordinary typing may have completed a native edit while the next menu
    // frame is still pending. Its verified observation chain owns refresh;
    // an unrelated keydown must not discard that chain using the old frame.
    if(!['ArrowUp','ArrowDown','Escape','Enter','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key)
      &&!(frame.kind==='add'&&event.key===' '))return;
    const navigation=frame.kind==='add'?['ArrowUp','ArrowDown','Home','End']:['ArrowUp','ArrowDown'];
    if(!this.#admitted()||!this.#focused(frame)){this.retire();return;}
    if(!this.#tokens(frame)){
      // A displayed picker owns these gestures even when a newer ordinary edit
      // is waiting for its presentation frame. Refuse that stale action without
      // letting the same Enter fall through to a native paragraph insertion.
      if(navigation.includes(event.key)||['Enter','Escape'].includes(event.key)||frame.kind==='add'&&event.key===' '){
        event.preventDefault();event.stopPropagation();o.feedback(label('stale',this.#locale));
      }
      this.retire();return;
    }
    if(navigation.includes(event.key)){
      event.preventDefault();event.stopPropagation();
      const choices=frame.choices,at=choices.findIndex(choice=>choice.id===frame.active);
      if(choices.length){const index=event.key==='Home'?0:event.key==='End'?choices.length-1:(Math.max(0,at)+(event.key==='ArrowUp'?-1:1)+choices.length)%choices.length;
        frame.active=choices[index]!.id;this.#draw(frame);if(frame.kind==='add')this.#list.activeOption?.focus({preventScroll:true});}
      return;
    }
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.#cancel(true);return;}
    if(event.key==='Enter'||frame.kind==='add'&&event.key===' '){
      event.preventDefault();event.stopPropagation();if(event.key==='Enter')this.#enterHeld=true;
      if(!event.repeat&&frame.active)this.#activate(frame.active,null);
      return;
    }
    if(['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key))this.retire();
  }
  #down(event:PointerEvent):void {
    this.#releaseGesture();
    const frame=this.#frame,id=this.#list.optionFor(event.target),o=this.#options;
    if(!frame||!id||!o||event.button!==0||event.altKey||event.ctrlKey||event.metaKey)return;
    event.preventDefault();
    if(frame.claimed||this.#building||!this.#admitted()||!this.#tokens(frame)||!this.#focused(frame))return;
    if(!frame.availability.get(id)?.available){o.feedback(frame.availability.get(id)?.reason??label('unavailable',this.#locale));return;}
    let request=frame.request;
    if(frame.kind==='slash'){
      const captured=o.editor.hostRequests.capture({focusScope:this.#list.element});
      if(captured.status!=='captured'){o.failure(captured);return;}
      request=captured.request;
    }
    if(request&&this.#tokens(frame)&&same(request.stamp,frame.context.state.stamp)&&same(request.context,frame.context.context)){
      this.#gesture={frame,request,pointerId:event.pointerId,id};
    }else if(request&&request!==frame.request)o.editor.hostRequests.release(request);
  }
  #click(event:MouseEvent):void {
    const gesture=this.#gesture;this.#gesture=null;
    const id=this.#list.optionFor(event.target);if(!id){this.#releaseGesture(gesture);return;}
    event.preventDefault();
    const pointerId=(event as PointerEvent).pointerId;
    if(event.detail>0&&(!gesture||gesture.id!==id||gesture.frame!==this.#frame
      ||Number.isSafeInteger(pointerId)&&pointerId>=0&&pointerId!==gesture.pointerId)){
      this.#releaseGesture(gesture);return;
    }
    this.#activate(id,gesture);this.#options?.schedule();
  }
  #activate(id:string,gesture:Gesture|null):void {
    if(!gesture)this.#releaseGesture();
    const frame=this.#frame,o=this.#options;
    if(!frame||!o||frame.claimed||this.#building||!this.#admitted()||!this.#tokens(frame)||!this.#focused(frame)){
      this.#releaseGesture(gesture);
      if(frame&&!frame.claimed&&!this.#building){this.retire();o?.feedback(label('stale',this.#locale));}return;
    }
    const choice=frame.choices.find(choice=>choice.id===id),known=frame.availability.get(id);
    if(!choice||!known?.available){this.#releaseGesture(gesture);o.feedback(known?.reason??label('unavailable',this.#locale));return;}
    frame.claimed=true;this.#building=true;
    let request=frame.request??gesture?.request??null;
    frame.request=null;this.#activationRequest=request;
    try{
      if(!request){const capture=o.editor.hostRequests.capture({focusScope:this.#list.element});
        if(capture.status!=='captured'){o.failure(capture);this.retire();return;}request=capture.request;this.#activationRequest=request;}
      if(!same(request.stamp,frame.context.state.stamp)||!same(request.context,frame.context.context))throw new Error('stale');
      const value=o.invoke(()=>choice.command(frame.context,frame.query)),absent=unavailable(value);
      if(absent){o.feedback(absent.message[this.#locale]);this.#releaseActivation();this.retire();return;}
      const owned=command(value),availability=o.availability(owned,frame.context);
      const actual=frame.kind==='slash'?this.#read(frame.context.state.stamp):null;
      if(!availability.available||this.#destroyed||this.#frame!==frame||!this.#tokens(frame)||!this.#admitted()
        ||frame.kind==='slash'&&(!actual||!same(slashRange(actual),frame.query))){
        this.#releaseActivation();o.feedback(availability.reason||label('stale',this.#locale));this.retire();return;
      }
      frame.request=null;
      const focus=frame.kind==='add'||o.element.ownerDocument.activeElement!==o.element?'native_result':'none';
      const result=o.editor.hostRequests.complete(request,owned,{focus});
      if(result.status!=='submitted'){this.#releaseActivation();o.failure(result);this.retire();return;}
      this.#activationRequest=null;
      const completion=result.submission.status==='completed'?Promise.resolve(result.submission.response):result.submission.completion;
      const task=Promise.all([completion,result.focus]).then(([response,restored])=>{
        if(this.#destroyed)return;
        if(response.status!=='ok')o.failure({status:'sdk_failure',response});
        else if(restored.failure)o.failure(restored.failure);
        if(this.#frame===frame)this.retire(true);o.schedule();
      },()=>{if(!this.#destroyed){o.failure(refused('ui.callback_failed',id));if(this.#frame===frame)this.retire(true);}})
        .finally(()=>this.#tasks.delete(task));
      this.#tasks.add(task);
      o.result(Object.freeze({status:'submitted',action:id,submission:result.submission,focus:result.focus}));
    }catch{this.#releaseActivation();if(!this.#destroyed){o.failure(refused('ui.callback_failed',id));this.retire();}}
    finally{this.#building=false;}
  }
  #cancel(focus:boolean):void {
    const frame=this.#frame,o=this.#options;if(!frame||!o)return;
    if(frame.kind==='add'&&frame.request&&!frame.claimed){
      const owned=this.#focused(frame),request=frame.request;frame.request=null;frame.claimed=true;
      const result=o.editor.hostRequests.cancel(request,{focus:focus&&owned});
      if(result.status==='cancelled')o.result({status:'cancelled',action:'add',restore:result.restore});else o.failure(result);
      const doc=o.element.ownerDocument,current=doc.activeElement;
      const stillOwned=!!current&&(this.#list.element.contains(current)||current===doc.body);
      this.retire();if(!this.#destroyed&&!focus&&owned&&stillOwned&&o.add.isConnected)o.add.focus({preventScroll:true});return;
    }
    this.retire();o.result({status:'cancelled',action:'slash',restore:null});
  }
  focusChanged():void {const frame=this.#frame;if(this.#options?.element.ownerDocument.activeElement!==this.#options?.element)this.#enterHeld=false;if(frame&&!frame.claimed&&!this.#focused(frame))this.retire();}
  closeAdd():boolean {if(this.#frame?.kind!=='add'||this.#frame.claimed)return false;this.#cancel(true);return true;}
  foreignGesture(target:EventTarget|null):void {
    const o=this.#options;if(!o||!this.#frame)return;
    if(target===o.add||this.#list.optionFor(target))return;this.retire();
  }
  #releaseGesture(gesture:Gesture|null=this.#gesture):void {
    if(this.#gesture===gesture)this.#gesture=null;
    if(gesture&&gesture.request!==gesture.frame.request)this.#options?.editor.hostRequests.release(gesture.request);
  }
  #releaseActivation():void {const request=this.#activationRequest;this.#activationRequest=null;if(request)this.#options?.editor.hostRequests.release(request);}
  retire(preserveHeldEnter=false):void {
    const o=this.#options,frame=this.#frame;this.#frame=null;this.#observation=null;this.#observedQuery=null;
    if(!preserveHeldEnter)this.#enterHeld=false;
    const gesture=this.#gesture;this.#gesture=null;
    if(gesture&&gesture.request!==frame?.request)o?.editor.hostRequests.release(gesture.request);
    if(frame?.request)o?.editor.hostRequests.release(frame.request);
    this.#presentation?.dispose();this.#presentation=null;
    this.#list.element.hidden=true;this.#list.element.classList.remove('kw-ui-floating');
    this.#list.element.style.removeProperty('left');this.#list.element.style.removeProperty('top');
    if(o){o.add.setAttribute('aria-expanded','false');o.add.removeAttribute('aria-controls');}
    this.#lastActive=null;
  }
  resources():Readonly<{listeners:number;subscriptions:number;hostRequests:number;continuations:number}> {
    return {listeners:this.#removals.length,subscriptions:this.#unsubscribe?1:0,
      hostRequests:(this.#frame?.request?1:0)+(this.#gesture&&this.#gesture.request!==this.#frame?.request?1:0)+(this.#activationRequest?1:0),continuations:this.#tasks.size};
  }
  destroy():Promise<void>{
    if(!this.#destroyed){this.#destroyed=true;this.retire();this.#releaseActivation();this.#unsubscribe?.();this.#unsubscribe=null;
      for(const remove of this.#removals.splice(0))remove();this.#list.destroy();this.#options=null;}
    return Promise.all([...this.#tasks]).then(()=>{});
  }
}
