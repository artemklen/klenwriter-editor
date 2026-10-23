// SPDX-License-Identifier: MIT OR Apache-2.0
// Measurement math is independent of the editor's geometry/placement helpers.
export function rgba(value){
  const match=/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value);
  if(!match)throw Error(`Unsupported measured color ${value}`);
  const out=[+match[1]/255,+match[2]/255,+match[3]/255,match[4]===undefined?1:+match[4]];
  if(out.some(n=>!Number.isFinite(n)||n<0||n>1))throw Error('Measured color outside RGB bounds');return out;
}
export function composite(front,back){const a=front[3]+back[3]*(1-front[3]);if(!a)return [0,0,0,0];return [0,1,2].map(i=>(front[i]*front[3]+back[i]*back[3]*(1-front[3]))/a).concat(a);}
export function contrast(front,back){const light=c=>{const rgb=c.slice(0,3).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};const a=light(front),b=light(back);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
export function measuredContrast(observation){
  if(observation.backgrounds.some(row=>row.opacity!==1))throw Error('Opaque scoped contrast fixture required');
  const compose=rows=>{let value=[1,1,1,1];for(const row of [...rows].reverse())value=composite(rgba(row.color),value);return value;};
  const background=compose(observation.backgrounds),outside=compose(observation.backgrounds.slice(1));
  return {text:contrast(composite(rgba(observation.color),background),background),border:contrast(composite(rgba(observation.borderColor),outside),outside),outline:contrast(composite(rgba(observation.outlineColor),outside),outside),background,outside};
}
export function observeSurface(element){
  const rect=element.getBoundingClientRect(),style=getComputedStyle(element),backgrounds=[];
  for(let node=element;node;node=node.parentElement){if(backgrounds.length===32)throw Error('Contrast ancestor cap');const s=getComputedStyle(node);backgrounds.push({color:s.backgroundColor,opacity:Number(s.opacity)});}
  const points=[[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]],hits=points.map(([x,y])=>{const px=rect.x+rect.width*x,py=rect.y+rect.height*y,hit=document.elementFromPoint(px,py);return {x:px,y:py,inside:!!hit&&(hit===element||element.contains(hit))};});
  return {tag:element.tagName,color:style.color,borderColor:style.borderTopColor,outlineColor:style.outlineColor,outlineStyle:style.outlineStyle,outlineWidth:parseFloat(style.outlineWidth),backgrounds,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},hits,visible:style.visibility==='visible'&&style.display!=='none'&&rect.width>0&&rect.height>0,clipped:element.scrollWidth>element.clientWidth+1||element.scrollHeight>element.clientHeight+1,viewport:{width:innerWidth,height:innerHeight},focused:document.activeElement===element};
}
export function observeLayout(root){
  const nodes=[...root.querySelectorAll('button,input,[role=option],.kw-ui-reason')].filter(node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return s.display!=='none'&&s.visibility==='visible'&&r.width>0&&r.height>0;});if(nodes.length>256)throw Error('Layout observation cap');
  return {viewport:innerWidth,shellWidth:document.documentElement.scrollWidth,targets:nodes.map(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return {id:node.id,tag:node.tagName,role:node.getAttribute('role'),text:node.textContent,width:r.width,height:r.height,left:r.left,right:r.right,clipped:node.scrollWidth>node.clientWidth+1||node.scrollHeight>node.clientHeight+1,lineHeight:s.lineHeight,fontSize:s.fontSize,letterSpacing:s.letterSpacing,wordSpacing:s.wordSpacing};})};
}
