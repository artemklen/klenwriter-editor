// SPDX-License-Identifier: MIT OR Apache-2.0
// Real adapter subprocess boundary against a task-owned Node mock executable ONLY.
// No Swift helper, Accessibility, NSPasteboard, CG events, browser or OS clipboard access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClipboardPlatform,ClipboardPlatformError} from '../scripts/clipboard-installed/native-platform.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
const pinnedNode=resolve(repo,'.tools/node/node_modules/node/bin/node');
const nonce='1234567890abcdef1234567890abcdef',title=`KlenWriter Clipboard native ${nonce}`;
const rootFrame={x:80,y:60,width:1024,height:820},pid=4242;
// Independent source-authored literal programs. Never imported/generated from adapter internals.
const copy=[{keyCode:55,down:true,flags:'command'},{keyCode:8,down:true,flags:'command'},{keyCode:8,down:false,flags:'command'},{keyCode:55,down:false,flags:'none'}];
const cut=[{keyCode:55,down:true,flags:'command'},{keyCode:7,down:true,flags:'command'},{keyCode:7,down:false,flags:'command'},{keyCode:55,down:false,flags:'none'}];
const paste=[{keyCode:55,down:true,flags:'command'},{keyCode:9,down:true,flags:'command'},{keyCode:9,down:false,flags:'command'},{keyCode:55,down:false,flags:'none'}];
const undo=[{keyCode:55,down:true,flags:'command'},{keyCode:6,down:true,flags:'command'},{keyCode:6,down:false,flags:'command'},{keyCode:55,down:false,flags:'none'}];
const redo=[{keyCode:55,down:true,flags:'command'},{keyCode:56,down:true,flags:'command+shift'},{keyCode:6,down:true,flags:'command+shift'},{keyCode:6,down:false,flags:'command+shift'},{keyCode:56,down:false,flags:'command'},{keyCode:55,down:false,flags:'none'}];
const safariCopy=[{keyCode:55,down:true,flags:'command'},{keyCode:8,down:true,flags:'command'},{keyCode:55,down:false,flags:'none'},{keyCode:8,down:false,flags:'none'}];
const releases={copy:[{keyCode:55,down:false,flags:'none'},{keyCode:8,down:false,flags:'none'}],cut:[{keyCode:55,down:false,flags:'none'},{keyCode:7,down:false,flags:'none'}],paste:[{keyCode:55,down:false,flags:'none'},{keyCode:9,down:false,flags:'none'}],undo:[{keyCode:55,down:false,flags:'none'},{keyCode:6,down:false,flags:'none'}],redo:[{keyCode:55,down:false,flags:'none'},{keyCode:56,down:false,flags:'none'},{keyCode:6,down:false,flags:'none'}]};
function fixture(t,{browser='chrome',scenario={},onRecord=()=>{}}={}){
  const dir=mkdtempSync(join(tmpdir(),'osr47-clipboard-platform-test-')),helper=join(dir,'closed-node-mock'),config=join(dir,'scenario.json'),log=join(dir,'requests.jsonl');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const constants={pid,rootFrame,programs:{copy,cut,paste,undo,redo},safariCopy,releases};
  const body=`import {readFileSync,appendFileSync} from 'node:fs';
const config=${JSON.stringify(config)},log=${JSON.stringify(log)},fixed=${JSON.stringify(constants)};
const scenario=JSON.parse(readFileSync(config,'utf8')),request=JSON.parse(readFileSync(0,'utf8'));
appendFileSync(log,JSON.stringify(request)+'\\n');
const echo={...request};delete echo.plain;delete echo.html;
const proof=()=>({pid:fixed.pid,name:request.browser==='chrome'?'Google Chrome':'Safari',bundle:request.browser==='chrome'?'com.google.Chrome':'com.apple.Safari',title:request.title+(request.browser==='chrome'?' - Google Chrome':''),role:'AXWindow',subrole:'AXStandardWindow',rootFrame:fixed.rootFrame,windowCount:1,matchCount:1,focused:true});
const base={format:'osr47-clipboard-platform-result/1',request:echo,status:'completed',delivery:'not_sent',elapsedMs:1};
let value,exit=0;
if(request.operation==='inspect')value={...base,proof:proof()};
else if(request.operation==='key'){
  if(!request.cleanupOnly&&scenario.opaque){process.stdout.write('controlled opaque completion');process.exit(23);}
  const program=request.cleanupOnly?fixed.releases[request.action]:request.browser==='safari'&&request.action==='copy'?fixed.safariCopy:fixed.programs[request.action];
  const mode=request.cleanupOnly?scenario.cleanupMode:scenario.keyMode;
  const count=mode==='partial'?1:mode==='refused'?0:program.length;
  const proofs=Array.from({length:count},proof);
  if(!request.cleanupOnly&&scenario.foreignProof&&proofs.length)proofs[0].pid=9999;
  value={...base,status:mode==='partial'?'unknown':mode==='refused'?'refused':'completed',delivery:mode==='partial'?'unknown/may_have_sent':mode==='refused'?'not_sent':'posted',method:'CGEvent/cghidEventTap',
    programId:'osr47/'+(request.cleanupOnly?'release-':'')+request.action+(request.browser==='safari'&&request.action==='copy'?'/safari-release-first/1':'/1'),program,postedTransitions:program.slice(0,count),postedCount:count,proofs,
    postcondition:{status:mode==='bad-final'?'refused':count===program.length?'verified':'not_attempted',proof:mode==='bad-final'||count!==program.length?null:proof()},reason:mode==='bad-final'?'Controlled final ownership failure':count!==program.length?'Controlled incomplete program':null};
  if(!request.cleanupOnly&&scenario.wrongProgram)value.programId='foreign-program/1';
  exit=count===program.length?0:2;
}else{
  const names={plain:'public.utf8-plain-text',html:'public.html'},formats={};
  for(const name of ['plain','html']){
    let text=request.operation==='clipboard-write'?request[name]:(scenario.formats?.[name]??null);
    if(text===null){formats[name]=null;continue;}
    if(scenario.normalize)text=text.replace(/\\r\\n/g,'\\n').normalize('NFC');
    const raw=Buffer.from(text,'utf8');formats[name]={type:names[name],bytes:raw.length,utf8Base64:raw.toString('base64'),text};
  }
  if(scenario.corrupt&&formats.plain){if(scenario.corrupt==='bytes')formats.plain.bytes++;if(scenario.corrupt==='base64')formats.plain.utf8Base64=Buffer.from('other bytes').toString('base64');if(scenario.corrupt==='text')formats.plain.text+='X';}
  value={...base,delivery:request.operation==='clipboard-write'?'clipboard_written':'not_sent',changeCountBefore:7,changeCountRead:8,changeCountAfter:8,formats,proof:proof(),cleared:request.operation==='clipboard-write',reason:null};
}
process.stdout.write(JSON.stringify(value)+'\\n');process.exit(exit);
`;
  // Explicit pinned Node executable; never rely on env/node or execute a production native helper.
  writeFileSync(helper,'#!'+pinnedNode+'\n'+body,{mode:0o755});writeFileSync(config,JSON.stringify(scenario));
  const platform=createClipboardPlatform({helperPath:helper,browser,nonce,title,onRecord});
  return{platform,requests:()=>{try{return readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(v=>JSON.parse(v));}catch(error){if(error.code==='ENOENT')return[];throw error;}},configure:v=>writeFileSync(config,JSON.stringify(v))};
}
function thrown(run){try{run();assert.fail('Expected a closed adapter failure');}catch(error){assert.ok(error instanceof ClipboardPlatformError);return error;}}
function frozen(value){if(value&&typeof value==='object'){assert.equal(Object.isFrozen(value),true);for(const entry of Object.values(value))frozen(entry);}}

test('CPPL01 one successful exact owner inspection cannot rebind or retry',t=>{
  const f=fixture(t),owned=f.platform.inspectOwnedWindow();assert.deepEqual({pid:owned.pid,rootFrame:owned.rootFrame},{pid,rootFrame});
  assert.deepEqual(f.requests(),[{format:'osr47-clipboard-platform/1',operation:'inspect',browser:'chrome',nonce,title,requestId:nonce+':1',deadlineMs:1000}]);
  assert.throws(()=>f.platform.inspectOwnedWindow(),/cannot rebind or retry/);assert.equal(f.requests().length,1);assert.deepEqual(f.platform.resources(),{keysPending:false,cleanupAttempted:false,disabled:false,inspected:true,records:1});
});
test('CPPL02 all five fixed Chrome shortcuts and Safari copy preserve independent literal programs and clear pending',t=>{
  const f=fixture(t);f.platform.inspectOwnedWindow();for(const[action,expected]of Object.entries({copy,cut,paste,undo,redo})){
    const record=f.platform.key(action);assert.deepEqual(record.result.program,expected);assert.deepEqual(record.result.postedTransitions,expected);assert.equal(record.result.postedCount,expected.length);
    assert.equal(record.request.pid,pid);assert.deepEqual(record.request.rootFrame,rootFrame);assert.equal(record.request.deadlineMs,1000);assert.equal(f.platform.resources().keysPending,false);
  }assert.equal(f.platform.releaseOwnedKeys().status,'not_needed');assert.equal(f.requests().length,6);
  const s=fixture(t,{browser:'safari'});s.platform.inspectOwnedWindow();assert.deepEqual(s.platform.key('copy').result.program,safariCopy);assert.equal(s.requests().length,2);
});
test('CPPL03 incomplete key core disables normal input and performs exactly one original-owner UP-only cleanup',t=>{
  const f=fixture(t,{scenario:{keyMode:'partial'}});f.platform.inspectOwnedWindow();const error=thrown(()=>f.platform.key('paste'));
  assert.equal(error.record.result.status,'unknown');assert.equal(error.record.result.delivery,'unknown/may_have_sent');assert.equal(error.cleanup.status,'completed');
  const requests=f.requests();assert.equal(requests.length,3);assert.equal(requests[2].cleanupOnly,true);assert.equal(requests[2].action,'paste');assert.equal(requests[2].pid,pid);assert.deepEqual(requests[2].rootFrame,rootFrame);
  assert.deepEqual(error.cleanup.record.result.program,releases.paste);assert.ok(error.cleanup.record.result.program.every(step=>step.down===false));
  assert.equal(f.platform.resources().keysPending,false);assert.equal(f.platform.resources().disabled,true);assert.throws(()=>f.platform.key('copy'));assert.equal(f.platform.releaseOwnedKeys().status,'not_needed');assert.equal(f.requests().length,3);
});
test('CPPL04 failed one-shot redo cleanup cannot replay a down or issue another release',t=>{
  const f=fixture(t,{scenario:{keyMode:'partial',cleanupMode:'partial'}});f.platform.inspectOwnedWindow();const error=thrown(()=>f.platform.key('redo'));
  assert.equal(error.cleanup.status,'failed');assert.equal(error.cleanup.keysPending,true);assert.deepEqual(error.cleanup.record.result.program,releases.redo);
  assert.deepEqual(error.cleanup.record.result.postedTransitions,[{keyCode:55,down:false,flags:'none'}]);
  assert.deepEqual(f.platform.releaseOwnedKeys(),{status:'not_repeated',keysPending:true});assert.throws(()=>f.platform.key('redo'));assert.equal(f.requests().length,3);
});
test('CPPL05 contextual complete core survives final-phase failure without redundant UP cleanup',t=>{
  const f=fixture(t,{scenario:{keyMode:'bad-final'}});f.platform.inspectOwnedWindow();const error=thrown(()=>f.platform.key('cut'));
  assert.equal(error.record.result.status,'completed');assert.deepEqual(error.record.result.postedTransitions,cut);assert.equal(error.cleanup.status,'not_needed');assert.equal(f.platform.resources().keysPending,false);assert.equal(f.platform.resources().disabled,true);
  assert.equal(f.platform.releaseOwnedKeys().status,'not_needed');assert.equal(f.requests().length,2);
});
test('CPPL06 selected clipboard strings require exact UTF8 bytes/base64 and never accept CRLF or NFC normalization',t=>{
  const plain='e\u0301\r\n\u00a0😀',html='<p>e\u0301\r\n</p>',f=fixture(t,{scenario:{formats:{plain,html}}});f.platform.inspectOwnedWindow();
  const read=f.platform.readClipboard();assert.equal(read.result.formats.plain.text,plain);assert.equal(read.result.formats.plain.bytes,Buffer.byteLength(plain));assert.equal(read.result.formats.plain.utf8Base64,Buffer.from(plain).toString('base64'));
  const write=f.platform.writeClipboard({plain,html});assert.deepEqual(write.result.formats,read.result.formats);assert.equal(write.request.deadlineMs,2000);assert.equal(write.result.delivery,'clipboard_written');
  for(const corrupt of['bytes','base64','text']){const bad=fixture(t,{scenario:{formats:{plain,html},corrupt}});bad.platform.inspectOwnedWindow();thrown(()=>bad.platform.readClipboard());assert.equal(bad.platform.resources().disabled,true);assert.equal(bad.requests().length,2);}
  const normalized=fixture(t,{scenario:{normalize:true}});normalized.platform.inspectOwnedWindow();const error=thrown(()=>normalized.platform.writeClipboard({plain,html}));assert.equal(error.record.result.formats.plain.text,'é\n\u00a0😀');assert.equal(normalized.platform.resources().disabled,true);
});
test('CPPL07 invalid action repeated request identity and non-scalar write refuse before another subprocess',t=>{
  const f=fixture(t);f.platform.inspectOwnedWindow();assert.throws(()=>f.platform.key('arbitrary'));assert.equal(f.requests().length,1);
  f.platform.key('copy',{requestId:nonce+':88'});assert.throws(()=>f.platform.key('paste',{requestId:nonce+':88'}),/cannot be reused/);assert.equal(f.requests().length,2);
  assert.throws(()=>f.platform.writeClipboard({plain:'\ud800',html:null}),/valid Unicode scalars/);assert.equal(f.requests().length,2);
});
test('CPPL08 opaque completion preserves original raw failure and permits only one fixed matching release',t=>{
  const f=fixture(t,{scenario:{opaque:true}});f.platform.inspectOwnedWindow();const error=thrown(()=>f.platform.key('undo'));
  assert.equal(error.record.stdout,'controlled opaque completion');assert.equal(error.record.exitCode,23);assert.equal(error.record.result,null);assert.equal(typeof error.record.parseError,'string');assert.equal(error.cleanup.status,'completed');assert.deepEqual(error.cleanup.record.result.program,releases.undo);
  assert.deepEqual(f.requests().map(r=>[r.operation,r.action??null,r.cleanupOnly??null]),[['inspect',null,null],['key','undo',false],['key','undo',true]]);assert.equal(f.platform.releaseOwnedKeys().status,'not_needed');assert.equal(f.requests().length,3);
});
test('CPPL09 mismatched owner or program proof never clears pending or rebinds cleanup authority',t=>{
  for(const scenario of[{foreignProof:true},{wrongProgram:true}]){const f=fixture(t,{scenario});f.platform.inspectOwnedWindow();const error=thrown(()=>f.platform.key('paste'));
    assert.equal(error.cleanup.status,'completed');assert.equal(error.cleanup.record.request.pid,pid);assert.deepEqual(error.cleanup.record.request.rootFrame,rootFrame);assert.deepEqual(error.cleanup.record.result.program,releases.paste);assert.equal(f.requests().length,3);assert.equal(f.platform.resources().disabled,true);
  }
});
test('CPPL10 evidence callbacks cannot reenter helpers or alter the independently owned next protocol request',t=>{
  let f;const reentry=[];f=fixture(t,{onRecord(record){
    frozen(record);
    for(const action of[()=>f.platform.key('paste'),()=>f.platform.releaseOwnedKeys(),()=>f.platform.inspectOwnedWindow(),()=>f.platform.readClipboard()]){
      try{action();assert.fail('Evidence callback dispatched a helper');}catch(error){reentry.push(error.message);assert.match(error.message,/Evidence callbacks cannot dispatch/);}
    }
    // A frozen observer snapshot may throw; an ordinary callback must never rebind private owner data.
    try{record.request.nonce='f'.repeat(32);}catch{}
    try{if(record.result.proof)record.result.proof.pid=9999;}catch{}
  }});
  f.platform.inspectOwnedWindow();f.platform.key('copy');assert.equal(reentry.length,8);assert.equal(f.requests().length,2);
  const request=f.requests()[1];assert.equal(request.nonce,nonce);assert.equal(request.title,title);assert.equal(request.browser,'chrome');assert.equal(request.pid,pid);assert.deepEqual(request.rootFrame,rootFrame);assert.equal(request.action,'copy');assert.equal(request.cleanupOnly,false);
  const evidence=f.platform.records();evidence.forEach(frozen);assert.throws(()=>{evidence[1].result.postedCount=0;},TypeError);assert.throws(()=>{evidence[1].request.nonce='f'.repeat(32);},TypeError);
  try{evidence.pop();}catch{}assert.equal(f.platform.records().length,2);assert.equal(f.platform.records()[1].result.postedCount,4);
});
test('CPPL11 throwing callback mutation disables input while preserving complete core and immutable failure evidence',t=>{
  const f=fixture(t,{onRecord(record){if(record.request.operation==='key')record.result.postedCount=0;}});f.platform.inspectOwnedWindow();
  const error=thrown(()=>f.platform.key('copy'));frozen(error.record);assert.equal(error.record.result.status,'completed');assert.equal(error.record.result.postedCount,4);assert.deepEqual(error.record.result.postedTransitions,copy);
  assert.equal(error.cleanup.status,'not_needed');assert.equal(f.platform.resources().keysPending,false);assert.equal(f.platform.resources().disabled,true);assert.throws(()=>f.platform.key('paste'));assert.equal(f.requests().length,2);
});
