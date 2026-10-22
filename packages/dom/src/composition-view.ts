// SPDX-License-Identifier: MIT OR Apache-2.0
// Bounded DOM correspondence only. Native ranges, edit validity and history stay Rust-owned.
import type { DeepReadonly, NodeViewDto, PositionDto, SelectionDto, StampDto } from '@klenwriter/editor-sdk';
import type { DomRefusal, RecoveryRegion } from './types.js';
import { domRefusal, isDomRefusal } from './refusal.js';
import type { LiteralCompositionSource } from './composition-literal.js';
import type { MarkDto } from '@klenwriter/editor-sdk';

export interface CompositionPoint { readonly node: Node; readonly offset: number }
export interface CompositionEntry {
  readonly id: string;
  readonly view: DeepReadonly<NodeViewDto>;
  readonly element: HTMLElement;
  readonly content: HTMLElement;
  readonly originalText: string;
}
export interface CompositionWindow {
  readonly stamp: DeepReadonly<StampDto>;
  readonly selection: DeepReadonly<SelectionDto>;
  readonly entries: readonly CompositionEntry[];
  readonly parent: HTMLElement;
  readonly before: ChildNode | null;
  readonly after: ChildNode | null;
  readonly anchor: CompositionPoint;
  readonly focus: CompositionPoint;
  readonly selectedAtomIds: readonly string[];
  readonly affectedNodeIds: readonly string[];
  readonly originalRegion: RecoveryRegion;
}
export interface CompositionObservation {
  readonly region: RecoveryRegion;
  readonly unchanged: boolean;
  readonly replacement: string;
  readonly fingerprint: string;
}
export interface CompositionRow {
  readonly view: DeepReadonly<NodeViewDto>;
  readonly outer: HTMLElement;
  readonly content: HTMLElement;
  readonly text: Text | null;
  readonly placeholder: HTMLBRElement | null;
}
export interface CompositionAccess {
  readonly host: HTMLElement;
  readonly limits: Readonly<{blocks: number; nodes: number; depth: number; utf16: number}>;
  readonly row: (id: string) => CompositionRow | undefined;
  readonly ownedId: (node: Node) => string | undefined;
  readonly placeholder: (node: Node) => boolean;
  readonly point: (position: DeepReadonly<PositionDto>) => CompositionPoint | DomRefusal;
  readonly selection: () => DeepReadonly<SelectionDto> | DomRefusal | null;
  readonly generation: () => object;
}
interface Budget { nodes: number; units: number; metadata: number }
type Attributes = readonly (readonly [string,string])[];
interface RecordNode {
  readonly node: Node;
  readonly type: number;
  readonly tag: string | null;
  readonly attributes: Attributes;
  readonly children: readonly Node[];
  readonly data: string | null;
  readonly start: number;
  readonly end: number;
  readonly chain: readonly Element[];
  readonly atom: boolean;
  readonly transparentTextRow: boolean;
}
interface Segment {
  readonly kind: 'text' | 'break' | 'atom';
  readonly node: Node;
  readonly data: string;
  readonly start: number;
  readonly end: number;
  readonly chain: readonly Element[];
  readonly style: string;
}
interface Scan { readonly records: readonly RecordNode[]; readonly segments: readonly Segment[]; readonly text: string; readonly units: number }
interface Chunk { readonly kind: Segment['kind']; readonly node: Node; readonly data: string; readonly chain: readonly Element[]; readonly style: string; readonly boundary: boolean }
interface Sentinel { readonly node: ChildNode; readonly previous: ChildNode | null; readonly next: ChildNode | null; readonly scan: Scan }
interface WindowState {
  readonly generation: object;
  readonly scans: readonly Scan[];
  readonly originals: ReadonlyMap<Node,RecordNode>;
  readonly outside: readonly Sentinel[];
  readonly ancestors: readonly {row: CompositionRow; parent: Node | null; attributes: Attributes}[];
  readonly prefix: readonly Chunk[];
  readonly suffix: readonly Chunk[];
  readonly prefixUnits: number;
  readonly suffixUnits: number;
  readonly left: CompositionPoint;
  readonly right: CompositionPoint;
  readonly originalSelected: string;
  readonly mutableText: ReadonlySet<Node>;
  readonly untouchedEmpty: readonly RecordNode[];
  readonly selectedAtoms: readonly Node[];
}
const samePosition = (a: DeepReadonly<PositionDto>,b: DeepReadonly<PositionDto>): boolean => a.kind===b.kind && (a.kind==='text'&&b.kind==='text'
  ? a.node===b.node&&a.offset===b.offset&&a.affinity===b.affinity : a.kind==='child'&&b.kind==='child'
    ? a.parent===b.parent&&a.index===b.index&&a.affinity===b.affinity : a.kind==='edge'&&b.kind==='edge'&&a.node===b.node&&a.side===b.side);
const sameSelection = (a: DeepReadonly<SelectionDto>,b: DeepReadonly<SelectionDto>) => samePosition(a.anchor,b.anchor)&&samePosition(a.focus,b.focus);
const attrsEqual = (element: Element,expected: Attributes): boolean => element.attributes.length===expected.length
  && expected.every(([name,value])=>element.getAttribute(name)===value);
const presentationAttributes = (attributes: Attributes) => attributes.filter(([name])=>name!=='id'&&name!=='data-editor-node');

/** Each returned window is registered privately; copied fields cannot authorize restoration. */
export function createCompositionCorrespondence(access: CompositionAccess) {
  const windows = new WeakMap<CompositionWindow,WindowState>(), ids = new WeakMap<Node,number>();
  const doc=access.host.ownerDocument;let nextId=0;
  const failure=(code: 'dom.composition_limit'|'dom.composition_stale'|'dom.composition_ambiguous',stamp:DeepReadonly<StampDto>|null,node:string|null=null) => domRefusal(code,'composition',stamp,node);
  function identity(node: Node): number {
    let id=ids.get(node);
    if(id===undefined){if(!Number.isSafeInteger(nextId+1))throw new Error('composition identity limit');id=++nextId;ids.set(node,id);}
    return id;
  }
  function attributes(node: Element,budget: Budget): Attributes | null {
    // Renderer-owned authored elements have a closed small attribute policy.
    // Unknown additions fail before copying their possibly unbounded values.
    if(node.attributes.length>32)return null;
    const result: [string,string][]=[];
    for(let i=0;i<node.attributes.length;i++){
      const attr=node.attributes[i];
      if(attr.name.length+attr.value.length>access.limits.utf16-budget.metadata)return null;
      budget.metadata+=attr.name.length+attr.value.length;result.push([attr.name,attr.value]);
    }
    result.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);return Object.freeze(result.map(value=>Object.freeze(value)));
  }
  function style(chain: readonly Element[],originals?: ReadonlyMap<Node,RecordNode>): string {
    return JSON.stringify(chain.flatMap(node=>{
      const original=originals?.get(node);
      const pairs=presentationAttributes(original?.attributes ?? []);
      // A UA paragraph merge can unwrap an unmarked text row entirely. Such a
      // transparent SPAN carries no presentation or native mark authority.
      // Authored mark tags/classes/attrs still participate in correspondence;
      // scan() separately rejects every fresh wrapper with attributes.
      return node.tagName==='SPAN'&&pairs.length===0&&(!original||original.transparentTextRow) ? [] : [[node.tagName,pairs]];
    }));
  }
  function scan(root: Node,budget: Budget,originals?: ReadonlyMap<Node,RecordNode>,baseline=false): Scan | null {
    const records: RecordNode[]=[],segments: Segment[]=[],pieces:string[]=[];
    const stack:{node:Node;depth:number;chain:readonly Element[];opaque?:boolean;exit?:boolean;record?:RecordNode}[]=[{node:root,depth:0,chain:[]}];
    let units=0,pending=1;
    while(stack.length){
      const item=stack.pop()!;
      if(item.exit){(item.record as {end:number}).end=units;continue;}
      pending--;
      if(++budget.nodes>access.limits.nodes||item.depth>access.limits.depth)return null;
      const {node}=item,start=units;
      if(node.nodeType!==1&&node.nodeType!==3)return null;
      const original=originals?.get(node);
      const id=access.ownedId(node),row=id?access.row(id):undefined;
      const atom=original?.atom ?? (row?.outer===node&&(row.view.primitive==='block_atom'||row.view.primitive==='inline_atom'));
      let attrs:Attributes=Object.freeze([]),tag:string|null=null;
      if(node.nodeType===1){
        const element=node as Element;tag=element.tagName;
        if(original){if(original.tag!==tag||!attrsEqual(element,original.attributes))return null;attrs=original.attributes;}
        else {
          if(baseline){
            if(!access.ownedId(node)&&!access.placeholder(node))return null;
            const value=attributes(element,budget);if(!value)return null;attrs=value;
          } else {
            // A fresh transparent UA wrapper can carry input, never a copied
            // identity, mark, authored attribute, BR, atom or block semantics.
            if(tag!=='SPAN'||element.attributes.length!==0)return null;
          }
        }
      }
      const children=node.childNodes;
      if(tag==='BR'&&children.length!==0)return null;
      if(children.length>access.limits.nodes-budget.nodes-pending)return null;
      const childRefs:Node[]=[];for(let i=0;i<children.length;i++)childRefs.push(children[i]);
      const data=node.nodeType===3?(node as Text).data:null;
      if(data!==null){
        if(data.length>access.limits.utf16-budget.units)return null;
        if(item.opaque){if(!baseline&&(!original||original.data!==data))return null;}
        else if(baseline&&(!row||row.text!==node||row.view.text!==data))return null;
        budget.units+=data.length;
        if(!item.opaque){units+=data.length;pieces.push(data);segments.push({kind:'text',node,data,start,end:units,chain:item.chain,style:style(item.chain,originals)});}
      } else if(tag==='BR'){
        if(!access.placeholder(node)){
          if(++budget.units>access.limits.utf16)return null;
          units++;pieces.push('\n');segments.push({kind:'break',node,data:'\n',start,end:units,chain:item.chain,style:style(item.chain,originals)});
        }
      } else {
        if(atom){
          // Renderer labels are bounded presentation, never replacement input.
          if(childRefs.some(child=>child.nodeType!==3))return null;
          segments.push({kind:'atom',node,data:'',start,end:start,chain:item.chain,style:style(item.chain,originals)});
        }
      }
      const transparentTextRow=original?.transparentTextRow??(baseline&&tag==='SPAN'&&row?.outer===node&&row.view.primitive==='text'&&presentationAttributes(attrs).length===0);
      const record:RecordNode={node,type:node.nodeType,tag,attributes:attrs,children:Object.freeze(childRefs),data,start,end:units,chain:item.chain,atom:!!atom,transparentTextRow};records.push(record);
      if(node.nodeType===1&&tag!=='BR'){
        stack.push({node,depth:item.depth,chain:item.chain,exit:true,record});
        const chain=node===root?item.chain:Object.freeze([...item.chain,node as Element]);
        pending+=children.length;
        for(let i=children.length-1;i>=0;i--)stack.push({node:children[i],depth:item.depth+1,chain,opaque:item.opaque||!!atom});
      }
    }
    return {records:Object.freeze(records),segments:Object.freeze(segments),text:pieces.join(''),units};
  }
  function offset(scanValue:Scan,point:CompositionPoint): number|null {
    const record=scanValue.records.find(value=>value.node===point.node);if(!record)return null;
    if(point.node.nodeType===3)return Number.isSafeInteger(point.offset)&&point.offset>=0&&point.offset<=(record.data?.length??0)?record.start+point.offset:null;
    if(!Number.isSafeInteger(point.offset)||point.offset<0||point.offset>record.children.length)return null;
    if(point.offset===0)return record.start;
    if(point.offset===record.children.length)return record.end;
    return scanValue.records.find(value=>value.node===record.children[point.offset])?.start??null;
  }
  function chunks(scanValue:Scan,from:number,to:number,boundaries:ReadonlySet<Node>,excludedAtoms?:ReadonlySet<Node>): readonly Chunk[] {
    const result:Chunk[]=[];
    for(const segment of scanValue.segments){
      if(segment.kind==='atom'){if(!excludedAtoms?.has(segment.node)&&segment.start>=from&&segment.start<to)result.push({...segment,boundary:false});continue;}
      const a=Math.max(from,segment.start),b=Math.min(to,segment.end);if(a>=b)continue;
      result.push({kind:segment.kind,node:segment.node,data:segment.data.slice(a-segment.start,b-segment.start),chain:segment.chain,style:segment.style,boundary:boundaries.has(segment.node)});
    }
    return result;
  }
  function matchesChunks(actual:readonly Chunk[],expected:readonly Chunk[],relaxBoundaryObjects:boolean): boolean {
    let ai=0,ao=0;
    for(const expectedChunk of expected){
      let eo=0;
      while(eo<expectedChunk.data.length||expectedChunk.kind==='atom'&&eo===0){
        const current=actual[ai];if(!current||current.kind!==expectedChunk.kind||current.style!==expectedChunk.style)return false;
        if(!expectedChunk.boundary||!relaxBoundaryObjects){
          if(!expectedChunk.boundary&&current.node!==expectedChunk.node)return false;
          if(current.chain.length!==expectedChunk.chain.length||current.chain.some((node,i)=>node!==expectedChunk.chain[i]))return false;
        }
        if(expectedChunk.kind==='atom'){if(current.node!==expectedChunk.node)return false;ai++;eo=1;break;}
        const count=Math.min(current.data.length-ao,expectedChunk.data.length-eo);if(count<=0)return false;
        if(current.data.slice(ao,ao+count)!==expectedChunk.data.slice(eo,eo+count))return false;
        ao+=count;eo+=count;if(ao===current.data.length){ai++;ao=0;}
      }
    }
    return ai===actual.length&&ao===0;
  }
  function completeOriginal(current:readonly Scan[],state:WindowState):boolean {
    if(current.length!==state.scans.length)return false;
    for(let i=0;i<current.length;i++){
      const a=current[i].records,b=state.scans[i].records;if(a.length!==b.length)return false;
      for(let j=0;j<a.length;j++){
        if(a[j].type!==b[j].type||a[j].tag!==b[j].tag||a[j].data!==b[j].data||a[j].children.length!==b[j].children.length)return false;
        if(a[j].type===1&&a[j].node!==b[j].node)return false;
        if(a[j].type===3&&!state.mutableText.has(b[j].node)&&a[j].node!==b[j].node)return false;
      }
    }
    return true;
  }
  function sameOutside(sentinel:Sentinel,budget:Budget):boolean {
    const {node}=sentinel;
    // The edge adjoining the composing window may lose selected members. The
    // edge facing away from it is checked separately by the caller.
    for(const record of sentinel.scan.records){
      if(++budget.nodes>access.limits.nodes)return false;
      if(record.node.nodeType===1&&!attrsEqual(record.node as Element,record.attributes))return false;
      if(record.node.nodeType===3){const data=(record.node as Text).data;if(data.length>access.limits.utf16-budget.units||data!==record.data)return false;budget.units+=data.length;}
      if(record.node.childNodes.length!==record.children.length||record.children.some((child,i)=>record.node.childNodes[i]!==child))return false;
    }
    return node.isConnected===access.host.isConnected;
  }
  function outside(window:CompositionWindow,state:WindowState,budget:Budget,recoveryOnly=false):DomRefusal|null {
    const parent=window.parent;
    if(window.before&&window.before.parentNode!==parent||window.after&&window.after.parentNode!==parent)return failure('dom.composition_stale',window.stamp);
    for(const ancestor of state.ancestors){if(++budget.nodes>access.limits.nodes)return failure('dom.composition_limit',window.stamp);if(ancestor.row.outer.parentNode!==ancestor.parent||!recoveryOnly&&ancestor.row.outer!==access.host&&!attrsEqual(ancestor.row.outer,ancestor.attributes))return failure('dom.composition_stale',window.stamp);}
    if(!recoveryOnly)for(const sentinel of state.outside){if(sentinel.node.parentNode!==parent||sentinel.node===window.before&&sentinel.node.previousSibling!==sentinel.previous||sentinel.node===window.after&&sentinel.node.nextSibling!==sentinel.next||!sameOutside(sentinel,budget))return failure('dom.composition_stale',window.stamp);}
    return null;
  }
  function begin(stamp:DeepReadonly<StampDto>,selection:DeepReadonly<SelectionDto>):CompositionWindow|DomRefusal {
    try {
      const actual=access.selection();if(!actual||isDomRefusal(actual)||!sameSelection(actual,selection))return failure('dom.composition_stale',stamp);
      const a=access.point(selection.anchor),f=access.point(selection.focus);if(isDomRefusal(a))return a;if(isDomRefusal(f))return f;
      const browser=doc.getSelection();if(!browser?.anchorNode||!browser.focusNode)return failure('dom.composition_stale',stamp);
      const anchor=Object.freeze({node:browser.anchorNode,offset:browser.anchorOffset}),focus=Object.freeze({node:browser.focusNode,offset:browser.focusOffset});
      const ordered=doc.createRange();ordered.setStart(anchor.node,anchor.offset);ordered.collapse(true);
      const focusRange=doc.createRange();focusRange.setStart(focus.node,focus.offset);focusRange.collapse(true);
      const reverse=ordered.compareBoundaryPoints(0,focusRange)>0;ordered.detach();focusRange.detach();
      const left=reverse?focus:anchor,right=reverse?anchor:focus;
      const block=(point:CompositionPoint):CompositionRow|undefined=>{
        let node:Node|null=point.node,steps=0;
        while(node&&steps++<=access.limits.depth){const id=access.ownedId(node),row=id?access.row(id):undefined;if(row?.view.primitive==='text_block')return row;if(node===access.host)break;node=node.parentNode;}
        return undefined;
      };
      const l=block(left),r=block(right);if(!l||!r||l.view.parent===null||l.view.parent!==r.view.parent)return failure('dom.composition_ambiguous',stamp);
      const parent=access.row(l.view.parent);if(!parent||l.outer.parentNode!==parent.content||r.outer.parentNode!==parent.content)return failure('dom.composition_stale',stamp);
      const li=parent.view.children.indexOf(l.view.id),ri=parent.view.children.indexOf(r.view.id);
      if(li<0||ri<li)return failure('dom.composition_stale',stamp);
      if(ri-li+1>access.limits.blocks)return failure('dom.composition_limit',stamp);
      if(l!==r&&(l.outer.tagName!=='P'||r.outer.tagName!=='P'||l.view.type_id!==r.view.type_id||JSON.stringify(l.view.attributes)!==JSON.stringify(r.view.attributes)))return failure('dom.composition_ambiguous',stamp);
      const entries:CompositionEntry[]=[],scans:Scan[]=[],originals=new Map<Node,RecordNode>(),atoms:string[]=[];
      const budget:Budget={nodes:0,units:0,metadata:0};
      for(let index=li;index<=ri;index++){
        const id=parent.view.children[index],row=access.row(id);if(!row||row.outer.parentNode!==parent.content||parent.content.childNodes[index]!==row.outer)return failure('dom.composition_stale',stamp,id);
        if(index>li&&index<ri&&!(row.view.primitive==='text_block'&&row.outer.tagName==='P'||row.view.primitive==='block_atom'&&row.outer.tagName==='HR'&&row.view.children.length===0))return failure('dom.composition_ambiguous',stamp,id);
        if(index>li&&++budget.units>access.limits.utf16)return failure('dom.composition_limit',stamp,id);
        const value=scan(row.outer,budget,undefined,true);if(!value)return failure('dom.composition_limit',stamp,id);
        entries.push(Object.freeze({id,view:row.view,element:row.outer,content:row.content,originalText:value.text}));scans.push(value);for(const record of value.records)originals.set(record.node,record);
        if(row.view.primitive==='block_atom')atoms.push(id);
      }
      // Resolve presentation signatures from captured metadata, never from
      // copied ID attributes or a model ID guessed from a new DOM object.
      for(const value of scans)for(const segment of value.segments)(segment as {style:string}).style=style(segment.chain,originals);
      const start=offset(scans[0],left),end=offset(scans[scans.length-1],right);if(start===null||end===null||l===r&&start>end)return failure('dom.composition_stale',stamp);
      const boundaryNodes=new Set([left.node,right.node]);
      const mutableText=new Set<Node>();
      for(let index=0;index<scans.length;index++)for(const segment of scans[index].segments){
        const from=index===0?start:0,to=index===scans.length-1?end:scans[index].units;
        if(segment.kind==='text'&&(boundaryNodes.has(segment.node)||segment.start<to&&segment.end>from))mutableText.add(segment.node);
      }
      const selectedAtoms=new Set<Node>(),selectedRange=doc.createRange();selectedRange.setStart(left.node,left.offset);selectedRange.setEnd(right.node,right.offset);
      try {
        for(const value of scans)for(const segment of value.segments)if(segment.kind==='atom'){
          const atomRange=doc.createRange();atomRange.selectNode(segment.node);
          const contained=!selectedRange.collapsed&&atomRange.compareBoundaryPoints(0,selectedRange)>=0&&atomRange.compareBoundaryPoints(2,selectedRange)<=0;
          const partial=!contained&&selectedRange.intersectsNode(segment.node);atomRange.detach();
          if(partial)return failure('dom.composition_ambiguous',stamp);
          const id=access.ownedId(segment.node);if(contained){selectedAtoms.add(segment.node);if(id&&!atoms.includes(id))atoms.push(id);}
        }
      } finally {selectedRange.detach();}
      const prefix=chunks(scans[0],0,start,boundaryNodes,selectedAtoms),suffix=chunks(scans[scans.length-1],end,scans[scans.length-1].units,boundaryNodes,selectedAtoms);
      const untouchedEmpty:RecordNode[]=[];
      for(let index=0;index<scans.length;index++)for(const record of scans[index].records){
        if(record.node===entries[index].element||boundaryNodes.has(record.node)||record.start!==record.end||selectedAtoms.has(record.node)||record.chain.some(node=>selectedAtoms.has(node)))continue;
        if(index===0&&record.end<=start||index===scans.length-1&&record.start>=end)untouchedEmpty.push(record);
      }
      const outside:Sentinel[]=[];
      const before=l.outer.previousSibling,after=r.outer.nextSibling;
      for(const node of [before,after])if(node){const value=scan(node,budget,undefined,true);if(!value)return failure('dom.composition_limit',stamp);outside.push({node,previous:node.previousSibling,next:node.nextSibling,scan:value});}
      const ancestors:WindowState['ancestors'][number][]=[];let ancestor:CompositionRow|undefined=parent;
      while(ancestor){
        if(++budget.nodes>access.limits.nodes||ancestors.length>=access.limits.depth)return failure('dom.composition_limit',stamp);
        const attrs=ancestor.outer===access.host?Object.freeze([]):attributes(ancestor.outer,budget);if(attrs===null)return failure('dom.composition_limit',stamp);
        ancestors.push({row:ancestor,parent:ancestor.outer.parentNode,attributes:attrs});ancestor=ancestor.view.parent===null?undefined:access.row(ancestor.view.parent);
      }
      const affected=Object.freeze(entries.map(value=>value.id)),originalText=scans.map(value=>value.text).join('\n');
      const region:RecoveryRegion=Object.freeze({kind:'bounded',stamp,originalText,provisionalText:originalText,affectedNodeIds:affected});
      const window:CompositionWindow=Object.freeze({stamp,selection,entries:Object.freeze(entries),parent:parent.content,before,after,anchor,focus,selectedAtomIds:Object.freeze(atoms),affectedNodeIds:affected,originalRegion:region});
      const selected=l===r?scans[0].text.slice(start,end):scans[0].text.slice(start)+'\n'+scans.slice(1,-1).map(value=>value.text).join('\n')+scans[scans.length-1].text.slice(0,end);
      windows.set(window,{generation:access.generation(),scans:Object.freeze(scans),originals,outside:Object.freeze(outside),ancestors:Object.freeze(ancestors),prefix,suffix,prefixUnits:start,suffixUnits:scans[scans.length-1].units-end,left,right,originalSelected:selected,mutableText,untouchedEmpty:Object.freeze(untouchedEmpty),selectedAtoms:Object.freeze([...selectedAtoms])});
      return window;
    } catch {return failure('dom.composition_limit',stamp);}
  }
  function observe(window:CompositionWindow,recoveryOnly=false):CompositionObservation|DomRefusal {
    const state=windows.get(window);if(!state||state.generation!==access.generation())return failure('dom.composition_stale',window.stamp);
    try {
      const budget:Budget={nodes:0,units:0,metadata:0},parent=window.parent;
      const outsideFailure=outside(window,state,budget,recoveryOnly);if(outsideFailure)return outsideFailure;
      const actual:Node[]=[];let node:ChildNode|null=window.before?window.before.nextSibling:parent.firstChild;
      while(node!==window.after){if(!node||actual.length>=access.limits.blocks)return failure('dom.composition_limit',window.stamp);actual.push(node);node=node.nextSibling;}
      if(!actual.length||actual[0]!==window.entries[0].element)return failure('dom.composition_ambiguous',window.stamp);
      const scans:Scan[]=[];
      for(let i=0;i<actual.length;i++){
        if(i&&++budget.units>access.limits.utf16)return failure('dom.composition_limit',window.stamp);
        const value=scan(actual[i],budget,state.originals);if(!value)return failure('dom.composition_limit',window.stamp);scans.push(value);
      }
      const originalShape=actual.length===window.entries.length&&actual.every((value,i)=>value===window.entries[i].element);
      const unchanged=originalShape&&completeOriginal(scans,state);
      const combined=scans.map(value=>value.text).join('\n');
      const region:RecoveryRegion=Object.freeze({kind:'bounded',stamp:window.stamp,originalText:window.originalRegion.kind==='bounded'?window.originalRegion.originalText:'',provisionalText:combined,affectedNodeIds:window.affectedNodeIds});
      if(!unchanged&&actual.length!==1)return failure('dom.composition_ambiguous',window.stamp);
      if(!unchanged&&window.entries.slice(1).some(value=>access.host.contains(value.element)))return failure('dom.composition_ambiguous',window.stamp);
      if(!unchanged&&state.selectedAtoms.some(value=>access.host.contains(value))&&(!recoveryOnly||window.entries.length>1))return failure('dom.composition_ambiguous',window.stamp);
      const current=scans[0];
      if(!unchanged&&!recoveryOnly){
        if(current.units<state.prefixUnits+state.suffixUnits)return failure('dom.composition_ambiguous',window.stamp);
        const boundary=new Set([state.left.node,state.right.node]);
        const prefix=chunks(current,0,state.prefixUnits,boundary),suffix=chunks(current,current.units-state.suffixUnits,current.units,boundary);
        if(!matchesChunks(prefix,state.prefix,false)||!matchesChunks(suffix,state.suffix,window.entries.length>1))return failure('dom.composition_ambiguous',window.stamp);
        const replacement=chunks(current,state.prefixUnits,current.units-state.suffixUnits,boundary);
        if(replacement.some(value=>value.kind!=='text'))return failure('dom.composition_ambiguous',window.stamp);
        const actualRecords=new Map(current.records.map(record=>[record.node,record]));
        for(const expected of state.untouchedEmpty){const actualRecord=actualRecords.get(expected.node);if(!actualRecord||actualRecord.data!==expected.data||actualRecord.chain.length!==expected.chain.length||actualRecord.chain.some((node,index)=>node!==expected.chain[index]))return failure('dom.composition_ambiguous',window.stamp);}
      }
      // Recovery-only reads preserve complete bounded Text diagnostics when a
      // semantic delta cannot be proved. They are never a dispatch observation.
      const fingerprint=recoveryOnly?'':JSON.stringify(scans.map(value=>value.records.map(record=>[identity(record.node),record.type,record.tag,record.attributes,record.data,record.children.map(identity)])));
      return Object.freeze({region,unchanged,replacement:unchanged?state.originalSelected:current.text.slice(state.prefixUnits,current.units-state.suffixUnits),fingerprint});
    } catch{return failure('dom.composition_limit',window.stamp);}
  }
  function literalSource(window:CompositionWindow,text:string,stored_marks:DeepReadonly<readonly MarkDto[]>|null,root:string):LiteralCompositionSource|DomRefusal|null {
    const state=windows.get(window);
    if(!state||state.generation!==access.generation())return failure('dom.composition_stale',window.stamp);
    if(window.entries.length!==1||state.scans.length!==1||state.prefixUnits!==0||state.suffixUnits!==0||window.selectedAtomIds.length||text.length===0)return null;
    const block=window.entries[0].view,selected=window.selection;
    if(block.primitive!=='text_block'||block.children.length!==1||selected.anchor.kind!=='text'||selected.focus.kind!=='text'
      ||selected.anchor.node!==block.children[0]||selected.focus.node!==block.children[0])return null;
    const leaf=access.row(block.children[0])?.view,parent=block.parent?access.row(block.parent)?.view:undefined;
    if(!leaf||!parent||leaf.primitive!=='text'||leaf.text===null||leaf.children.length||leaf.parent!==block.id
      ||!((selected.anchor.offset===0&&selected.focus.offset===leaf.text.length)||(selected.focus.offset===0&&selected.anchor.offset===leaf.text.length)))return null;
    const observed=observe(window);
    if(isDomRefusal(observed))return observed;
    if(observed.region.kind!=='bounded'||observed.region.originalText!==leaf.text||observed.region.provisionalText!==text||observed.replacement!==text)return failure('dom.composition_stale',window.stamp);
    return Object.freeze({stamp:window.stamp,selection:selected,stored_marks,root,text,leaf,block,parent,ancestors:Object.freeze(state.ancestors.map(ancestor=>ancestor.row.view))});
  }
  function literalOutside(window:CompositionWindow):DomRefusal|null {
    const state=windows.get(window);
    if(!state||state.generation!==access.generation())return failure('dom.composition_stale',window.stamp);
    try{return outside(window,state,{nodes:0,units:0,metadata:0});}catch{return failure('dom.composition_limit',window.stamp);}
  }
  return {begin,observe:(window:CompositionWindow)=>observe(window),capture:(window:CompositionWindow)=>observe(window,true),owns:(window:CompositionWindow)=>windows.get(window)?.generation===access.generation(),literalSource,literalOutside};
}
