// SPDX-License-Identifier: MIT OR Apache-2.0
// SOURCE03. Actual CompositionOwner with labelled view/native/scheduler doubles.
// Geometry/default-scan controls below use the actual registered correspondence.
// These controls do not prove native semantics, trusted input or OS provenance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CompositionOwner} from '../packages/dom/dist/composition.js';
import {createCompositionCorrespondence} from '../packages/dom/dist/composition-view.js';
const clone=value=>structuredClone(value);
const point=(node,offset)=>({kind:'text',node,offset,affinity:'after'});
const sourceSelection={anchor:point('original-text',0),focus:point('original-text',3)};
const base={session:'transient-controlled',generation:'1',revision:'0',selection_epoch:'1',history_epoch:'0'};
const refusal=(stamp=base)=>({status:'dom_refused',diagnostic:{code:'dom.composition_limit',phase:'composition',stamp:clone(stamp),publication:'none',node:null,typeId:null}});
function harness({enabled=true,hookFailure=null}={}){
  let time=0,next=0,serial=0n,listener=null,focus=true,text='old',shape='text',mutations=0,context={build_id:'controlled-only',profile:{},registry_digest:'registry',capability_digest:'capability'};
  let state={stamp:clone(base),root:'root',selection:clone(sourceSelection),stored_marks:null,dirty:false,saved_revision:'0',history:{undo_entries:'0',redo_entries:'0',retained_bytes:'0'}};
  const rafs=new Map(),timers=new Map(),packets=[],dispatches=[],ordinary=[],calls=[],liveTickets=new Set();
  const textNode={nodeType:3},block={nodeType:1},browser={isCollapsed:false,anchorNode:textNode,focusNode:textNode,anchorOffset:0,focusOffset:3};
  const win={performance:{now:()=>time},requestAnimationFrame:f=>{const id=++next;rafs.set(id,f);return id;},cancelAnimationFrame:id=>rafs.delete(id),setTimeout:(f,delay)=>{const id=++next;timers.set(id,{f,at:time+delay});return id;},clearTimeout:id=>timers.delete(id)};
  const element={nodeType:1,ownerDocument:{defaultView:win,getSelection:()=>browser,hasFocus:()=>true},contains:node=>node===element||node===block||node===textNode};
  const selection={intent:()=>serial,intentAvailable:()=>true,ownsFocus:()=>focus,cancel:()=>{},syncFromDom:()=>clone(state.selection),invalidate(_clear=false,event=null){const old=serial;serial++;listener?.(old,serial,event);},observeInputIntent(fn){listener=fn;return()=>{listener=null;};}};
  const region=(stamp=base,original='old')=>Object.freeze({kind:'bounded',stamp:clone(stamp),originalText:original,provisionalText:shape==='br'?'':text,affectedNodeIds:['block']});
  let originalWindow,acceptedWindow;
  const observation=window=>shape==='br'?refusal():Object.freeze({region:region(window.stamp,window.originalRegion.originalText),unchanged:text===window.originalRegion.originalText,replacement:window===originalWindow?text:'',fingerprint:'actual:'+text});
  const view={beginComposition(stamp,range){const window=Object.freeze({stamp:clone(stamp),selection:clone(range),entries:[{id:'block'}],parent:element,before:null,after:null,anchor:{node:textNode,offset:range.anchor.offset},focus:{node:textNode,offset:range.focus.offset},selectedAtomIds:[],affectedNodeIds:['block'],originalRegion:region(stamp,text)});if(!originalWindow)originalWindow=window;return window;},
    observeComposition(window){calls.push('observe:'+shape);return observation(window);},captureComposition:window=>region(window.stamp),captureRegion:()=>region(),readSelection:()=>clone(state.selection),setComposing:()=>{},endProvisional:()=>{},restoreSelection:()=>null,restoreComposition:()=>{throw Error('A transient empty frame must never restore/cancel the source');},
    captureTerminalDeletion(window,event){calls.push('capture-delete');assert.equal(window,originalWindow);assert.equal(event.type,'beforeinput');assert.equal(event.inputType,'deleteCompositionText');assert.equal(shape,'text');if(hookFailure==='delete')return refusal();const ticket={original:window};liveTickets.add(ticket);return ticket;},
    observeTerminalDeletion(ticket,event){calls.push('observe-delete');assert(liveTickets.has(ticket));assert.equal(event.type,'input');assert.equal(event.inputType,'deleteCompositionText');assert.equal(shape,'br');return hookFailure==='empty'?refusal():null;},
    captureTerminalInsertion(ticket,event){calls.push('capture-insert');assert(liveTickets.has(ticket));assert.equal(event.inputType,'insertFromComposition');assert.equal(event.isComposing,true);assert.equal(shape,'br');return hookFailure==='insert'?refusal():null;},
    observeTerminalInsertion(ticket,event){calls.push('observe-insert');assert(liveTickets.has(ticket));assert.equal(event.type,'input');assert.equal(event.inputType,'insertFromComposition');if(hookFailure==='payload')return refusal();const observed=observation(originalWindow);liveTickets.delete(ticket);return observed;},
    releaseTerminal(ticket){calls.push('release');liveTickets.delete(ticket);},terminalRetainedBytes:ticket=>liveTickets.has(ticket)?64:0};
  let response;
  const typed={enabled:()=>enabled,prepare(value,origin,window){assert.equal(value,text);assert.equal(origin,'composition_commit');assert.equal(window,originalWindow);return {command:{id:'controlled-typed',payload_json:JSON.stringify({kind:'insert_typed_text',text:value,origin})}};},dispatch:(prepared,submit)=>submit({kind:'input_command',stamp:clone(base),command:prepared.command}),joined:value=>{assert.equal(value,response);return acceptedWindow;},retire:()=>{},arm:()=>{throw Error('Null result cannot arm raw restoration');}};
  const publish=request=>{dispatches.push(request);selection.invalidate();state={...state,stamp:{...base,revision:'1',selection_epoch:'2',history_epoch:'1'},selection:{anchor:point('fresh-text',text.length),focus:point('fresh-text',text.length)},dirty:true,history:{undo_entries:'1',redo_entries:'0',retained_bytes:'100'}};acceptedWindow=view.beginComposition(state.stamp,state.selection);response={status:'ok',value:{kind:'input_mutation',effect:'changed',state:clone(state),presentation:null,result:null}};return {status:'completed',response};};
  const owner=new CompositionOwner({element,view,selection,bindings:{insertText:()=>{throw Error('No legacy fallback/replay');}},typed,canEdit:()=>true,busy:()=>false,capture:()=>clone(state.stamp),context:()=>clone(context),readState:()=>clone(state),submit:publish,submitInput:publish,ordinary:event=>{ordinary.push(event);throw Error('Closing echo must never authorize ordinary input');},report:()=>{},recover:(failure,region,composition)=>packets.push({failure,region,composition}),composing:()=>{},consumeRecords:()=>{const n=mutations;mutations=0;return n;}});
  const event=(type,extra={})=>({type,target:element,cancelable:type==='beforeinput'||type==='keydown',defaultPrevented:false,data:null,inputType:'',isComposing:false,key:'',code:'',repeat:false,altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,getTargetRanges:()=>[],preventDefault(){this.defaultPrevented=true;},...extra});
  const api={owner,view,event,packets,dispatches,ordinary,calls,selection,liveTickets,state:()=>clone(state),
    start(){owner.start(event('compositionstart',{data:'old'}));text='´';browser.isCollapsed=false;browser.anchorOffset=0;browser.focusOffset=1;owner.input(event('input',{inputType:'insertCompositionText',data:'´',isComposing:true}));owner.keydown(event('keydown',{key:'Dead',code:'KeyE',isComposing:true,altKey:true}));owner.keyup(event('keyup',{key:'´',code:'KeyE',isComposing:true,altKey:true}));},
    deleteBefore(){return owner.beforeInput(event('beforeinput',{inputType:'deleteCompositionText',isComposing:true,cancelable:false}));},
    empty(){shape='br';text='';browser.isCollapsed=true;browser.anchorNode=browser.focusNode=block;browser.anchorOffset=browser.focusOffset=0;owner.input(event('input',{inputType:'deleteCompositionText',isComposing:true}));},
    insertBefore(){return owner.beforeInput(event('beforeinput',{inputType:'insertFromComposition',data:'é',isComposing:true,cancelable:true}));},
    payloadDomOnly(){shape='text';text='é';browser.anchorNode=browser.focusNode=textNode;browser.anchorOffset=browser.focusOffset=1;browser.isCollapsed=true;},
    payload(value='é'){shape='text';text=value;browser.anchorNode=browser.focusNode=textNode;browser.anchorOffset=browser.focusOffset=value.length;owner.input(event('input',{inputType:'insertFromComposition',data:'event data is not authority',isComposing:true}));},
    end(){owner.end(event('compositionend',{data:'not authority'}));},echo(extra={}){const e=event('keydown',{key:'é',code:'KeyE',...extra});owner.keydown(e);return e;},echoUp(){owner.keyup(event('keyup',{key:'e',code:'KeyE'}));},
    ready(){api.start();api.deleteBefore();api.empty();api.insertBefore();api.payload();api.end();},
    raf(ms=16){time+=ms;const work=[...rafs.values()];rafs.clear();work.forEach(f=>f(time));},setText(value){text=value;},setMutations(value){mutations=value;},setFocus(value){focus=value;},moveBrowserCaret(where){assert(where==='start'||where==='other-owned-node');browser.anchorNode=browser.focusNode=where==='start'?textNode:block;browser.anchorOffset=browser.focusOffset=0;browser.isCollapsed=true;},stale(){state={...state,stamp:{...state.stamp,selection_epoch:'2'}};},foreign(){selection.invalidate(false,event('pointerdown'));},context(){context={...context,capability_digest:'foreign'};},
    close(){owner.destroy();assert.equal(listener,null);assert.equal(rafs.size,0);assert.equal(timers.size,0);assert.equal(liveTickets.size,0);assert.deepEqual(owner.resources(),{continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});}};
  return api;
}
test('TT01 composing-only transient: deletion remains non-native; actual payload then code-matched closing echo yields one null-result claim',()=>{
  const h=harness();h.start();h.deleteBefore();h.empty();assert.equal(h.dispatches.length,0);assert.equal(h.packets.length,0);assert.deepEqual(h.state().stamp,base);h.insertBefore();h.payload();h.end();h.echo();h.echoUp();assert.equal(h.dispatches.length,0);h.raf();assert.equal(h.dispatches.length,0);h.raf();assert.equal(h.dispatches.length,1);assert.equal(h.packets.length,0);assert.equal(h.ordinary.length,0);assert.deepEqual(JSON.parse(h.dispatches[0].command.payload_json),{kind:'insert_typed_text',text:'é',origin:'composition_commit'});assert.equal(h.state().history.undo_entries,'1');h.close();
});
test('TT02 pending BR at end retains old immediate capture refusal, with no post-end delivery mode',()=>{const h=harness();h.start();h.deleteBefore();h.empty();h.end();assert.equal(h.dispatches.length,0);assert.equal(h.packets.length,1);assert.equal(h.packets[0].composition.reason,'capture_limit');h.payload();h.raf();h.raf();assert.equal(h.dispatches.length,0);h.close();});
test('TT03 same BR without its beforeinput deletion lineage cannot dispatch deletion or a later payload',()=>{const h=harness();h.start();h.empty();h.end();h.payload();h.raf();h.raf();assert.equal(h.dispatches.length,0);assert.equal(h.packets.length,1);h.close();});
for(const hookFailure of ['delete','empty','insert','payload'])test(`TT04 native/view boundary refusal at ${hookFailure} is atomic and never replayed`,()=>{const h=harness({hookFailure});h.start();h.deleteBefore();if(!h.packets.length)h.empty();if(!h.packets.length){h.insertBefore();if(!h.packets.length)h.payload();}h.end();h.raf();h.raf();assert.equal(h.dispatches.length,0);assert.equal(h.packets.length,1);assert.deepEqual(h.state().stamp,base);h.close();});
for(const [name,change]of [['foreign intent',h=>h.foreign()],['native selection epoch',h=>h.stale()],['immutable context',h=>h.context()],['focus',h=>h.setFocus(false)]])test(`TT05 pending transient refuses changed ${name}`,()=>{const h=harness();h.start();h.deleteBefore();h.empty();change(h);h.insertBefore();if(!h.packets.length)h.payload();h.end();h.raf();h.raf();assert.equal(h.dispatches.length,0);assert.equal(h.packets.length,1);h.close();});
for(const [name,extra]of [['wrong code',{code:'KeyQ'}],['repeat',{repeat:true}],['modifier',{metaKey:true}],['foreign target',{target:{}}]])test(`TT06 closing echo ${name} keeps old busy refusal`,()=>{const h=harness();h.ready();h.echo(extra);h.raf();h.raf();assert.equal(h.dispatches.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,1);h.close();});
test('TT07 repeated closing delivery cannot obtain a second echo or ordinary permit',()=>{const h=harness();h.ready();h.echo();h.echoUp();h.echo();h.raf();h.raf();assert.equal(h.dispatches.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,1);h.close();});
test('TT08 late closing echo after first RAF but before second cannot publish',()=>{const h=harness();h.ready();h.raf();h.echo();h.echoUp();h.raf();assert.equal(h.dispatches.length,0);assert.equal(h.packets.length,1);assert.equal(h.ordinary.length,0);h.close();});
test('TT09 a normal beforeinput after an accepted echo still cannot use an ordinary permit',()=>{const h=harness();h.ready();h.echo();h.echoUp();h.owner.beforeInput(h.event('beforeinput',{inputType:'insertText',data:'é'}));h.raf();h.raf();assert.equal(h.dispatches.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,1);h.close();});
test('TT10 eighth normal nonempty fingerprint read may settle by 249ms; no empty RAF becomes an observation',()=>{const h=harness();h.ready();for(let i=1;i<=8;i++){h.setText(i>=7?'é':String(i));h.raf(i===8?32:31);}assert.equal(h.dispatches.length,1);assert.equal(h.packets.length,0);h.close();});
test('TT11 eighth unstable normal payload fingerprint refuses without a ninth read',()=>{const h=harness();h.ready();for(let i=1;i<=8;i++){h.setText(String(i));h.raf(15);}assert.equal(h.dispatches.length,0);assert.equal(h.packets.length,1);assert.equal(h.packets[0].composition.reason,'settle_limit');h.raf();assert.equal(h.dispatches.length,0);h.close();});
test('TT12 original 250ms deadline remains absolute after successful transient payload',()=>{const h=harness();h.ready();h.raf(250);assert.equal(h.dispatches.length,0);assert.equal(h.packets[0].composition.reason,'settle_limit');h.close();});
test('TT13 original mutation ceiling is shared through transient phases',()=>{const h=harness();h.start();h.setMutations(4097);h.deleteBefore();h.empty();h.end();h.raf();h.raf();assert.equal(h.dispatches.length,0);assert.equal(h.packets.length,1);assert.equal(h.packets[0].composition.reason,'capture_limit');assert.equal(h.packets[0].region.kind,'retained_dom');h.close();});
test('TT14 no opt-in means same owned fresh BR follows the old default refusal path',()=>{const h=harness({enabled:false});h.start();h.deleteBefore();h.empty();h.end();assert.equal(h.calls.includes('capture-delete'),false);assert.equal(h.dispatches.length,0);assert.equal(h.packets[0].composition.reason,'capture_limit');h.close();});
test('TT15 nested start retires the original pending generation without an intermediate empty command',()=>{const h=harness();h.start();h.deleteBefore();h.empty();h.owner.start(h.event('compositionstart'));h.end();h.raf();h.raf();assert.equal(h.dispatches.length,0);assert.equal(h.packets.length,1);h.close();});

// A tiny DOM data model, not jsdom, native DOM or browser provenance. It provides
// only the actual correspondence's structural API; no observation result is mocked.
function geometry({partial=false,marks=[],leafAttributes={},extraLeaf=false,multiBlock=false,originalBreak=false,originalEmpty=false}={}){
  let browser,currentGeneration={},nativeSelection=clone(sourceSelection);
  const doc={getSelection:()=>browser,createRange(){return {startContainer:null,startOffset:0,endContainer:null,endOffset:0,setStart(node,offset){this.startContainer=node;this.startOffset=offset;},setEnd(node,offset){this.endContainer=node;this.endOffset=offset;},collapse(){this.endContainer=this.startContainer;this.endOffset=this.startOffset;},compareBoundaryPoints(_how,other){if(this.startContainer===other.startContainer)return this.startOffset-other.startOffset;const all=[];const visit=node=>{all.push(node);node.childNodes.forEach(visit);};visit(host);return all.indexOf(this.startContainer)-all.indexOf(other.startContainer);},detach(){},get collapsed(){return this.startContainer===this.endContainer&&this.startOffset===this.endOffset;}};}};
  class N {
    constructor(type,tag=null,data=null){this.nodeType=type;this.tagName=tag;this.data=data;this.ownerDocument=doc;this.parentNode=null;this.childNodes=[];this.attributes=[];}
    append(...nodes){for(const node of nodes){node.parentNode?.replaceChildren(...node.parentNode.childNodes.filter(n=>n!==node));this.childNodes.push(node);node.parentNode=this;}}
    replaceChildren(...nodes){for(const node of this.childNodes)node.parentNode=null;this.childNodes=[];this.append(...nodes);}
    setAttribute(name,value){const old=this.attributes.find(a=>a.name===name);if(old)old.value=value;else this.attributes.push({name,value});}
    getAttribute(name){return this.attributes.find(a=>a.name===name)?.value??null;}
    contains(node){return this===node||this.childNodes.some(child=>child.contains(node));}
    get firstChild(){return this.childNodes[0]??null;}
    get nextSibling(){if(!this.parentNode)return null;return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this)+1]??null;}
    get previousSibling(){if(!this.parentNode)return null;return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this)-1]??null;}
    get isConnected(){return this===host||host.contains(this);}
  }
  const host=new N(1,'DIV'),p=new N(1,'P'),span=new N(1,'SPAN'),text=new N(3,null,'old'),tail=new N(1,'P'),tailSpan=new N(1,'SPAN'),tailText=new N(3,null,'tail');host.append(p,tail);p.append(span);span.append(text);tail.append(tailSpan);tailSpan.append(tailText);
  const rows=new Map(),owned=new WeakMap(),make=(id,parent,primitive,type_id,outer,content,leafText,children,value)=>{const view={stamp:clone(base),id,parent,primitive,type_id,attributes:{},marks:[],text:value,children,changed_revision:'0',stats:{authored_nodes:'0',text_utf8:'0',text_utf16:'0',height:'0'}};const row={view,outer,content,text:leafText,placeholder:null};rows.set(id,row);owned.set(outer,id);if(leafText)owned.set(leafText,id);outer.setAttribute('data-editor-node',id);return row;};
  make('root',null,'root','root',host,host,null,['block','tail'],null);make('block','root','text_block','paragraph',p,p,null,['original-text'],null);const leaf=make('original-text','block','text','text',span,span,text,[],'old');leaf.view.marks=clone(marks);leaf.view.attributes=clone(leafAttributes);make('tail','root','text_block','paragraph',tail,tail,null,['tail-text'],null);make('tail-text','tail','text','text',tailSpan,tailSpan,tailText,[],'tail');
  if(extraLeaf){const extraSpan=new N(1,'SPAN'),extraText=new N(3,null,'x');p.append(extraSpan);extraSpan.append(extraText);make('extra-text','block','text','text',extraSpan,extraSpan,extraText,[],'x');rows.get('block').view.children.push('extra-text');}
  if(originalBreak){const br=new N(1,'BR');p.append(br);make('native-break','block','inline_atom','hard_break',br,br,null,[],null);rows.get('block').view.children.push('native-break');}
  if(originalEmpty){text.data='';leaf.view.text='';nativeSelection.focus.offset=0;}
  if(partial)nativeSelection.focus.offset=2;if(multiBlock)nativeSelection.focus=point('tail-text',4);
  browser={isCollapsed:originalEmpty,anchorNode:text,focusNode:multiBlock?tailText:text,anchorOffset:0,focusOffset:multiBlock?4:originalEmpty?0:partial?2:3};
  const access={host,limits:{blocks:32,nodes:1024,depth:128,utf16:32768},row:id=>rows.get(id),ownedId:node=>owned.get(node),placeholder:()=>false,point:value=>({node:rows.get(value.node).text,offset:value.offset}),selection:()=>nativeSelection,generation:()=>currentGeneration};
  const api=createCompositionCorrespondence(access),window=api.begin(clone(base),nativeSelection);assert.notEqual(window?.status,'dom_refused','Valid independently authored baseline');
  const input=(type,inputType,{cancelable=false,range=null,isComposing=true,data=null}={})=>({type,inputType,cancelable,isComposing,data,getTargetRanges:()=>range??[]});
  const range=(node,start,end)=>({startContainer:node,startOffset:start,endContainer:node,endOffset:end});
  let br=null,payload=null;
  return {api,window,access,host,p,span,text,tail,tailText,rows,N,input,range,preedit(){text.data='´';browser.anchorNode=browser.focusNode=text;browser.anchorOffset=0;browser.focusOffset=1;browser.isCollapsed=false;},
    deleteEvent(extra={}){return input('beforeinput','deleteCompositionText',{range:[range(text,0,1)],...extra});},
    empty(){br=new N(1,'BR');p.replaceChildren(br);browser.anchorNode=browser.focusNode=p;browser.anchorOffset=browser.focusOffset=0;browser.isCollapsed=true;return br;},
    insertEvent(extra={}){return input('beforeinput','insertFromComposition',{cancelable:true,range:[range(p,0,0)],data:'é',...extra});},
    payload(value='é'){payload=new N(3,null,value);p.replaceChildren(payload);browser.anchorNode=browser.focusNode=payload;browser.anchorOffset=browser.focusOffset=value.length;browser.isCollapsed=true;return payload;},
    selection(node,start,end=start){browser.anchorNode=browser.focusNode=node;browser.anchorOffset=start;browser.focusOffset=end;browser.isCollapsed=start===end;},generation(){currentGeneration={};},native(){nativeSelection={...nativeSelection,focus:{...nativeSelection.focus,offset:2}};}};
}
const refused=value=>assert.equal(value?.status,'dom_refused');
function captured(g){g.preedit();const ticket=g.api.captureTerminalDeletion(g.window,g.deleteEvent());assert(ticket&&ticket.status!=='dom_refused','A registered exact preedit deletion has one private ticket');return ticket;}
function emptied(g){const ticket=captured(g);g.empty();assert.equal(g.api.observeTerminalDeletion(ticket,g.input('input','deleteCompositionText')),null);return ticket;}
test('TG01 default registered observer refuses the same fresh BR even when a separate private ticket exists',()=>{const g=geometry(),ticket=captured(g);g.empty();refused(g.api.observe(g.window));assert.equal(g.api.observeTerminalDeletion(ticket,g.input('input','deleteCompositionText')),null);refused(g.api.observe(g.window));g.api.releaseTerminal(ticket);assert.equal(g.api.terminalRetainedBytes(ticket),0);});
test('TG02 private ticket consumes actual P direct Text payload through the normal observer; no native ID or empty replacement is synthesized',()=>{const g=geometry(),ticket=emptied(g);assert(g.api.terminalRetainedBytes(ticket)>0);assert.equal(g.api.captureTerminalInsertion(ticket,g.insertEvent()),null);const text=g.payload();const observed=g.api.observeTerminalInsertion(ticket,g.input('input','insertFromComposition',{data:'not authority'}));assert.equal(observed.replacement,'é');assert.equal(observed.region.originalText,'old');assert.equal(observed.region.provisionalText,'é');assert.equal(g.p.firstChild,text);assert.equal(text.nodeType,3);assert.equal(g.host.contains(g.span),false);assert.equal(g.api.terminalRetainedBytes(ticket),0);refused(g.api.observeTerminalInsertion(ticket,g.input('input','insertFromComposition')));});
for(const [name,options]of [['partial original selection',{partial:true}],['link native marks',{marks:[{type_id:'org.klenwriter.kwdj/link',attributes:{href:'https://example.test/'}}]}],['code native marks',{marks:[{type_id:'org.klenwriter.kwdj/code',attributes:{}}]}],['reference-link native marks',{marks:[{type_id:'org.klenwriter.kwdj/reference_link',attributes:{id:'r'}}]}],['authored native attributes',{leafAttributes:{lang:{kind:'string',value:'x'}}}],['multiple native leaves',{extraLeaf:true}],['multiple native blocks',{multiBlock:true}],['original native hard break',{originalBreak:true}],['original native empty Text',{originalEmpty:true}]])test(`TG03 unsupported ${name} never receives a private terminal ticket`,()=>{const g=geometry(options);g.preedit();assert.equal(g.api.captureTerminalDeletion(g.window,g.deleteEvent()),null);});
for(const [name,change]of [['wrong preedit offset',g=>({range:[g.range(g.text,0,0)]})],['multiple ranges',g=>({range:[g.range(g.text,0,1),g.range(g.text,0,1)]})],['range in another object',g=>({range:[g.range(g.tailText,0,1)]})],['composing flag absent',()=>({isComposing:false})],['cancelable deletion',()=>({cancelable:true})]])test(`TG04 deletion lineage rejects ${name}`,()=>{const g=geometry();g.preedit();const value=g.api.captureTerminalDeletion(g.window,g.deleteEvent(change(g)));assert(value===null||value.status==='dom_refused');});
for(const [name,change]of [['attributed BR',(g,br)=>br.setAttribute('class','foreign')],['BR children',(g,br)=>br.append(new g.N(3,null,'x'))],['extra text',(g)=>g.p.append(new g.N(3,null,'x'))],['wrapped BR',(g,br)=>{const wrap=new g.N(1,'SPAN');g.p.replaceChildren(wrap);wrap.append(br);}],['wrong selection',(g)=>g.selection(g.p,1)],['outside sentinel text',(g)=>{g.tailText.data='foreign';}],['block metadata',(g)=>g.p.setAttribute('class','foreign')],['stale generation',(g)=>g.generation()]])test(`TG05 exact pending geometry refuses ${name}`,()=>{const g=geometry(),ticket=captured(g),br=g.empty();change(g,br);refused(g.api.observeTerminalDeletion(ticket,g.input('input','deleteCompositionText')));g.api.releaseTerminal(ticket);assert.equal(g.api.terminalRetainedBytes(ticket),0);});
test('TG06 an object copying the public window field is not a registered ticket',()=>{const g=geometry();g.preedit();g.empty();refused(g.api.observeTerminalDeletion({window:g.window},g.input('input','deleteCompositionText')));});
test('TG07 insertion range must be exactly the actual empty owned block child0',()=>{const g=geometry(),ticket=emptied(g);refused(g.api.captureTerminalInsertion(ticket,g.insertEvent({range:[g.range(g.p,0,1)]})));g.api.releaseTerminal(ticket);});
test('TG08 event data alone with an empty BR or surviving SPAN cannot become payload',()=>{for(const shape of ['br','span']){const g=geometry(),ticket=emptied(g);assert.equal(g.api.captureTerminalInsertion(ticket,g.insertEvent()),null);if(shape==='span'){const span=new g.N(1,'SPAN');span.append(new g.N(3,null,'é'));g.p.replaceChildren(span);g.selection(span.firstChild,1);}refused(g.api.observeTerminalInsertion(ticket,g.input('input','insertFromComposition',{data:'é'})));g.api.releaseTerminal(ticket);}});
test('TG09 released or completed ticket cannot be rebound to a later generation',()=>{const g=geometry(),ticket=emptied(g);g.api.releaseTerminal(ticket);refused(g.api.captureTerminalInsertion(ticket,g.insertEvent()));g.api.releaseTerminal(ticket);assert.equal(g.api.terminalRetainedBytes(ticket),0);});

// SOURCE03 amendment02. A protected native selection cannot stand in for the
// actual DOM point. These move only the controlled browser caret: native state,
// immutable context and complete actual text/fingerprint remain unchanged.
test('TT16 actual caret moved after private payload before end cannot enter settlement',()=>{
  const h=harness();h.start();h.deleteBefore();h.empty();h.insertBefore();h.payload();
  const before=h.state(),region=h.view.captureRegion();assert.equal(region.provisionalText,'é');
  h.moveBrowserCaret('start');assert.deepEqual(h.state(),before);assert.deepEqual(h.view.captureRegion(),region);
  h.end();h.raf();h.raf();assert.equal(h.dispatches.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,1);assert.equal(h.packets[0].composition.nativeOutcome,'not_submitted');assert.deepEqual(h.state(),before);h.close();
});
test('TT17 actual caret moved to another owned node after end cannot gain closing-echo authority',()=>{
  const h=harness();h.ready();const before=h.state(),region=h.view.captureRegion();assert.equal(region.provisionalText,'é');
  h.moveBrowserCaret('other-owned-node');assert.deepEqual(h.state(),before);assert.deepEqual(h.view.captureRegion(),region);
  h.echo();h.echoUp();h.raf();h.raf();assert.equal(h.dispatches.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,1);assert.equal(h.packets[0].composition.nativeOutcome,'not_submitted');assert.deepEqual(h.state(),before);h.close();
});

// SOURCE03 amendment03. Actual nonempty DOM alone cannot consume the original
// insertion ticket: the matching owned input delivery is independently required.
test('TT18 actual direct Text without matching insertFromComposition input cannot settle at end',()=>{
  const h=harness();h.start();h.deleteBefore();h.empty();h.insertBefore();const before=h.state();
  h.payloadDomOnly();assert.equal(h.view.captureRegion().provisionalText,'é');assert.deepEqual(h.state(),before);
  h.end();h.raf();h.raf();assert.equal(h.dispatches.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,1);assert.equal(h.packets[0].composition.reason,'ambiguous_tail');assert.equal(h.packets[0].composition.nativeOutcome,'not_submitted');assert.deepEqual(h.state(),before);h.close();
});

// SOURCE03 amendment04: owner/view callback-boundary doubles, not native DOM
// callback provenance. A real getTargetRanges may reenter while the view creates
// a ticket. Ownership must be checked when it returns, before retaining anything.
for(const [name,reenter]of [
  ['foreign intent',h=>h.foreign()],
  ['nested composition start',h=>h.owner.start(h.event('compositionstart'))],
  ['destroyed owner',h=>h.owner.destroy()],
])test(`TT19 returned deletion ticket is released immediately after callback ${name}`,()=>{
  const h=harness();h.start();const capture=h.view.captureTerminalDeletion;let returned=null;
  h.view.captureTerminalDeletion=(window,event)=>{const ticket=capture(window,event);assert(ticket&&ticket.status!=='dom_refused');returned=ticket;assert.equal(h.liveTickets.has(ticket),true);reenter(h);return ticket;};
  h.deleteBefore();assert(returned);assert.equal(h.dispatches.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.liveTickets.size,0,'The just-returned ticket is released at the same callback boundary, before any next input');
  if(name!=='destroyed owner'){assert.equal(h.packets.length,1);assert.equal(h.packets[0].composition.nativeOutcome,'not_submitted');}
  // Destroyed owners have no new recovery-callback obligation. All three cases
  // must nevertheless release actual retained ticket/scheduler/listener state.
  h.close();
});

// SOURCE03 amendment05: post-observation actual DOM/focus is a consumption
// condition, not merely a precheck. Native stamp/context/text stay unchanged.
for(const [name,change]of [
  ['same actual Text caret moved to0',h=>h.moveBrowserCaret('start')],
  ['owned editor focus lost',h=>h.setFocus(false)],
])test(`TT20 closing echo rechecks ${name} after observation callback`,()=>{
  const h=harness();h.ready();const before=h.state(),observe=h.view.observeComposition;let changed=false;
  h.view.observeComposition=window=>{const actual=observe(window);if(!changed){changed=true;change(h);}return actual;};
  h.echo();h.echoUp();h.raf();h.raf();assert.equal(changed,true);assert.equal(h.dispatches.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,1);assert.equal(h.packets[0].composition.nativeOutcome,'not_submitted');assert.deepEqual(h.state(),before);h.close();
});

// SOURCE03 + explicit deprecated keyboard fields. These are source-first owner
// controls with existing labelled doubles, not OS or native transaction proof.
// keyCode229 is not an ordinary permit: only the complete paired terminal ticket
// may classify one non-mutating closing key before the first settlement RAF.
const closing229={keyCode:229,which:229,isComposing:false,repeat:false,altKey:false,ctrlKey:false,metaKey:false,shiftKey:false};
const release229=h=>h.owner.keyup(h.event('keyup',{key:'e',code:'KeyE',keyCode:69,which:69}));
test('TT21 complete paired terminal admits one non-mutating closing keyCode229 and one original null-result claim',()=>{
  const h=harness();h.ready();const e=h.echo(closing229);assert.equal(e.keyCode,229);assert.equal(e.isComposing,false);assert.equal(e.defaultPrevented,false);release229(h);
  assert.equal(h.dispatches.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,0);h.raf();assert.equal(h.dispatches.length,0);h.raf();
  assert.equal(h.dispatches.length,1);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,0);assert.deepEqual(JSON.parse(h.dispatches[0].command.payload_json),{kind:'insert_typed_text',text:'é',origin:'composition_commit'});
  assert.deepEqual(h.state().stamp,{...base,revision:'1',selection_epoch:'2',history_epoch:'1'});assert.deepEqual(h.state().selection,{anchor:point('fresh-text',1),focus:point('fresh-text',1)});assert.equal(h.state().history.undo_entries,'1');assert.equal(h.state().history.redo_entries,'0');h.close();
});
test('TT22 ordinary beforeinput after a closing229 echo still cannot obtain an ordinary permit',()=>{
  const h=harness();h.ready();const before=h.state();assert.equal(h.echo(closing229).defaultPrevented,false);release229(h);
  const input=h.event('beforeinput',{inputType:'insertText',data:'é',isComposing:false});assert.equal(h.owner.beforeInput(input),true);assert.equal(input.defaultPrevented,true);h.raf();h.raf();
  assert.equal(h.dispatches.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,1);assert.equal(h.packets[0].composition.reason,'busy');assert.equal(h.packets[0].composition.nativeOutcome,'not_submitted');assert.deepEqual(h.state(),before);h.close();
});
for(const [name,extra]of [
  ['wrong code',{code:'KeyQ'}],['repeat',{repeat:true}],['Alt',{altKey:true}],['Control',{ctrlKey:true}],['Meta',{metaKey:true}],['Shift',{shiftKey:true}],['foreign target',{target:{}}],['still composing',{isComposing:true}],
])test(`TT23 closing229 ${name} cannot bypass the original terminal fences`,()=>{
  const h=harness();h.ready();const before=h.state();h.echo({...closing229,...extra});release229(h);h.raf();h.raf();
  assert.equal(h.dispatches.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,1);assert.equal(h.packets[0].composition.nativeOutcome,'not_submitted');assert.deepEqual(h.state(),before);h.close();
});
for(const [name,change]of [
  ['native selection epoch',h=>h.stale()],['immutable context',h=>h.context()],['foreign intent',h=>h.foreign()],['focus',h=>h.setFocus(false)],['actual caret',h=>h.moveBrowserCaret('start')],
])test(`TT24 closing229 refuses changed ${name}`,()=>{
  const h=harness();h.ready();change(h);const before=h.state();h.echo(closing229);release229(h);h.raf();h.raf();
  assert.equal(h.dispatches.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,1);assert.equal(h.packets[0].composition.nativeOutcome,'not_submitted');assert.deepEqual(h.state(),before);h.close();
});
test('TT25 closing229 after the first RAF and before the second remains late and cannot publish',()=>{
  const h=harness();h.ready();const before=h.state();h.raf();assert.equal(h.dispatches.length,0);const late=h.echo(closing229);release229(h);h.raf();
  assert.equal(late.defaultPrevented,true);assert.equal(h.dispatches.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,1);assert.equal(h.packets[0].composition.reason,'busy');assert.equal(h.packets[0].composition.nativeOutcome,'not_submitted');assert.deepEqual(h.state(),before);h.close();
});
test('TT26 no terminal ticket keeps keyCode229 nonordinary while the original nonterminal composition settles its own preedit',()=>{
  const h=harness();h.start();h.end();const e=h.echo(closing229);release229(h);assert.equal(e.defaultPrevented,false);assert.equal(h.packets.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.calls.includes('capture-delete'),false);h.raf();h.raf();
  assert.equal(h.dispatches.length,1);assert.deepEqual(JSON.parse(h.dispatches[0].command.payload_json),{kind:'insert_typed_text',text:'´',origin:'composition_commit'});assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,0);h.close();
});
test('TT27 idle owner does not turn keyCode229 into a command, recovery or ordinary permit',()=>{
  const h=harness(),before=h.state(),e=h.event('keydown',{key:'é',code:'KeyE',...closing229});h.owner.keydown(e);release229(h);assert.equal(e.defaultPrevented,false);assert.equal(h.dispatches.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,0);assert.deepEqual(h.state(),before);h.close();
});
for(const released of [false,true])test(`TT28 second closing229 ${released?'after keyup':'while same code is held'} is never a second echo or ordinary permit`,()=>{
  const h=harness();h.ready();const before=h.state();assert.equal(h.echo(closing229).defaultPrevented,false);if(released)release229(h);const second=h.echo(closing229);release229(h);h.raf();h.raf();
  assert.equal(second.defaultPrevented,true);assert.equal(h.dispatches.length,0);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,1);assert.equal(h.packets[0].composition.reason,'busy');assert.equal(h.packets[0].composition.nativeOutcome,'not_submitted');assert.deepEqual(h.state(),before);h.close();
});
