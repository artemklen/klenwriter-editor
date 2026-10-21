// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DeepReadonly, PositionDto, SelectionDto, TextWindowReplyV2 } from '@klenwriter/editor-sdk';
import type { OrdinaryInputObservation } from '@klenwriter/editor-dom';
import type { UiSlashRange } from './types.js';

export const sameData=(a:unknown,b:unknown):boolean=>JSON.stringify(a)===JSON.stringify(b);
export const windowText=(window:DeepReadonly<TextWindowReplyV2>):string=>window.before.map(span=>span.text).join('');

export function collapsed(selection:DeepReadonly<SelectionDto>|null):boolean {
  if(!selection)return false;
  const a=selection.anchor,b=selection.focus;
  if(a.kind!==b.kind)return false;
  if(a.kind==='text'&&b.kind==='text')return a.node===b.node&&a.offset===b.offset;
  if(a.kind==='child'&&b.kind==='child')return a.parent===b.parent&&a.index===b.index;
  return sameData(a,b);
}
function scalarString(value:string):boolean {
  for(let i=0;i<value.length;i++){
    const unit=value.charCodeAt(i);
    if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}
    else if(unit>=0xdc00&&unit<=0xdfff)return false;
  }
  return true;
}

/** Bounded lexical presentation; native query still validates the exact range. */
export function slashRange(window:DeepReadonly<TextWindowReplyV2>):UiSlashRange|null {
  if(!collapsed(window.selection)||window.caret.kind!=='text'||window.before.length>1024)return null;
  const value=windowText(window);
  if(!value.length||value.length>256||!scalarString(value))return null;
  const start=value.lastIndexOf('/');
  if(start<0||start===0&&window.before_stop!=='block'||start>0&&![' ','\t'].includes(value[start-1]!))return null;
  const literal=value.slice(start);
  if(/[ \t\r\n\f\v]/.test(literal))return null;
  let offset=0,anchor:PositionDto|null=null;
  for(const span of window.before){
    if(start<offset+span.text.length){
      anchor={kind:'text',node:span.node,offset:span.from_utf16+start-offset,affinity:'after'};break;
    }
    offset+=span.text.length;
  }
  if(!anchor)return null;
  return Object.freeze({literal,range:Object.freeze({anchor:Object.freeze(anchor),focus:window.caret})});
}

/** Compare two native windows; the InputEvent hint alone confers no authority. */
export function newSlashWitness(event:OrdinaryInputObservation,after:DeepReadonly<TextWindowReplyV2>):boolean {
  const before=event.beforeWindow;
  if(event.inputType!=='insertText'||event.dataHint!=='/'||!before||!collapsed(event.selectionBefore)
    ||!collapsed(event.selectionAfter)||!sameData(before.stamp,event.before)||!sameData(after.stamp,event.after)
    ||!sameData(before.selection,event.selectionBefore)||!sameData(after.selection,event.selectionAfter)
    ||before.block.node!==after.block.node||before.block.type_id!==after.block.type_id
    ||!sameData(before.caret,before.selection.focus)||!sameData(after.caret,after.selection.focus))return false;
  if([...before.before,...after.before].some(span=>span.to_utf16-span.from_utf16!==span.text.length||!scalarString(span.text)))return false;
  const last=after.before.at(-1);
  if(!last||after.caret.kind!=='text'||last.node!==after.caret.node||last.to_utf16!==after.caret.offset||!last.text.endsWith('/'))return false;
  const from=before.caret;
  const empty=from.kind==='child'&&from.parent===before.block.node&&from.index===0
    &&before.before.length===0&&before.after.length===0&&before.before_stop==='block'&&before.after_stop==='block';
  if(!empty){
    if(from.kind!=='text')return false;
    const oldEnd=before.before.at(-1);
    if(oldEnd&&(oldEnd.node!==from.node||oldEnd.to_utf16!==from.offset))return false;
    const slashOffset=last.to_utf16-1;
    // A new marked leaf may follow the preserved prefix, but a repeated string
    // at an unrelated native coordinate is never an insertion witness.
    const previous=after.before.at(-2);
    const sameLeaf=last.node===from.node&&slashOffset===from.offset;
    const splitLeaf=last.text==='/'&&last.from_utf16===0&&!!previous
      &&previous.node===from.node&&previous.to_utf16===from.offset;
    if(!sameLeaf&&!splitLeaf)return false;
  }else if(after.before.length!==1||last.from_utf16!==0||last.to_utf16!==1||last.text!=='/')return false;
  let expected=windowText(before)+'/';
  // This clips only the comparison witness to the native window capacity. The
  // actual slash range above is never truncated into a successful query.
  while(expected.length>256){const unit=expected.charCodeAt(0);expected=expected.slice(unit>=0xd800&&unit<=0xdbff?2:1);}
  if(!scalarString(expected)||windowText(after)!==expected)return false;
  const prefixLength=expected.length-1,beforeLength=windowText(before).length;
  const beforePrefix=sliceSpans(before,beforeLength-prefixLength,beforeLength);
  const afterPrefix=sliceSpans(after,0,prefixLength);
  return sameData(beforePrefix,afterPrefix);
}

function sliceSpans(window:DeepReadonly<TextWindowReplyV2>,from:number,to:number):readonly unknown[] {
  const result=[];let cursor=0;
  for(const span of window.before){
    const a=Math.max(0,from-cursor),b=Math.min(span.text.length,to-cursor);
    if(a<b)result.push({node:span.node,from_utf16:span.from_utf16+a,to_utf16:span.from_utf16+b,text:span.text.slice(a,b)});
    cursor+=span.text.length;
  }
  return result;
}
