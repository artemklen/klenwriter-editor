// SPDX-License-Identifier: MIT OR Apache-2.0
// Bounded lexical/native-window witness functions only. Context/type eligibility,
// origin admission, ready lifecycle and current-token checks belong to the owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { collapsed, slashRange, newSlashWitness } from '../packages/ui/dist/slash-window.js';
const bytes=readFileSync(new URL('../contracts/slash/v1/lexical-key-oracles.json',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../contracts/slash/v1/manifest.json',import.meta.url),'utf8'));
const pinned=manifest.files.find(row=>row.path==='lexical-key-oracles.json');
assert(pinned);assert.equal(createHash('sha256').update(bytes).digest('hex'),pinned.sha256);
const oracle=JSON.parse(bytes);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const copy=value=>structuredClone(value);
const stamp=revision=>({session:'s',generation:'1',revision,selection_epoch:revision,history_epoch:revision});
const textPoint=(node,offset,affinity='after')=>({kind:'text',node,offset,affinity});
const selection=caret=>({anchor:copy(caret),focus:copy(caret)});
const stops={block_start:'block',clipped:'window_limit',hard_break:'hard_break',inline_atom:'inline_atom'};
function window(text,{left='block_start',node='T',from=0,revision='1'}={}){
  const caret=textPoint(node,from+text.length);
  return {kind:'text_window',stamp:stamp(revision),selection:selection(caret),caret,block:{node:'P',type_id:'paragraph',primitive:'text_block'},ancestors:[{node:'ROOT',type_id:'root',primitive:'container'}],
    before:text?[{node,from_utf16:from,to_utf16:from+text.length,text}]:[],after:[],before_stop:stops[left],after_stop:'window_limit'};
}
// LX35/38 declare owner profile eligibility, not a parameter of slashRange.
for(const [id,text,left,outcome,expected]of oracle.lexical.filter(row=>Number(row[0].slice(2))<=34))test(`SL-${id} independent bounded lexical literal and UTF16 range`,()=>{
  const input=freeze(window(text,{left})),before=copy(input),actual=slashRange(input);
  if(outcome==='closed')assert.equal(actual,null);else{
    assert(actual);assert.equal(actual.literal,expected.literal??text.slice(expected.anchor));
    assert.deepEqual(actual.range,{anchor:textPoint('T',expected.range[0]),focus:textPoint('T',expected.range[1])});
  }
  assert.deepEqual(input,before,'Pure presentation cannot mutate native window');
});
const decode=value=>{const [,node,offset,side]=/^(.+)@(\d+)(After|Before)$/.exec(value);return textPoint(node,Number(offset),side.toLowerCase());};
for(const row of oracle.spanMapping)test(`SL-${row.id} exact native span offsets and current caret without normalization`,()=>{
  const spans=row.spans.map(s=>({node:s.role,from_utf16:s.from,to_utf16:s.to,text:s.text}));
  const last=spans.at(-1),caret=row.expected.currentCaret?decode(row.expected.currentCaret):textPoint(last.node,last.to_utf16);
  const input=freeze({...window(row.beforeCaret,{left:row.left}),before:spans,caret,selection:selection(caret)}),before=copy(input),actual=slashRange(input);
  if(typeof row.expected==='string')assert.equal(actual,null);else{
    assert.equal(actual.literal,row.expected.literal);assert.deepEqual(actual.range.anchor,decode(row.expected.range.anchor));
    // The frozen semantic seed has end-Before; its separately frozen currentCaret
    // is After. UI uses the actual native caret, not a fabricated Before endpoint.
    assert.deepEqual(actual.range.focus,decode(row.expected.currentCaret));
    assert.equal(actual.range.focus.affinity,'after');assert.equal(decode(row.expected.range.focus).affinity,'before');
  }
  assert.deepEqual(input,before);
});
test('SL-COLLAPSED both text/child affinities compare coordinates; real noncollapsed/root child gap has no lexical range',()=>{
  const text={anchor:textPoint('T',1,'before'),focus:textPoint('T',1,'after')};assert.equal(collapsed(text),true);
  assert.equal(collapsed({anchor:{kind:'child',parent:'P',index:0,affinity:'before'},focus:{kind:'child',parent:'P',index:0,affinity:'after'}}),true);
  assert.equal(collapsed(null),false);assert.equal(collapsed({...text,focus:textPoint('OTHER',1)}),false);
  const noncollapsed=window('/');noncollapsed.selection.anchor.offset=0;assert.equal(slashRange(noncollapsed),null);
  const gap=window('/');gap.caret={kind:'child',parent:'ROOT',index:0,affinity:'after'};gap.selection=selection(gap.caret);assert.equal(slashRange(gap),null);
});
function witness(){
  const before=window('a ',{revision:'0'}),after=window('a /',{revision:'1'});
  const event={kind:'ordinary_input',inputType:'insertText',isTrusted:false,dataHint:'/',before:copy(before.stamp),after:copy(after.stamp),context:{build_id:'controlled',profile:{profile_id:'generic'},registry_digest:'R',capability_digest:'C'},selectionBefore:copy(before.selection),selectionAfter:copy(after.selection),beforeWindow:before};
  return {event,after};
}
test('SL-W01 single slash requires exact native before/after witnesses; isTrusted false remains observation only',()=>{
  const {event,after}=witness(),before=copy({event,after});freeze(event);freeze(after);
  assert.equal(newSlashWitness(event,after),true);assert.equal(event.isTrusted,false);assert.deepEqual({event,after},before);
});
test('SL-W02 native empty-child caret may become actual new Text in the same block',()=>{
  const {event,after}=witness();const empty=window('',{revision:'0'});empty.after_stop='block';empty.caret={kind:'child',parent:'P',index:0,affinity:'after'};empty.selection=selection(empty.caret);
  event.beforeWindow=empty;event.selectionBefore=copy(empty.selection);const single=window('/',{node:'FRESH',revision:'1'});event.selectionAfter=copy(single.selection);
  assert.equal(newSlashWitness(freeze(event),freeze(single)),true);assert.equal(slashRange(single).literal,'/');
});
test('SL-W03 native clipping preserves scalar boundary in comparison, never certifies lexical eligibility',()=>{
  const before=window('😀'+'a'.repeat(254),{revision:'0'}),after=window('a'.repeat(254)+'/',{revision:'1',from:2,left:'clipped'}),{event}=witness();
  event.beforeWindow=before;event.selectionBefore=before.selection;event.selectionAfter=after.selection;assert.equal(newSlashWitness(freeze(event),freeze(after)),true);assert.equal(slashRange(after),null,'A verified suffix still has no eligible ASCII lexical boundary');
});
test('SL-W04 wrong input hint/type, missing witness, native changed text, stamps, selection or block cannot certify',()=>{
  const variants=[
    x=>x.event.inputType='insertReplacementText',x=>x.event.dataHint='/quote',x=>x.event.dataHint=null,x=>x.event.beforeWindow=null,
    x=>x.after.before[0].text='a x',x=>x.event.before.revision='9',x=>x.event.after.revision='9',
    x=>x.event.selectionBefore.focus.offset=0,x=>x.event.selectionAfter.focus.offset=0,
    x=>x.after.block.node='OTHER',x=>x.after.block.type_id='heading',
  ];
  for(const mutate of variants){const x=witness();mutate(x);assert.equal(newSlashWitness(freeze(x.event),freeze(x.after)),false);}
});
// Source-authored negative correspondence expectations precede any test run.
// Equal lexical bytes at another native coordinate are not the original edit.
test('SL-W05 equal strings cannot replace native caret/span continuity or an empty-block parent witness',()=>{
  const shifted=witness();shifted.after.before[0].from_utf16=97;shifted.after.before[0].to_utf16=100;shifted.after.caret=textPoint('T',100);shifted.after.selection=selection(shifted.after.caret);shifted.event.selectionAfter=copy(shifted.after.selection);
  const renamed=witness();renamed.after.before[0].node='RENAMED';renamed.after.caret=textPoint('RENAMED',3);renamed.after.selection=selection(renamed.after.caret);renamed.event.selectionAfter=copy(renamed.after.selection);
  const wrongCaret=witness();wrongCaret.after.caret=textPoint('T',99);
  const wrongBefore=witness();wrongBefore.event.beforeWindow.caret=textPoint('OTHER',2);
  for(const x of [shifted,renamed,wrongCaret,wrongBefore])assert.equal(newSlashWitness(freeze(x.event),freeze(x.after)),false);
  for(const bad of [{parent:'ROOT',index:0},{parent:'P',index:1}]){
    const {event}=witness(),empty=window('',{revision:'0'});empty.after_stop='block';empty.caret={kind:'child',...bad,affinity:'after'};empty.selection=selection(empty.caret);event.beforeWindow=empty;event.selectionBefore=copy(empty.selection);
    const after=window('/',{node:'FRESH',revision:'1'});event.selectionAfter=copy(after.selection);assert.equal(newSlashWitness(freeze(event),freeze(after)),false);
  }
});
test('SL-W06 collapsed coordinate equality permits both affinities without synthesizing range endpoints',()=>{
  const {event,after}=witness();event.beforeWindow.selection.anchor.affinity='before';event.selectionBefore=copy(event.beforeWindow.selection);after.selection.anchor.affinity='before';event.selectionAfter=copy(after.selection);
  assert.equal(newSlashWitness(freeze(event),freeze(after)),true);assert.deepEqual(slashRange(after).range.focus,after.caret);
});
test('SL-W07 inserted marked Text leaf follows exact preserved prefix endpoint without rewriting native IDs',()=>{
  const {event}=witness(),before=window('a ',{from:5,revision:'0',left:'clipped'}),after=window('/',{node:'NEW',revision:'1'});
  after.before=[copy(before.before[0]),copy(after.before[0])];after.before_stop='window_limit';event.beforeWindow=before;event.selectionBefore=copy(before.selection);event.selectionAfter=copy(after.selection);
  assert.equal(newSlashWitness(freeze(event),freeze(after)),true);assert.deepEqual(slashRange(after),{literal:'/',range:{anchor:textPoint('NEW',0),focus:textPoint('NEW',1)}});
});
