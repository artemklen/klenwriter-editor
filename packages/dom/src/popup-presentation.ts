// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DeepReadonly, SessionContextV2, StampDto } from '@klenwriter/editor-sdk';
import type { DomRefusal, MountedPopupPresentation, MountedPopupPresentationHandle } from './types.js';
import { fields } from './ownership.js';
import { domRefusal } from './refusal.js';

interface Configuration {
  element():HTMLElement|null; capture():DeepReadonly<StampDto>|null; context():DeepReadonly<SessionContextV2>|null;
  guard():DomRefusal|null;
  write(change:()=>void,cleanup:boolean):DomRefusal|null;
}
const ATTRS=['aria-haspopup','aria-controls','aria-activedescendant'] as const;
type Attributes=Map<string,string|null>;
type Entry={element:HTMLElement|null;listbox:HTMLElement|null;option:HTMLElement|null;before:Attributes;written:Attributes};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

/** One presentation capability; it never captures or restores native selection. */
export class PopupPresentationOwner {
  readonly api:MountedPopupPresentation;
  #configuration:Configuration|null;
  #entry:Entry|null=null;
  #operating=false;
  constructor(configuration:Configuration){
    this.#configuration=configuration;
    this.api=Object.freeze({open:(options:Parameters<MountedPopupPresentation['open']>[0])=>this.open(options)});
  }
  resources():Readonly<{handles:number}>{return Object.freeze({handles:this.#entry?1:0});}
  #failure(code:DomRefusal['diagnostic']['code']):DomRefusal{return domRefusal(code,'render',this.#configuration?.capture()??null);}
  #parse(value:unknown,keys:readonly string[]):Record<string,unknown>{
    const result=fields(value);
    if(Object.keys(result).length!==keys.length||keys.some(key=>!Object.hasOwn(result,key)))throw new TypeError();
    return result;
  }
  #references(element:HTMLElement,listbox:unknown,option:unknown):listbox is HTMLElement {
    const doc=element.ownerDocument,win=doc.defaultView!;
    const owner=Object.getOwnPropertyDescriptor(win.Node.prototype,'ownerDocument')!.get!;
    const connected=Object.getOwnPropertyDescriptor(win.Node.prototype,'isConnected')!.get!;
    const children=Object.getOwnPropertyDescriptor(win.Node.prototype,'childNodes')!.get!;
    const contains=win.Node.prototype.contains,get=win.Element.prototype.getAttribute;
    const id=(node:HTMLElement)=>{
      const value=get.call(node,'id');
      return value && value.length<=256 && !/[\t\n\f\r ]/.test(value) && win.Document.prototype.getElementById.call(doc,value)===node?value:null;
    };
    const genuine=(node:unknown):node is HTMLElement=>{
      // Native getters supply the DOM brand check before reading supplied properties.
      try{return owner.call(node)===doc && connected.call(node)===true && node instanceof win.HTMLElement;}
      catch{return false;}
    };
    if(!genuine(element)||!genuine(listbox)||contains.call(element,listbox)||contains.call(listbox,element)
      ||get.call(listbox,'role')!=='listbox'||!id(listbox))return false;
    const ids=new Set<string>([id(listbox)!]);
    let count=0,visited=0,found=option===null;
    const stack:{node:Node;depth:number}[]=[{node:listbox,depth:0}];
    while(stack.length){
      const row=stack.pop()!;
      if(++visited>256||row.depth>8)return false;
      if(row.node!==listbox && row.node instanceof win.HTMLElement && get.call(row.node,'role')==='option'){
        if(!genuine(row.node)||++count>32)return false;
        const value=id(row.node);if(!value||ids.has(value))return false;ids.add(value);
        if(row.node===option)found=true;
      }
      const nodes=children.call(row.node) as NodeListOf<ChildNode>;
      if(nodes.length>256-visited-stack.length)return false;
      for(let i=nodes.length-1;i>=0;i--)stack.push({node:nodes[i],depth:row.depth+1});
    }
    return found && (option===null || genuine(option));
  }
  #get(element:HTMLElement,name:string):string|null {return this.#configuration!.element()!.ownerDocument.defaultView!.Element.prototype.getAttribute.call(element,name);}
  #attributes(entry:Entry,option:HTMLElement|null):Attributes {
    return new Map([['aria-haspopup','listbox'],['aria-controls',this.#get(entry.listbox!,'id')],['aria-activedescendant',option?this.#get(option,'id'):null]]);
  }
  #apply(entry:Entry,values:Attributes):void {
    const element=entry.element!;
    const prototype=element.ownerDocument.defaultView!.Element.prototype;
    for(const [name,value] of values){
      if(this.#entry!==entry||!this.#configuration)return;
      // A custom-element attribute reaction may synchronously dispose/destroy.
      // Record ownership before that reaction and never continue a retired write.
      entry.written.set(name,value);
      if(value===null)prototype.removeAttribute.call(element,name);else prototype.setAttribute.call(element,name,value);
    }
  }
  #fresh(c:Configuration,stamp:DeepReadonly<StampDto>|null,context:DeepReadonly<SessionContextV2>|null):boolean {
    return this.#configuration===c && !!stamp && !!context && !c.guard() && same(stamp,c.capture())&&same(context,c.context());
  }
  open(options:Parameters<MountedPopupPresentation['open']>[0]):ReturnType<MountedPopupPresentation['open']>{
    const c=this.#configuration;if(!c)return this.#failure('dom.disposed');
    if(this.#operating||this.#entry)return this.#failure('dom.busy');
    const guard=c.guard();if(guard)return guard;
    const stamp=c.capture(),context=c.context();this.#operating=true;
    try{
      const value=this.#parse(options,['element','listbox','activeOption']);
      // Identity admission precedes any access to the caller's element.
      const element=c.element();
      if(!element||value.element!==element||!this.#references(element,value.listbox,value.activeOption))return this.#failure('dom.invalid_options');
      if(!this.#fresh(c,stamp,context))return this.#failure('dom.busy');
      const entry:Entry={element,listbox:value.listbox,option:value.activeOption as HTMLElement|null,
        before:new Map(ATTRS.map(name=>[name,this.#get(element,name)])),written:new Map()};
      this.#entry=entry;
      const refusal=c.write(()=>this.#apply(entry,this.#attributes(entry,entry.option)),false);
      if(refusal){this.retire();return refusal;}
      if(!this.#fresh(c,stamp,context)||this.#entry!==entry){this.retire();return this.#failure('dom.busy');}
      const presentation:MountedPopupPresentationHandle=Object.freeze({update:(value:Parameters<MountedPopupPresentationHandle['update']>[0])=>this.#update(entry,value),dispose:()=>this.#dispose(entry)});
      return Object.freeze({status:'opened',presentation,stamp:stamp!,context:context!});
    }catch{this.retire();return this.#failure('dom.invalid_options');}
    finally{this.#operating=false;}
  }
  #update(entry:Entry,options:Parameters<MountedPopupPresentationHandle['update']>[0]):ReturnType<MountedPopupPresentationHandle['update']>{
    const c=this.#configuration;if(!c||this.#entry!==entry)return this.#failure('dom.disposed');
    if(this.#operating)return this.#failure('dom.busy');
    const guard=c.guard();if(guard)return guard;
    const stamp=c.capture(),context=c.context();this.#operating=true;
    try{
      const value=this.#parse(options,['activeOption']);
      if(entry.element!==c.element()||!this.#valid(entry,value.activeOption)){this.retire();return this.#failure('dom.invalid_options');}
      if(!this.#fresh(c,stamp,context))return this.#failure('dom.busy');
      const refusal=c.write(()=>this.#apply(entry,this.#attributes(entry,value.activeOption as HTMLElement|null)),false);
      if(refusal){this.retire();return refusal;}
      if(!this.#fresh(c,stamp,context)||this.#entry!==entry){this.retire();return this.#failure('dom.busy');}
      entry.option=value.activeOption as HTMLElement|null;
      return Object.freeze({status:'updated',stamp:stamp!,context:context!});
    }catch{return this.#failure('dom.invalid_options');}
    finally{this.#operating=false;}
  }
  #valid(entry:Entry,option:unknown):boolean {
    return !!entry.element && this.#references(entry.element,entry.listbox,option)
      && [...entry.written].every(([name,value])=>this.#get(entry.element!,name)===value);
  }
  validate():void {try{if(this.#entry&&!this.#valid(this.#entry,this.#entry.option))this.retire();}catch{this.retire();}}
  #dispose(entry:Entry):void {
    if(this.#entry!==entry)return;
    this.#entry=null;
    const element=entry.element,operating=this.#operating;this.#operating=true;
    try{
      if(element){const prototype=element.ownerDocument.defaultView!.Element.prototype;
        this.#configuration?.write(()=>{
          for(const [name,value] of entry.before){
            if(!entry.written.has(name)||prototype.getAttribute.call(element,name)!==entry.written.get(name))continue;
            if(value===null)prototype.removeAttribute.call(element,name);else prototype.setAttribute.call(element,name,value);
          }
        },true);
      }
    }finally{
      entry.element=null;entry.listbox=null;entry.option=null;entry.before.clear();entry.written.clear();this.#operating=operating;
    }
  }
  retire():void {if(this.#entry)this.#dispose(this.#entry);}
  destroy():void {this.retire();this.#configuration=null;}
}
