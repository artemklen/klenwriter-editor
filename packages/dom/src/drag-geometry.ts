// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DeepReadonly, Response, SessionContextV2, StampDto } from '@klenwriter/editor-sdk';
import type { CssRect, DomRefusal, DragBox, DragDestination, DragGeometryRead, DragGeometryRequest, DragNodeHeader } from './types.js';
import type { DomView, GeometryRow } from './view.js';
import { fields } from './ownership.js';
import { domRefusal } from './refusal.js';

interface Configuration {
  element(): HTMLElement | null;
  view(): DomView | null;
  capture(): DeepReadonly<StampDto> | null;
  context(): DeepReadonly<SessionContextV2> | null;
  readState(): Response;
  guard(): DomRefusal | null;
}
interface Box { readonly left:number; readonly top:number; readonly right:number; readonly bottom:number }
interface Crop { readonly element:Element; readonly box:Box }
interface MeasuredBox { readonly row:GeometryRow; readonly rect:CssRect; readonly clip:Box }
const STAMP_KEYS=['session','generation','revision','selection_epoch','history_epoch'] as const;
const unsupported=Symbol('unsupported drag geometry'),limited=Symbol('drag geometry limit');
const eligible=(row:GeometryRow)=>['text_block','container','block_atom'].includes(row.view.primitive);
const sameStamp=(a:DeepReadonly<StampDto>|null,b:DeepReadonly<StampDto>|null)=>!!a&&!!b&&STAMP_KEYS.every(key=>a[key]===b[key]);
const sameContext=(a:DeepReadonly<SessionContextV2>|null,b:DeepReadonly<SessionContextV2>|null)=>!!a&&!!b&&a.build_id===b.build_id
  &&a.registry_digest===b.registry_digest&&a.capability_digest===b.capability_digest&&a.profile.profile_id===b.profile.profile_id
  &&a.profile.profile_version===b.profile.profile_version&&a.profile.codec_id===b.profile.codec_id&&a.profile.wire_version===b.profile.wire_version
  &&a.profile.extensions.length===b.profile.extensions.length&&a.profile.extensions.every((extension,index)=>extension.id===b.profile.extensions[index].id&&extension.version===b.profile.extensions[index].version);
const validBox=(box:Box)=>[box.left,box.top,box.right,box.bottom,box.right-box.left,box.bottom-box.top].every(Number.isFinite);
const intersect=(a:Box,b:Box):Box=>({left:Math.max(a.left,b.left),top:Math.max(a.top,b.top),right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)});
const cssRect=(box:Box):CssRect=>Object.freeze({x:box.left,y:box.top,width:Math.max(0,box.right-box.left),height:Math.max(0,box.bottom-box.top)});
const equalBox=(a:Box,b:Box)=>a.left===b.left&&a.top===b.top&&a.right===b.right&&a.bottom===b.bottom;
const equalRect=(a:CssRect,b:CssRect)=>a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;
const contains=(box:Box,x:number,y:number)=>box.right>box.left&&box.bottom>box.top&&x>=box.left&&x<=box.right&&y>=box.top&&y<=box.bottom;

function closed(value:unknown,keys:readonly string[]):Record<string,unknown> {
  const result=fields(value);
  if(Object.keys(result).length!==keys.length||keys.some(key=>!Object.hasOwn(result,key)))throw unsupported;
  return result;
}
function id(value:unknown):string {
  if(typeof value!=='string'||value.length===0||value.length>128)throw unsupported;
  return value;
}
/** Context is a closed SDK identity, not a second profile/schema decoder. */
function ownContext(value:unknown):DeepReadonly<SessionContextV2> {
  let units=0;
  const string=(value:unknown):string=>{
    if(typeof value!=='string'||(units+=value.length)>65536)throw unsupported;
    return value;
  };
  const context=closed(value,['build_id','profile','registry_digest','capability_digest']);
  const profile=closed(context.profile,['profile_id','profile_version','codec_id','wire_version','extensions']);
  if(typeof profile.wire_version!=='number'||!Number.isInteger(profile.wire_version)||profile.wire_version<0||profile.wire_version>0xffff_ffff||Object.is(profile.wire_version,-0))throw unsupported;
  const values=profile.extensions;
  if(!Array.isArray(values)||Object.getPrototypeOf(values)!==Array.prototype||values.length>64)throw unsupported;
  const descriptors=Object.getOwnPropertyDescriptors(values);
  if(Reflect.ownKeys(descriptors).length!==values.length+1)throw unsupported;
  const extensions:{readonly id:string;readonly version:string}[]=[];
  for(let index=0;index<values.length;index++) {
    const descriptor=descriptors[String(index)];
    if(!descriptor||!('value' in descriptor)||!descriptor.enumerable)throw unsupported;
    const extension=closed(descriptor.value,['id','version']);
    extensions.push(Object.freeze({id:string(extension.id),version:string(extension.version)}));
  }
  const result=Object.freeze({build_id:string(context.build_id),profile:Object.freeze({
    profile_id:string(profile.profile_id),profile_version:string(profile.profile_version),codec_id:string(profile.codec_id),
    wire_version:profile.wire_version,extensions:Object.freeze(extensions)
  }),registry_digest:string(context.registry_digest),capability_digest:string(context.capability_digest)});
  if(new TextEncoder().encode(JSON.stringify(result)).length>65536)throw unsupported;
  return result;
}
function ownRequest(value:DragGeometryRequest):DragGeometryRequest {
  const request=closed(value,['kind','stamp','context','source','point','insideParent']);
  if(request.kind!=='drag')throw unsupported;
  const stamp=closed(request.stamp,STAMP_KEYS);
  if(STAMP_KEYS.some(key=>typeof stamp[key]!=='string'||(stamp[key] as string).length>128))throw unsupported;
  let point:Readonly<{x:number;y:number}>|null=null;
  if(request.point!==null) {
    const data=closed(request.point,['x','y']);
    if(typeof data.x!=='number'||typeof data.y!=='number'||!Number.isFinite(data.x)||!Number.isFinite(data.y))throw unsupported;
    point=Object.freeze({x:data.x,y:data.y});
  }
  const insideParent=request.insideParent===null?null:id(request.insideParent);
  if(!point&&insideParent!==null)throw unsupported;
  return Object.freeze({kind:'drag',stamp:Object.freeze({...stamp}) as unknown as StampDto,
    context:ownContext(request.context),source:id(request.source),point,insideParent});
}

/** One budget for all source/hit/parent facts, boxes and final revalidation. */
class DragMeasurement {
  readonly doc:Document; readonly win:Window; readonly viewport:Box;
  readonly objects=new Set<Node>(); readonly ancestors=new Set<Element>();
  readonly slots=new Map<string,Set<number>>(); readonly rows=new Map<string,GeometryRow>();
  readonly ownedNodes=new Map<Node,string>(); readonly parents=new Map<Node,Node|null>();
  readonly indexes=new Map<string,number|null>(); readonly checked=new Set<string>();
  readonly headers=new Map<string,DragNodeHeader>(); readonly boxes=new Map<string,MeasuredBox>();
  readonly styles=new Map<Element,string>(); readonly crops=new Map<Element,Crop>();
  readonly walked=new Set<string>();
  childSlots=0; rects=0;
  constructor(readonly host:HTMLElement,readonly view:DomView) {
    this.doc=host.ownerDocument;
    const win=this.doc.defaultView;
    if(!win||!host.isConnected||win.frameElement)throw unsupported;
    this.win=win;this.viewport=this.readViewport();
  }
  readViewport():Box {
    const layout:Box={left:0,top:0,right:this.doc.documentElement.clientWidth,bottom:this.doc.documentElement.clientHeight};
    const visual=this.win.visualViewport;
    const visible:Box=visual?{left:visual.offsetLeft,top:visual.offsetTop,right:visual.offsetLeft+visual.width,bottom:visual.offsetTop+visual.height}:layout;
    if(!validBox(layout)||!validBox(visible)||layout.right<0||layout.bottom<0||visible.right<visible.left||visible.bottom<visible.top)throw unsupported;
    return intersect(layout,visible);
  }
  visit(node:Node):void {
    if(!this.objects.has(node)) {
      if(this.objects.size+this.childSlots>=1024)throw limited;
      this.objects.add(node);this.parents.set(node,node.parentNode);
    }
  }
  ancestor(element:Element):void {
    this.visit(element);
    if(!this.ancestors.has(element)) {
      if(this.ancestors.size>=128)throw limited;
      this.ancestors.add(element);
    }
  }
  slot(parent:GeometryRow,index:number):string {
    let slots=this.slots.get(parent.view.id);
    if(!slots){slots=new Set();this.slots.set(parent.view.id,slots);}
    if(!slots.has(index)) {
      if(this.objects.size+this.childSlots>=1024)throw limited;
      slots.add(index);this.childSlots++;
    }
    return parent.view.children[index];
  }
  row(key:string):GeometryRow {
    const cached=this.rows.get(key);if(cached)return cached;
    const row=this.view.geometryRow(key);
    if(!row||row.view.id!==key)throw unsupported;
    this.visit(row.outer);this.rows.set(key,row);return row;
  }
  owned(node:Node,row:GeometryRow):void {
    this.visit(node);
    const owner=this.view.geometryOwner(node);
    if(!node.isConnected||node.ownerDocument!==this.doc||node!==this.host&&!this.host.contains(node)||!owner||owner.outer!==row.outer||owner.view!==row.view)throw unsupported;
    this.ownedNodes.set(node,row.view.id);
  }
  ordinal(row:GeometryRow,parent:GeometryRow):number {
    let index=this.indexes.get(row.view.id);
    if(index===undefined) {
      for(let next=0;next<parent.view.children.length;next++)if(this.slot(parent,next)===row.view.id){index=next;break;}
    }
    if(index===undefined||index===null||this.slot(parent,index)!==row.view.id||row.outer.parentNode!==parent.content
      ||parent.content.childNodes.length!==parent.view.children.length||parent.content.childNodes[index]!==row.outer)throw unsupported;
    this.indexes.set(row.view.id,index);return index;
  }
  validate(row:GeometryRow):void {
    const pending:GeometryRow[]=[],seen=new Set<string>();let current=row;
    while(!this.checked.has(current.view.id)) {
      if(seen.has(current.view.id))throw unsupported;
      seen.add(current.view.id);this.owned(current.outer,current);this.owned(current.content,current);pending.push(current);
      if(current.view.parent===null) {
        if(current.outer!==this.host||current.view.primitive!=='root')throw unsupported;
        this.indexes.set(current.view.id,null);break;
      }
      const parent=this.row(current.view.parent);this.ancestor(parent.outer);this.ancestor(parent.content);
      this.ordinal(current,parent);current=parent;
    }
    for(const item of pending) {
      if(item.view.primitive==='text') {
        let node:Node=item.outer;
        for(const wrapper of item.wrappers) {
          this.owned(wrapper,item);
          if(node.childNodes.length!==1||node.firstChild!==wrapper)throw unsupported;
          node=wrapper;
        }
        if(!item.text||node!==item.content||node.childNodes.length!==1||node.firstChild!==item.text||item.text.data!==item.view.text)throw unsupported;
        this.owned(item.text,item);
      } else if(item.placeholder) {
        this.owned(item.placeholder,item);
        if(item.view.children.length!==0||item.content.childNodes.length!==1||item.content.firstChild!==item.placeholder)throw unsupported;
      } else if(!item.view.primitive.endsWith('_atom')&&item.view.primitive!=='hard_break'&&item.content.childNodes.length!==item.view.children.length)throw unsupported;
      this.checked.add(item.view.id);
    }
  }
  header(row:GeometryRow):DragNodeHeader {
    const cached=this.headers.get(row.view.id);if(cached)return cached;
    this.validate(row);
    const index=this.indexes.get(row.view.id),count=row.view.children.length;
    const typeId=row.view.type_id;
    if(index===undefined||!Number.isSafeInteger(count)||count<0||typeof typeId!=='string'||typeId.length>128||!typeId&&row.view.primitive!=='root')throw unsupported;
    const header=Object.freeze({id:id(row.view.id),typeId,primitive:row.view.primitive,
      parent:row.view.parent,index,childCount:count});
    this.headers.set(row.view.id,header);return header;
  }
  style(element:Element):CSSStyleDeclaration {
    this.visit(element);
    const style=this.win.getComputedStyle(element);
    const nonNone=(value:string)=>!!value&&value!=='none';
    if(style.writingMode!=='horizontal-tb'||nonNone(style.transform)||nonNone(style.perspective)||nonNone(style.clipPath)
      ||nonNone(style.getPropertyValue('mask-image'))||nonNone(style.getPropertyValue('-webkit-mask-image')))throw unsupported;
    const zoom=style.getPropertyValue('zoom');if(zoom&&zoom!=='normal'&&Number(zoom)!==1)throw unsupported;
    const signature=JSON.stringify([style.writingMode,style.transform,style.perspective,style.clipPath,style.getPropertyValue('mask-image'),
      style.getPropertyValue('-webkit-mask-image'),zoom,style.overflowX,style.overflowY,style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomLeftRadius,style.borderBottomRightRadius]);
    const previous=this.styles.get(element);if(previous!==undefined&&previous!==signature)throw unsupported;
    this.styles.set(element,signature);return style;
  }
  rawRect(rect:DOMRect):CssRect {
    if(![rect.x,rect.y,rect.left,rect.top,rect.right,rect.bottom,rect.width,rect.height,rect.x+rect.width,rect.y+rect.height].every(Number.isFinite)||rect.width<0||rect.height<0)throw unsupported;
    return Object.freeze({x:rect.x,y:rect.y,width:rect.width,height:rect.height});
  }
  fragment(element:HTMLElement):CssRect {
    const rects=element.getClientRects();
    if(!Number.isSafeInteger(rects.length)||rects.length<0||rects.length>256-this.rects)throw limited;
    this.rects+=rects.length;
    if(rects.length!==1)throw unsupported;
    const rect=this.rawRect(rects[0]);if(rect.height<=0)throw unsupported;
    return rect;
  }
  crop(element:Element):Box {
    if(this.rects>=256)throw limited;
    this.rects++;
    const rect=this.rawRect(element.getBoundingClientRect());
    const box={left:rect.x+element.clientLeft,top:rect.y+element.clientTop,
      right:rect.x+element.clientLeft+element.clientWidth,bottom:rect.y+element.clientTop+element.clientHeight};
    if(!validBox(box)||box.right<box.left||box.bottom<box.top)throw unsupported;
    return box;
  }
  clip(element:Element):Box {
    let box=this.viewport,current=element.parentElement;this.style(element);
    while(current) {
      this.ancestor(current);const style=this.style(current),x=style.overflowX!=='visible',y=style.overflowY!=='visible';
      if(x||y) {
        if([style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomLeftRadius,style.borderBottomRightRadius]
          .some(value=>value.split(/\s+/).some(part=>!Number.isFinite(parseFloat(part))||parseFloat(part)!==0)))throw unsupported;
        let crop=this.crops.get(current);
        if(!crop){crop={element:current,box:this.crop(current)};this.crops.set(current,crop);}
        box=intersect(box,{left:x?crop.box.left:box.left,right:x?crop.box.right:box.right,top:y?crop.box.top:box.top,bottom:y?crop.box.bottom:box.bottom});
      }
      current=current.parentElement;
    }
    if(!validBox(box))throw unsupported;
    return box;
  }
  /** Bounded actual subtree ownership; atoms have opaque renderer-owned labels. */
  walk(row:GeometryRow):void {
    if(this.walked.has(row.view.id))return;
    const pending:Node[]=[row.outer];
    while(pending.length) {
      const node=pending.pop()!;this.visit(node);
      const owner=this.view.geometryOwner(node);if(!owner)throw unsupported;
      const cached=this.row(owner.view.id);this.owned(node,cached);this.validate(cached);
      if(node.nodeType===1)this.style(node as Element);
      if(cached.view.primitive.endsWith('_atom')||cached.view.primitive==='hard_break')continue;
      // Push at most the remaining budget, without materializing childNodes.
      for(let child=node.lastChild;child;child=child.previousSibling){this.visit(child);pending.push(child);}
    }
    this.walked.add(row.view.id);
  }
  box(row:GeometryRow):DragBox {
    const cached=this.boxes.get(row.view.id);if(cached)return Object.freeze({rect:cached.rect,clip:cssRect(cached.clip)});
    this.validate(row);this.walk(row);
    const result={row,rect:this.fragment(row.outer),clip:this.clip(row.outer)};
    this.boxes.set(row.view.id,result);return Object.freeze({rect:result.rect,clip:cssRect(result.clip)});
  }
  hit(x:number,y:number):GeometryRow {
    if(!contains(this.viewport,x,y))throw unsupported;
    let current:Node|null=this.doc.elementFromPoint(x,y);
    if(!current||!this.host.contains(current))throw unsupported;
    while(current&&current!==this.host) {
      this.visit(current);const owner=this.view.geometryOwner(current);if(!owner)throw unsupported;
      const row=this.row(owner.view.id);this.owned(current,row);this.validate(row);
      if(eligible(row))return row;
      current=current.parentNode;if(current?.nodeType===1)this.ancestor(current as Element);
    }
    throw unsupported;
  }
  insideParents(row:GeometryRow):readonly DragNodeHeader[] {
    const result:DragNodeHeader[]=[],seen=new Set<string>();let current:GeometryRow|null=row;
    while(current) {
      if(seen.has(current.view.id))throw unsupported;
      seen.add(current.view.id);this.ancestor(current.outer);this.ancestor(current.content);this.validate(current);
      if(current.view.primitive==='container'||current.view.primitive==='root')result.push(this.header(current));
      current=current.view.parent===null?null:this.row(current.view.parent);
    }
    return Object.freeze(result);
  }
  revalidateOwnership():void {
    this.checked.clear();
    for(const row of this.rows.values()) {
      const current=this.view.geometryRow(row.view.id);
      if(!current||current.outer!==row.outer||current.content!==row.content||current.view!==row.view||current.text!==row.text||current.placeholder!==row.placeholder)throw unsupported;
      this.validate(row);
    }
    for(const [node,parent] of this.parents)if(!node.isConnected||node.ownerDocument!==this.doc||node.parentNode!==parent)throw unsupported;
    for(const [node,key] of this.ownedNodes)this.owned(node,this.row(key));
  }
  revalidate():void {
    this.revalidateOwnership();
    for(const element of this.styles.keys())this.style(element);
    for(const crop of this.crops.values())if(!equalBox(crop.box,this.crop(crop.element)))throw unsupported;
    for(const box of this.boxes.values())if(!equalRect(box.rect,this.fragment(box.row.outer)))throw unsupported;
    if(!equalBox(this.viewport,this.readViewport()))throw unsupported;
    // Measurement hooks may synchronously detach/reparent objects while
    // returning an old rectangle. Their last read cannot bypass ownership.
    this.revalidateOwnership();
  }
  work():Readonly<{objects:number;childSlots:number;ancestors:number;rects:number}> {
    return Object.freeze({objects:this.objects.size,childSlots:this.childSlots,ancestors:this.ancestors.size,rects:this.rects});
  }
}

/** Pure composite read. It neither captures a request nor grants move authority. */
export function readDragGeometry(configuration:Configuration,value:DragGeometryRequest):DragGeometryRead {
  const guard=configuration.guard();if(guard)return guard;
  let request:DragGeometryRequest;
  const failure=(code:DomRefusal['diagnostic']['code'])=>domRefusal(code,'geometry',configuration.capture());
  try{request=ownRequest(value);}catch{return failure('dom.invalid_options');}
  const host=configuration.element(),view=configuration.view(),stamp=configuration.capture(),context=configuration.context();
  if(!host||!view||!stamp||!context)return failure('dom.not_ready');
  if(!sameStamp(request.stamp,stamp)||!sameContext(request.context,context))return failure('dom.stale_selection');
  const response=configuration.readState();
  if(response.status!=='ok'||response.value.kind!=='state')return Object.freeze({status:'sdk_failure',response});
  const current=()=>configuration.element()===host&&configuration.view()===view&&sameStamp(stamp,configuration.capture())
    &&sameStamp(stamp,view.geometryStamp())&&sameContext(context,configuration.context());
  if(!sameStamp(stamp,response.value.state.stamp)||!current())return failure('dom.stale_selection');
  try {
    const measurement=new DragMeasurement(host,view),source=measurement.row(request.source);
    if(!eligible(source)||source.view.parent===null)throw unsupported;
    const sourceHeader=measurement.header(source),sourceBox=measurement.box(source);
    let hit:DragNodeHeader|null=null,insideParents:readonly DragNodeHeader[]=Object.freeze([]),destination:DragDestination|null=null,targetBox:DragBox|null=null;
    if(request.point) {
      const row=measurement.hit(request.point.x,request.point.y);hit=measurement.header(row);
      const hitBox=measurement.box(row);
      const clip={left:hitBox.clip.x,top:hitBox.clip.y,right:hitBox.clip.x+hitBox.clip.width,bottom:hitBox.clip.y+hitBox.clip.height};
      const rect={left:hitBox.rect.x,top:hitBox.rect.y,right:hitBox.rect.x+hitBox.rect.width,bottom:hitBox.rect.y+hitBox.rect.height};
      if(!contains(clip,request.point.x,request.point.y)||!contains(rect,request.point.x,request.point.y))throw unsupported;
      insideParents=measurement.insideParents(row);
      if(request.insideParent!==null) {
        const parent=insideParents.find(parent=>parent.id===request.insideParent);if(!parent)throw unsupported;
        targetBox=measurement.box(measurement.row(parent.id));
        destination=Object.freeze({placement:'inside',reference:parent.id,parent:parent.id,before_index:parent.childCount});
      } else {
        if(hit.parent===null||hit.index===null)throw unsupported;
        const offset=request.point.y-hitBox.rect.y;
        const placement=hit.primitive==='container'
          ? offset<hitBox.rect.height/4?'before':offset>=hitBox.rect.height*3/4?'after':null
          : offset<hitBox.rect.height/2?'before':'after';
        if(placement)destination=Object.freeze({placement,reference:hit.id,parent:hit.parent,before_index:hit.index+(placement==='after'?1:0)});
        targetBox=hitBox;
      }
    }
    if(!current())return failure('dom.stale_selection');
    const after=configuration.guard();if(after)return after;
    measurement.revalidate();
    if(!current())return failure('dom.stale_selection');
    const finalGuard=configuration.guard();if(finalGuard)return finalGuard;
    return Object.freeze({status:'drag_measured',stamp,context,source:sourceHeader,sourceBox,hit,insideParents,destination,targetBox,
      viewport:cssRect(measurement.viewport),work:measurement.work()});
  } catch(error) {
    if(!current())return failure('dom.stale_selection');
    const after=configuration.guard();return after??failure(error===limited?'dom.selection_limit':'dom.selection_geometry_unsupported');
  }
}
