// SPDX-License-Identifier: MIT OR Apache-2.0
// Transport adapter for independent frozen literals; never derives expected
// content, ordering, selection or counters from a candidate observation.
import { readFileSync } from 'node:fs';

const json=path=>JSON.parse(readFileSync(path,'utf8'));
const cloned=value=>structuredClone(value);
const paths=table=>Object.fromEntries(Object.entries(table).map(([role,path])=>[role,Array.isArray(path)?path:path.kind==='synthetic_root'?[]:path.path]));
function template(value,roles){
  if(Array.isArray(value))return value.map(v=>template(v,roles));
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,['node','parent'].includes(key)&&typeof v==='string'&&Object.hasOwn(roles,v)?`@${v}`:template(v,roles)]));
}
const ids={toggle_mark:'toggle-mark',insert_block:'insert-block',move:'move'};
const command=intent=>({id:`org.klenwriter.kwdj/command/${ids[intent.kind]}`,payload:cloned(intent)});

export function loadUiSemanticCases(){
  const packet=json('artifacts/extensions/packet.json');
  const native=json('contracts/ui/v1/native-oracles.json');
  const nested=json('contracts/ui/v1/nesting-oracles.json');
  const result=[];
  for(const c of native.cases){
    const notes=c.id.startsWith('V06-');
    const before=notes?{R:[],D:[0],P:[0,0],T:[0,0,0]}:c.input.roles;
    const selection=notes?{anchor:{kind:'text',node:'T',offset:1,affinity:'after'},focus:{kind:'text',node:'T',offset:1,affinity:'after'}}:c.input.selection;
    const commands=notes?[{id:c.command.id,payload:c.command.payload}]:[command(c.intent)];
    if(c.id==='V02-collapsed-twice')commands.push(command(c.intent));
    const e=c.expected, stateOnly=c.id==='V02-collapsed-twice';
    const changed=notes?e.kind==='changed':e.documentEvents===1;
    const refused=notes?e.kind==='refused':!!e.code;
    const profile=notes?{profile_id:'org.example.notes',profile_version:'1.0.0',codec_id:'org.example.notes/json',wire_version:1,extensions:packet.registries.D0.selected_extensions}:packet.kwdjProfile;
    const job={id:c.id,input:notes?c.input:c.input.canonical_json,roles_before:before,selection:template(selection,before),commands:commands.map(v=>({...v,payload:template(v.payload,before)})),history:changed,profile,
      registry_json:notes?packet.registryJson.D0:packet.kwdjRegistryJson,
      profile_options_json:JSON.stringify(notes?{root_blocks:['org.example.notes/paragraph'],limits:null}:{identities:{media:[],references:[]},limits:null})};
    const after=notes?before:e.roles??before;
    const expected={id:c.id,inputCanonical:job.input,afterCanonical:notes?e.canonical:e.canonical_json,rolesBefore:before,rolesAfter:after,
      selectionBefore:selection,selectionAfter:notes||e.selection==='same_as_input'||!e.selection?selection:e.selection,
      queryActive:e.queryActive??null,queryEffect:notes?(changed?'changed':refused?null:'unchanged'):e.queryEffect??null,
      changed,refused,stateOnly,code:e.code??null,diagnosticPath:e.path??null,created:e.created??[],retired:e.retired??[],
      stampDelta:e.stampDelta??{revision:changed?'1':'0',selection_epoch:'0',history_epoch:changed?'1':'0'},literal:c};
    result.push({job,expected});
  }
  for(const c of nested.cases){
    const before=paths(c.roles_before),after=paths(c.roles_after),e=c.expected.command;
    const job={id:c.id,input:c.input_canonical,roles_before:before,selection:template(c.selection,before),commands:[{id:c.command_id,payload:template(c.intent,before)}],history:e.response_status==='ok',profile:packet.kwdjProfile,registry_json:packet.kwdjRegistryJson,profile_options_json:c.profile_options_json};
    const expected={id:c.id,inputCanonical:c.input_canonical,afterCanonical:c.after_canonical,rolesBefore:before,rolesAfter:after,selectionBefore:c.selection,selectionAfter:e.selection,changed:e.response_status==='ok',refused:e.response_status==='refused',stateOnly:false,
      queryActive:c.expected.query.value.presentation?.active??null,queryEffect:c.expected.query.value.effect,code:e.diagnostic?.code??null,diagnosticPath:e.diagnostic?.path??null,
      diagnostic:e.diagnostic??null,queryDiagnostic:c.expected.query.value.diagnostic??null,created:e.identity.created,retired:e.identity.retired,stampDelta:e.stamp_delta,literal:c};
    result.push({job,expected});
  }
  return result;
}
