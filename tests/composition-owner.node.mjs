// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled scheduler/view/native-ticket doubles exercise the actual owner.
// These are NOT native semantics, real DOM correspondence or OS IME evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CompositionOwner } from '../packages/dom/dist/composition.js';
import { loadCompositionContract } from '../scripts/composition-contract-data.mjs';

const rows=loadCompositionContract().events.rows;
const policy=id=>{const row=rows.find(row=>row.id.startsWith(`${id}-`));assert(row);return row;};
const clone=value=>structuredClone(value);
const nativeRefusal={status:'refused',diagnostic:{code:'position.invalid',path:'',category:'sdk',details:{},stamp:null,may_have_committed:false}};
function harness({native='ok',onRecovery,onSubmit,seed=0n,structuralOrdinary=false}={}) {
  let time=0,next=0,serial=0n,listener=null,available=true,focus=true,text='abcd',mutations=0,viewFailure=null,observeCost=0,bindingCost=0;
  let state={stamp:{session:'s1:1:1',generation:'1',revision:'0',selection_epoch:'1',history_epoch:'0'},
    root:'n1:1:1:1',selection:{anchor:{kind:'text',node:'n1:1:1:3',offset:1,affinity:'after'},focus:{kind:'text',node:'n1:1:1:3',offset:3,affinity:'after'}},stored_marks:null,dirty:false,saved_revision:'0',history:{undo_entries:'0',redo_entries:'0',retained_bytes:'0'}};
  const context={build_id:'controlled-build',profile:{},registry_digest:'registry',capability_digest:'capabilities'};
  const rafs=new Map(),timers=new Map(),calls=[],recoveries=[],resourceSnapshots=[];
  const point={nodeType:3};
  const browser={anchorNode:point,focusNode:point,anchorOffset:2,focusOffset:2,isCollapsed:true};
  const win={performance:{now:()=>time},requestAnimationFrame:f=>{const id=++next;rafs.set(id,f);return id;},cancelAnimationFrame:id=>rafs.delete(id),
    setTimeout:(f,delay)=>{const id=++next;timers.set(id,{f,at:time+delay});return id;},clearTimeout:id=>timers.delete(id)};
  const element={ownerDocument:{defaultView:win,getSelection:()=>browser},contains:node=>node===element||node===point};
  const region=()=>Object.freeze({kind:'bounded',stamp:clone(state.stamp),originalText:'abcd',provisionalText:text,affectedNodeIds:['n1:1:1:2']});
  const selection={intent:()=>serial,intentAvailable:()=>available,ownsFocus:()=>focus,cancel:()=>calls.push('cancel-pointer'),syncFromDom:()=>clone(state.selection),
    invalidate(clear=false,event=null){const before=serial;serial++;listener?.(before,serial,event);},
    observeInputIntent(fn){listener=fn;return()=>{listener=null;};}};
  const view={
    beginComposition(stamp,range){calls.push('begin');return {stamp,selection:range,entries:[],parent:element,before:null,after:null,anchor:{node:point,offset:1},focus:{node:point,offset:3},selectedAtomIds:[],affectedNodeIds:['n1:1:1:2'],originalRegion:region()};},
    observeComposition(window){calls.push('observe');time+=observeCost;observeCost=0;return viewFailure??(structuralOrdinary&&ordinaryCalls>0&&window.stamp.revision!==state.stamp.revision
      ?{status:'dom_refused',diagnostic:{code:'dom.composition_stale',phase:'composition',stamp:clone(state.stamp),publication:'none',node:null,typeId:null}}
      :{region:region(),unchanged:text===window.originalRegion.provisionalText,replacement:text==='abcd'?'bc':text.slice(1,-1),fingerprint:`actual:${text}`});},
    restoreComposition(){calls.push('restore');text='abcd';return null;},
    readSelection:()=>clone(state.selection),restoreSelection:()=>{calls.push('restore-selection');return null;},
    setComposing:value=>calls.push(`composing:${value}`),endProvisional:()=>calls.push('unprotect'),captureRegion:()=>viewFailure?{kind:'retained_dom',element,reason:'capture_limit',ownership:'transferred_to_host'}:region(),
    captureComposition:()=>viewFailure?{kind:'retained_dom',element,reason:'capture_limit',ownership:'transferred_to_host'}:region(),
  };
  let owner,resolve,reject,originalTicket=null,ordinaryCalls=0,submissions=0;
  const response=()=>{
    if(native==='refused')return {...clone(nativeRefusal),diagnostic:{...nativeRefusal.diagnostic,stamp:clone(state.stamp)}};
    if(native==='fatal')return {status:'fatal',diagnostic:{...clone(nativeRefusal.diagnostic),stamp:clone(state.stamp),may_have_committed:true}};
    state={...state,stamp:{...state.stamp,revision:String(+state.stamp.revision+1),selection_epoch:String(+state.stamp.selection_epoch+1),history_epoch:String(+state.stamp.history_epoch+1)},
      selection:{anchor:{kind:'text',node:'n1:1:1:3',offset:2,affinity:'after'},focus:{kind:'text',node:'n1:1:1:3',offset:2,affinity:'after'}},dirty:true,history:{undo_entries:String(+state.history.undo_entries+1),redo_entries:'0',retained_bytes:'100'}};
    return {status:'ok',value:{kind:'mutation',effect:'changed',state:clone(state),presentation:{active:'none'}}};
  };
  function ticket() {
    if(native==='queued') {originalTicket={status:'queued',completion:new Promise((yes,no)=>{resolve=()=>yes(response());reject=no;})};return originalTicket;}
    originalTicket={status:'completed',response:response()};return originalTicket;
  }
  const config={element,view,selection,bindings:{insertText:value=>{time+=bindingCost;bindingCost=0;return {id:'literal-insert-text',payload_json:JSON.stringify({kind:'insert_text',text:value})};}},
    canEdit:()=>true,busy:()=>false,capture:()=>clone(state.stamp),context:()=>clone(context),readState:()=>clone(state),
    submit(request){submissions++;calls.push('submit');selection.invalidate();onSubmit?.(owner);return ticket();},
    ordinary(event){ordinaryCalls++;calls.push('ordinary');event.preventDefault();selection.invalidate(false,event);text='aZ d';return ticket();},
    report:failure=>calls.push(['report',failure]),recover(failure,r,composition){calls.push('recovery');const packet={failure,region:r,composition};recoveries.push(packet);onRecovery?.(owner,packet);},
    composing:value=>calls.push(`mount-composing:${value}`),consumeRecords:()=>{const n=mutations;mutations=0;return n;},onResources:r=>resourceSnapshots.push(r)};
  owner=new CompositionOwner(config,seed);
  function event(type,extra={}) {return {type,target:element,cancelable:true,defaultPrevented:false,isComposing:false,inputType:'',data:null,key:'',code:'',keyCode:0,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,repeat:false,getTargetRanges:()=>[],preventDefault(){this.defaultPrevented=true;},...extra};}
  const api={owner,event,calls,recoveries,resourceSnapshots,selection,
    start(){owner.start(event('compositionstart',{data:''}));},end(){owner.end(event('compositionend',{data:'Q'}));},
    raf(ms=16){time+=ms;const pending=[...rafs.values()];rafs.clear();pending.forEach(f=>f(time));},
    elapsed(ms){time+=ms;const pending=[...timers.entries()].filter(([,v])=>v.at<=time);pending.forEach(([id,v])=>{timers.delete(id);v.f();});},
    setText(value){text=value;},setMutations(n){mutations=n;},setObserveCost(ms){observeCost=ms;},setBindingCost(ms){bindingCost=ms;},setFailure(code='dom.composition_limit'){viewFailure={status:'dom_refused',diagnostic:{code,phase:'composition',stamp:clone(state.stamp),publication:'none',node:null,typeId:null}};},
    staleNative(){state={...state,stamp:{...state.stamp,revision:'1'}};},setFocus(value){focus=value;},exhaustIntent(){available=false;},
    resolve:()=>resolve(),reject:()=>reject(new Error('unknown completion')),ticket:()=>originalTicket,state:()=>clone(state),
    submissions:()=>submissions,ordinaryCalls:()=>ordinaryCalls,timers:()=>timers.size,rafs:()=>rafs.size,listeners:()=>Number(listener!==null),
    commit(){api.start();text='aZd';api.end();api.raf();api.raf();},
    close(){owner.retained();owner.destroy();},
  };return api;
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
const label=(id,text)=>`${policy(id).id}: ${text} [controlled owner only]`;

for(const id of ['E01','E02','E03','E04'])test(label(id,'one changed generation despite event/data ordering'),()=>{
  const h=harness();h.start();h.setText('aQd');
  if(id==='E02')h.owner.input(h.event('input',{inputType:'insertCompositionText',data:'wrong'}));
  h.setText('aZd');h.end();if(id==='E03')h.end();
  h.owner.input(h.event('input',{inputType:'insertFromComposition',data:id==='E04'?'wrong':'Z'}));h.raf();h.raf();
  assert.equal(h.submissions(),policy(id).expected.compositionDispatches);assert.equal(h.recoveries.length,0);h.close();
});
test(label('E05','complete unchanged cancellation has no native ticket'),()=>{const h=harness();h.start();h.setText('a?d');h.setText('abcd');h.end();h.raf();h.raf();assert.equal(h.submissions(),0);assert(h.calls.includes('restore'));assert.equal(h.recoveries.length,0);h.close();});
for(const id of ['E06','E07'])test(label(id,'Escape/blur does not imply unchanged cancellation'),()=>{const h=harness();h.start();h.setText('aQd');if(id==='E06')h.owner.keydown(h.event('keydown',{key:'Escape',code:'Escape'}));else {h.setFocus(false);h.owner.blur(h.event('blur'));}h.setText('a´d');h.end();h.raf();h.raf();assert.equal(h.submissions(),1);assert.equal(h.recoveries.length,0);assert(!h.calls.includes('restore-selection'));h.close();});
test(label('E08','blur watchdog transfers active DOM without destructive repair'),()=>{const h=harness();h.start();h.setText('aQd');h.owner.blur(h.event('blur'));h.elapsed(250);assert.equal(h.recoveries[0].composition.reason,'settle_limit');assert.equal(h.recoveries[0].region.kind,'retained_dom');assert(!h.calls.includes('restore'));assert.equal(h.submissions(),0);h.close();});
test(label('E09','consecutive stable RAF reads'),()=>{const h=harness();h.start();h.setText('aQd');h.end();h.raf();h.setText('aZd');h.raf();assert.equal(h.submissions(),0);h.raf();assert.equal(h.submissions(),1);h.close();});
for(const id of ['E10','E11'])test(label(id,'eighth read boundary is inclusive, never a ninth admission'),()=>{const h=harness();h.start();h.end();for(let i=1;i<=8;i++){h.setText(id==='E10'&&i>=7?'aZd':`a${i}d`);h.raf(15);}assert.equal(h.submissions(),id==='E10'?1:0);if(id==='E11')assert.equal(h.recoveries[0].composition.reason,'settle_limit');assert.equal(h.rafs(),0);h.close();});
for(const [id,ms]of[['E12',250],['E13',600]])test(label(id,'deadline forbids first delayed callback dispatch'),()=>{const h=harness();h.start();h.setText('aZd');h.end();h.raf(ms);assert.equal(h.submissions(),0);assert.equal(h.recoveries[0].composition.reason,'settle_limit');h.close();});
for(const id of ['E14','E15'])test(label(id,'foreign native/Noop target is never adopted'),()=>{const h=harness();h.start();h.setText('aZd');if(id==='E14')h.staleNative();else h.selection.invalidate();h.end();h.raf();h.raf();assert.equal(h.submissions(),0);assert.equal(h.recoveries[0].composition.reason,'stale');assert.equal(h.recoveries[0].region.provisionalText,'aZd');h.close();});
test(label('E16','owned preedit serial advances only through exact registered event'),()=>{const h=harness();h.start();h.setText('aQd');const event=h.event('beforeinput',{inputType:'insertCompositionText',isComposing:true});assert(h.owner.beforeInput(event));h.selection.invalidate(false,event);h.setText('aZd');h.end();h.raf();h.raf();assert.equal(h.submissions(),1);assert.equal(h.recoveries.length,0);h.close();});
test(label('E17','claim precedes reentrant end/input/host callbacks'),()=>{const h=harness({onSubmit:owner=>{owner.end(h.event('compositionend'));owner.input(h.event('input',{inputType:'insertFromComposition'}));owner.end(h.event('compositionend'));}});h.commit();assert.equal(h.submissions(),1);assert.equal(h.recoveries.length,0);h.close();});
test(label('E18','same original queued ticket has one terminal path'),async()=>{const h=harness({native:'queued'});h.commit();const ticket=h.ticket();h.end();assert.equal(h.submissions(),1);assert.equal(h.owner.resources().continuations,1);h.resolve();await flush();assert.equal(h.recoveries.length,0);assert.equal(h.owner.resources().continuations,0);assert.equal(h.ticket(),ticket);h.close();});
test(label('E19','queued original cannot enqueue a new ordinary gesture'),async()=>{const h=harness({native:'queued'});h.commit();h.owner.keydown(h.event('keydown',{key:'x',code:'KeyX'}));const packet=h.recoveries[0];assert.equal(packet.composition.reason,'busy');assert.equal(packet.composition.submission,h.ticket());assert.equal(packet.composition.unappliedInput.key,'x');assert.equal(h.ordinaryCalls(),0);h.resolve();await flush();assert.equal(h.recoveries[0],packet);assert.equal(h.recoveries.length,1);h.close();});
test(label('E20','unchanged accepted correspondence deduplicates'),()=>{const h=harness();h.commit();h.owner.input(h.event('input',{inputType:'insertFromComposition',data:'Z'}));h.end();assert.equal(h.submissions(),1);assert.equal(h.recoveries.length,0);h.close();});
test(label('E21','changed accepted tail retains newest actual text'),()=>{const h=harness();h.commit();h.setText('aZZd');h.owner.input(h.event('input',{inputType:'insertCompositionText',data:'Z'}));assert.equal(h.recoveries[0].composition.reason,'ambiguous_tail');assert.equal(h.recoveries[0].region.provisionalText,'aZZd');assert.equal(h.submissions(),1);h.close();});
test(label('E22','early space cannot gain a retrospective key permit'),()=>{const h=harness();h.commit();const input=h.event('beforeinput',{inputType:'insertText',data:' '});h.owner.beforeInput(input);h.owner.keydown(h.event('keydown',{key:' ',code:'Space'}));assert(input.defaultPrevented);assert.equal(h.ordinaryCalls(),0);assert.equal(h.recoveries[0].composition.unappliedInput.data,' ');h.close();});
for(const id of ['E23','E24'])test(label(id,'fresh prospective key permit delegates exactly one ordinary operation'),()=>{const h=harness();h.commit();h.owner.keydown(h.event('keydown',{key:' ',code:'Space'}));const input=h.event('beforeinput',{inputType:'insertText',data:' '});h.owner.beforeInput(input);assert(input.defaultPrevented);assert.equal(h.ordinaryCalls(),1);if(id==='E24'){h.owner.beforeInput(h.event('beforeinput',{inputType:'insertText',data:' '}));assert.equal(h.recoveries[0].composition.reason,'ambiguous_tail');assert.equal(h.ordinaryCalls(),1);}else assert.equal(h.recoveries.length,0);h.close();});
test(label('E25','ordinary key before stability is retained busy'),()=>{const h=harness();h.start();h.setText('aZd');h.end();h.owner.keydown(h.event('keydown',{key:'x',code:'KeyX'}));assert.equal(h.submissions(),0);assert.equal(h.recoveries[0].composition.reason,'busy');assert.equal(h.recoveries[0].composition.unappliedInput.key,'x');h.close();});
test(label('E26','consecutive start never coalesces two unresolved generations'),()=>{const h=harness();h.start();h.setText('aQd');h.end();h.start();assert.equal(h.submissions(),0);assert.equal(h.recoveries[0].composition.reason,'ambiguous_tail');assert.equal(h.recoveries[0].region.kind,'retained_dom');h.close();});
test(label('E27','actual returned refusal/ticket retained before restoration'),()=>{const h=harness({native:'refused'});h.commit();const packet=h.recoveries[0];assert.equal(packet.composition.reason,'native_refused');assert.equal(packet.composition.submission,h.ticket());assert.equal(packet.composition.response,h.ticket().response);assert.equal(packet.composition.response.diagnostic.code,'position.invalid');assert.equal(packet.region.provisionalText,'aZd');assert.equal(packet.composition.disposition,'committed_restored');assert(h.calls.indexOf('restore')<h.calls.indexOf('recovery'));h.close();});
for(const id of ['E28','E29','E30','E31'])test(label(id,'callback failures cannot replace sole packet or repeat notification'),()=>{
  let retained;
  const h=harness({native:'refused',onRecovery(owner,packet){retained=packet;if(id==='E28')throw new Error('host callback');if(id==='E31')owner.beforeInput(h.event('beforeinput',{inputType:'insertText',data:'x'}));if(id==='E30'||id==='E31'){owner.retained();owner.destroy();}}});
  h.commit();assert.equal(retained.composition.response,h.ticket().response);assert.equal(retained.region.provisionalText,'aZd');assert.equal(h.submissions(),1);assert.equal(h.recoveries.length,1);if(id==='E28'||id==='E29')assert.equal(h.owner.retained().composition.response,h.ticket().response);h.close();
});
test(label('E32','incomplete capture transfers exact actual DOM capability'),()=>{const h=harness();h.start();h.setFailure();h.end();assert.equal(h.submissions(),0);assert.equal(h.recoveries[0].composition.reason,'capture_limit');assert.equal(h.recoveries[0].region.kind,'retained_dom');assert(!h.calls.includes('restore'));h.close();});
test(label('E33','oversize unapplied event retains original reference'),()=>{const h=harness();h.commit();const event=h.event('beforeinput',{inputType:'insertText',data:'x'.repeat(2097153)});h.owner.beforeInput(event);assert.equal(h.recoveries[0].composition.unappliedInput.kind,'retained_event');assert.equal(h.recoveries[0].composition.unappliedInput.event,event);assert.equal(h.ordinaryCalls(),0);h.close();});
test(label('E34','fatal may-have-committed never restores original model'),()=>{const h=harness({native:'fatal'});h.commit();assert.equal(h.recoveries[0].composition.reason,'native_fatal');assert.equal(h.recoveries[0].composition.response,h.ticket().response);assert.equal(h.recoveries[0].composition.response.diagnostic.may_have_committed,true);assert(!h.calls.includes('restore'));h.close();});
test(label('E35','late queued completion updates numeric resources only after destroy'),async()=>{const h=harness({native:'queued'});h.commit();const receipt=h.owner.retained();assert.equal(receipt.composition.submission,h.ticket());h.owner.destroy();const viewCalls=h.calls.length;assert.equal(h.owner.resources().continuations,1);h.resolve();await flush();assert.equal(h.calls.length,viewCalls);assert.equal(receipt.composition.nativeOutcome,'queued');assert(Object.isFrozen(receipt));assert.equal(h.owner.resources().continuations,0);assert.equal(h.resourceSnapshots.at(-1).continuations,0);assert.equal(h.recoveries.length,0);});
test(label('E36','destroy retains latest bounded UA input without destructive writes'),()=>{const h=harness();h.start();h.setText('aQd');h.setText('aQd終');const receipt=h.owner.retained();assert.equal(receipt.region.provisionalText,'aQd終');h.owner.destroy();assert.equal(h.listeners(),0);assert.equal(h.rafs(),0);assert.equal(h.timers(),0);assert(!h.calls.includes('restore'));assert.deepEqual(h.owner.resources(),{continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});});
test(label('E37','internal boundary seed proves MAX and MAX-1 without wrapping'),()=>{const max=18446744073709551615n;const h=harness({seed:max});h.start();assert.equal(h.recoveries[0].composition.reason,'generation_limit');assert.equal(h.recoveries[0].composition.generation,max.toString());assert.equal(h.submissions(),0);h.close();const last=harness({seed:max-1n});last.start();last.end();last.raf();last.raf();last.start();assert.equal(last.recoveries[0].composition.reason,'generation_limit');assert.equal(last.recoveries[0].composition.generation,max.toString());last.close();});
test(label('E38','composition-specific input cannot consume an ordinary permit'),()=>{const h=harness();h.commit();h.owner.keydown(h.event('keydown',{key:' ',code:'Space'}));h.owner.beforeInput(h.event('beforeinput',{inputType:'insertFromComposition',data:'Z'}));assert.equal(h.ordinaryCalls(),0);assert.equal(h.recoveries[0].composition.reason,'ambiguous_tail');h.close();});
for(const id of ['E39','E40'])test(label(id,'indistinguishable origin label is never a runtime authority'),()=>{const h=harness();h.commit();h.owner.beforeInput(h.event('beforeinput',{inputType:'insertText',data:' ',declaredTestOrigin:id}));assert.equal(h.ordinaryCalls(),0);assert.equal(h.recoveries[0].composition.reason,'ambiguous_tail');assert.equal(h.recoveries[0].composition.unappliedInput.data,' ');h.close();});

test('foreign event during native callback is not adopted as own native invalidation [controlled]',()=>{const h=harness({onSubmit:()=>h.selection.invalidate(false,h.event('pointerdown'))});h.commit();assert.equal(h.recoveries[0].composition.reason,'stale');assert.equal(h.submissions(),1);h.close();});
test('destroy inside submit before queued ticket returns keeps unknown immutable receipt and actual continuation [controlled]',async()=>{let receipt;const h=harness({native:'queued',onSubmit(owner){receipt=owner.retained();owner.destroy();}});h.commit();assert.equal(receipt.composition.nativeOutcome,'unknown');assert.equal(receipt.composition.submission,null);assert.equal(h.owner.resources().continuations,1);h.resolve();await flush();assert.equal(receipt.composition.nativeOutcome,'unknown');assert.equal(h.owner.resources().continuations,0);assert.equal(h.resourceSnapshots.at(-1).continuations,0);});
test('mutation overflow refuses before dispatch and transfers DOM [controlled]',()=>{const h=harness();h.start();h.setText('aZd');h.setMutations(4097);h.end();assert.equal(h.submissions(),0);assert.equal(h.recoveries[0].composition.reason,'capture_limit');assert.equal(h.recoveries[0].region.kind,'retained_dom');h.close();});
test('ordinary key permit refuses mismatched target ranges and keeps event [controlled]',()=>{const h=harness();h.commit();h.owner.keydown(h.event('keydown',{key:'x',code:'KeyX'}));h.owner.beforeInput(h.event('beforeinput',{inputType:'insertText',data:'x',getTargetRanges:()=>[{startContainer:{},endContainer:{},startOffset:0,endOffset:0}]}));assert.equal(h.ordinaryCalls(),0);assert.equal(h.recoveries[0].composition.reason,'ambiguous_tail');h.close();});
test('orphan composition-specific input has no invented baseline and no command [controlled]',()=>{const h=harness();const event=h.event('beforeinput',{inputType:'insertFromComposition',data:'Z'});assert(h.owner.beforeInput(event));assert.equal(h.recoveries[0].composition.base,null);assert.equal(h.recoveries[0].composition.selection,null);assert.equal(h.submissions(),0);h.close();});
test('completed structural ordinary action uses a fresh native correspondence, while duplicate stays negative [controlled]',()=>{const h=harness({structuralOrdinary:true});h.commit();h.owner.keyup(h.event('keyup',{key:'Enter',code:'Enter'}));h.owner.keydown(h.event('keydown',{key:'Enter',code:'Enter'}));h.owner.beforeInput(h.event('beforeinput',{inputType:'insertParagraph'}));assert.equal(h.ordinaryCalls(),1);assert.equal(h.recoveries.length,0);assert.equal(h.calls.filter(c=>c==='begin').length,2);h.owner.beforeInput(h.event('beforeinput',{inputType:'insertParagraph'}));assert.equal(h.ordinaryCalls(),1);assert.equal(h.recoveries[0].composition.reason,'ambiguous_tail');assert.equal(h.recoveries[0].composition.base.revision,'1');assert.equal(h.recoveries[0].composition.submission,h.ticket());h.close();});
test('delayed deadline captures newest actual UA text without admitting a late dispatch [controlled]',()=>{const h=harness();h.start();h.setText('aQd');h.end();h.setText('aNewestd');h.raf(600);assert.equal(h.submissions(),0);assert.equal(h.recoveries[0].composition.reason,'settle_limit');assert.equal(h.recoveries[0].region.provisionalText,'aNewestd');assert.equal(h.timers(),0);assert.equal(h.rafs(),0);h.close();});
test('delayed timer deadline captures newest actual UA text without admitting a late dispatch [controlled]',()=>{const h=harness();h.start();h.setText('aQd');h.end();h.setText('aNewestd');h.elapsed(600);assert.equal(h.submissions(),0);assert.equal(h.recoveries[0].composition.reason,'settle_limit');assert.equal(h.recoveries[0].region.provisionalText,'aNewestd');assert.equal(h.timers(),0);assert.equal(h.rafs(),0);h.close();});
test('relevant mutation consumed by input between equal RAFs resets stability [controlled E09]',()=>{const h=harness();h.start();h.setText('aZd');h.end();h.raf();h.setMutations(1);h.owner.input(h.event('input',{inputType:'insertCompositionText',data:'Z'}));h.raf();assert.equal(h.submissions(),0);h.raf();assert.equal(h.submissions(),1);assert.equal(h.recoveries.length,0);h.close();});

test('idle keyboard observations retain no identity log or prospective composition authority [controlled]',()=>{
  const h=harness();for(const code of ['KeyX','unmatched-idle','x'.repeat(2097153)])h.owner.keydown(h.event('keydown',{key:'x',code}));
  assert.deepEqual(h.owner.resources(),{continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});assert.equal(h.recoveries.length,0);
  h.commit();h.owner.keydown(h.event('keydown',{key:'x',code:'KeyX'}));h.owner.beforeInput(h.event('beforeinput',{inputType:'insertText',data:'x'}));assert.equal(h.ordinaryCalls(),1);assert.equal(h.recoveries.length,0);h.close();
});
test('oversize active key identity retains the original event before adding state [controlled]',()=>{
  const h=harness();h.start();h.setText('aQd');const event=h.event('keydown',{key:'Process',code:'x'.repeat(2097153)});h.owner.keydown(event);
  const packet=h.recoveries[0];assert.equal(packet.composition.reason,'capture_limit');assert.equal(packet.composition.unappliedInput.kind,'retained_event');assert.equal(packet.composition.unappliedInput.event,event);assert.equal(packet.region.provisionalText,'aQd');assert(event.defaultPrevented);assert.equal(h.submissions(),0);assert(h.owner.resources().retainedInputBytes<1024);h.close();assert.equal(h.owner.resources().retainedInputBytes,0);
});
test('aggregate held and closing identity payload admits the exact existing cap then refuses overflow [controlled]',()=>{
  const h=harness();h.start();h.setText('aQd');const base=h.owner.resources().retainedInputBytes,codes=['a','b','c','d'].map(c=>c.repeat(524288));
  for(const code of codes.slice(0,3))h.owner.keydown(h.event('keydown',{key:'Process',code}));
  assert.equal(h.recoveries.length,0);assert.equal(h.owner.resources().retainedInputBytes-base,2*2097152);
  const event=h.event('keydown',{key:'Process',code:codes[3]});h.owner.keydown(event);const packet=h.recoveries[0];assert.equal(packet.composition.reason,'capture_limit');assert.equal(packet.composition.unappliedInput.kind,'bounded');assert.equal(packet.composition.unappliedInput.code,codes[3]);assert.equal(packet.region.provisionalText,'aQd');assert.equal(h.submissions(),0);
  const retained=h.owner.resources();h.owner.keydown(h.event('keydown',{key:'Process',code:'another-ignored-key'}));assert.equal(h.recoveries.length,1);assert.deepEqual(h.owner.resources(),retained);h.close();
});
test('keyboard resource accounting releases held/permit strings and clears closing identity on retirement [controlled]',()=>{
  const h=harness();h.start();const initial=h.owner.resources().retainedInputBytes;h.owner.keydown(h.event('keydown',{key:'q',code:'KeyQ'}));assert.equal(h.owner.resources().retainedInputBytes-initial,16);
  h.owner.keyup(h.event('keyup',{key:'q',code:'KeyQ'}));assert.equal(h.owner.resources().retainedInputBytes-initial,8);
  h.setText('aZd');h.end();h.raf();h.raf();const committed=h.owner.resources().retainedInputBytes;
  h.owner.keydown(h.event('keydown',{key:' ',code:'Space'}));assert.equal(h.owner.resources().retainedInputBytes-committed,22);h.owner.keyup(h.event('keyup',{key:' ',code:'Space'}));assert.equal(h.owner.resources().retainedInputBytes,committed);assert.equal(h.resourceSnapshots.at(-1).retainedInputBytes,committed);
  const st=h.state();h.owner.externalSubmission({kind:'set_selection',stamp:st.stamp,selection:st.selection},h.ticket());assert.deepEqual(h.owner.resources(),{continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});h.close();assert.equal(h.resourceSnapshots.at(-1).retainedInputBytes,0);
});
test('an unreleased composing key is not a fresh ordinary gesture even with repeat false [controlled]',()=>{
  const h=harness();h.start();h.owner.keydown(h.event('keydown',{key:'x',code:'KeyX'}));h.setText('aZd');h.end();h.raf();h.raf();h.owner.keydown(h.event('keydown',{key:'x',code:'KeyX',repeat:false}));assert.equal(h.recoveries[0].composition.reason,'ambiguous_tail');assert.equal(h.ordinaryCalls(),0);assert.equal(h.submissions(),1);h.close();
});
test('released composing key permits a fresh gesture while repeat and unknown closing Enter remain negative [controlled]',()=>{
  const h=harness();h.start();h.owner.keydown(h.event('keydown',{key:'x',code:'KeyX'}));h.setText('aZd');h.end();h.raf();h.raf();h.owner.keyup(h.event('keyup',{key:'x',code:'KeyX'}));h.owner.keydown(h.event('keydown',{key:'x',code:'KeyX'}));h.owner.beforeInput(h.event('beforeinput',{inputType:'insertText',data:'x'}));assert.equal(h.ordinaryCalls(),1);assert.equal(h.recoveries.length,0);h.close();
  for(const event of [{key:'x',code:'KeyX',repeat:true},{key:'Enter',code:'Enter'}]){const negative=harness();negative.commit();negative.owner.keydown(negative.event('keydown',event));assert.equal(negative.recoveries[0].composition.reason,'ambiguous_tail');assert.equal(negative.ordinaryCalls(),0);negative.close();}
});
test('initial end capture time counts against the original 250ms deadline [controlled]',()=>{
  const h=harness();h.start();h.setText('aZd');h.setObserveCost(300);h.end();h.raf(0);assert.equal(h.submissions(),0);assert.equal(h.recoveries[0].composition.reason,'settle_limit');assert.equal(h.recoveries[0].region.provisionalText,'aZd');assert.equal(h.timers(),0);assert.equal(h.rafs(),0);h.close();
});
test('initial blur capture time counts against its first 250ms watchdog [controlled]',()=>{
  const h=harness();h.start();h.setText('aQd');h.setObserveCost(300);h.owner.blur(h.event('blur'));h.elapsed(0);assert.equal(h.submissions(),0);assert.equal(h.recoveries[0].composition.reason,'settle_limit');assert.equal(h.recoveries[0].region.kind,'retained_dom');assert(!h.calls.includes('restore'));assert.equal(h.timers(),0);assert.equal(h.rafs(),0);h.close();
});
test('a second stable RAF observation that reaches the deadline cannot dispatch [controlled]',()=>{
  const h=harness();h.start();h.setText('aZd');h.end();h.raf();h.setObserveCost(240);h.raf();assert.equal(h.submissions(),0);assert.equal(h.recoveries[0].composition.reason,'settle_limit');assert.equal(h.recoveries[0].region.provisionalText,'aZd');assert.equal(h.timers(),0);assert.equal(h.rafs(),0);h.close();
});
test('command binding callback time cannot admit native submission after the deadline [controlled]',()=>{
  const h=harness();h.start();h.setText('aZd');h.end();h.raf();h.setBindingCost(300);h.raf();assert.equal(h.submissions(),0);assert.equal(h.recoveries[0].composition.reason,'settle_limit');assert.equal(h.recoveries[0].composition.nativeOutcome,'not_submitted');assert.equal(h.recoveries[0].region.provisionalText,'aZd');assert.equal(h.timers(),0);assert.equal(h.rafs(),0);h.close();
});
