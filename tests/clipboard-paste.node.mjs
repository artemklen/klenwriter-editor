// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled owner/SDK/platform scheduling. No native grammar or OS clipboard evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {attachClipboard} from '../packages/dom/dist/clipboard.js';
import {deferred} from './helpers/sdk-fake.mjs';
const ok=()=>({status:'ok',value:{kind:'mutation',effect:'changed',state:{},presentation:null}});
const candidate=()=>({status:'candidate',command:{id:'org.example/insert',payload_json:'{"kind":"fragment"}'},diagnostics:['clipboard.example']});
const next=()=>new Promise(r=>setImmediate(r));
function fixture(extra={}){
 const decode=deferred(),calls=[],queries=[],submissions=[],notifications=[],reads=[],timers=new Map();let intent=0n,nextTimer=1,clock=0;
 let stamp={session:'controlled',generation:'1',revision:'0',selection_epoch:'1',history_epoch:'0'};
 let selection={anchor:{kind:'text',node:'L',offset:1,affinity:'after'},focus:{kind:'text',node:'R',offset:2,affinity:'after'}};
 let context={build_id:'fixture',profile:{},registry_digest:'a'.repeat(64),capability_digest:'b'.repeat(64)},liveSelection=selection;
 const domNode={},element=new EventTarget();element.isConnected=true;element.contains=x=>x===domNode||x===element;
 const doc={activeElement:element,hasFocus:()=>true,getSelection:()=>({anchorNode:domNode,focusNode:domNode}),defaultView:{navigator:{},performance:{now:()=>clock},setTimeout(fn){const id=nextTimer++;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}}};element.ownerDocument=doc;
 const source={types:['text/plain','text/html'],items:[],files:{length:0},getData(format){calls.push(format);return format==='text/plain'?(extra.raw??'e\u0301\r\n\ud800'):'<p>rich</p>';}};
 let decodedInput;
 const owner=attachClipboard({element,view:{readSelection:()=>liveSelection},bindings:{deleteSelection:()=>({id:'delete',payload_json:'{}'})},capture:()=>stamp,context:()=>context,readState:()=>({stamp,selection}),intent:()=>intent,
  guard:()=>null,report:()=>{},writeText:extra.writeText??(()=>Promise.resolve()),
  read(request){reads.push(request.kind);if(extra.readThrow&&request.kind==='clipboard_context')throw Error('controlled read exception');if(request.kind==='selection_text')return{status:'ok',value:{kind:'selection_text',stamp,selection,text:'selected',empty:false,selected_atoms:[],projection_id:'fixture'}};
    if(request.kind==='selection_fragment')return{status:'ok',value:{kind:'selection_fragment',stamp,selection,format_id:'fragment/1',fragment_json:'{}',empty:false}};
    return{status:'ok',value:{kind:'clipboard_context',stamp,selection,format_id:'context/1',context_json:'{}'}};},
  query(request){queries.push(request);return extra.query?.(request)??{status:'ok',value:{kind:'availability',available:true,effect:'changed',presentation:null,diagnostic:null}};},
  submit(request,validate){extra.submitGate?.();const refusal=validate?.();if(refusal)return refusal;submissions.push(request);return extra.submit?.(request)??{status:'completed',response:ok()};},
  codec:{contextFormat:'context/1',fragmentFormat:'fragment/1',decode(input){decodedInput=input;return extra.decode?.(input)??decode.promise;},...(extra.encode?{encode:extra.encode}:{})},
  ...(extra.write?{write:extra.write}:{}),onPasteResult:r=>notifications.push(r)});
 return{owner,decode,source,calls,queries,submissions,notifications,reads,timers,input:()=>decodedInput,
   elapse(units){clock+=units;},expire(){const active=[...timers.values()];timers.clear();active.forEach(fn=>fn());},
   mutate(kind){if(kind==='intent')intent++;else if(kind==='context')context={...context,capability_digest:'c'.repeat(64)};else if(kind==='live')liveSelection={...selection,focus:{...selection.focus,offset:3}};else stamp={...stamp,[kind]:String(BigInt(stamp[kind])+1n)};},doc};
}
const zero={pending:0,continuations:0,retainedTextBytes:0,retainedUtf16Units:0,retainedRecoveries:0,retiredParsers:0};
test('PASTE01 synchronous complete capture precedes decoder yield and exactly one isolated original target ticket',async()=>{
 const f=fixture();const promise=f.owner.paste(f.source);assert.deepEqual(f.calls,['text/plain','text/html']);assert.equal(f.submissions.length,0);assert.equal(f.input().capture.representations['text/plain'].text,'e\u0301\r\n\ud800');
 f.source.getData=()=>{throw Error('no late read');};f.decode.resolve(candidate());const r=await promise;assert.equal(r.status,'inserted');assert.equal(r.recovery,'none');assert.equal(f.queries.length,1);assert.equal(f.submissions.length,1);assert.deepEqual(f.submissions[0].history_hint,{kind:'isolated'});assert.equal(r.submission.response.status,'ok');assert.deepEqual(f.owner.resources(),zero);f.owner.destroy();
});
for(const field of['generation','revision','selection_epoch','history_epoch','intent','context','live'])test('PASTE target fence '+field+' refuses without retry and preserves exact raw',async()=>{
 const f=fixture();const promise=f.owner.paste(f.source);f.mutate(field);f.decode.resolve(candidate());const r=await promise;assert.equal(r.status,'refused');assert.equal(r.failure.diagnostic.code,'dom.stale_selection');assert.equal(f.submissions.length,0);assert.deepEqual(f.calls,['text/plain','text/html']);const recovery=f.owner.takeRecovery();assert.equal(recovery.capture.representations['text/plain'].text,'e\u0301\r\n\ud800');assert.equal(f.owner.takeRecovery(),null);assert.deepEqual(f.owner.resources(),zero);f.owner.destroy();
});
test('PASTE09 retained failure occupies sole slot until explicit transfer or release',async()=>{
 const f=fixture();const promise=f.owner.paste(f.source);f.decode.resolve({status:'refused',diagnostics:['clipboard.unsupported_semantics']});const r=await promise;assert.equal(r.recovery,'retained');let reads=0;
 const second=await f.owner.paste({get types(){reads++;throw Error('no capture');}});assert.equal(second.failure.diagnostic.code,'dom.clipboard_recovery_pending');assert.equal(reads,0);assert.equal(f.owner.resources().retainedRecoveries,1);assert.equal(f.owner.releaseRecovery(),true);assert.equal(f.owner.releaseRecovery(),false);f.owner.destroy();
});
test('PASTE10 deadline retires actual decoder, blocks new capture and never applies its late candidate',async()=>{
 const f=fixture();const promise=f.owner.paste(f.source);f.expire();const r=await promise;assert.equal(r.failure.diagnostic.code,'dom.clipboard_timeout');assert.equal(r.recovery,'pending');assert.equal(f.owner.resources().retiredParsers,1);assert.equal(f.owner.takeRecovery(),null);assert.equal((await f.owner.paste(f.source)).failure.diagnostic.code,'dom.busy');
 f.decode.resolve(candidate());await next();assert.equal(f.submissions.length,0);assert.equal(f.owner.resources().retiredParsers,0);assert.equal(f.owner.resources().retainedRecoveries,1);assert.equal(f.owner.takeRecovery().reason,'dom.clipboard_timeout');f.owner.destroy();
});
test('PASTE11 destroy gives pending recovery transfer and keeps raw accounted until actual completion',async()=>{
 const f=fixture();const promise=f.owner.paste(f.source);f.owner.destroy();const transfer=f.owner.transferRecovery();assert.equal(transfer.status,'pending');assert.equal(f.owner.resources().retiredParsers,1);f.decode.resolve(candidate());const r=await promise;assert.equal(r.status,'refused');assert.equal(r.failure.diagnostic.code,'dom.disposed');const recovery=await transfer.completion;assert.equal(recovery.capture.representations['text/plain'].text,'e\u0301\r\n\ud800');assert.equal(f.notifications.length,0);assert.equal(f.submissions.length,0);assert.deepEqual(f.owner.resources(),zero);
});
test('PASTE12 capture refusal never calls decoder and retains truthful incomplete receipt',async()=>{
 let decodes=0;const f=fixture({decode(){decodes++;return Promise.resolve(candidate());}});f.source.getData=()=> 'x'.repeat(524289);const r=await f.owner.paste(f.source);assert.equal(r.status,'refused');assert.equal(decodes,0);const recovery=f.owner.takeRecovery();assert.equal(recovery.capture.representations['text/plain'].status,'oversize_not_retained');assert.equal(recovery.capture.representations['text/html'].status,'unread_due_limit');f.owner.destroy();
});
test('PASTE13 full final fence is repeated after a reentrant native query',async()=>{
 let f;f=fixture({query(){f.mutate('intent');return{status:'ok',value:{kind:'availability',available:true,effect:'changed'}};}});const promise=f.owner.paste(f.source);f.decode.resolve(candidate());const r=await promise;assert.equal(r.status,'refused');assert.equal(f.queries.length,1);assert.equal(f.submissions.length,0);assert.equal(r.recovery,'retained');f.owner.releaseRecovery();f.owner.destroy();
});
test('PASTE14 queued native ticket and fatal outcome retain actual provenance without replay',async()=>{
 const native=deferred(),ticket={status:'queued',completion:native.promise},f=fixture({submit:()=>ticket});const promise=f.owner.paste(f.source);f.decode.resolve(candidate());await next();assert.equal(f.submissions.length,1);assert.equal(f.timers.size,0,'decode deadline cannot misreport a queued native publication');native.resolve({status:'fatal',diagnostic:{code:'fixture',may_have_committed:true}});const r=await promise;assert.equal(r.status,'indeterminate');assert.equal(r.submission,ticket);assert.equal(r.recovery,'retained');assert.equal(f.owner.resources().pending,0);f.owner.releaseRecovery();f.owner.destroy();
});
test('PASTE15 copy/cut cannot overlap a live parser and rich cut waits for confirmed write',async()=>{
 const f=fixture();const pending=f.owner.paste(f.source);assert.equal((await f.owner.cut()).failure.diagnostic.code,'dom.busy');f.decode.resolve(candidate());await pending;f.owner.destroy();
 const ack=deferred(),payloads=[],g=fixture({encode:()=>({status:'encoded',html:'<p>selected</p>'}),write:p=>{payloads.push(p);return ack.promise;}});const cut=g.owner.cut();assert.deepEqual(payloads,[{text:'selected',html:'<p>selected</p>'}]);assert.equal(g.submissions.length,0);ack.resolve();const r=await cut;assert.equal(r.status,'cut');assert.equal(g.submissions.length,1);g.owner.destroy();
});

test('PASTE16 synchronous decoder duration cannot evade the absolute deadline',async()=>{
 let f;f=fixture({decode(){f.elapse(15001);return Promise.resolve(candidate());}});const r=await f.owner.paste(f.source);assert.equal(r.failure.diagnostic.code,'dom.clipboard_timeout');assert.equal(f.queries.length,0);assert.equal(f.submissions.length,0);assert.equal(f.owner.takeRecovery().reason,'dom.clipboard_timeout');f.owner.destroy();
});
test('PASTE17 post-commandGate fence sees private intent changed without a native stamp change',async()=>{
 let f;f=fixture({submitGate(){f.mutate('intent');}});const promise=f.owner.paste(f.source);f.decode.resolve(candidate());const r=await promise;assert.equal(r.status,'refused');assert.equal(r.failure.diagnostic.code,'dom.stale_selection');assert.equal(f.submissions.length,0);assert.equal(f.owner.takeRecovery().reason,'dom.stale_selection');f.owner.destroy();
});
test('PASTE18 native submit exception preserves unknown publication and raw recovery',async()=>{
 const f=fixture({submit(){throw Error('controlled native boundary throw');}});const promise=f.owner.paste(f.source);f.decode.resolve(candidate());const r=await promise;assert.equal(r.status,'indeterminate');assert.equal(r.failure.diagnostic.publication,'unknown');assert.equal(r.recovery,'retained');f.owner.releaseRecovery();f.owner.destroy();
});
test('PASTE19 context-read exception terminates the live slot and transfers raw',async()=>{
 const f=fixture({readThrow:true});const r=await f.owner.paste(f.source);assert.equal(r.status,'refused');assert.equal(f.owner.resources().pending,0);assert.equal(f.owner.takeRecovery().reason,'preflight_failed');assert.equal(f.owner.transferRecovery().status,'transferred');f.owner.destroy();
});
test('PASTE20 retirement deadline preserves the first mode cancellation reason',async()=>{
 const f=fixture();const promise=f.owner.paste(f.source);f.owner.cancel('dom.mode_blocked');f.expire();const r=await promise;assert.equal(r.failure.diagnostic.code,'dom.mode_blocked');f.decode.resolve(candidate());await next();assert.equal(f.owner.takeRecovery().reason,'dom.mode_blocked');assert.equal(f.submissions.length,0);f.owner.destroy();
});
