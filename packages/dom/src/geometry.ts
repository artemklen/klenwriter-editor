// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DeepReadonly, Response, SelectionDto, SessionContextV2, StampDto } from '@klenwriter/editor-sdk';
import type { CssRect, DomRefusal, DragGeometryRead, DragGeometryRequest, GeometryRead, GeometryRequest, GeometrySnapshot, MountedGeometry } from './types.js';
import type { DomPoint, DomView, GeometryRow } from './view.js';
import { fields } from './ownership.js';
import { domRefusal, isDomRefusal } from './refusal.js';
import { readDragGeometry } from './drag-geometry.js';

interface Configuration {
  element(): HTMLElement | null;
  view(): DomView | null;
  capture(): DeepReadonly<StampDto> | null;
  context(): DeepReadonly<SessionContextV2> | null;
  readState(): Response;
  guard(): DomRefusal | null;
}
interface Box { readonly left:number; readonly top:number; readonly right:number; readonly bottom:number }
interface Clip { readonly box:Box; readonly chain:readonly Element[] }
const STAMP_KEYS = ['session','generation','revision','selection_epoch','history_epoch'] as const;
const eligible = (row:GeometryRow) => ['text_block','container','block_atom'].includes(row.view.primitive);
const sameStamp = (a:DeepReadonly<StampDto>|null,b:DeepReadonly<StampDto>|null) => !!a && !!b && STAMP_KEYS.every(key=>a[key]===b[key]);
const sameContext = (a:DeepReadonly<SessionContextV2>|null,b:DeepReadonly<SessionContextV2>|null) => !!a && !!b && a.build_id===b.build_id && a.registry_digest===b.registry_digest && a.capability_digest===b.capability_digest && JSON.stringify(a.profile)===JSON.stringify(b.profile);
const unsupported = Symbol('unsupported geometry');
const limited = Symbol('geometry limit');
const cssRect = (box:Box):CssRect => Object.freeze({x:box.left,y:box.top,width:Math.max(0,box.right-box.left),height:Math.max(0,box.bottom-box.top)});
const intersect = (a:Box,b:Box):Box => ({left:Math.max(a.left,b.left),top:Math.max(a.top,b.top),right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)});
const validBox = (box:Box) => [box.left,box.top,box.right,box.bottom,box.right-box.left,box.bottom-box.top].every(Number.isFinite);

/** Closed options copy. Coordinates deliberately permit fractional/negative CSS values. */
function ownRequest(value:GeometryRequest):GeometryRequest {
  const request=fields(value),kind=request.kind;
  const keys=kind==='block'?['kind','stamp','node']:kind==='block_at_point'?['kind','stamp','x','y']:kind==='selection'?['kind','stamp']:null;
  if(!keys || Object.keys(request).length!==keys.length || keys.some(key=>!Object.hasOwn(request,key)))throw unsupported;
  const stamp=fields(request.stamp);
  if(Object.keys(stamp).length!==STAMP_KEYS.length || STAMP_KEYS.some(key=>typeof stamp[key]!=='string'))throw unsupported;
  if(kind==='block' && (typeof request.node!=='string' || request.node.length===0))throw unsupported;
  if(kind==='block_at_point' && (typeof request.x!=='number' || typeof request.y!=='number' || !Number.isFinite(request.x) || !Number.isFinite(request.y)))throw unsupported;
  const ownedStamp=Object.freeze({...stamp}) as unknown as StampDto;
  return Object.freeze({...request,stamp:ownedStamp}) as unknown as GeometryRequest;
}

/** All objects, styles, temporary ranges and counters die at the end of one read. */
class Measurement {
  readonly doc:Document;
  readonly win:Window;
  readonly viewport:Box;
  readonly visited=new Set<Node>();
  readonly ancestors=new Set<Element>();
  readonly rows=new Map<string,GeometryRow>();
  readonly clips=new Map<Node,Clip>();
  readonly insideClips=new Map<Node,Clip>();
  readonly styles=new Map<Element,CSSStyleDeclaration>();
  readonly crops=new Map<Element,Box>();
  readonly checked=new Set<string>();
  rawRects=0;
  constructor(readonly host:HTMLElement,readonly view:DomView) {
    this.doc=host.ownerDocument;
    const win=this.doc.defaultView;
    if(!win || !host.isConnected || win.frameElement)throw unsupported;
    this.win=win;
    const layout:Box={left:0,top:0,right:this.doc.documentElement.clientWidth,bottom:this.doc.documentElement.clientHeight};
    const visual=win.visualViewport;
    const visible:Box=visual?{left:visual.offsetLeft,top:visual.offsetTop,right:visual.offsetLeft+visual.width,bottom:visual.offsetTop+visual.height}:layout;
    if(!validBox(layout) || !validBox(visible) || layout.right<0 || layout.bottom<0 || visible.right<visible.left || visible.bottom<visible.top)throw unsupported;
    this.viewport=intersect(layout,visible);
  }
  visit(node:Node):void {
    if(!this.visited.has(node)){if(this.visited.size===1024)throw limited;this.visited.add(node);}
  }
  ancestor(element:Element):void {
    if(!this.ancestors.has(element)){if(this.ancestors.size===128)throw limited;this.ancestors.add(element);}
  }
  row(id:string):GeometryRow {
    const cached=this.rows.get(id);if(cached)return cached;
    const row=this.view.geometryRow(id);if(!row)throw unsupported;
    this.rows.set(id,row);return row;
  }
  /** Validate actual parent links, not IDs copied onto unrelated browser objects. */
  validate(row:GeometryRow):void {
    const pending:GeometryRow[]=[];let current=row;
    while(!this.checked.has(current.view.id)) {
      if(pending.some(item=>item.view.id===current.view.id))throw unsupported;
      if(!current.outer.isConnected || current.outer.ownerDocument!==this.doc || (current.outer!==this.host && !this.host.contains(current.outer)))throw unsupported;
      if(this.view.geometryOwner(current.outer)?.outer!==current.outer)throw unsupported;
      pending.push(current);
      if(current.view.parent===null){if(current.outer!==this.host || current.view.primitive!=='root')throw unsupported;break;}
      const parent=this.row(current.view.parent);this.ancestor(parent.outer);this.ancestor(parent.content);
      const index=parent.view.children.indexOf(current.view.id);
      if(index<0 || current.outer.parentNode!==parent.content || parent.content.childNodes.length!==parent.view.children.length || parent.content.childNodes[index]!==current.outer)throw unsupported;
      current=parent;
    }
    for(const item of pending) {
      if(item.view.primitive==='text') {
        let node:Node=item.outer;
        for(const wrapper of item.wrappers) {
          this.visit(wrapper);
          if(node.childNodes.length!==1 || node.firstChild!==wrapper || this.view.geometryOwner(wrapper)?.outer!==item.outer)throw unsupported;
          node=wrapper;
        }
        if(!item.text || node!==item.content || node.childNodes.length!==1 || node.firstChild!==item.text || item.text.data!==item.view.text || this.view.geometryOwner(item.text)?.outer!==item.outer)throw unsupported;
      } else if(item.placeholder && (item.view.children.length!==0 || item.content.childNodes.length!==1 || item.content.firstChild!==item.placeholder))throw unsupported;
      this.checked.add(item.view.id);
    }
  }
  owned(node:Node):GeometryRow {
    this.visit(node);
    const row=this.view.geometryOwner(node);if(!row)throw unsupported;
    this.validate(this.row(row.view.id));return row;
  }
  point(point:DomPoint):void {
    const row=this.owned(point.node);
    if(point.node.nodeType===3) {
      if(row.text!==point.node || point.offset<0 || point.offset>(point.node as Text).length)throw unsupported;
    } else {
      if(!Number.isSafeInteger(point.offset) || point.offset<0 || point.offset>point.node.childNodes.length)throw unsupported;
      if(point.node===row.content && !row.text && !row.view.primitive.endsWith('_atom') && row.view.primitive!=='hard_break') {
        if(row.placeholder){if(point.offset!==0)throw unsupported;}
        else {
          if(point.node.childNodes.length!==row.view.children.length)throw unsupported;
          // Only the two actual neighbours define this gap; unrelated siblings
          // need no document-wide scan or semantic reconstruction.
          for(const index of [point.offset-1,point.offset])if(index>=0 && index<row.view.children.length) {
            const child=this.row(row.view.children[index]);this.validate(child);
            if(point.node.childNodes[index]!==child.outer)throw unsupported;
          }
        }
      }
    }
  }
  style(element:Element):CSSStyleDeclaration {
    const cached=this.styles.get(element);if(cached)return cached;
    const style=this.win.getComputedStyle(element);
    const nonNone=(value:string)=>!!value && value!=='none';
    if(style.writingMode!=='horizontal-tb' || nonNone(style.transform) || nonNone(style.perspective) || nonNone(style.clipPath) || nonNone(style.getPropertyValue('mask-image')) || nonNone(style.getPropertyValue('-webkit-mask-image')))throw unsupported;
    const zoom=style.getPropertyValue('zoom');if(zoom && zoom!=='normal' && Number(zoom)!==1)throw unsupported;
    this.styles.set(element,style);return style;
  }
  clip(node:Node,inside=false):Clip {
    const cache=inside?this.insideClips:this.clips,cached=cache.get(node);if(cached)return cached;
    let box=this.viewport;
    const chain:Element[]=[];
    if(node.nodeType===1)this.style(node as Element);
    let ancestor=inside && node.nodeType===1?node as Element:node.parentElement;
    while(ancestor) {
      this.ancestor(ancestor);
      const style=this.style(ancestor),cropX=style.overflowX!=='visible',cropY=style.overflowY!=='visible';
      if(cropX || cropY) {
        if([style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomLeftRadius,style.borderBottomRightRadius].some(value=>value.split(/\s+/).some(part=>!Number.isFinite(parseFloat(part)) || parseFloat(part)!==0)))throw unsupported;
        let crop=this.crops.get(ancestor);
        if(!crop) {
          if(this.rawRects===256)throw limited;this.rawRects++;
          const rect=ancestor.getBoundingClientRect();
          if(![rect.x,rect.y,rect.width,rect.height,rect.left,rect.top,rect.right,rect.bottom,rect.x+rect.width,rect.y+rect.height].every(Number.isFinite) || rect.width<0 || rect.height<0)throw unsupported;
          crop={left:rect.left+ancestor.clientLeft,top:rect.top+ancestor.clientTop,right:rect.left+ancestor.clientLeft+ancestor.clientWidth,bottom:rect.top+ancestor.clientTop+ancestor.clientHeight};
          if(!validBox(crop) || crop.right<crop.left || crop.bottom<crop.top)throw unsupported;
          this.crops.set(ancestor,crop);
        }
        chain.push(ancestor);
        box=intersect(box,{left:cropX?crop.left:box.left,right:cropX?crop.right:box.right,top:cropY?crop.top:box.top,bottom:cropY?crop.bottom:box.bottom});
      }
      ancestor=ancestor.parentElement;
    }
    if(!validBox(box))throw unsupported;
    const result={box,chain};cache.set(node,result);return result;
  }
  sameClip(a:Clip,b:Clip):void {
    if(a.chain.length!==b.chain.length || a.chain.some((element,index)=>element!==b.chain[index]))throw unsupported;
  }
  rectangles(list:DOMRectList,endpoint=false):readonly CssRect[] {
    const length=list.length;
    if(!Number.isSafeInteger(length) || length<0 || length>256-this.rawRects)throw limited;
    this.rawRects+=length;
    const output:CssRect[]=[];
    for(let i=0;i<length;i++) {
      const rect=list[i];
      if(!rect || ![rect.x,rect.y,rect.width,rect.height,rect.left,rect.top,rect.right,rect.bottom,rect.x+rect.width,rect.y+rect.height].every(Number.isFinite) || rect.width<0 || rect.height<0) {
        if(endpoint)return Object.freeze([]);throw unsupported;
      }
      output.push(Object.freeze({x:rect.x,y:rect.y,width:rect.width,height:rect.height}));
    }
    return Object.freeze(output);
  }
  endpoint(range:Range):CssRect|null {
    let rects:readonly CssRect[];
    try{rects=this.rectangles(range.getClientRects(),true);}catch(error){if(error===limited)throw error;return null;}
    const usable=rects.filter(rect=>rect.height>0);
    if(usable.length===0)return null;
    const first=usable[0];
    return usable.every(rect=>rect.x===first.x && rect.y===first.y && rect.width===first.width && rect.height===first.height)?first:null;
  }
  after(node:Node):Node|null {
    let current:Node|null=node;
    while(current && current!==this.host) {
      const parent=current.parentElement;if(parent)this.ancestor(parent);
      if(current.nextSibling)return current.nextSibling;
      current=current.parentNode;
    }
    return null;
  }
  first(container:Node,offset:number,end=false):Node|null {
    if(container.nodeType===3)return (end?offset>0:offset===(container as Text).length)?this.after(container):container;
    return container.childNodes[offset] ?? this.after(container);
  }
  walk(first:Node|null,fence:Node|null,clip:Clip):void {
    let node=first;
    while(node && node!==fence) {
      const row=this.owned(node);this.sameClip(clip,this.clip(node));
      const opaque=row.view.primitive.endsWith('_atom') || row.view.primitive==='hard_break';
      node=!opaque && node.firstChild?node.firstChild:this.after(node);
    }
    if(node!==fence)throw unsupported;
  }
  block(row:GeometryRow):{rects:readonly CssRect[];anchor:CssRect;focus:null;clip:Clip} {
    if(!eligible(row))throw unsupported;
    this.validate(row);
    const clip=this.clip(row.outer);
    // A bounded ownership check also catches same-turn foreign descendants.
    // Atom labels are renderer-owned opaque presentation, never traversed.
    let node:Node|null=row.outer;const fence=this.after(row.outer);
    while(node && node!==fence) {
      const owner=this.owned(node);
      if(node.nodeType===1)this.style(node as Element);
      const opaque=owner.view.primitive.endsWith('_atom') || owner.view.primitive==='hard_break';
      node=!opaque && node.firstChild?node.firstChild:this.after(node);
    }
    const rects=this.rectangles(row.outer.getClientRects()),anchor=rects.find(rect=>rect.height>0);
    if(!anchor)throw unsupported;
    return {rects,anchor,focus:null,clip};
  }
  selection(selection:DeepReadonly<SelectionDto>):{rects:readonly CssRect[];anchor:CssRect;focus:CssRect|null;clip:Clip} {
    const anchorPoint=this.view.domPoint(selection.anchor),focusPoint=this.view.domPoint(selection.focus);
    if(isDomRefusal(anchorPoint) || isDomRefusal(focusPoint))throw unsupported;
    this.point(anchorPoint);this.point(focusPoint);
    const anchorRange=this.doc.createRange(),focusRange=this.doc.createRange(),range=this.doc.createRange();
    anchorRange.setStart(anchorPoint.node,anchorPoint.offset);anchorRange.collapse(true);
    focusRange.setStart(focusPoint.node,focusPoint.offset);focusRange.collapse(true);
    const order=anchorRange.compareBoundaryPoints(0,focusRange);
    const start=order<=0?anchorPoint:focusPoint,end=order<=0?focusPoint:anchorPoint;
    range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);
    const clip=this.clip(anchorPoint.node,true);this.sameClip(clip,this.clip(focusPoint.node,true));
    if(!range.collapsed)this.walk(this.first(start.node,start.offset),this.first(end.node,end.offset,true),clip);
    const rects=this.rectangles(range.getClientRects());
    const anchor=this.endpoint(anchorRange),focus=order===0?anchor:this.endpoint(focusRange);
    if(!anchor)throw unsupported;
    return {rects,anchor,focus,clip};
  }
  hit(x:number,y:number):GeometryRow {
    if(x<this.viewport.left || x>this.viewport.right || y<this.viewport.top || y>this.viewport.bottom)throw unsupported;
    const hit=this.doc.elementFromPoint(x,y);
    if(!hit || !this.host.contains(hit))throw unsupported;
    let current:Node|null=hit;
    while(current && current!==this.host) {
      this.visit(current);
      const row=this.view.geometryOwner(current);
      // Do not walk through a foreign overlay to a genuine ancestor.
      if(!row)throw unsupported;
      this.validate(this.row(row.view.id));
      if(eligible(row))return row;
      current=current.parentNode;if(current?.nodeType===1)this.ancestor(current as Element);
    }
    throw unsupported;
  }
  revalidate():void {
    this.checked.clear();
    for(const row of this.rows.values()) {
      if(this.view.geometryRow(row.view.id)?.outer!==row.outer)throw unsupported;
      this.validate(row);
    }
    for(const node of this.visited)if(!node.isConnected || !this.host.contains(node) && node!==this.host || !this.view.geometryOwner(node))throw unsupported;
  }
}

function visible(rect:CssRect,clip:CssRect):boolean {
  if(rect.height<=0 || clip.width<=0 || clip.height<=0 || rect.y>=clip.y+clip.height || rect.y+rect.height<=clip.y)return false;
  return rect.width===0?rect.x>=clip.x && rect.x<=clip.x+clip.width:rect.x<clip.x+clip.width && rect.x+rect.width>clip.x;
}

/** No subscriptions, native mutations, retained DOM handles or presentation writes. */
export function createMountedGeometry(configuration:Configuration):MountedGeometry {
  function read(value:DragGeometryRequest):DragGeometryRead;
  function read(value:GeometryRequest):GeometryRead;
  function read(value:GeometryRequest|DragGeometryRequest):GeometryRead|DragGeometryRead;
  function read(value:GeometryRequest|DragGeometryRequest):GeometryRead|DragGeometryRead {
    let drag=false;
    try{drag=!!value&&typeof value==='object'&&Object.getOwnPropertyDescriptor(value,'kind')?.value==='drag';}catch{/* The old request validator retains its refusal path. */}
    if(drag)return readDragGeometry(configuration,value as DragGeometryRequest);
    const guard=configuration.guard();if(guard)return guard;
    let request:GeometryRequest|undefined;
    const failure=(code:DomRefusal['diagnostic']['code'])=>domRefusal(code,'geometry',configuration.capture(),request?.kind==='block'?request.node:null);
    try{request=ownRequest(value as GeometryRequest);}catch{return failure('dom.invalid_options');}
    const host=configuration.element(),view=configuration.view(),stamp=configuration.capture(),context=configuration.context();
    if(!host || !view || !stamp || !context)return failure('dom.not_ready');
    if(!sameStamp(request.stamp,stamp))return failure('dom.stale_selection');
    const response=configuration.readState();
    if(response.status!=='ok' || response.value.kind!=='state')return Object.freeze({status:'sdk_failure',response});
    const state=response.value.state;
    const current=()=>configuration.element()===host && configuration.view()===view && sameStamp(stamp,configuration.capture()) && sameStamp(stamp,view.geometryStamp()) && sameContext(context,configuration.context());
    if(!sameStamp(stamp,state.stamp) || !current())return failure('dom.stale_selection');
    if(request.kind==='selection' && !state.selection)return failure('dom.selection_missing');
    try {
      const measurement=new Measurement(host,view);
      let target:GeometrySnapshot['target'],result:ReturnType<Measurement['block']>|ReturnType<Measurement['selection']>;
      if(request.kind==='selection') {
        target=Object.freeze({kind:'selection',selection:state.selection!});result=measurement.selection(state.selection!);
      } else {
        const row=request.kind==='block'?measurement.row(request.node):measurement.hit(request.x,request.y);
        target=Object.freeze({kind:'block',node:row.view.id});result=measurement.block(row);
      }
      if(!current())return failure('dom.stale_selection');
      const after=configuration.guard();if(after)return after;
      measurement.revalidate();
      if(!current())return failure('dom.stale_selection');
      const clip=cssRect(result.clip.box),viewport=cssRect(measurement.viewport);
      return Object.freeze({status:'measured',stamp,context,target,rects:result.rects,anchor:result.anchor,focus:result.focus,clip,viewport,
        visible:result.rects.some(rect=>visible(rect,clip)) || visible(result.anchor,clip) || !!result.focus && visible(result.focus,clip)});
    } catch {
      if(!current())return failure('dom.stale_selection');
      const after=configuration.guard();return after ?? failure('dom.selection_geometry_unsupported');
    }
  }
  return Object.freeze({read});
}
