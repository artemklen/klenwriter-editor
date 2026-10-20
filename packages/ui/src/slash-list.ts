// SPDX-License-Identifier: MIT OR Apache-2.0
export interface SlashListItem {
  readonly id:string;readonly label:string;readonly available:boolean;readonly reason:string;
}
interface Option {readonly element:HTMLDivElement;readonly label:HTMLSpanElement;readonly reason:HTMLSpanElement}
/** Literal presentation only; these option identities never authorize commands. */
export class SlashList {
  readonly element:HTMLDivElement;
  #options=new Map<string,Option>();#owned=new WeakMap<Node,string>();
  #active:HTMLElement|null=null;#serial=0;#empty:HTMLDivElement;#destroyed=false;
  constructor(readonly document:Document,readonly prefix:string){
    this.element=document.createElement('div');this.element.id=`${prefix}-list`;
    this.element.className='kw-ui-popup kw-ui-slash';this.element.setAttribute('role','listbox');this.element.hidden=true;
    this.#empty=document.createElement('div');this.#empty.className='kw-ui-reason';this.#empty.setAttribute('role','status');
  }
  update(items:readonly SlashListItem[],activeId:string|null,label:string,emptyLabel:string,locale:'ru'|'en'):void {
    if(this.#destroyed)return;
    this.element.setAttribute('aria-label',label);this.element.lang=locale;this.#active=null;
    const live=new Set(items.map(item=>item.id));
    for(const [id,option]of this.#options)if(!live.has(id)){option.element.remove();this.#owned.delete(option.element);this.#options.delete(id);}
    if(items.length)this.#empty.remove();
    let next=this.element.firstChild;
    for(const item of items){
      let option=this.#options.get(item.id);
      if(!option){
        const element=this.document.createElement('div'),name=this.document.createElement('span'),reason=this.document.createElement('span');
        element.id=`${this.prefix}-option-${++this.#serial}`;element.className='kw-ui-button kw-ui-slash-option';element.tabIndex=-1;element.setAttribute('role','option');
        reason.id=`${element.id}-reason`;reason.className='kw-ui-reason';element.setAttribute('aria-describedby',reason.id);element.append(name,reason);
        option={element,label:name,reason};this.#options.set(item.id,option);this.#owned.set(element,item.id);
      }
      if(option.label.textContent!==item.label)option.label.textContent=item.label;
      if(option.reason.textContent!==item.reason)option.reason.textContent=item.reason;
      option.element.setAttribute('aria-disabled',String(!item.available));
      option.element.setAttribute('aria-selected',String(item.id===activeId));
      if(item.id===activeId)this.#active=option.element;
      if(option.element!==next)this.element.insertBefore(option.element,next);
      next=option.element.nextSibling;
    }
    if(!items.length){this.#empty.textContent=emptyLabel;this.element.append(this.#empty);}
  }
  get activeOption():HTMLElement|null{return this.#active;}
  optionFor(target:EventTarget|null):string|null {
    const NodeConstructor=this.document.defaultView?.Node;
    if(!NodeConstructor||!(target instanceof NodeConstructor))return null;
    let node:Node|null=target;
    const parent=Object.getOwnPropertyDescriptor(NodeConstructor.prototype,'parentNode')!.get!;
    try{for(let depth=0;node&&node!==this.element&&depth<8;depth++){
      const actualParent=parent.call(node) as Node|null;
      const id=this.#owned.get(node);if(id&&this.#options.get(id)?.element===node&&actualParent===this.element)return id;
      node=actualParent;
    }}catch{return null;}
    return null;
  }
  scrollActive():void {
    const active=this.#active;if(this.#destroyed||!active||!this.element.isConnected||this.element.hidden)return;
    const list=this.element.getBoundingClientRect(),option=active.getBoundingClientRect();
    const current=this.element.scrollTop,max=Math.max(0,this.element.scrollHeight-this.element.clientHeight);
    const scale=list.height/this.element.offsetHeight;
    if(![list.top,list.bottom,option.top,option.bottom,current,max,scale].every(Number.isFinite)||scale<=0)return;
    // Rects include CSS zoom; scrollTop/clientHeight use the element's local
    // CSS units. Convert only this list's measured scroll, never page scroll.
    const top=list.top+this.element.clientTop*scale,bottom=top+this.element.clientHeight*scale;
    const delta=option.top<top?option.top-top:option.bottom>bottom?option.bottom-bottom:0;
    this.element.scrollTop=Math.max(0,Math.min(max,current+delta/scale));
  }
  destroy():void{if(this.#destroyed)return;this.#destroyed=true;this.element.remove();this.#options.clear();this.#owned=new WeakMap();this.#active=null;this.#empty.remove();}
}
