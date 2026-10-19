// SPDX-License-Identifier: MIT OR Apache-2.0
// Pure transport and HTTP module boundaries; no OS/native input is executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createInputOwner,fixedKeyScript} from '../scripts/composition-native/input.mjs';
import {validCall,caseIds} from '../scripts/composition-native/protocol.mjs';
const literals={
 'ordinary-en':{keyCode:6,modifier:'shift',keyTransitions:['shift-down','key6-down','key6-up','shift-up']},
 'ordinary-ru':{keyCode:6,modifier:'none',keyTransitions:['key6-down','key6-up']},
 'deadkey-acute':{keyCode:14,modifier:'option',keyTransitions:['option-down','key14-down','key14-up','option-up']},
 'complete-e':{keyCode:14,modifier:'none',keyTransitions:['key14-down','key14-up']},
 escape:{keyCode:53,modifier:'none',keyTransitions:['key53-down','key53-up']},
 'shift-tab':{keyCode:48,modifier:'shift',keyTransitions:['shift-down','key48-down','key48-up','shift-up']},
 tab:{keyCode:48,modifier:'none',keyTransitions:['key48-down','key48-up']},
};
function fixture({badGuard=null,unknown=false,late=false}={}){let serial=0,time=0n,failed=false;const calls=[],records=[],nonce='a'.repeat(32),config={nonce,origin:'http://127.0.0.1:4174',fixtureUrl:'http://127.0.0.1:4174/composition',title:'KlenWriter Composition native '+nonce};
 const owner=createInputOwner({browser:'chrome',config,inputHelper:'/tmp/pure-no-exec/input',keyScriptPath:'/tmp/pure-no-exec/keys.scpt',mountedId:()=> 'composition-mount-1',clock:()=>time,record:(kind,value)=>records.push({kind,...value}),
  guard:async action=>({id:nonce+':'+String(++serial),start:time,value:{nonce,url:config.fixtureUrl,title:config.title,id:'composition-mount-1',mountedId:'composition-mount-1',serial,caseId:'plain-deadkey',action,allowed:true,documentFocused:true,editorConnected:true,target:action==='tab'?'host-control':'editor',viewport:{width:1024,height:768,scale:1,offsetLeft:0,offsetTop:0},point:null,pointerDown:false,...badGuard}}),
  run:(command,args)=>{calls.push({command,args});if(command==='/tmp/pure-no-exec/input'){const request=JSON.parse(args[1]);return {stdout:JSON.stringify({status:'guarded',delivery:'not_sent',action:request.action,requestId:request.requestId,nonce,mountedId:request.mountedId,caseId:request.caseId,target:request.target,cleanupOnly:false,frontBundle:'com.google.Chrome',frontPid:17,expectedAxWindowTitle:config.title+' - Google Chrome',observedAxWindowTitle:config.title+' - Google Chrome',axWindowCount:1,axViewport:{x:0,y:0,width:1024,height:768},elapsedMs:1})};}
   assert.equal(command,'/usr/bin/osascript');const action=args[4];if(unknown&&!failed&&!action.startsWith('release-')){failed=true;throw Object.assign(Error('Controlled timeout/may_have_sent'),{execution:{signal:'SIGTERM'}});}const cleanup=action.startsWith('release-'),base=cleanup?action.slice(8):action;const literal=literals[base];if(late)time+=1001000000n;return {stdout:JSON.stringify({status:cleanup?'keys-released':'key-sent',action,...literal,keyTransitions:cleanup?[...(literal.modifier==='none'?[]:[literal.modifier+'-up']),`key${literal.keyCode}-up`]:literal.keyTransitions,frontPid:17})};}});
 return {owner,calls,records,advance:ms=>{time+=BigInt(ms)*1000000n;}};
}
test('closed six-case protocol rejects generic eval/URL/text and extra arguments',()=>{assert.equal(caseIds.length,6);for(const id of caseIds)assert.equal(validCall('prepare',['en',id]),true);for(const [method,args]of [['eval',['1']],['prepare',['en','unknown']],['prepare',['en','plain-deadkey','extra']],['guard',['arbitrary-key']],['checkpoint',['extra']]])assert.equal(validCall(method,args),false);assert.ok(fixedKeyScript.includes('key down option'));assert.ok(fixedKeyScript.includes('key up option'));assert.ok(!fixedKeyScript.includes('keystroke '));});
for(const [action,literal]of Object.entries(literals))test(`finite guarded ${action} has literal key choreography`,async()=>{const f=fixture();const v=await f.owner.input(action);assert.equal(f.calls.length,2);assert.deepEqual(v.actual.keyTransitions,literal.keyTransitions);assert.equal(v.actual.keyCode,literal.keyCode);assert.equal(v.delivery,'sent');assert.equal(f.owner.keysPending,false);assert.equal(v.cleanupOnly,false);});
for(const badGuard of [{nonce:'b'.repeat(32)},{allowed:false},{target:'foreign'},{viewport:{width:1023,height:768,scale:1,offsetLeft:0,offsetTop:0}},{editorConnected:false}])test('invalid fresh fixture guard never invokes even preflight',async()=>{const f=fixture({badGuard});await assert.rejects(f.owner.input('deadkey-acute'));assert.equal(f.calls.length,0);assert.equal(f.owner.disabled,true);assert.equal(f.owner.keysPending,false);});
test('unknown dispatch retains owned key cleanup and never replays original',async()=>{const f=fixture({unknown:true});await assert.rejects(f.owner.input('deadkey-acute'));assert.equal(f.owner.keysPending,true);const before=f.calls.length;await assert.rejects(f.owner.input('complete-e'));assert.equal(f.calls.length,before);const released=await f.owner.releaseOwnedKeys();assert.equal(released.action,'release-deadkey-acute');assert.deepEqual(released.actual.keyTransitions,['option-up','key14-up']);assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,true);assert.equal(f.calls.filter(x=>x.command==='/usr/bin/osascript'&&x.args[4]==='deadkey-acute').length,1);assert.throws(()=>f.owner.releaseOwnedKeys());});
test('known complete but late reply stays failed without redundant key release',async()=>{const f=fixture({late:true});await assert.rejects(f.owner.input('deadkey-acute'));assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,true);assert.equal(f.records.at(-1).delivery,'sent/known_completed');assert.throws(()=>f.owner.releaseOwnedKeys());});

// HTTP only: load the real opt-in broker's finite module graph without a browser,
// page handshake, broker command, key helper or native input.
test('opt-in composition broker serves the complete nonce protocol module graph', {timeout:15000}, async t=>{
 const directory=await mkdtemp(join(tmpdir(),'osr41-composition-broker-module-'));
 const child=spawn(process.execPath,['scripts/composition-native/server.mjs','--directory',directory],{
  cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:['ignore','pipe','pipe'],
 });
 let terminal=null,diagnostic='';
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>{terminal={code,signal};resolve(terminal);}));
 child.on('error',error=>{diagnostic=(diagnostic+'\n'+error.message).slice(-8192);});
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{diagnostic=(diagnostic+chunk.toString('utf8')).slice(-8192);});
 t.after(async()=>{
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
  const force=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},1000);force.unref();
  try{await closed;assert.ok(child.exitCode!==null||child.signalCode!==null,'owned broker process must exit');}
  finally{clearTimeout(force);await rm(directory,{recursive:true,force:true});}
 });
 const deadline=Date.now()+5000;
 let config;
 while(Date.now()<deadline){
  assert.equal(terminal,null,'owned broker exited before config: '+diagnostic);
  try{config=JSON.parse(await readFile(join(directory,'config.json'),'utf8'));break;}
  catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
  await delay(10);
 }
 assert.ok(config,'owned broker must write its finite config before deadline: '+diagnostic);
 assert.equal(config.origin,'http://127.0.0.1:4174');
 assert.match(config.nonce,/^[a-f0-9]{32}$/);
 assert.equal(config.base,'/composition-native-broker-'+config.nonce);
 const request=url=>fetch(url,{headers:{Connection:'close'},signal:AbortSignal.timeout(1000)});
 let ready=false;
 while(Date.now()<deadline){
  assert.equal(terminal,null,'owned broker exited before listening: '+diagnostic);
  try{const response=await request(new URL(config.base+'/config',config.origin));if(response.status===200){const actual=await response.json();assert.equal(actual.nonce,config.nonce);ready=true;break;}}
  catch(error){if(error.name==='AssertionError')throw error;}
  await delay(10);
 }
 assert.equal(ready,true,'own nonce route must be ready before module fetch: '+diagnostic);
 const protocolUrl=new URL(config.base+'/protocol.mjs',config.origin),protocol=await request(protocolUrl);
 assert.equal(protocol.status,200);
 assert.match(protocol.headers.get('content-type'),/^text\/javascript(?:;|$)/);
 const protocolBytes=Buffer.from(await protocol.arrayBuffer());
 assert.deepEqual(protocolBytes,await readFile(new URL('../scripts/composition-native/protocol.mjs',import.meta.url)));
 const reexport=/export\s*\{\s*boundedJson\s*\}\s*from\s*['"]([^'"]+)['"]/.exec(protocolBytes.toString('utf8'));
 assert.ok(reexport,'served protocol must expose the actual shared boundedJson dependency');
 const dependencyUrl=new URL(reexport[1],protocolUrl);
 assert.equal(dependencyUrl.href,config.origin+'/selection-native/protocol.mjs');
 const unknown=await request(new URL('./unknown-module.mjs',dependencyUrl));
 assert.equal(unknown.status,404,'the opt-in module route must remain an exact allowlist');await unknown.arrayBuffer();
 const dependency=await request(dependencyUrl);
 assert.equal(dependency.status,200,'browser-resolved shared protocol dependency must be reachable');
 assert.match(dependency.headers.get('content-type'),/^text\/javascript(?:;|$)/);
 assert.deepEqual(Buffer.from(await dependency.arrayBuffer()),await readFile(new URL('../scripts/selection-native/protocol.mjs',import.meta.url)));
 const status=await request(new URL(config.base+'/host/status',config.origin));assert.equal(status.status,200);
 const state=await status.json();assert.equal(state.ready,null);assert.equal(state.commands,0);assert.equal(state.polls,0);
});
