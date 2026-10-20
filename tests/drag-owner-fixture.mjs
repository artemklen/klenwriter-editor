// SPDX-License-Identifier: MIT OR Apache-2.0
// Finite process-local DOM/geometry/host doubles. These assert UI ownership;
// they are not native Move, browser capture, layout or installed-input evidence.
import assert from 'node:assert/strict';
import { DragOwner } from '../packages/ui/dist/drag-owner.js';

const copy=value=>structuredClone(value);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export const MOVE=Object.freeze({id:'example.notes/move',payload_json:'{"kind":"move","node":"S","parent":"R","before_index":1}'});
export const refusal=code=>({status:'dom_refused',diagnostic:{code,phase:'host_request',stamp:null,node:null,typeId:null,publication:'none'}});
class Element extends EventTarget {
  constructor(doc,tag='div'){super();Object.assign(this,{ownerDocument:doc,tagName:tag.toUpperCase(),parentElement:null,children:[],connected:true,attrs:new Map(),dataset:{},style:{},styles:{},hidden:false,text:'',captures:new Set(),captureAllowed:true,clientLeft:0,clientTop:0,clientWidth:600,clientHeight:500,scrollHeight:500,scrollWrites:[],offsetTop:0,offsetHeight:24,rectangle:{x:0,y:0,width:600,height:500}});this.offset=0;}
  get isConnected(){return this.connected&&(!this.parentElement||this.parentElement.isConnected);}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  set textContent(value){this.replaceChildren();this.text=String(value);}
  append(...children){for(const child of children){child.remove();child.parentElement=this;child.connected=true;child.offsetTop=this.children.length*24;this.children.push(child);}}
  prepend(...children){for(const child of [...children].reverse()){child.remove();child.parentElement=this;child.connected=true;this.children.unshift(child);}}
  replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this.text='';this.append(...children);}
  remove(){if(this.parentElement){const children=this.parentElement.children;children.splice(children.indexOf(this),1);this.parentElement=null;}this.connected=false;}
  contains(child){return child===this||this.children.some(node=>node.contains(child));}
  setAttribute(name,value){this.attrs.set(name,String(value));}
  getAttribute(name){return this.attrs.get(name)??null;}
  setPointerCapture(id){if(this.captureAllowed)this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);}
  getBoundingClientRect(){return {...this.rectangle};}
  focus(){this.ownerDocument.activeElement=this;this.ownerDocument.onFocus?.(this);}
  get scrollTop(){return this.offset;}
  set scrollTop(value){const next=Math.max(0,Math.min(this.scrollHeight-this.clientHeight,value));this.scrollWrites.push({before:this.offset,after:next});this.offset=next;}
}
function event(type,values={}){
  const e=new Event(type,{cancelable:true});
  const defaults={pointerId:7,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:150,clientY:310,altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,repeat:false};
  for(const [name,value]of Object.entries({...defaults,...values}))Object.defineProperty(e,name,{value,enumerable:true});
  return e;
}
export function fixture(){
  let time=0,id=0;
  const frames=new Map(),win=new EventTarget(),doc=new EventTarget();
  Object.assign(win,{HTMLElement:Element,performance:{now:()=>time},requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),getComputedStyle:element=>({transform:'none',perspective:'none',overflowY:'visible',scrollBehavior:'auto',scrollSnapType:'none',...element.styles})});
  Object.assign(doc,{defaultView:win,hidden:false,createElement:tag=>new Element(doc,tag)});
  const page=new Element(doc),body=new Element(doc),local=new Element(doc),host=new Element(doc),gutter=new Element(doc),hit=new Element(doc),external=new Element(doc);
  page.append(body);body.append(local,gutter,external);local.append(host);host.append(hit);
  for(const node of [page,body,local,host,gutter,external,hit])node.connected=true;
  host.rectangle={x:100,y:50,width:300,height:400};host.clientWidth=300;host.clientHeight=400;
  doc.scrollingElement=page;doc.activeElement=host;
  const R=freeze({id:'R',typeId:'',primitive:'root',parent:null,index:null,childCount:200});
  const S=freeze({id:'S',typeId:'example.notes/line',primitive:'text_block',parent:'R',index:0,childCount:1});
  const context=freeze({build_id:'controlled-build',registry_digest:'controlled-registry',capability_digest:'controlled-capabilities',profile:{profile_id:'example.notes',profile_version:'1',codec_id:'json',wire_version:2,extensions:[]}});
  const f={doc,win,page,body,local,host,gutter,hit,external,frames,captures:[],releases:[],live:new Set(),queries:[],geometryReads:[],completed:[],results:[],failures:[],feedback:[],moved:[],factoryCalls:[],keyboardCalls:0,schedules:0,beforeOpens:0,focusWrites:0,selectionWrites:0,
    stamp:freeze({session:'controlled-session',generation:'1',revision:'0',selection_epoch:'0',history_epoch:'0'}),context,source:S,root:R,targetIndex:1,container:false,hostFailure:null,geometryFailure:null,queryFailure:null,available:true,diagnostic:null,completionFailure:null,sourceClone:false,
    model:freeze({canonical:'{"literal":"unchanged control model"}',selection:{anchor:{node:'text',offset:0},focus:{node:'text',offset:1}},history:{undo:0,redo:0},events:[]})};
  f.elementAt=()=>hit;
  doc.onFocus=()=>f.focusWrites++;
  doc.elementFromPoint=(x,y)=>f.elementAt(x,y);
  const nativeResponse=()=>({status:'ok',value:{kind:'mutation',effect:'changed',state:{stamp:f.stamp},presentation:null}});
  f.submission=Object.freeze({status:'completed',response:nativeResponse()});
  f.focus=Promise.resolve(Object.freeze({status:'not_requested',failure:null}));
  f.factory=(captured,destination)=>({id:'example.notes/move',payload_json:JSON.stringify({kind:'move',node:captured.source.id,parent:destination.parent,before_index:destination.before_index})});
  f.editor={capture:()=>f.stamp,context:()=>f.context,
    read(){throw Error('drag motion must not read NodeViews, StateDto or catalog');},
    query(request){f.queries.push(copy(request));f.onQuery?.();return f.queryFailure??{status:'ok',value:{kind:'availability',available:f.available,diagnostic:f.diagnostic}};},
    geometry:{read(request){
      f.geometryReads.push(copy(request));assert.equal(request.kind,'drag');assert.deepEqual(Object.keys(request).sort(),['context','insideParent','kind','point','source','stamp']);
      if(f.geometryFailure)return f.geometryFailure;
      if(request.point&&f.elementAt(request.point.x,request.point.y)===external)return refusal('dom.selection_geometry_unsupported');
      const target=freeze({id:'T',typeId:'example.notes/group',primitive:f.container?'container':'text_block',parent:'R',index:f.targetIndex,childCount:2});
      const sourceBox={rect:{x:120,y:100,width:240,height:40},clip:{x:0,y:0,width:600,height:500}};
      let destination=null,targetBox=null,parents=[];
      if(request.point){
        parents=f.container?[target,R]:[R];
        const parent=request.insideParent===null?null:parents.find(node=>node.id===request.insideParent);
        if(request.insideParent!==null&&!parent)return refusal('dom.selection_geometry_unsupported');
        destination=parent?{placement:'inside',reference:parent.id,parent:parent.id,before_index:parent.childCount}:{placement:request.point.y<320?'before':'after',reference:'T',parent:'R',before_index:f.targetIndex+(request.point.y<320?0:1)};
        targetBox={rect:parent?.id==='R'?{x:100,y:50,width:300,height:400}:{x:120,y:300,width:240,height:40},clip:{x:0,y:0,width:600,height:500}};
      }
      if(f.noDestination&&request.insideParent===null)destination=null;
      if(f.targetRect&&targetBox)targetBox.rect=f.targetRect;
      const measured=freeze({status:'drag_measured',stamp:f.stamp,context:f.context,source:f.sourceClone?{...S,index:9}:S,sourceBox,hit:request.point?target:null,insideParents:parents,destination,targetBox,viewport:{x:0,y:0,width:600,height:500},work:{objects:4,childSlots:2,ancestors:3,rects:4}});
      f.onGeometry?.(request);return measured;
    }},
    hostRequests:{
      status:()=>f.hostFailure??{status:'available',stamp:f.stamp,context:f.context},
      capture(options){assert.equal(options.focusScope,gutter);const request=Object.freeze({stamp:f.stamp,context:f.context});f.captures.push(request);f.live.add(request);return{status:'captured',request};},
      release(request){f.releases.push(request);return f.live.delete(request);},
      complete(request,command,options){assert.ok(f.live.delete(request),'only the exact original live request can complete');f.completed.push({request,command,options});f.onComplete?.();return f.completionFailure??Object.freeze({status:'submitted',submission:f.submission,focus:f.focus});},
    },
  };
  f.owner=new DragOwner({editor:f.editor,element:host,gutter,prefix:'controlled-drag',source:()=>S.id,
    beforeOpen(){f.beforeOpens++;f.beforeOpen?.();},keyboard(){f.keyboardCalls++;},invoke:callback=>callback(),
    feedback:message=>f.feedback.push(message),failure:value=>f.failures.push(value),reason:value=>value.diagnostic?.code??value.code??'native failure',
    result:value=>f.results.push(value),schedule:()=>f.schedules++,moved:source=>f.moved.push(source)},'en');
  f.profile=Object.freeze({move:(captured,destination)=>{f.factoryCalls.push({captured,destination});return f.factory(captured,destination);}});
  f.owner.configure(f.profile,'en');
  f.down=(values={})=>{const e=event('pointerdown',{clientX:30,clientY:110,...values});doc.dispatchEvent(e);f.owner.handle.dispatchEvent(e);return e;};
  f.move=(x=150,y=310,values={})=>{const e=event('pointermove',{clientX:x,clientY:y,...values});win.dispatchEvent(e);return e;};
  f.up=(x=150,y=310,values={})=>{const e=event('pointerup',{clientX:x,clientY:y,...values});win.dispatchEvent(e);return e;};
  f.key=(key,values={})=>{const e=event('keydown',{key,...values});doc.dispatchEvent(e);return e;};
  f.handleKey=(key,values={})=>{const e=event('keydown',{key,...values});f.owner.handle.dispatchEvent(e);return e;};
  f.signal=(type,values={})=>{const e=event(type,values);(['blur','resize','pointercancel','lostpointercapture'].includes(type)?win:doc).dispatchEvent(e);return e;};
  f.click=()=>{const e=event('click');f.owner.handle.dispatchEvent(e);return e;};
  f.advance=ms=>{time+=ms;};
  f.frame=(ms=16)=>{time+=ms;const current=[...frames.values()];frames.clear();for(const fn of current)fn(time);};
  f.bump=(field='revision')=>f.stamp=freeze({...f.stamp,[field]:String(BigInt(f.stamp[field])+1n)});
  f.arm=()=>{f.down();assert.equal(f.owner.resources().dragGestures,1);assert.equal(f.owner.resources().pointerCaptures,1);return f.captures.at(-1);};
  f.hover=()=>{f.move();f.frame();};
  f.idle=()=>{const r=f.owner.resources();for(const key of ['animationFrames','hostRequests','dragGestures','pointerCaptures'])assert.equal(r[key],0,key);assert.equal(f.frames.size,0);assert.equal(f.live.size,0);};
  f.destroy=async()=>{await f.owner.destroy();assert.deepEqual(f.owner.resources(),{listeners:0,animationFrames:0,hostRequests:0,continuations:0,dragGestures:0,pointerCaptures:0});assert.equal(f.gutter.children.length,0);assert.equal(f.focusWrites,0);assert.equal(f.selectionWrites,0);f.idle();};
  return f;
}
export const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
