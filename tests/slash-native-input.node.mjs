// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled transport43 only. Every guard/run callback is a stub; this file
// executes no helper, AppleScript, browser, clipboard, input or permission API.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createInputOwner,fixedKeyScript} from '../scripts/slash-native/input.mjs';
import {validCall,caseIds,caseActions,keySpecs} from '../scripts/slash-native/protocol.mjs';
import {validCall as oldValidCall} from '../scripts/ui-native/protocol.mjs';

// These literals are independently authored from installed-v1 physicalTextKeys
// and the closed macOS virtual codes; the implementation table is not an oracle.
const literals={
 slash:{code:44,modifiers:[],text:'/',source:'US',caseId:'I43-N01-en'},
 'query-p':{code:35,modifiers:[],text:'p',source:'US',caseId:'I43-N01-en'},
 'query-a':{code:0,modifiers:[],text:'a',source:'US',caseId:'I43-N01-en'},
 'query-r':{code:15,modifiers:[],text:'r',source:'US',caseId:'I43-N01-en'},
 'query-ru-w':{code:13,modifiers:[],text:'ц',source:'Russian',caseId:'I43-N01-ru'},
 'query-ru-b':{code:11,modifiers:[],text:'и',source:'Russian',caseId:'I43-N01-ru'},
 'query-ru-n':{code:45,modifiers:[],text:'т',source:'Russian',caseId:'I43-N01-ru'},
 'ordinary-en':{code:6,modifiers:['shift'],text:'Z',source:'US',caseId:'I43-N03-en'},
 'ordinary-ru':{code:6,modifiers:[],text:'я',source:'Russian',caseId:'I43-N10-ru'},
 'complete-e':{code:14,modifiers:[],text:'e',source:'US',caseId:'I43-N08-en'},
 enter:{code:36,modifiers:[],caseId:'I43-N01-en'},
 find:{code:3,modifiers:['command'],caseId:'I43-N05-en'},
};
const pointerLiterals={'click-quote':{target:'quote',caseId:'I43-N02-en'},'click-add':{target:'add',caseId:'I43-N09-en'}};
function fixture(browser='safari',extra={}){
 const nonce='b'.repeat(32),config={nonce,title:'KlenWriter Slash native '+nonce,fixtureUrl:'http://127.0.0.1:4174/ui'};
 const calls=[],records=[],proofs=[],guardCalls=[],frame={x:22,y:22,width:1072,height:950};
 let serial=0,mount='ui42-1',caseId='I43-N01-en',pageHook=null,keyGuardHook=null,keyHook=null,pointerHook=null;
 const execution=value=>({returnCode:0,stdout:JSON.stringify(value),stderr:'',stubOnly:true});
 function proof(action,cleanup){
  const p={id:nonce+':'+(++serial),start:process.hrtime.bigint(),value:{nonce,url:config.fixtureUrl,title:config.title,id:mount,mountedId:mount,
   serial,caseId,action,target:pointerLiterals[action]?.target??'focused',allowed:true,editorConnected:true,documentFocused:true,
   point:pointerLiterals[action]?{x:140,y:340}:null,pointerDown:false,viewport:{width:1024,height:768,scale:1,offsetLeft:0,offsetTop:0,pageZoom:1},
   zoomEvidence:{dprRatio:1},...(cleanup?{releaseOnly:true}:{})}};
  proofs.push(p);guardCalls.push({action,cleanup});return pageHook?pageHook(p,cleanup):p;
 }
 function keyGuard(q){
  const literal=literals[q.action],sourceId='com.apple.keylayout.'+literal?.source;
  return {status:'guarded',delivery:'not_sent',cleanupOnly:q.cleanupOnly,action:q.action,requestId:q.requestId,nonce,mountedId:q.mountedId,
   caseId:q.caseId,target:q.target,frontBundle:browser==='chrome'?'com.google.Chrome':'com.apple.Safari',frontPid:73,
   expectedAxWindowTitle:config.title+(browser==='chrome'?' - Google Chrome':''),observedAxWindowTitle:config.title+(browser==='chrome'?' - Google Chrome':''),
   axWindowCount:1,axWindow:{...frame},axViewport:{x:22,y:139,width:1024,height:768},elapsedMs:12,
   ...(!q.cleanupOnly&&literal?.text?{keyboardTranslation:{sourceId,layoutId:sourceId,selected:true,enabled:true,selectable:true,
    keyCode:literal.code,modifierState:literal.modifiers.includes('shift')?2:0,keyboardType:40,text:literal.text,deadKeyState:0,osStatus:0}}:{})};
 }
 const owner=createInputOwner({browser,config,inputHelper:'/stub/guard43',keyScriptPath:'/stub/keys43.scpt',record:(kind,value)=>records.push({kind,value}),mountedId:()=>mount,
  guard:async a=>proof(a,false),cleanupGuard:async a=>proof(a,true),...extra,
  run(command,argv,options){
   const call={command,argv:[...argv],options:{...options}};calls.push(call);
   if(command==='/usr/bin/osascript'){
    const action=argv[4].replace(/^release-/,''),cleanup=argv[4].startsWith('release-'),literal=literals[action];assert.ok(literal);
    const value={status:cleanup?'keys-released':'key-sent',action:argv[4],keyCode:literal.code,modifiers:[...literal.modifiers],frontPid:73,
     keyTransitions:cleanup?[...literal.modifiers.map(m=>m+'-up'),`key${literal.code}-up`]:[...literal.modifiers.map(m=>m+'-down'),`key${literal.code}-down`,`key${literal.code}-up`,...literal.modifiers.toReversed().map(m=>m+'-up')]};
    return keyHook?keyHook(value,call):execution(value);
   }
   assert.equal(command,'/stub/guard43');const q=JSON.parse(argv[1]);call.request=q;
   if(argv[0]==='--guard-key'){const value=keyGuard(q);return keyGuardHook?keyGuardHook(value,call):execution(value);}
   assert.equal(argv[0],'--request');const value={...keyGuard(q),status:'sent',delivery:'sent',screenPoint:{x:22+q.point.x,y:139+q.point.y},transitions:q.cleanupOnly?['up']:['down','up']};
   return pointerHook?pointerHook(value,call):execution(value);
  }});
 return {owner,calls,records,proofs,guardCalls,config,execution,set caseId(v){caseId=v;},set mount(v){mount=v;},set pageHook(v){pageHook=v;},
  set keyGuardHook(v){keyGuardHook=v;},set keyHook(v){keyHook=v;},set pointerHook(v){pointerHook=v;}};
}
const unknown=()=>{throw Object.assign(Error('Controlled opaque completion'),{execution:{returnCode:null,stdout:'',stderr:'',error:'ETIMEDOUT',stubOnly:true}});};

test('SL43 protocol has exactly20 locale-bound rows and no42 or action aliases',()=>{
 const ids=['en','ru'].flatMap(l=>Array.from({length:10},(_,i)=>`I43-N${String(i+1).padStart(2,'0')}-${l}`));
 assert.deepEqual(caseIds,ids);
 for(const id of ids){const l=id.endsWith('-en')?'en':'ru';assert.equal(validCall('prepare',[l,id]),true);assert.equal(oldValidCall('prepare',[l,id]),false);assert.equal(validCall('prepare',[l==='en'?'ru':'en',id]),false);}
 for(const alias of ['p','a','r','ru-tse','ru-i','ru-te','Z','ru-ya','click-blockquote','copy','left','move-up'])assert.equal(validCall('guard',[alias]),false);
 for(const method of ['eval','setRange','typeText'])assert.equal(validCall(method,[]),false);
 assert.equal(validCall('documentGuard',[]),true);assert.equal(validCall('setup',['host-edit']),false);
 assert.deepEqual(Object.entries(caseActions).filter(([,a])=>a.includes('find')).map(([k])=>k),['I43-N05-en','I43-N05-ru']);
 assert.deepEqual(Object.entries(caseActions).filter(([,a])=>a.includes('zoom-in')).map(([k])=>k),['I43-N07-en','I43-N07-ru']);
 assert.throws(()=>{keySpecs.slash.code=0;},TypeError);assert.throws(()=>caseActions['I43-N01-en'].push('copy'),TypeError);
});
for(const [action,literal] of Object.entries(literals).filter(([,v])=>v.text))test(`SL43 ${action} requires its independently fixed translation then one literal program`,async()=>{
 const f=fixture();f.caseId=literal.caseId;const value=await f.owner.input(action);
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].request.format,'osr43-native-input/1');
 assert.deepEqual(f.calls[1].argv,['/stub/keys43.scpt','safari',f.config.title,'73',action]);
 assert.equal(value.keyGuard.keyboardTranslation.text,literal.text);assert.equal(value.actual.keyCode,literal.code);assert.deepEqual(value.actual.modifiers,literal.modifiers);
 assert.equal(f.owner.keysPending,false);assert.ok(f.calls[1].options.timeout<=1000);assert.equal(value.delivery,'sent');
});
for(const [name,change]of[
 ['missing',v=>{delete v.keyboardTranslation;}],['wrong source',v=>{v.keyboardTranslation.sourceId='com.apple.keylayout.Russian';}],
 ['wrong layout',v=>{v.keyboardTranslation.layoutId='com.apple.keylayout.Russian';}],['disabled source',v=>{v.keyboardTranslation.enabled=false;}],
 ['wrong letter',v=>{v.keyboardTranslation.text='X';}],['dead state',v=>{v.keyboardTranslation.deadKeyState=1;}],
 ['foreign key',v=>{v.keyboardTranslation.keyCode=0;}],['extra authority',v=>{v.keyboardTranslation.arbitraryKey=99;}],
])test(`SL43 ${name} translation refuses before any key dispatch`,async()=>{
 const f=fixture();f.keyGuardHook=v=>{change(v);return f.execution(v);};await assert.rejects(f.owner.input('slash'));
 assert.equal(f.calls.length,1);assert.equal(f.owner.keysPending,false);assert.equal(f.records.at(-1).value.delivery,'not_sent');
});
for(const [name,change]of[
 ['expired',p=>{p.start-=2_000_000_000n;}],['42case',p=>{p.value.caseId='navigation';}],['wrong43case',p=>{p.value.caseId='I43-N04-en';}],
 ['foreign mount',p=>{p.value.mountedId='ui42-2';}],['foreign nonce',p=>{p.value.nonce='c'.repeat(32);}],
])test(`SL43 ${name} page guard cannot authorize query-p`,async()=>{
 const f=fixture();f.pageHook=p=>{change(p);return p;};await assert.rejects(f.owner.input('query-p'));assert.equal(f.calls.length,0);assert.equal(f.owner.keysPending,false);
});
test('SL43 read-only guard cost consumes the original1s budget',async()=>{
 const f=fixture();f.keyGuardHook=v=>{f.proofs.at(-1).start-=2_000_000_000n;return f.execution(v);};await assert.rejects(f.owner.input('slash'),/AX guard consumed/);
 assert.equal(f.calls.length,1);assert.equal(f.owner.keysPending,false);
});
test('SL43 unknown Russian input has one original-code UP cleanup even after source/focus changes',async()=>{
 const f=fixture();f.caseId='I43-N10-ru';f.keyHook=unknown;await assert.rejects(f.owner.input('ordinary-ru'),/opaque/);
 assert.equal(f.owner.keysPending,true);f.keyHook=null;f.pageHook=(p,cleanup)=>{assert.equal(cleanup,true);p.value.documentFocused=false;return p;};
 const value=await f.owner.releaseOwnedKeys();assert.deepEqual(value.actual.keyTransitions,['key6-up']);assert.equal(f.calls.at(-1).argv.at(-1),'release-ordinary-ru');
 assert.equal('keyboardTranslation' in value.keyGuard,false);assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,true);
 await assert.rejects(async()=>f.owner.releaseOwnedKeys());await assert.rejects(f.owner.input('ordinary-ru'));assert.equal(f.calls.length,4);
});
test('SL43 malformed original key receipt retains pending and never replays a DOWN',async()=>{
 const f=fixture();f.keyHook=v=>f.execution({...v,keyTransitions:['key44-down']});await assert.rejects(f.owner.input('slash'));
 assert.equal(f.owner.keysPending,true);f.keyHook=null;await f.owner.releaseOwnedKeys();assert.deepEqual(f.calls.at(-1).argv.slice(-1),['release-slash']);assert.equal(f.calls.length,4);
});
test('SL43 full contextual key completion arriving late stays FAILED without redundant UP',async()=>{
 const f=fixture();f.keyHook=v=>{f.proofs.at(-1).start-=2_000_000_000n;return f.execution(v);};await assert.rejects(f.owner.input('slash'),/Total43/);
 assert.equal(f.owner.keysPending,false);assert.equal(f.records.at(-1).value.delivery,'sent/known_completed');await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.calls.length,2);
});
test('SL43 unknown key cleanup refuses changed PID and cannot retry',async()=>{
 const f=fixture();f.keyHook=unknown;await assert.rejects(f.owner.input('slash'));f.keyHook=null;f.keyGuardHook=v=>f.execution({...v,frontPid:74});
 await assert.rejects(async()=>f.owner.releaseOwnedKeys());await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.owner.keysPending,true);assert.equal(f.calls.length,3);
});
for(const [action,literal]of Object.entries(pointerLiterals))test(`SL43 ${action} maps only its genuine declared target`,async()=>{
 const f=fixture();f.caseId=literal.caseId;const value=await f.owner.input(action);assert.equal(f.calls.length,1);assert.equal(f.calls[0].request.target,literal.target);
 assert.deepEqual(value.actual.transitions,['down','up']);assert.equal(f.owner.pointerState,'up');
});
test('SL43 unknown Quote click has exactly one original-point UP cleanup',async()=>{
 const f=fixture();f.caseId='I43-N02-en';f.pointerHook=unknown;await assert.rejects(f.owner.input('click-quote'));const original=f.calls[0].request;
 f.pointerHook=null;const value=await f.owner.releaseOwnedPointer();assert.deepEqual(value.actual.transitions,['up']);assert.deepEqual(f.calls[1].request.point,original.point);
 assert.deepEqual(f.calls[1].request.viewport,original.viewport);assert.equal(f.calls[1].request.cleanupOnly,true);assert.equal(f.calls[1].request.pointerDown,true);
 await assert.rejects(f.owner.releaseOwnedPointer());assert.equal(f.calls.length,2);
});
test('SL43 Find opt-in refuses genuine but ineligible43row before helper dispatch',async()=>{
 const f=fixture('chrome',{nativeFindEpisode:'chrome-fd01'});await assert.rejects(f.owner.input('find'));assert.equal(f.calls.length,0);
});
test('SL43 fixed AS exposes only literal43 programs and retains original42 source bytes',()=>{
 assert.match(fixedKeyScript,/KlenWriter Slash native/);assert.match(fixedKeyScript,/fixtureAction is "query-ru-w"/);assert.match(fixedKeyScript,/key down 13/);
 assert.doesNotMatch(fixedKeyScript,/fixtureAction is "copy"|fixtureAction is "move-up"|sc-copy01|KlenWriter UI native/);
 const pins={'protocol.mjs':'cc8c66fac2dbeee57d91132c81873d85c3a29ead246a8ee6407f3684ce1a2ee0','input.mjs':'c073e0ed2552b7e076a33c170e9d08b545bbd392ccb429c06e3df656899b9f8e','guard.swift':'cf56884952573490de22ed84901188f38bb66f3c1d21906a80e9f7e0f2185105','find-key.swift':'b017c9d79d20474b0c3de593b5b6606a3f79c05b7284b13d62ee827e0c6687fc'};
 for(const [name,sha]of Object.entries(pins))assert.equal(createHash('sha256').update(readFileSync(new URL('../scripts/ui-native/'+name,import.meta.url))).digest('hex'),sha,name);
});
