// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled protocol/dispatch boundaries only. No OS, browser, helper or network calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputOwner} from '../scripts/selection-native/input.mjs';
import {validCall,limits} from '../scripts/selection-native/protocol.mjs';
function fixture(){
  const nonce='a'.repeat(32),config={nonce,origin:'http://127.0.0.1:4174',fixtureUrl:'http://127.0.0.1:4174/selection',title:'KlenWriter Selection native '+nonce};
  let serial=0,reply=null,execute=null,pageDown=false;
  const records=[],calls=[];
  function proof(action){
      return {id:nonce+':'+String(++serial),start:process.hrtime.bigint(),value:{nonce,url:config.fixtureUrl,title:config.title,
        id:'selection-mount-1',mountedId:'selection-mount-1',serial,caseId:'scroll-down-terminal',action,
        target:action==='tab'?'host-control':'editor',allowed:true,editorConnected:true,documentFocused:true,pointerDown:pageDown,
        viewport:{width:1024,height:768,scale:1,offsetLeft:0,offsetTop:0},point:['move-start','down','move-end','up'].includes(action)?{x:140,y:340}:null}};
  }
  const owner=createInputOwner({browser:'safari',config,inputHelper:'/controlled/no-helper-is-executed',mountedId:()=> 'selection-mount-1',
    record:(kind,value)=>records.push({kind,value}),
    async guard(action){return reply?reply(action,proof):proof(action);},
    run(command,argv){const request=JSON.parse(argv[1]);calls.push({command,request});if(execute)return execute(request);
      if(request.action==='down')pageDown=true;if(request.action==='up')pageDown=false;
      return {returnCode:0,stdout:JSON.stringify({status:'sent',action:request.action,requestId:request.requestId,nonce}),stderr:''};},
  });
  return {owner,config,records,calls,set reply(value){reply=value;},set execute(value){execute=value;}};
}
test('controlled selection transport has finite closed cases/actions, no eval/coordinates/key RPC',()=>{
  assert.equal(limits.commands,1024);assert.equal(limits.runMs,600000);
  assert(validCall('prepare',['en','key-comb']));assert(validCall('guard',['move-end']));assert(validCall('checkpoint',[]));
  for(const pair of [['eval',['1+1']],['guard',['key-42']],['prepare',['en','invented']],['guard',['down',{x:1,y:1}]],['inspect',['extra']]])assert.equal(validCall(...pair),false);
});
test('controlled stale guard never starts physical dispatch and disables later input',async()=>{
  const f=fixture();f.reply=(action,proof)=>({...proof(action),start:process.hrtime.bigint()-2_000_000_000n});
  await assert.rejects(f.owner.input('down'));assert.equal(f.calls.length,0);assert.equal(f.owner.disabled,true);
  assert.equal(f.records.at(-1).value.delivery,'not_sent');await assert.rejects(f.owner.input('select-all'));assert.equal(f.calls.length,0);
});
test('controlled foreign mount guard refuses before any physical helper call',async()=>{
  const f=fixture();f.reply=(action,proof)=>{const result=proof(action);result.value.mountedId='selection-mount-2';return result;};
  await assert.rejects(f.owner.input('down'));assert.equal(f.calls.length,0);assert.equal(f.owner.disabled,true);
  assert.equal(f.records.at(-1).value.delivery,'not_sent');
});
test('controlled unknown down allows one fresh owned cleanup release without restoring acceptance',async()=>{
  const f=fixture();f.execute=()=>{throw Object.assign(Error('controlled timeout'),{execution:{returnCode:null,error:'timeout'}});};
  await assert.rejects(f.owner.input('down'));assert.equal(f.owner.pointerState,'may-have-down');assert.equal(f.owner.disabled,true);
  assert.equal(f.records.at(-1).value.delivery,'unknown/may_have_sent');assert.equal(f.calls.length,1);
  f.execute=null;const cleanup=await f.owner.releaseOwnedPointer();assert.equal(cleanup.cleanupOnly,true);assert.equal(f.owner.pointerState,'up');assert.equal(f.owner.disabled,true);
  assert.equal(f.calls[1].request.action,'up');assert.equal(f.calls[1].request.cleanupOnly,true);
  await assert.rejects(f.owner.input('select-all'));await assert.rejects(f.owner.releaseOwnedPointer());assert.equal(f.calls.length,2);
});
test('controlled lost broker cannot be bypassed for pointer cleanup',async()=>{
  const f=fixture();await f.owner.input('down');assert.equal(f.owner.pointerState,'down');
  f.reply=()=>{throw Error('unknown broker completion; pending command retained');};
  await assert.rejects(f.owner.releaseOwnedPointer());assert.equal(f.calls.length,1);assert.equal(f.owner.pointerState,'down');assert.equal(f.owner.disabled,true);
  assert.equal(f.records.at(-1).kind,'cleanup-pointer-release-failure');assert.equal(f.records.at(-1).value.delivery,'not_sent');
});
test('controlled ordinary pointer phases preserve one owned button and actual returned receipts',async()=>{
  const f=fixture();await f.owner.input('move-start');await f.owner.input('down');await f.owner.input('move-end');await f.owner.input('up');
  assert.equal(f.owner.pointerState,'up');assert.equal(f.owner.disabled,false);assert.deepEqual(f.calls.map(r=>r.request.action),['move-start','down','move-end','up']);
  assert(f.records.every(row=>row.value.delivery==='sent'));assert(f.calls.every(row=>row.request.deadlineMs>0&&row.request.deadlineMs<=1000));
});
