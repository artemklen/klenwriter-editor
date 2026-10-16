import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Deliberately small contract reference, not an editor, KWDJ codec or Rust proof.
const read = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
let checks = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const fail = code => { throw new Error(code); };
function scalarBoundaries(text) {
  if (!text.isWellFormed()) fail('invalid-unicode');
  const utf16 = [0], utf8 = [0];
  for (const scalar of text) {
    utf16.push(utf16.at(-1) + scalar.length);
    utf8.push(utf8.at(-1) + Buffer.byteLength(scalar));
  }
  return { utf16, utf8 };
}
function replaceMap({a,b,insertLength:l}, {offset:x,affinity}) {
  if (x < a) return {offset:x,deleted:false};
  if (x > b) return {offset:x+l-(b-a),deleted:false};
  if (a !== b && x === b) return {offset:a+l,deleted:false};
  return {offset:a+(affinity === 'after' ? l : 0),deleted:x>a && x<b};
}
function textMap(op, p) {
  if (op.kind === 'replace') return replaceMap(op,p);
  if (op.kind === 'split') return p.offset>op.at || (p.offset===op.at && p.affinity==='after')
    ? {leaf:op.right,offset:p.offset-op.at} : {leaf:op.left,offset:p.offset};
  if (op.kind === 'join') return {leaf:op.left,offset:p.offset+(p.leaf===op.right?op.leftLength:0)};
  fail('unknown-operation');
}
function deletedGap(tree, node, affinity) {
  for (const [parent,children] of Object.entries(tree)) {
    const index=children.indexOf(node);
    if (index>=0) return {kind:'child',parent,index,affinity,deleted:true};
  }
  fail('missing-parent');
}
const positions = await read('evidence/osr-59/position-vectors.json');
const segmenter = new Intl.Segmenter('und', {granularity:'grapheme'});
for (const v of positions.text) {
  const actual=scalarBoundaries(v.value);
  equal(actual,{utf16:v.utf16,utf8:v.utf8},v.id);
  // Comparison only: ICU/Unicode versions are printed, never the production pin.
  const boundaries=[...segmenter.segment(v.value)].map(s=>s.index); boundaries.push(v.value.length);
  equal([...new Set(boundaries)],v.graphemes,`${v.id} graphemes`);
  for (const x of v.rejectUtf16??[]) equal(actual.utf16.includes(x),false,`${v.id} half surrogate`);
  for (const x of v.rejectUserEditOffsets??[]) equal(v.graphemes.includes(x),false,`${v.id} cluster edit`);
  for(let byte=0;byte<Buffer.byteLength(v.value);byte++) if(!v.utf8.includes(byte)) {
    equal(actual.utf8.includes(byte),false,`${v.id} mid-byte ${byte}`);
  }
}
for(const value of positions.invalidStrings) {
  assert.throws(()=>scalarBoundaries(value),/invalid-unicode/); checks++;
}
const cross=positions.marksAcrossCluster;
equal(cross.leaves.map(x=>x.text).join(''),cross.logical,'mark boundaries preserve logical text');
equal([...segmenter.segment(cross.logical)].map(x=>x.index).concat(cross.logical.length),cross.graphemes,'cross-mark cluster');
for(const v of positions.textMaps) equal(textMap(v.op,v.input),v.expected,v.id);
for(const v of positions.structuralMaps) {
  if(v.move) {
    const source=v.tree[v.move.parent]; const from=source.indexOf(v.move.node);
    const result=source.filter(x=>x!==v.move.node); const target=v.move.beforeIndex-(from<v.move.beforeIndex?1:0);
    result.splice(target,0,v.move.node);
    equal(result,v.expectedChildren,v.id); equal(v.point,v.expectedPoint,`${v.id} stable descendant`);
  } else if(v.delete) equal(deletedGap(v.tree,v.delete,v.point.affinity??v.point.side),v.expected,v.id);
  else equal(v.point.index<=v.tree[v.point.parent].length,v.expectedValid,v.id);
}
const rev=positions.reverseSelection;
equal({anchor:textMap(rev.op,rev.before.anchor),focus:textMap(rev.op,rev.before.focus)},rev.after,'reverse mapping');
equal(rev.after.anchor.offset>rev.after.focus.offset,true,'reverse direction retained');
// A deliberately bounded tree-operation model for hand-authored M0 vectors.
// This is not an editor: no DOM, profile grammar, real Unicode command segmenter,
// transaction scheduler or production Rust/native/WASM boundary is implemented.
const clone = value => structuredClone(value);
const parentOf = (doc, id) => {
  const entry=Object.entries(doc.nodes).find(([,node])=>node.children?.includes(id));
  if(!entry) fail('missing-parent');
  return {parent:entry[0],index:entry[1].children.indexOf(id)};
};
function subtreeIds(doc,id) {
  const node=doc.nodes[id]; if(!node) fail('unknown-node-id');
  return [id,...(node.children??[]).flatMap(child=>subtreeIds(doc,child))];
}
function validateTree(doc) {
  const visited=new Set();
  const visit=id=> {
    if(visited.has(id)) fail('duplicate-or-cyclic-node');
    visited.add(id); const node=doc.nodes[id]; if(!node) fail('unknown-node-id');
    if(node.kind==='text') scalarBoundaries(node.text);
    else if(node.kind==='container') {
      if(!Array.isArray(node.children)) fail('invalid-children');
      for(const child of node.children) visit(child);
    } else if(node.kind!=='atom') fail('invalid-node-kind');
  };
  visit(doc.root);
  if(visited.size!==Object.keys(doc.nodes).length) fail('orphan-node');
}
function validatePosition(doc,p) {
  if(p.kind==='text') {
    const node=doc.nodes[p.leaf];
    if(node?.kind!=='text'||!scalarBoundaries(node.text).utf16.includes(p.utf16)) fail('invalid-text-position');
  } else if(p.kind==='child') {
    const node=doc.nodes[p.parent];
    if(node?.kind!=='container'||!Number.isInteger(p.index)||p.index<0||p.index>node.children.length) fail('invalid-child-position');
  } else if(p.kind==='edge') {
    if(doc.nodes[p.node]?.kind!=='atom'||!['before','after'].includes(p.side)) fail('invalid-edge-position');
    return;
  } else fail('invalid-position-kind');
  if(!['before','after'].includes(p.affinity)) fail('invalid-affinity');
}
const mapped = (position,deleted=false) => ({position,deleted});
const mapChild = (p,parent,a,b,length) => {
  if(p.kind!=='child'||p.parent!==parent) return mapped(p);
  const m=replaceMap({a,b,insertLength:length},{offset:p.index,affinity:p.affinity});
  return mapped({...p,index:m.offset},m.deleted);
};
function assertEditBoundary(doc,leaf,offset) {
  const {parent,index}=parentOf(doc,leaf),children=doc.nodes[parent].children;
  let start=index,end=index;
  while(start>0&&doc.nodes[children[start-1]].kind==='text')start--;
  while(end+1<children.length&&doc.nodes[children[end+1]].kind==='text')end++;
  const prefix=children.slice(start,index).reduce((n,id)=>n+doc.nodes[id].text.length,0);
  const logical=children.slice(start,end+1).map(id=>doc.nodes[id].text).join('');
  const bounds=[...segmenter.segment(logical)].map(x=>x.index).concat(logical.length);
  if(!bounds.includes(prefix+offset))fail('invalid-grapheme-boundary');
}
function applyStep(doc,op,checkUserBoundaries=true) {
  if(op.kind==='replaceText') {
    const node=doc.nodes[op.leaf]; if(node?.kind!=='text') fail('unknown-text');
    const old=node.text,bounds=scalarBoundaries(old).utf16;
    if(!bounds.includes(op.from)||!bounds.includes(op.to)||op.from>op.to) fail('invalid-text-position');
    if(checkUserBoundaries){assertEditBoundary(doc,op.leaf,op.from);assertEditBoundary(doc,op.leaf,op.to);}
    scalarBoundaries(op.insert);
    node.text=old.slice(0,op.from)+op.insert+old.slice(op.to);
    return {inverse:{kind:'replaceText',leaf:op.leaf,from:op.from,to:op.from+op.insert.length,insert:old.slice(op.from,op.to)},map:p=>{
      if(p.kind!=='text'||p.leaf!==op.leaf)return mapped(p);
      const m=replaceMap({a:op.from,b:op.to,insertLength:op.insert.length},{offset:p.utf16,affinity:p.affinity});
      return mapped({...p,utf16:m.offset},m.deleted);
    }};
  }
  if(op.kind==='splitText') {
    const left=doc.nodes[op.leaf]; if(left?.kind!=='text'||doc.nodes[op.right])fail('invalid-split');
    if(!scalarBoundaries(left.text).utf16.includes(op.at))fail('invalid-text-position');
    if(checkUserBoundaries)assertEditBoundary(doc,op.leaf,op.at);
    const {parent,index}=parentOf(doc,op.leaf);
    doc.nodes[op.right]={...clone(left),text:left.text.slice(op.at)}; left.text=left.text.slice(0,op.at);
    doc.nodes[parent].children.splice(index+1,0,op.right);
    return {inverse:{kind:'joinText',left:op.leaf,right:op.right},map:p=>{
      if(p.kind!=='text'||p.leaf!==op.leaf)return mapChild(p,parent,index+1,index+1,1);
      return p.utf16>op.at||(p.utf16===op.at&&p.affinity==='after')
        ? mapped({...p,leaf:op.right,utf16:p.utf16-op.at}):mapped(p);
    }};
  }
  if(op.kind==='joinText') {
    const left=doc.nodes[op.left],right=doc.nodes[op.right];
    const a=parentOf(doc,op.left),b=parentOf(doc,op.right);
    if(left?.kind!=='text'||right?.kind!=='text'||a.parent!==b.parent||b.index!==a.index+1||JSON.stringify(left.marks)!==JSON.stringify(right.marks))fail('invalid-join');
    const at=left.text.length;left.text+=right.text;doc.nodes[a.parent].children.splice(b.index,1);delete doc.nodes[op.right];
    return {inverse:{kind:'splitText',leaf:op.left,right:op.right,at},map:p=>p.kind==='text'&&p.leaf===op.right
      ?mapped({...p,leaf:op.left,utf16:at+p.utf16}):mapChild(p,a.parent,b.index,b.index+1,0)};
  }
  if(op.kind==='moveSubtree') {
    const source=parentOf(doc,op.node),dest=doc.nodes[op.parent];
    if(dest?.kind!=='container'||!Number.isInteger(op.beforeIndex)||op.beforeIndex<0||op.beforeIndex>dest.children.length)fail('invalid-destination');
    if(subtreeIds(doc,op.node).includes(op.parent))fail('move-into-descendant');
    if(source.parent===op.parent&&op.beforeIndex>=source.index&&op.beforeIndex<=source.index+1)fail('move-noop');
    const target=op.beforeIndex-(source.parent===op.parent&&source.index<op.beforeIndex?1:0);
    doc.nodes[source.parent].children.splice(source.index,1);dest.children.splice(target,0,op.node);
    const undoIndex=source.index+(source.parent===op.parent&&target<source.index?1:0);
    return {inverse:{kind:'moveSubtree',node:op.node,parent:source.parent,beforeIndex:undoIndex},map:p=>{
      const remove=mapChild(p,source.parent,source.index,source.index+1,0);
      const insert=mapChild(remove.position,op.parent,target,target,1);
      return mapped(insert.position,remove.deleted||insert.deleted);
    }};
  }
  if(op.kind==='deleteSubtree') {
    if(op.node===doc.root)fail('cannot-delete-root');
    const {parent,index}=parentOf(doc,op.node),ids=subtreeIds(doc,op.node),removed={};
    for(const id of ids){removed[id]=clone(doc.nodes[id]);delete doc.nodes[id];}
    doc.nodes[parent].children.splice(index,1);
    return {inverse:{kind:'restoreSubtree',node:op.node,parent,beforeIndex:index,nodes:removed},map:p=>{
      const target=p.kind==='text'?p.leaf:p.kind==='edge'?p.node:p.parent;
      return ids.includes(target)?mapped({kind:'child',parent,index,affinity:p.affinity??p.side},true):mapChild(p,parent,index,index+1,0);
    }};
  }
  if(op.kind==='insertAtom'||op.kind==='restoreSubtree') {
    const dest=doc.nodes[op.parent];
    if(dest?.kind!=='container'||!Number.isInteger(op.beforeIndex)||op.beforeIndex<0||op.beforeIndex>dest.children.length)fail('invalid-destination');
    const nodes=op.kind==='insertAtom'?{[op.node]:{kind:'atom',type:op.type}}:op.nodes;
    if(Object.keys(nodes).some(id=>Object.hasOwn(doc.nodes,id)))fail('duplicate-node-id');
    Object.assign(doc.nodes,clone(nodes));dest.children.splice(op.beforeIndex,0,op.node);
    return {inverse:{kind:'deleteSubtree',node:op.node},map:p=>mapChild(p,op.parent,op.beforeIndex,op.beforeIndex,1)};
  }
  if(op.kind==='markText') {
    const old=doc.nodes[op.leaf],{parent,index}=parentOf(doc,op.leaf);
    if(old?.kind!=='text'||!scalarBoundaries(old.text).utf16.includes(op.from)||!scalarBoundaries(old.text).utf16.includes(op.to)||op.from>=op.to)fail('invalid-mark-range');
    if(checkUserBoundaries){assertEditBoundary(doc,op.leaf,op.from);assertEditBoundary(doc,op.leaf,op.to);}
    // The reference fixture supplies the semantic run IDs, never expected positions.
    // Intl is only the version-reported reference lane, not the production pin.
    const chunks=[{start:0,end:op.from,marks:old.marks},{start:op.from,end:op.to,marks:[...old.marks,op.mark]},{start:op.to,end:old.text.length,marks:old.marks}].filter(x=>x.start<x.end);
    if(op.runIds.length!==chunks.length||op.runIds[0]!==op.leaf||new Set(op.runIds).size!==op.runIds.length||op.runIds.slice(1).some(id=>doc.nodes[id]))fail('invalid-run-ids');
    const before=clone(old);chunks.forEach((chunk,i)=>doc.nodes[op.runIds[i]]={kind:'text',text:old.text.slice(chunk.start,chunk.end),marks:clone(chunk.marks)});
    doc.nodes[parent].children.splice(index,1,...op.runIds);
    return {inverse:{kind:'restoreRuns',parent,index,removeIds:op.runIds,runs:[{id:op.leaf,node:before}]},map:p=>{
      if(p.kind!=='text'||p.leaf!==op.leaf)return mapChild(p,parent,index,index+1,chunks.length);
      let run=chunks.findIndex(c=>p.utf16<c.end||(p.utf16===c.end&&p.affinity==='before'));
      if(run<0)run=chunks.length-1;
      return mapped({...p,leaf:op.runIds[run],utf16:p.utf16-chunks[run].start});
    }};
  }
  if(op.kind==='restoreRuns') {
    const parent=doc.nodes[op.parent];
    if(JSON.stringify(parent.children.slice(op.index,op.index+op.removeIds.length))!==JSON.stringify(op.removeIds))fail('invalid-run-restore');
    const old=op.removeIds.map(id=>({id,node:clone(doc.nodes[id])}));
    const starts=new Map();let length=0;for(const run of old){starts.set(run.id,length);length+=run.node.text.length;}
    for(const id of op.removeIds)delete doc.nodes[id];for(const run of op.runs)doc.nodes[run.id]=clone(run.node);
    parent.children.splice(op.index,op.removeIds.length,...op.runs.map(x=>x.id));
    return {inverse:{kind:'restoreRuns',parent:op.parent,index:op.index,removeIds:op.runs.map(x=>x.id),runs:old},map:p=>{
      if(p.kind!=='text'||!starts.has(p.leaf))return mapChild(p,op.parent,op.index,op.index+op.removeIds.length,op.runs.length);
      const logical=starts.get(p.leaf)+p.utf16;let start=0;
      for(let i=0;i<op.runs.length;i++){const run=op.runs[i],end=start+run.node.text.length;if(logical<end||(logical===end&&p.affinity==='before')||i===op.runs.length-1)return mapped({...p,leaf:run.id,utf16:logical-start});start=end;}
    }};
  }
  fail('unknown-model-operation');
}
// Internal semantic replay restores the exact stored change. An insertion can
// join a grapheme, so its inverse endpoints need not be user-edit boundaries.
// Scalar/tree/position validation still runs; operation DTOs cannot enable this.
const HISTORY_REPLAY=Symbol('history replay');
function transact(state,operations,authority) {
  const next=clone(state),inverse=[],provenance={anchor:'mapped',focus:'mapped'};
  validateTree(next.document);for(const p of Object.values(next.selection))validatePosition(next.document,p);
  for(const op of operations){
    const result=applyStep(next.document,op,authority!==HISTORY_REPLAY);inverse.unshift(result.inverse);
    for(const endpoint of ['anchor','focus']){const m=result.map(next.selection[endpoint]);next.selection[endpoint]=m.position;if(m.deleted)provenance[endpoint]='deleted';}
    validateTree(next.document);for(const p of Object.values(next.selection))validatePosition(next.document,p);
  }
  next.revision=(BigInt(state.revision)+1n).toString();
  return {state:next,inverse,provenance};
}
const operationVectors=await read('evidence/osr-59/operation-vectors.json');
const transactionResults=[];
for(const v of operationVectors.transactions){
  const pristine=clone(v.before),commit=transact(v.before,v.operations);
  equal(v.before,pristine,`${v.id} original preserved`);
  equal(commit.state,v.expected.after,`${v.id} computed commit`);
  equal(commit.provenance,v.expected.provenance,`${v.id} endpoint provenance`);
  const undo=transact(commit.state,commit.inverse,HISTORY_REPLAY);undo.state.selection=clone(v.before.selection);
  equal(undo.state,v.expected.undo,`${v.id} inverse replay + stored selection`);
  const redo=transact(undo.state,v.operations,HISTORY_REPLAY);redo.state.selection=clone(commit.state.selection);
  equal(redo.state,v.expected.redo,`${v.id} forward replay + stored selection`);
  for(const p of Object.values(undo.state.selection))validatePosition(undo.state.document,p);
  transactionResults.push({id:v.id,operations:v.operations.map(x=>x.kind),checks:5,passed:true});
}
for(const v of operationVectors.refusals){
  const pristine=clone(v.before);assert.throws(()=>transact(v.before,v.operations,v.lane==='history'?HISTORY_REPLAY:undefined),new RegExp(v.expected));checks++;
  equal(v.before,pristine,`${v.id} refusal preserves document, selection and revision`);
}

function replyStatus(current,captured) {
  if(captured.session!==current.session||captured.generation!==current.generation)return 'stale-session';
  if(captured.revision!==current.revision)return 'stale-revision';
  if(captured.selectionEpoch!==current.selectionEpoch)return 'stale-selection';
  return 'current';
}
for(const v of operationVectors.lifecycleReplies){
  const pristine=clone(v.current);equal(replyStatus(v.current,v.captured),v.expected,v.id);equal(v.current,pristine,`${v.id} no mutation`);
}
assert(!positions.lifecycle.exportKeys.some(k=>/session|generation|history|selection/i.test(k)));checks++;

const profiles=await read('evidence/osr-57/profile-vectors.json');
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const validId=id=>typeof id==='string'&&/^[\x21-\x7e]{1,128}$/.test(id);
function assertAttrSchema(d,depth=0) {
  if(depth>8)fail('invalid-attribute-schema');
  if(Array.isArray(d)){if(!d.length||!d.every(x=>typeof x==='string'))fail('invalid-attribute-schema');return;}
  if(!isRecord(d))fail('invalid-attribute-schema');
  const bound=n=>Number.isInteger(n)&&n>=0&&n<=65536;
  switch(d.kind){
    case 'string':if(!bound(d.maxBytes))fail('invalid-attribute-schema');break;
    case 'boolean':break;
    case 'number':case 'integer':
      if(!Number.isFinite(d.min)||!Number.isFinite(d.max)||d.min>d.max||(d.kind==='integer'&&(!Number.isInteger(d.min)||!Number.isInteger(d.max))))fail('invalid-attribute-schema');break;
    case 'enum':if(!Array.isArray(d.values)||!d.values.length||!d.values.every(x=>typeof x==='string'))fail('invalid-attribute-schema');break;
    case 'list':if(!bound(d.maxItems))fail('invalid-attribute-schema');assertAttrSchema(d.item,depth+1);break;
    case 'object':if(!isRecord(d.fields)||Object.keys(d.fields).length>64)fail('invalid-attribute-schema');for(const child of Object.values(d.fields))assertAttrSchema(child,depth+1);break;
    case 'nullable':assertAttrSchema(d.value,depth+1);break;
    default:fail('invalid-attribute-schema');
  }
}
function attrValue(value,descriptor,depth=0) {
  if(depth>8)fail('attribute-depth-exceeded');
  // Arrays are the first fixture format's enum shorthand, not arbitrary JSON.
  if(Array.isArray(descriptor)){if(!descriptor.includes(value))fail('invalid-attribute');return;}
  if(!isRecord(descriptor))fail('invalid-attribute-schema');
  if(value===undefined&&descriptor.optional)return;
  switch(descriptor.kind) {
    case 'string':
      if(typeof value!=='string'||!value.isWellFormed()||Buffer.byteLength(value)>descriptor.maxBytes)fail('invalid-attribute');break;
    case 'boolean':if(typeof value!=='boolean')fail('invalid-attribute');break;
    case 'number':case 'integer':
      if(typeof value!=='number'||!Number.isFinite(value)||(descriptor.kind==='integer'&&!Number.isInteger(value))||value<descriptor.min||value>descriptor.max)fail('invalid-attribute');break;
    case 'enum':if(!descriptor.values.includes(value))fail('invalid-attribute');break;
    case 'list':
      if(!Array.isArray(value)||value.length>descriptor.maxItems)fail('invalid-attribute');
      for(const item of value)attrValue(item,descriptor.item,depth+1);break;
    case 'object':
      if(!isRecord(value)||Object.keys(value).some(key=>!Object.hasOwn(descriptor.fields,key)))fail('invalid-attribute');
      for(const [key,field] of Object.entries(descriptor.fields))attrValue(value[key],field,depth+1);break;
    case 'nullable':if(value!==null)attrValue(value,descriptor.value,depth+1);break;
    default:fail('invalid-attribute-schema');
  }
}
function admit(profile, sample, options={}) {
  const original=clone(sample);
  let nodes=0;
  const attrs=(value={},schema={})=> {
    if(!isRecord(schema))fail('invalid-attribute-schema');
    for(const descriptor of Object.values(schema))assertAttrSchema(descriptor);
    if(!isRecord(value)||Object.keys(value).some(k=>!Object.hasOwn(schema,k)))fail('invalid-attribute');
    for(const [key,descriptor] of Object.entries(schema))attrValue(value[key],descriptor);
    if(Buffer.byteLength(JSON.stringify(value))>(options.maxAttrBytes??profile.limits?.maxAttrBytes??256))fail('attribute-bytes-exceeded');
  };
  const visit=(node,depth=0)=> {
    if(++nodes>(options.maxNodes??100)||depth>(options.maxDepth??16))fail('resource-limit-exceeded');
    if(!isRecord(node))fail('invalid-node');
    if(!Object.hasOwn(profile.types,node.type))fail('unknown-node');
    const type=profile.types[node.type];
    if(!profile.renderers.includes(node.type))fail('renderer-missing');
    attrs(node.attrs,type.attrs);
    if(type.kind==='text') {
      if(typeof node.text!=='string'||!node.text||!node.text.isWellFormed())fail('invalid-text');
      for(const mark of node.marks??[]) {
        if(!Object.hasOwn(profile.marks,mark.type)||!type.marks.includes(mark.type))fail('unknown-mark');
        attrs(mark.attrs,profile.marks[mark.type]);
      }
    } else {
      if(!Array.isArray(node.content)||node.content.length<type.min||node.content.length>type.max)fail('invalid-child');
      for(const child of node.content) {
        if(!type.children.includes(child.type))fail('invalid-child');
        visit(child,depth+1);
      }
    }
  };
  let result='admitted';
  try {
    if(Object.hasOwn(options,'requestedRegistryVersion')&&options.requestedRegistryVersion!==profiles.registryVersion)fail('registry-version-unsupported');
    if(Object.hasOwn(options,'requestedProfile')&&options.requestedProfile!==profile.id)fail('profile-unsupported');
    if(Object.hasOwn(options,'requestedVersion')&&options.requestedVersion!==profile.version)fail('version-unsupported');
    if(Object.hasOwn(options,'requestedCodec')&&options.requestedCodec!==profile.codec)fail('codec-unsupported');
    if(Object.hasOwn(options,'requestedWireVersion')&&options.requestedWireVersion!==profile.wireVersion)fail('wire-version-unsupported');
    if(![profile.id,profile.codec,...profile.extensionIds].every(validId))fail('invalid-id');
    if(new Set(profile.extensionIds).size!==profile.extensionIds.length)fail('duplicate-id');
    for(const requested of options.requestedExtensions??[]) {
      if(!Object.hasOwn(profile.extensionVersions,requested.id))fail('extension-unsupported');
      if(profile.extensionVersions[requested.id]!==requested.version)fail('extension-version-unsupported');
    }
    visit(sample);
  } catch(e) {result=e.message;}
  assert.deepEqual(sample,original,'admission/refusal must preserve input');
  return result;
}
for(const p of profiles.profiles) equal(admit(p,p.sample),p.expected,p.id);
for(const v of profiles.additionalPositive??[]) equal(admit(profiles.profiles[v.profile],v.sample,v),v.expected,v.id);
for(const v of profiles.negative) {
  const p=structuredClone(profiles.profiles[v.profile]);
  if(v.omitRenderer) p.renderers=p.renderers.filter(x=>x!==v.omitRenderer);
  if(v.duplicateExtension) p.extensionIds.push(p.extensionIds[0]);
  if(v.overrideCalloutKindDescriptor)p.types.callout.attrs.kind=v.overrideCalloutKindDescriptor;
  equal(admit(p,v.sample??p.sample,v),v.expected,v.id);
}
function order(extensions) {
  const out=[], remaining=new Map(extensions.map(x=>[x.id,x]));
  if(remaining.size!==extensions.length)fail('duplicate-id');
  if(!extensions.every(x=>validId(x.id)))fail('invalid-id');
  for(const e of extensions) if(e.depends.some(x=>!remaining.has(x))) fail('dependency-missing');
  while(remaining.size) {
    const next=[...remaining.values()].filter(x=>x.depends.every(d=>out.includes(d))).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)[0];
    if(!next) fail('dependency-cycle');
    out.push(next.id);remaining.delete(next.id);
  }
  return out;
}
for(const v of profiles.dependencyVectors) {
  if(v.expectedRefusal) { assert.throws(()=>order(v.extensions),new RegExp(v.expectedRefusal));checks++; }
  else equal(order(v.extensions),v.expectedOrder,'dependency order');
}
const hashes={};
for(const file of ['evidence/osr-57/profile-vectors.json','evidence/osr-59/position-vectors.json','evidence/osr-59/operation-vectors.json','scripts/check-m0-contracts.mjs']) {
  hashes[file]=createHash('sha256').update(await readFile(new URL(`../${file}`,import.meta.url))).digest('hex');
}
console.log(JSON.stringify({checks,failures:0,transactionResults,operationRefusals:operationVectors.refusals.length,profileCases:profiles.profiles.length+profiles.negative.length+(profiles.additionalPositive?.length??0),dependencyCases:profiles.dependencyVectors.length,lifecycleReplyCases:operationVectors.lifecycleReplies.length,node:process.version,icu:process.versions.icu,unicode:process.versions.unicode,hashes,
  limitation:'M0 executable reference/vectors only. No production Rust, codec, DOM mapping, native/WASM parity or bidi-layout acceptance.'},null,2));
