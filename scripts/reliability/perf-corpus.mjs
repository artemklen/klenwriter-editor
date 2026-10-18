// SPDX-License-Identifier: MIT OR Apache-2.0
// Authored shape generator, not a production codec. Validity is established by
// actual strict admission; rejection fails capture and never silently shrinks it.
import { readFileSync } from 'node:fs';
import { canonical, digest } from './perf-compare.mjs';

const kw = (type, content) => ({ type, content });
const kt = text => ({ type: 'text', text });
const kp = text => kw('paragraph', text ? [kt(text)] : []);
const nn = (type, children = [], text = null, attrs = {}) => ({ type: `org.example.notes/${type}`, attrs, marks: [], text, children });
const np = text => nn('paragraph', text ? [nn('text', [], text)] : []);
export const SHAPES = Object.freeze(['long-leaf', 'many-blocks', 'deep-ancestors', 'lists', 'table', 'near-nodes', 'near-bytes']);
// Primary decision frozen before capacity probes, not candidate-dependent.
export const NOTES_CAPACITY_LADDERS = Object.freeze({
  'long-leaf': [16384,32768,65536,131072,262144,524288,1048576],
  'many-blocks': [128,256,512,1024,2048,4096,8192,10000],
  'deep-ancestors': [4,8,16,24,32,38,45],
  'near-nodes': [1024,2048,4096,8192,16384,32768,65535],
  'near-bytes': [65536,131072,262144,524288,1048576,2097152,4194304,8388608,15720000],
});
export function notesCapacityRow(root, shape, quantity) {
  if(!NOTES_CAPACITY_LADDERS[shape]?.includes(quantity))throw new Error('quantity outside frozen ladder');
  let blocks;
  if(shape==='long-leaf')blocks=[np('x'.repeat(quantity))];
  else if(shape==='many-blocks'||shape==='near-nodes')blocks=[np('x'),...Array.from({length:(shape==='near-nodes'?quantity-2:quantity)-1},()=>np(''))];
  else if(shape==='deep-ancestors'){let node=np('x');for(let i=0;i<quantity;i++)node=nn('callout',[node],null,{kind:'info',title:null});blocks=[node];}
  else {blocks=[];for(let remaining=quantity;remaining>0;remaining-=1048000)blocks.push(np('x'.repeat(Math.min(remaining,1048000))));}
  const document={schema_version:1,root:nn('document',blocks,null,{title:'',tags:[]})};
  let nodes=0,depth=0,first;
  function visit(node,path,d){nodes++;depth=Math.max(depth,d);if(typeof node.text==='string')first??=path;node.children.forEach((child,i)=>visit(child,[...path,i],d+1));}visit(document.root,[0],1);
  const input=canonical(document);
  return {id:`notes/${shape}`,profile:'notes',shape,quantity,supported:true,input,registry:readFileSync(`${root}/examples/notes-extension/d1.json`,'utf8'),root_blocks:['org.example.notes/paragraph','org.example.notes/callout'],first_text_path:first,
    authored_nodes:nodes,authored_depth:depth,canonical_bytes:Buffer.byteLength(input),input_sha256:digest(document),capacity_label:'near-default-admission-capacity; exact semantic maxima retained as independent controls'};
}
export function corpus(root, selectedNotes = null) {
  const registry = readFileSync(`${root}/examples/notes-extension/d1.json`, 'utf8');
  const kwRegistry = canonical({ format: 'editor-registry/1', profile: { id: 'org.klenwriter.kwdj', version: '1.0.0', codec_id: 'org.klenwriter.kwdj/json', wire_version: 1 },
    selected_extensions: [{ id: 'org.klenwriter.kwdj/base', version: '1.0.0' }], mark_policy: {}, extensions: [],
    root: { op: 'repeat', min: 1, max: 50000, item: { op: 'choice', items: ['paragraph', 'heading', 'blockquote', 'bullet_list', 'ordered_list', 'task_list', 'code_block', 'scene_break', 'table', 'media_image', 'literary_block', 'warning', 'spoiler', 'disclosure', 'verse'].map(name => ({ op: 'type', id: `org.klenwriter.kwdj/${name}` })) } } });
  const result = [];
  for (const profile of ['kwdj', 'notes']) for (const shape of SHAPES) {
    if (profile === 'notes' && ['lists', 'table'].includes(shape)) { result.push({ id: `${profile}/${shape}`, profile, shape, supported: false, reason: 'compiled notes profile has no list/table capability' }); continue; }
    let blocks;
    const p = profile === 'kwdj' ? kp : np;
    switch (shape) {
      case 'long-leaf': blocks = [p('x'.repeat(profile === 'kwdj' ? 262144 : 1048576))]; break;
      case 'many-blocks': blocks = [p('x'), ...Array.from({ length: 9999 }, () => p(''))]; break;
      case 'deep-ancestors': {
        let node = p('x');
        // Authored depth30 KWDJ,40 notes; leave room for semantic/synthetic roots.
        for (let i = 0; i < (profile === 'kwdj' ? 28 : 38); i++) node = profile === 'kwdj' ? kw('blockquote', [node]) : nn('callout', [node], null, { kind: 'info', title: null });
        blocks = [node]; break;
      }
      case 'lists': blocks = Array.from({ length: 50 }, () => kw('bullet_list', Array.from({ length: 100 }, () => kw('list_item', [kp('x')])))); break;
      case 'table': blocks = [kw('table', Array.from({ length: 500 }, () => kw('table_row', Array.from({ length: 49 }, () => kw('table_cell', [kp('')])))))]; blocks[0].content[0].content[0].content = [kp('x')]; break;
      case 'near-nodes': blocks = [p('x'), ...Array.from({ length: (profile === 'kwdj' ? 49998 : 65532) }, () => p(''))]; break;
      case 'near-bytes': {
        const leaf = profile === 'kwdj' ? 262000 : 1048000;
        // Seven / fifteen leaves leave explicit envelope headroom below2/16MiB.
        blocks = Array.from({ length: profile === 'kwdj' ? 7 : 15 }, () => p('x'.repeat(leaf))); break;
      }
    }
    const document = profile === 'kwdj' ? { schema: 'klenwriter.document', schema_version: 1, profile: 'prose', content: blocks }
      : { schema_version: 1, root: nn('document', blocks, null, { title: '', tags: [] }) };
    let nodes = 0, maximumDepth = 0, textBytes = 0, firstTextPath;
    function visit(node, path, depth) {
      nodes++; maximumDepth = Math.max(maximumDepth, depth);
      if (typeof node.text === 'string') { textBytes += Buffer.byteLength(node.text); firstTextPath ??= path; }
      for (const [index, child] of (node.content ?? node.children ?? []).entries()) visit(child, [...path, index], depth + 1);
    }
    if (profile === 'kwdj') blocks.forEach((node, index) => visit(node, [index], 1)); else visit(document.root, [0], 1);
    const input = canonical(document);
    result.push({ id: `${profile}/${shape}`, profile, shape, supported: true, input, registry: profile === 'notes' ? registry : kwRegistry, root_blocks: profile === 'notes' ? ['org.example.notes/paragraph', 'org.example.notes/callout'] : [],
      first_text_path: firstTextPath, authored_nodes: nodes, authored_depth: maximumDepth, text_bytes: textBytes, canonical_bytes: Buffer.byteLength(input), input_sha256: digest(document) });
  }
  // Lifecycle/long-session are deliberately small, separate from shape scans.
  for (const profile of ['kwdj', 'notes']) {
    const base = result.find(row => row.id === `${profile}/many-blocks`);
    const document = profile === 'kwdj' ? { schema: 'klenwriter.document', schema_version: 1, profile: 'prose', content: [kp('x')] }
      : { schema_version: 1, root: nn('document', [np('x')], null, { title: '', tags: [] }) };
    const input = canonical(document);
    result.push({ ...base, id: `${profile}/small`, shape: 'small', input, input_sha256: digest(document), authored_nodes: profile === 'kwdj' ? 2 : 3, authored_depth: profile === 'kwdj' ? 2 : 3, text_bytes: 1, canonical_bytes: Buffer.byteLength(input) });
  }
  if(selectedNotes)for(let i=0;i<result.length;i++)if(result[i].profile==='notes'&&result[i].supported&&result[i].shape!=='small'){
    const previous=result[i],selection=selectedNotes[previous.shape];if(!selection)throw new Error('missing reference Notes capacity');
    const row=notesCapacityRow(root,previous.shape,selection.quantity);if(row.input_sha256!==selection.inputSha256)throw new Error('selected Notes input changed');
    result[i]={...row,maximal_control_input_sha256:previous.input_sha256};
  }
  return result;
}
