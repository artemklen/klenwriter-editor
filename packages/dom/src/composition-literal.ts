// SPDX-License-Identifier: MIT OR Apache-2.0
import type {DeepReadonly, EventDto, MarkDto, NodeViewDto, SelectionDto, StampDto, StateDto} from '@klenwriter/editor-sdk';

/** Internal source references captured under the original registered window. */
export interface LiteralCompositionSource {
  readonly stamp:DeepReadonly<StampDto>; readonly selection:DeepReadonly<SelectionDto>;
  readonly stored_marks:DeepReadonly<readonly MarkDto[]>|null; readonly root:string; readonly text:string;
  readonly leaf:DeepReadonly<NodeViewDto>; readonly block:DeepReadonly<NodeViewDto>; readonly parent:DeepReadonly<NodeViewDto>;
  readonly ancestors?:readonly DeepReadonly<NodeViewDto>[];
}
interface LiteralCompositionAfter {
  readonly effect:string; readonly state:DeepReadonly<StateDto>; readonly event:DeepReadonly<EventDto>;
  readonly leaf:DeepReadonly<NodeViewDto>; readonly block:DeepReadonly<NodeViewDto>; readonly parent:DeepReadonly<NodeViewDto>;
  readonly ancestors?:readonly DeepReadonly<NodeViewDto>[];
}
interface Budget {nodes:number;units:number}
const cap={nodes:131072,depth:128,units:2097152};
/** Bound native metadata comparison before traversing/copying its descendants. */
function equal(left:unknown,right:unknown,budget:Budget):boolean {
  const stack:{left:unknown;right:unknown;depth:number}[]=[{left,right,depth:0}];
  while(stack.length){
    const item=stack.pop()!;
    if(++budget.nodes>cap.nodes||item.depth>cap.depth)return false;
    const a=item.left,b=item.right;
    if(typeof a==='string'||typeof b==='string'){
      if(typeof a!=='string'||typeof b!=='string'||a.length>cap.units-budget.units)return false;
      budget.units+=a.length;if(a!==b)return false;continue;
    }
    if(a===null||b===null||typeof a!=='object'||typeof b!=='object'){if(a!==b)return false;continue;}
    if(Array.isArray(a)!==Array.isArray(b))return false;
    // Count own enumerable keys without first allocating unbounded key arrays.
    let rightCount=0;
    for(const key in b)if(Object.hasOwn(b,key)&&++rightCount>cap.nodes-budget.nodes-stack.length)return false;
    let leftCount=0;
    for(const key in a)if(Object.hasOwn(a,key)){
      if(++leftCount>rightCount||key.length>cap.units-budget.units||!Object.hasOwn(b,key))return false;
      budget.units+=key.length;stack.push({left:(a as Record<string,unknown>)[key],right:(b as Record<string,unknown>)[key],depth:item.depth+1});
    }
    if(leftCount!==rightCount)return false;
  }
  return true;
}
function members(actual:readonly string[],expected:readonly string[]):boolean {
  return actual.length===expected.length&&new Set(actual).size===actual.length&&expected.every(id=>actual.includes(id));
}
function header(before:DeepReadonly<NodeViewDto>,after:DeepReadonly<NodeViewDto>,budget:Budget):boolean {
  return before.id===after.id&&before.parent===after.parent&&before.primitive===after.primitive&&before.type_id===after.type_id
    &&before.text===after.text&&equal(before.attributes,after.attributes,budget)&&equal(before.marks,after.marks,budget);
}
export function sameLiteralNode(before:DeepReadonly<NodeViewDto>,after:DeepReadonly<NodeViewDto>):boolean {
  const budget:Budget={nodes:0,units:0};return header(before,after,budget)&&equal(before.children,after.children,budget);
}
export function literalCompositionBytes(source:LiteralCompositionSource):number|null {
  if(source.text.length>cap.units||source.leaf.text===null||source.leaf.text.length>cap.units)return null;
  const budget:Budget={nodes:0,units:0};
  for(const value of [source.leaf,source.block,...(source.ancestors??[source.parent])]){
    const metadata={id:value.id,parent:value.parent,primitive:value.primitive,type_id:value.type_id,attributes:value.attributes,marks:value.marks,children:value.children};
    if(!equal(metadata,metadata,budget))return null;
  }
  if(!equal(source.stored_marks,source.stored_marks,budget))return null;
  return 2*(source.text.length+source.leaf.text.length+budget.units);
}
/** Generic literal publication proof. No profile rules, normalization or ID prediction. */
export function verifyLiteralComposition(source:LiteralCompositionSource,after:LiteralCompositionAfter):boolean {
  try {
    const {state,event,leaf,block,parent}=after,budget:Budget={nodes:0,units:0};
    const ancestors=source.ancestors??[source.parent],currentAncestors=after.ancestors??[parent];
    if(after.effect!=='changed'||event.change.kind!=='document'||source.text.length>cap.units||ancestors.length===0||ancestors.length>cap.depth||ancestors.length!==currentAncestors.length
      ||source.leaf.primitive!=='text'||source.leaf.text===null||source.leaf.children.length!==0||source.block.primitive!=='text_block'
      ||source.block.children.length!==1||source.block.children[0]!==source.leaf.id||source.leaf.parent!==source.block.id
      ||source.block.parent!==source.parent.id||source.parent.id!==ancestors[0].id||state.root!==source.root)return false;
    const a=source.selection.anchor,f=source.selection.focus;
    if(a.kind!=='text'||f.kind!=='text'||a.node!==source.leaf.id||f.node!==source.leaf.id
      ||!((a.offset===0&&f.offset===source.leaf.text.length)||(f.offset===0&&a.offset===source.leaf.text.length)))return false;
    if(!equal(source.stamp,event.before,budget)||!equal(state.stamp,event.after,budget)||!equal(event.selection_before,source.selection,budget)
      ||!equal(event.selection_after,state.selection,budget)||!equal(event.stored_marks_before,source.stored_marks,budget)
      ||!equal(event.stored_marks_after,state.stored_marks,budget)||!equal(source.stored_marks,state.stored_marks,budget)||!equal(event.history,state.history,budget)
      ||state.stamp.session!==source.stamp.session||state.stamp.generation!==source.stamp.generation
      ||BigInt(state.stamp.revision)!==BigInt(source.stamp.revision)+1n||BigInt(state.stamp.selection_epoch)!==BigInt(source.stamp.selection_epoch)+1n
      ||BigInt(state.stamp.history_epoch)!==BigInt(source.stamp.history_epoch)+1n||event.change.from_revision!==source.stamp.revision||event.change.to_revision!==state.stamp.revision)return false;
    if(!equal(source.leaf.stamp,source.stamp,budget)||!equal(source.block.stamp,source.stamp,budget)
      ||!equal(leaf.stamp,state.stamp,budget)||!equal(block.stamp,state.stamp,budget)||!header(source.block,block,budget)
      ||leaf.id===source.leaf.id||leaf.primitive!=='text'||leaf.type_id!==source.leaf.type_id||leaf.parent!==block.id||leaf.children.length!==0
      ||leaf.text!==source.text||!equal(leaf.attributes,source.leaf.attributes,budget)||!equal(leaf.marks,source.stored_marks??source.leaf.marks,budget)
      ||block.children.length!==1||block.children[0]!==leaf.id)return false;
    const selection=state.selection;
    if(!selection||selection.anchor.kind!=='text'||selection.focus.kind!=='text'||selection.anchor.node!==leaf.id||selection.focus.node!==leaf.id
      ||selection.anchor.offset!==source.text.length||selection.focus.offset!==source.text.length||selection.anchor.affinity!=='after'||selection.focus.affinity!=='after')return false;
    for(let i=0;i<ancestors.length;i++){
      const old=ancestors[i],current=currentAncestors[i];
      if(!equal(old.stamp,source.stamp,budget)||!equal(current.stamp,state.stamp,budget)||!header(old,current,budget)||!equal(old.children,current.children,budget)
        ||i===0&&(!equal(parent,current,budget)||!equal(source.parent,old,budget))
        ||i+1<ancestors.length&&old.parent!==ancestors[i+1].id)return false;
    }
    if(ancestors[ancestors.length-1].id!==source.root||ancestors[ancestors.length-1].parent!==null)return false;
    const impact=event.change.impact,ancestorIds=[...ancestors.map(node=>node.id),block.id];
    return !impact.root_order_changed&&members(impact.removed,[source.leaf.id])&&members(impact.upserted,[block.id,leaf.id])
      &&members(impact.ancestors_before,ancestorIds)&&members(impact.ancestors_after,ancestorIds);
  }catch{return false;}
}
