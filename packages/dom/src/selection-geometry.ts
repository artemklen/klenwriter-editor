// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DomPoint, DomView } from './view.js';
export interface VisibleBox { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export interface EdgeGeometry { readonly clip: VisibleBox; readonly scroller: HTMLElement; readonly viewportScroller: boolean }
const finite = (r: VisibleBox) => [r.left,r.top,r.right,r.bottom].every(Number.isFinite) && r.right > r.left && r.bottom > r.top;
const intersect = (a: VisibleBox,b: VisibleBox): VisibleBox => ({left:Math.max(a.left,b.left),top:Math.max(a.top,b.top),right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)});
/** Rectangle-only browser correspondence. No model traversal or layout simulation. */
export function edgeGeometry(host: HTMLElement,start?: Node): EdgeGeometry | null {
  const doc=host.ownerDocument, win=doc.defaultView; if (!win || !host.isConnected) return null;
  const visual=win.visualViewport;
  let clip: VisibleBox={left:visual?.offsetLeft ?? 0,top:visual?.offsetTop ?? 0,right:(visual?.offsetLeft ?? 0)+(visual?.width ?? doc.documentElement.clientWidth),bottom:(visual?.offsetTop ?? 0)+(visual?.height ?? doc.documentElement.clientHeight)};
  if(start && start!==host && !host.contains(start))return null;
  let scroller: HTMLElement | null=null, ancestor: HTMLElement | null=start instanceof win.HTMLElement?start:start?.parentElement ?? host, count=0;
  while (ancestor) {
    if (++count>32) return null;
    const style=win.getComputedStyle(ancestor);
    if (style.writingMode!=='horizontal-tb' || style.getPropertyValue('zoom') && !['1','normal'].includes(style.getPropertyValue('zoom'))) return null;
    if (style.scrollBehavior==='smooth' || style.transform!=='none' || style.perspective!=='none' || style.clipPath!=='none' || style.getPropertyValue('mask-image') && style.getPropertyValue('mask-image')!=='none') return null;
    const cropX=style.overflowX!=='visible', cropY=style.overflowY!=='visible';
    if (cropX || cropY) {
      if ([style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomLeftRadius,style.borderBottomRightRadius].some(value=>value.split(' ').some(v=>parseFloat(v)!==0))) return null;
      const rect=ancestor.getBoundingClientRect(), box={left:rect.left+ancestor.clientLeft,top:rect.top+ancestor.clientTop,right:rect.left+ancestor.clientLeft+ancestor.clientWidth,bottom:rect.top+ancestor.clientTop+ancestor.clientHeight};
      if (!finite(box)) return null;
      clip=intersect(clip,{left:cropX?box.left:clip.left,right:cropX?box.right:clip.right,top:cropY?box.top:clip.top,bottom:cropY?box.bottom:clip.bottom});
    }
    if (!scroller && ['auto','scroll'].includes(style.overflowY) && ancestor.scrollHeight>ancestor.clientHeight) scroller=ancestor;
    ancestor=ancestor.parentElement;
  }
  if (!finite(clip)) return null;
  const viewportScroller=!scroller;
  scroller ??= doc.scrollingElement instanceof win.HTMLElement ? doc.scrollingElement : doc.documentElement;
  return {clip,scroller,viewportScroller};
}
export function caretVisible(doc: Document,point: DomPoint,clip: VisibleBox): boolean {
  try {
    const range=doc.createRange();range.setStart(point.node,point.offset);range.collapse(true);
    const rects=range.getClientRects();
    for (let i=0;i<rects.length;i++) {
      const r=rects[i];
      if ([r.left,r.top,r.right,r.bottom,r.height].every(Number.isFinite) && r.height>0 && r.width>=0 && r.left>=clip.left-.5 && r.right<=clip.right+.5 && r.top>=clip.top-.5 && r.bottom<=clip.bottom+.5) return true;
    }
  } catch { /* A missing native caret is unsupported, never a guessed glyph. */ }
  return false;
}
/** At most eight actual browser hits; every returned point has a wholly visible caret. */
export function visibleEdgeHit(host: HTMLElement,view: DomView,geometry: EdgeGeometry,x: number,direction: -1|1): DomPoint | null {
  const {clip}=geometry,doc=host.ownerDocument;
  const hitDoc=doc as Document & {caretPositionFromPoint?: (x:number,y:number)=>{offsetNode:Node;offset:number}|null;caretRangeFromPoint?: (x:number,y:number)=>Range|null};
  const boundedX=Math.max(clip.left+.5,Math.min(clip.right-.5,x));
  for (const inset of [.5,8,16,24,32,40,48,64]) {
    const y=direction===1?clip.bottom-inset:clip.top+inset;
    if (y<clip.top || y>clip.bottom) continue;
    let point: DomPoint | null=null;
    try {
      const caret=hitDoc.caretPositionFromPoint?.(boundedX,y);
      if (caret) point={node:caret.offsetNode,offset:caret.offset};
      else { const range=hitDoc.caretRangeFromPoint?.(boundedX,y);if(range)point={node:range.startContainer,offset:range.startOffset}; }
    } catch { return null; }
    if (!point || !host.contains(point.node)) continue;
    const model=view.textPosition(point.node,point.offset);
    const actual=edgeGeometry(host,point.node);
    if (!model || 'status' in model || !actual || actual.scroller!==geometry.scroller || !caretVisible(doc,point,actual.clip)) continue;
    return point;
  }
  return null;
}
