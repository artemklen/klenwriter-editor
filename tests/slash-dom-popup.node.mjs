// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled DOM-brand/MutationObserver boundary doubles; actual DOM/AT evidence belongs to browser lanes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PopupPresentationOwner } from '../packages/dom/dist/popup-presentation.js';
const records=new WeakMap();
class Node {
  constructor(doc){records.set(this,{doc,connected:true,children:[],parent:null,attrs:new Map()});}
  get ownerDocument(){return record(this).doc;}
  get isConnected(){return record(this).connected;}
  get childNodes(){return record(this).children;}
  contains(node){return this===node||record(this).children.some(child=>Node.prototype.contains.call(child,node));}
}
const record=x=>{const value=records.get(x);if(!value)throw TypeError('DOM brand');return value;};
class Element extends Node {
  getAttribute(name){return record(this).attrs.get(name)??null;}
  setAttribute(name,value){record(this).attrs.set(name,String(value));record(this).reaction?.(name);}
  removeAttribute(name){record(this).attrs.delete(name);}
}
class Document {
  constructor(){this.all=[];this.defaultView={Node,Element,HTMLElement:Element,Document};}
  getElementById(id){return this.all.find(node=>record(node).connected&&Element.prototype.getAttribute.call(node,'id')===id)??null;}
}
function fixture(){
  const doc=new Document(),make=(id,role)=>{const n=new Element(doc);doc.all.push(n);if(id)n.setAttribute('id',id);if(role)n.setAttribute('role',role);return n;};
  const root=make('editor','textbox'),list=make('picker','listbox'),a=make('a','option'),b=make('b','option');
  const append=(parent,child)=>{record(parent).children.push(child);record(child).parent=parent;};append(list,a);append(list,b);
  root.setAttribute('aria-haspopup','dialog');root.setAttribute('aria-controls','host-owned');
  let guard=null,drain=null,stamp={session:'s',generation:'1',revision:'0',selection_epoch:'0',history_epoch:'0'},context={build_id:'controlled'};
  const writes=[];let owner;
  owner=new PopupPresentationOwner({element:()=>root,capture:()=>structuredClone(stamp),context:()=>context,guard:()=>guard,write(change,cleanup){writes.push(['drain',cleanup]);drain?.();if(guard&&!cleanup)return guard;writes.push(['disconnect',cleanup]);try{change();}finally{writes.push(['reobserve',cleanup]);}return null;}});
  return {owner,root,list,a,b,doc,make,append,writes,setGuard:x=>guard=x,setDrain:x=>drain=x,bump(){stamp={...stamp,revision:'1'};},open:()=>owner.api.open({element:root,listbox:list,activeOption:a})};
}
test('popup writes exactly textbox-compatible owned ARIA; updates active descendant and restores previous attrs',()=>{
  const f=fixture(),opened=f.open();assert.equal(opened.status,'opened');assert.equal(f.owner.resources().handles,1);
  assert.equal(f.root.getAttribute('role'),'textbox');assert.equal(f.root.getAttribute('aria-expanded'),null);assert.equal(f.root.getAttribute('aria-haspopup'),'listbox');assert.equal(f.root.getAttribute('aria-controls'),'picker');assert.equal(f.root.getAttribute('aria-activedescendant'),'a');
  assert.equal(opened.presentation.update({activeOption:f.b}).status,'updated');assert.equal(f.root.getAttribute('aria-activedescendant'),'b');assert.equal(opened.presentation.update({activeOption:null}).status,'updated');assert.equal(f.root.getAttribute('aria-activedescendant'),null);
  opened.presentation.dispose();opened.presentation.dispose();assert.equal(f.owner.resources().handles,0);assert.equal(f.root.getAttribute('aria-haspopup'),'dialog');assert.equal(f.root.getAttribute('aria-controls'),'host-owned');assert.equal(f.root.getAttribute('aria-activedescendant'),null);
  assert.deepEqual(f.writes.slice(0,3),[['drain',false],['disconnect',false],['reobserve',false]]);
});
test('one live handle, old disposed handle cannot update/release later owner, destroy clears references',()=>{
  const f=fixture(),old=f.open();assert.equal(f.open().diagnostic.code,'dom.busy');old.presentation.dispose();const newer=f.open();old.presentation.dispose();assert.equal(f.owner.resources().handles,1);assert.equal(old.presentation.update({activeOption:f.a}).diagnostic.code,'dom.disposed');
  f.owner.destroy();assert.equal(f.owner.resources().handles,0);assert.equal(newer.presentation.update({activeOption:f.a}).diagnostic.code,'dom.disposed');assert.equal(f.open().diagnostic.code,'dom.disposed');
  const reaction=fixture();record(reaction.root).reaction=name=>{if(name==='aria-haspopup')reaction.owner.destroy();};
  assert.equal(reaction.open().status,'dom_refused');assert.equal(reaction.owner.resources().handles,0);assert.equal(reaction.root.getAttribute('aria-controls'),'host-owned');assert.equal(reaction.root.getAttribute('aria-haspopup'),'dialog');
});
test('foreign attribute writes survive compare-and-restore disposal and invalidate the live handle',()=>{
  const f=fixture(),opened=f.open();f.root.setAttribute('aria-controls','foreign');f.owner.validate();assert.equal(f.owner.resources().handles,0);assert.equal(f.root.getAttribute('aria-controls'),'foreign');assert.equal(f.root.getAttribute('aria-haspopup'),'dialog');assert.equal(opened.presentation.update({activeOption:null}).diagnostic.code,'dom.disposed');
});
test('element identity checked without evaluating foreign getters; prototype fakes fail native brand',()=>{
  const f=fixture();let calls=0;const foreign={get ownerDocument(){calls++;throw Error('foreign');}};
  assert.equal(f.owner.api.open({element:foreign,listbox:f.list,activeOption:null}).diagnostic.code,'dom.invalid_options');assert.equal(calls,0);
  const fake=Object.create(Element.prototype);Object.defineProperty(fake,'ownerDocument',{get(){calls++;throw Error('foreign');}});
  assert.equal(f.owner.api.open({element:f.root,listbox:fake,activeOption:null}).diagnostic.code,'dom.invalid_options');assert.equal(calls,0);assert.equal(f.owner.resources().handles,0);
  Object.defineProperty(f.list,'getAttribute',{get(){calls++;throw Error('foreign method');}});assert.equal(f.open().status,'opened');assert.equal(calls,0);
});
test('closed own-data request rejects accessor/extra keys without evaluating getters; parser reentry is refused',()=>{
  const f=fixture();let calls=0;const value={element:f.root,listbox:f.list,get activeOption(){calls++;return null;}};assert.equal(f.owner.api.open(value).diagnostic.code,'dom.invalid_options');assert.equal(calls,0);
  assert.equal(f.owner.api.open({element:f.root,listbox:f.list,activeOption:null,extra:true}).diagnostic.code,'dom.invalid_options');
  let nested;const proxy=new Proxy({element:f.root,listbox:f.list,activeOption:null},{getPrototypeOf(target){nested=f.open();return Object.getPrototypeOf(target);}});assert.equal(f.owner.api.open(proxy).status,'opened');assert.equal(nested.diagnostic.code,'dom.busy');
});
test('same-document connection/roles/browser ID identity and external-root relationships are required',()=>{
  for(const kind of ['foreign','detached','wrong-role','wrong-id','option-outside','inside-editor','contains-editor']){
    const f=fixture();if(kind==='foreign')record(f.list).doc=new Document();if(kind==='detached')record(f.a).connected=false;if(kind==='wrong-role')f.a.setAttribute('role','button');if(kind==='wrong-id')f.a.setAttribute('id','a b');if(kind==='option-outside')record(f.list).children.splice(0,1);if(kind==='inside-editor')f.append(f.root,f.list);if(kind==='contains-editor')f.append(f.list,f.root);
    assert.equal(f.open().diagnostic.code,'dom.invalid_options',kind);assert.equal(f.owner.resources().handles,0,kind);
  }
});
test('local option validation is finite32 with distinct resolving IDs',()=>{
  const f=fixture();for(let i=2;i<32;i++)f.append(f.list,f.make(`option-${i}`,'option'));const opened=f.open();assert.equal(opened.status,'opened');opened.presentation.dispose();f.append(f.list,f.make('option-33','option'));assert.equal(f.open().diagnostic.code,'dom.invalid_options');
  const duplicate=fixture();duplicate.b.setAttribute('id','a');assert.equal(duplicate.open().diagnostic.code,'dom.invalid_options');
});
test('real pending-mutation refusal is retained before write; invalidated references retire on refresh',()=>{
  const f=fixture();const refusal={status:'dom_refused',diagnostic:{code:'dom.recovery_required'}};f.setDrain(()=>f.setGuard(refusal));assert.equal(f.open(),refusal);assert.equal(f.owner.resources().handles,0);assert.equal(f.root.getAttribute('aria-controls'),'host-owned');
  const g=fixture(),opened=g.open();record(g.list).connected=false;g.owner.validate();assert.equal(g.owner.resources().handles,0);assert.equal(opened.presentation.update({activeOption:null}).diagnostic.code,'dom.disposed');assert.equal(g.root.getAttribute('aria-controls'),'host-owned');
});
