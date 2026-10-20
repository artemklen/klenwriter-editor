// SPDX-License-Identifier: MIT OR Apache-2.0
// Frozen-literal transport projection. Never derives an expected outcome from
// a candidate result; incomplete authoring seeds stay qualified separately.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const json=path=>JSON.parse(readFileSync(path,'utf8')),copy=value=>structuredClone(value);
const paths=table=>Object.fromEntries(Object.entries(table).map(([key,value])=>[key,value==='/'?[]:value.slice(1).split('/').map(Number)]));
export function slashPoint(source){
  const child=/^Child\((\w+),(\d+),(After|Before)\)$/.exec(source),gap=/^(\w+)#(\d+)(After|Before)$/.exec(source);
  if(child||gap){const m=child??gap;return {kind:'child',parent:m[1],index:Number(m[2]),affinity:m[3].toLowerCase()};}
  const text=/^(\w+)@(\d+)(After|Before)$/.exec(source);assert(text,`Authored point ${source}`);
  return {kind:'text',node:text[1],offset:Number(text[2]),affinity:text[3].toLowerCase()};
}
const selection=point=>({anchor:copy(point),focus:copy(point)});
const range=text=>{const [anchor,focus]=text.split(/\s*->\s*/);return {anchor:slashPoint(anchor),focus:slashPoint(focus)};};
function literalTokens(value){
  if(typeof value==='string'&&value.startsWith('$'))return value.slice(1);
  if(Array.isArray(value))return value.map(literalTokens);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,literalTokens(v)]));
  return value;
}
function requestTokens(value,roles){
  if(Array.isArray(value))return value.map(v=>requestTokens(v,roles));
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,['node','parent'].includes(key)&&typeof v==='string'&&Object.hasOwn(roles,v)?`@${v}`:requestTokens(v,roles)]));
}
function standardCase(packet,id,input,rolesBefore,beforeSelection,payload,expected){
  return {job:{id,mode:'semantic',input,roles_before:rolesBefore,selection:requestTokens(beforeSelection,rolesBefore),
    commands:[{id:`org.klenwriter.kwdj/command/${payload.kind==='dismiss_slash'?'dismiss-slash':'accept-slash'}`,payload:requestTokens(payload,rolesBefore)}],history:expected.changed,
    profile:packet.kwdjProfile,registry_json:packet.kwdjRegistryJson,profile_options_json:JSON.stringify({identities:{media:[],references:[]},limits:null})},
  expected:{id,inputCanonical:input,rolesBefore,selectionBefore:beforeSelection,queryActive:expected.refused?null:'none',stateOnly:false,created:[],retired:[],stampDelta:{revision:expected.changed?'1':'0',selection_epoch:expected.changed?'1':'0',history_epoch:expected.changed?'1':'0'},...expected}};
}
export function loadSlashCases(){
  const packet=json('artifacts/extensions/packet.json'),oracle=json('contracts/slash/v1/native-source-oracles.json');
  const windows=json('contracts/slash/v1/text-window-oracles.json'),base=oracle.baselineF;
  const beforeRoles=paths(base.roles),beforeSelection=literalTokens(base.selection),queryRange=literalTokens(base.range);
  const result=[];
  for(const c of oracle.nativeCandidates){
    const afterRoles={...beforeRoles,...paths(c.targetRoles),N:[2],U:[2,0]};
    result.push(standardCase(packet,c.id,base.canonical,beforeRoles,beforeSelection,{kind:'accept_slash',target:c.target,range:queryRange,literal:base.literal},
      {changed:true,refused:false,afterCanonical:c.afterCanonical,rolesAfter:afterRoles,selectionAfter:selection(slashPoint('U@0After')),queryEffect:'changed',literal:c}));
  }
  for(const c of oracle.additionalNativeGoldens){
    const rolesBefore=c.rolesBefore?paths(c.rolesBefore):beforeRoles;
    const rolesAfter=c.id==='S43-E01'?{R:[],P:[0],A:[1],N:[2]}:c.id==='S43-U01'?{R:[],P:[0],T1:[0,0],A:[1],N:[2],T3:[2,0]}:{...beforeRoles,A:[1],N:[2],U:[2,0]};
    result.push(standardCase(packet,c.id,c.beforeCanonical,rolesBefore,selection(slashPoint(c.currentCaret)),{kind:'accept_slash',target:c.target,range:range(c.range),literal:c.literal},
      {changed:true,refused:false,afterCanonical:c.afterCanonical,rolesAfter,selectionAfter:selection(slashPoint(c.afterCaret)),queryEffect:'changed',literal:c}));
  }
  for(const c of oracle.negativeSeeds.slice(0,12)){
    let input=c.canonical??base.canonical,rolesBefore=beforeRoles,current=beforeSelection,captured=queryRange,literal=base.literal,target={kind:'scene_break'};
    if(c.id==='S43-N01')literal='/other';if(c.id==='S43-N02')literal='x';
    if(c.id==='S43-N03')target={kind:'heading',level:1};if(c.id==='S43-N04')target={kind:'ordered_list',start:'9'};
    if(c.id==='S43-N05')current=null;
    if(c.id==='S43-N06')current=range('T@4After -> T@6After');
    if(c.id==='S43-N07')current=selection(slashPoint('T@5After'));
    if(c.id==='S43-N08'){current=selection(slashPoint(c.currentCaret));captured=range(c.range);literal=c.literal;target=c.target;}
    if(c.id==='S43-N09'){rolesBefore={R:[],P:[0],T1:[0,0],BR:[0,1],T2:[0,2]};current=selection(slashPoint(c.currentCaret));captured=range(c.range);literal=c.literal;target=c.target;}
    if(c.id==='S43-N10'){rolesBefore={R:[],P1:[0],T1:[0,0],ATOM:[1],P2:[2],T2:[2,0]};current=selection(slashPoint(c.currentCaret));captured=range(c.range);literal=c.literal;target=c.target;}
    if(c.id==='S43-N11'){current=selection(slashPoint('R#1After'));captured=range('R#0After -> R#1Before');}
    if(c.id==='S43-N12'){const u=oracle.additionalNativeGoldens.find(row=>row.id==='S43-U01');input=u.beforeCanonical;rolesBefore=paths(u.rolesBefore);current=selection(slashPoint(u.currentCaret));captured=range('T1@1After -> T2@1Before');literal=u.literal;target=u.target;}
    const diagnostic={code:c.code,path:c.path,category:c.category,details:{},stamp:null,may_have_committed:false};
    result.push(standardCase(packet,c.id,input,rolesBefore,current,{kind:'accept_slash',target,range:captured,literal},
      {changed:false,refused:true,afterCanonical:input,rolesAfter:rolesBefore,selectionAfter:current,queryEffect:null,code:c.code,diagnosticPath:c.path,diagnostic,queryDiagnostic:diagnostic,literal:c}));
  }
  result.push(standardCase(packet,'S43-DISMISS',base.canonical,beforeRoles,beforeSelection,{kind:'dismiss_slash'},
    {changed:false,refused:false,afterCanonical:base.canonical,rolesAfter:beforeRoles,selectionAfter:beforeSelection,queryEffect:'unchanged',literal:oracle.cancelAndDismiss}));
  for(const c of windows.cases){
    if(c.id==='W04-surrogate-caret'||c.id==='W08-inline-atom')continue;
    let document,roles={R:[],P:[0]},point,expectedBefore=c.expectedBefore??[],expectedAfter=c.expectedAfter??[];
    if(c.leaves){document={content:[{content:c.leaves.map(row=>({type:'text',text:row.text,...(row.marks?.length?{marks:row.marks.map(type=>({type}))}:{})})),type:'paragraph'}],profile:'prose',schema:'klenwriter.document',schema_version:1};c.leaves.forEach((row,i)=>roles[row.role]=[0,i]);point={kind:'text',node:c.caret.node,offset:c.caret.offset,affinity:'after'};}
    else if(c.children){document={content:[{content:c.children.map(row=>row.primitive==='hard_break'?{type:'hard_break'}:{type:'text',text:row.text}),type:'paragraph'}],profile:'prose',schema:'klenwriter.document',schema_version:1};c.children.forEach((row,i)=>roles[row.role]=[0,i]);point={kind:'text',node:c.caret.node,offset:c.caret.offset,affinity:'after'};}
    else if(c.id==='W09-empty'){document={content:[{content:[],type:'paragraph'}],profile:'prose',schema:'klenwriter.document',schema_version:1};point={kind:'child',parent:'P',index:0,affinity:'after'};}
    else{const text=c.textRecipe?c.textRecipe.repeat.repeat(c.textRecipe.count):c.text??'/head';document={content:[{content:[{type:'text',text}],type:'paragraph'}],profile:'prose',schema:'klenwriter.document',schema_version:1};roles.T=[0,0];point={kind:'text',node:'T',offset:typeof c.caret==='number'?c.caret:text.length,affinity:'after'};}
    let selected=selection(point);
    if(c.id==='W17-null')selected=null;
    if(c.id==='W18-root-gap')selected=selection({kind:'child',parent:'R',index:0,affinity:'after'});
    if(c.id==='W19-noncollapsed')selected=literalTokens(c.selection);
    // Pure JSON serialization of authored document data, no editor/canonicalizer.
    const input=JSON.stringify(document);
    result.push({job:{id:c.id,mode:'window',input,roles_before:roles,selection:requestTokens(selected,roles),commands:[],reads:[{kind:'text_window',before_utf16:c.before??256,after_utf16:c.after??0}],history:false,profile:packet.kwdjProfile,registry_json:packet.kwdjRegistryJson,profile_options_json:JSON.stringify({identities:{media:[],references:[]},limits:null})},
      expected:{id:c.id,rolesBefore:roles,selectionBefore:selected,window:c,expectedBefore:literalTokens(expectedBefore),expectedAfter:literalTokens(expectedAfter)}});
  }
  // Source-frozen additional inventory: independently wrong one stamp field.
  // Fresh selected W01 has revision0/selection_epoch1/history_epoch0/generation1.
  // These are deliberate valid-decimal mismatches, not forged node identities.
  const w01=result.find(c=>c.job.id==='W01-start');
  for(const [id,field,value,code,path]of [
    ['W21-revision','revision','1','session.stale_revision','stamp.revision'],
    ['W22-selection-epoch','selection_epoch','0','session.stale_selection_epoch','stamp.selection_epoch'],
    ['W23-history-epoch','history_epoch','1','session.stale_history_epoch','stamp.history_epoch'],
    ['W24-generation','generation','2','session.stale_session','stamp.session'],
  ]){
    const c=copy(w01);c.job.id=id;c.expected.id=id;
    c.job.reads[0].stamp_overrides={[field]:value};c.expected.window={id,diagnostic:code,path,category:'sdk'};result.push(c);
  }
  const foreign=copy(w01);foreign.job.id='W25-foreign-session';foreign.expected.id=foreign.job.id;
  foreign.job.foreign=true;foreign.job.reads[0].use_foreign_stamp=true;
  foreign.expected.window={id:foreign.job.id,diagnostic:'session.stale_session',path:'stamp.session',category:'sdk'};result.push(foreign);
  return {cases:result,qualifiedNotRun:[{id:'W04-surrogate-caret',scope:'Public set_selection refuses invalid setup; private-position lane required, not silently tested by a different input.'},{id:'W08-inline-atom',scope:'No shipped KWDJ inline-atom admission; not sealed KWDJ proof.'},...oracle.negativeSeeds.slice(12).map(c=>({id:c.id,scope:'Incomplete source seed requires separate genuine foreign/deleted/stale/limit setup before this lane can count it as executed.'}))]};
}
