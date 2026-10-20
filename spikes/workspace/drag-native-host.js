// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed44 observation facade over actual packaged public UI/DOM/SDK. No input synthesis.
export function installDragNativeHost(config,programs){
  const check=(condition,message)=>{if(!condition)throw Error(message);},clone=value=>structuredClone(value);
  check(config.format==='osr44-drag-http-broker/1'&&/^[a-f0-9]{32}$/.test(config.nonce),'Closed44 namespace');
  check(config.title==='KlenWriter Drag native '+config.nonce&&location.href===config.fixtureUrl&&document.title===config.title,'Exact owned document');
  check(programs.format==='editor-drag-installed-programs/1'&&!window.ui44Native,'One source-bound44 facade');
  let current=null,serial=0,objectSerial=0;const objects=new WeakMap();
  const token=value=>{if(!value)return null;if(!objects.has(value)){check(++objectSerial<=4096,'Object observation bound');objects.set(value,'o'+objectSerial);}return objects.get(value);};
  const raf=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const bounds=element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
  const inside=(p,r)=>p.x>=r.x&&p.x<r.x+r.width&&p.y>=r.y&&p.y<r.y+r.height;
  const connected=r=>[r.root,r.editor,r.source,r.target,r.handle].every(n=>n?.isConnected)&&document.getElementById(r.id)===r.root;
  const viewport=r=>{const v=visualViewport;return{width:innerWidth,height:innerHeight,scale:v?.scale,offsetLeft:v?.offsetLeft,offsetTop:v?.offsetTop,pageZoom:1024/innerWidth};};
  const active=()=>({object:token(document.activeElement),id:document.activeElement?.id??null,tag:document.activeElement?.tagName??null});
  // Window capture is installed BEFORE any mount/owner. The terminal owner may stop propagation later.
  for(const name of ['pointermove','pointerdown','pointerup','pointercancel','gotpointercapture','lostpointercapture','click','keydown','keyup','focusin','focusout','compositionstart','compositionupdate','compositionend','dragstart','dragover','drop'])window.addEventListener(name,event=>{
    const r=current;if(!r||!r.root.contains(event.target)&&!['pointerup','pointercancel','keyup'].includes(name))return;
    if(r.events.length>=16384){r.overflow=true;return;}
    const element=event.target instanceof Element?event.target:null;
    const value={name,at:performance.now(),timeOrigin:performance.timeOrigin,isTrusted:event.isTrusted,targetObject:token(element),sourceHit:!!(element&&(element===r.source||r.source.contains(element))),handleHit:!!(element&&(element===r.handle||r.handle.contains(element))),targetTag:element?.tagName??null,targetControl:element?.dataset.editorUiControl??null,
      pointerId:event.pointerId??null,pointerType:event.pointerType??null,isPrimary:event.isPrimary??null,button:event.button??null,buttons:event.buttons??null,x:event.clientX??null,y:event.clientY??null,
      key:event.key??null,code:event.code??null,shiftKey:event.shiftKey??null,metaKey:event.metaKey??null,defaultPreventedAtCapture:event.defaultPrevented,active:active()};
    r.events.push(value);
    const unpressed=name==='pointermove'&&event.isTrusted&&event.pointerType==='mouse'&&event.isPrimary===true&&event.buttons===0;
    if(unpressed&&r.hoverRequest&&value.sourceHit&&value.at>=r.hoverRequest.at&&Math.abs(value.x-r.hoverRequest.point.x)<=1&&Math.abs(value.y-r.hoverRequest.point.y)<=1)r.sourceHover={...value,index:r.events.length-1,sourceObject:token(r.source)};
    if(unpressed&&r.startRequest&&value.handleHit&&value.at>=r.startRequest.at&&Math.abs(value.x-r.start.x)<=1&&Math.abs(value.y-r.start.y)<=1)r.handleMove={...value,index:r.events.length-1,handleObject:token(r.handle)};
    if(name==='pointerdown'&&event.isTrusted&&element&&(element===r.handle||r.handle.contains(element))){r.pointerId=event.pointerId;r.down=true;}
    if(['pointerup','pointercancel'].includes(name)&&event.pointerId===r.pointerId&&event.isTrusted)r.down=false;
  },true);
  const rec=()=>{check(current,'Actual current mount');check(connected(current),'Original connected fixture objects');return current;};
  function roleElement(editor,paths,role){let node=editor;const path=paths[role];check(Array.isArray(path),'Source-authored role path');for(const index of path){check(Number.isSafeInteger(index)&&index>=0&&node.children[index],'Original role DOM membership');node=node.children[index];}return node;}
  function clip(r){const box=bounds(r.editor),left=box.x+r.editor.clientLeft,top=box.y+r.editor.clientTop;return{x:Math.max(0,left),y:Math.max(0,top),width:Math.min(innerWidth,left+r.editor.clientWidth)-Math.max(0,left),height:Math.min(innerHeight,top+r.editor.clientHeight)-Math.max(0,top)};}
  function endPoint(r){
    if(r.family.scroll){const c=clip(r);check(c.width>20&&c.height>20,'Positive genuine editor clip');return{x:c.x+c.width/2,y:r.family.scroll.direction==='down'?c.y+c.height-10:c.y+10};}
    const b=bounds(r.target);check(b.width>4&&b.height>4,'Positive original target box');
    const targetGeometry=window.ui42.dragGeometryRead(r.id,r.fixture.target);check(targetGeometry.status==='drag_measured','Compact genuine target geometry');
    r.targetHeader=clone(targetGeometry.source);
    if(r.fixture.placement==='inside'&&targetGeometry.source.primitive==='container')return{x:b.x+2,y:b.y+2};
    return{x:b.x+b.width/2,y:b.y+b.height*(r.fixture.placement==='after'?7/8:1/8)};
  }
  function geometry(r){return window.ui42.dragGeometryRead(r.id,r.fixture.source,r.end??null,r.insideParent??null);}
  async function light(r){
    const facts=window.ui42.mountedFacts(r.id),c=clip(r),target=bounds(r.target),point=r.end,maximum=r.editor.scrollHeight-r.editor.clientHeight;
    const atLimit=r.family.scroll?(r.family.scroll.direction==='down'?Math.abs(r.editor.scrollTop-maximum)<=.5:r.editor.scrollTop<=.5):false;
    return{id:r.id,caseId:r.row.id,clock:{kind:'performance.now',timeOrigin:performance.timeOrigin,at:performance.now()},facts,viewport:viewport(r),dpr:devicePixelRatio,active:active(),documentFocused:document.hasFocus(),
      sourceObject:token(r.source),handleObject:token(r.handle),targetObject:token(r.target),handleFocused:document.activeElement===r.handle,editorFocused:r.editor.contains(document.activeElement),
      handle:{box:bounds(r.handle),disabled:r.handle.getAttribute('aria-disabled'),label:r.handle.getAttribute('aria-label')??r.handle.textContent},
      menu:[...r.root.querySelectorAll('[role="menuitem"]')].map(n=>({object:token(n),label:n.textContent,focused:n===document.activeElement,disabled:n.getAttribute('aria-disabled')})),
      pointer:{down:r.down,pointerId:r.pointerId,captured:r.pointerId!==null&&r.handle.hasPointerCapture(r.pointerId)},
      scroll:{top:r.editor.scrollTop,maximum,atLimit,clip:c,target,terminal:!!(atLimit&&point&&inside(point,target)&&target.y>=c.y-.5&&target.y+target.height<=c.y+c.height+.5)},
      preview:{hidden:r.root.querySelector('.kw-ui-drag-preview')?.hidden??true,line:r.root.querySelector('.kw-ui-drag-line')?bounds(r.root.querySelector('.kw-ui-drag-line')):null},geometry:!r.down?geometry(r):null,overflow:r.overflow,eventCount:r.events.length,events:clone(r.events)};
  }
  async function checkpoint(){const r=rec();return{...(await light(r)),native:await window.ui42.inspect(r.id),nativeTrace:window.ui42.nativeTrace(r.id),events:clone(r.events),policy:clone(r.policy),errors:clone(r.errors),boundaryProvenance:clone(programs.separate_boundaries)};}
  async function prepare(locale,caseId){
    check(!current&&['en','ru'].includes(locale),'No live prior mount');const row=programs.rows.find(row=>row.id===caseId&&row.locale===locale);check(row,'Closed matching row');
    const family=programs.families.find(f=>f.id===row.family),fixture=programs.fixtures[family.fixture];check(fixture,'Frozen fixture');
    const mounted=await window.ui42.mount({drag:true,nativeTrace:true,locale,source:fixture.input,sourceRoles:fixture.roles_before,selection:fixture.selection});
    const root=document.getElementById(mounted.id),editor=document.getElementById(mounted.id+'-editor');check(root&&editor,'Genuine packaged mount');
    const r={id:mounted.id,root,editor,row,family,fixture,source:roleElement(editor,fixture.roles_before,fixture.source),target:roleElement(editor,fixture.roles_before,fixture.target),handle:root.querySelector('[data-editor-ui-control="drag"]'),events:[],policy:[],errors:[],down:false,pointerId:null,start:null,end:null,lastGuard:null,hoverRequest:null,sourceHover:null,startRequest:null,handleMove:null,insideParent:fixture.placement==='inside'?fixture.intent.parent:null,overflow:false};
    check(r.handle,'Actual packaged drag handle');current=r;
    r.policyListener=event=>r.policy.push({directive:event.effectiveDirective,blocked:event.blockedURI});r.errorListener=event=>r.errors.push(String(event.message).slice(0,1024));
    document.addEventListener('securitypolicyviolation',r.policyListener);window.addEventListener('error',r.errorListener);
    // All fixture layout/focus/scroll setup precedes the baseline and actual input.
    if(family.scroll)root.classList.add('ui-drag-scroll');
    const focused=await window.ui42.editorFocus(r.id);check(focused.response?.status==='ok','Original public exact focus setup');
    if(family.scroll)editor.scrollTop=family.scroll.prebaseline==='end'?editor.scrollHeight-editor.clientHeight:0;
    await raf();r.baseline=await checkpoint();r.events=[];
    return{id:r.id,row:clone(row),family:family.id,baseline:r.baseline,sourceObjects:{source:token(r.source),handle:token(r.handle),target:token(r.target)},qualifiedBoundaries:clone(programs.separate_boundaries)};
  }
  async function guard(action,cleanup=false){
    const r=rec();check(r.family.actions.includes(action),'Closed family action');
    if(action==='move-start'&&!cleanup){
      await raf();check(r.handle.getAttribute('aria-disabled')==='false','Genuine hovered source handle available');
      const hover=r.sourceHover,requested=r.hoverRequest;
      check(requested&&hover&&hover.index>=requested.eventOffset&&hover.sourceObject===token(r.source)&&hover.timeOrigin===performance.timeOrigin&&hover.at>=requested.at&&performance.now()-hover.at<=1000,'Fresh original trusted source hover lineage');
      check(!r.start&&!r.startRequest,'Original handle/endpoint binding happens once before Down');
      const facts=window.ui42.mountedFacts(r.id);check(JSON.stringify(facts.stamp)===JSON.stringify(requested.stamp)&&JSON.stringify(facts.context)===JSON.stringify(requested.context),'Source-hover native baseline unchanged');
      const g=window.ui42.dragGeometryRead(r.id,r.fixture.source);check(g.status==='drag_measured','Genuine original source geometry');
      const b=bounds(r.handle);r.start={x:b.x+b.width/2,y:b.y+b.height/2};r.end=endPoint(r);
      r.startRequest={at:performance.now(),eventOffset:r.events.length,sourceHover:clone(hover),stamp:clone(facts.stamp),context:clone(facts.context),handleObject:token(r.handle)};
    }
    if(!cleanup&&!['hover-source','zoom-in','zoom-reset'].includes(action))check(r.start&&r.startRequest,'Original pre-Down binding required; no late point recapture');
    let point=null;
    if(action==='hover-source'){const b=bounds(r.source),container=['BLOCKQUOTE','UL','OL'].includes(r.source.tagName);point={x:b.x+(container?2:Math.min(32,b.width/2)),y:b.y+(container?2:b.height/2)};}
    else if(['move-start','down'].includes(action))point=r.start;
    else if(/^move-[1-8]$/.test(action)){check(r.start&&r.end,'Original fixed path');const fraction=Number(action.at(-1))/8;point={x:r.start.x+(r.end.x-r.start.x)*fraction,y:r.start.y+(r.end.y-r.start.y)*fraction};}
    else if(action==='up')point=cleanup?r.lastGuard?.point:r.end;
    if(cleanup&&action!=='up')point=null;
    if(!cleanup&&point){check(Number.isFinite(point.x)&&Number.isFinite(point.y)&&inside(point,{x:0,y:0,width:innerWidth,height:innerHeight}),'Actual fixed point inside viewport');}
    let actualUnpressedHandleMove=false,downProof=null;
    if(action==='hover-source'&&!cleanup){
      const facts=window.ui42.mountedFacts(r.id);check(!r.hoverRequest,'No source-hover replay');
      r.hoverRequest={at:performance.now(),eventOffset:r.events.length,point:clone(point),sourceObject:token(r.source),stamp:clone(facts.stamp),context:clone(facts.context)};
    }
    if(action==='down'&&!cleanup){
      const move=r.handleMove,original=r.startRequest,now=performance.now(),box=bounds(r.handle),hit=document.elementFromPoint(r.start.x,r.start.y);
      check(original&&move&&move.index>=original.eventOffset&&move.handleObject===original.handleObject&&move.timeOrigin===performance.timeOrigin&&move.at>=original.at&&move.at>=original.sourceHover.at&&move.at<=now&&now-move.at<=1000,'Fresh matching trusted unpressed handle move');
      check(move.pointerId===original.sourceHover.pointerId,'Original source-hover pointer identity');
      const pointerSince=r.events.slice(move.index+1).filter(e=>e.name.startsWith('pointer')&&e.pointerId===move.pointerId);check(pointerSince.length===0,'No intervening pointer phase after original handle move');
      check(Math.abs(box.x+box.width/2-r.start.x)<=.5&&Math.abs(box.y+box.height/2-r.start.y)<=.5,'Original handle centre changed; no retarget');
      check(hit&&(hit===r.handle||r.handle.contains(hit)),'Fresh original handle hit required at unchanged start');
      const facts=window.ui42.mountedFacts(r.id);check(JSON.stringify(facts.stamp)===JSON.stringify(original.stamp)&&JSON.stringify(facts.context)===JSON.stringify(original.context),'Original pre-Down full native baseline changed');
      actualUnpressedHandleMove=true;downProof={sourceHover:clone(original.sourceHover),move:clone(move),observedAt:now,handleBox:box,hitObject:token(hit),sourceObject:token(r.source),handleObject:token(r.handle),originalPoint:clone(r.start)};
    }
    const v={nonce:config.nonce,url:location.href,title:document.title,id:r.id,mountedId:r.id,caseId:r.row.id,action,serial:++serial,allowed:!r.overflow&&document.hasFocus(),editorConnected:connected(r),documentFocused:document.hasFocus(),releaseOnly:cleanup,
      sourceObject:token(r.source),handleObject:token(r.handle),targetObject:token(r.target),point,viewport:viewport(r),actualUnpressedHandleMove,downProof,targetHeader:clone(r.targetHeader??null),
      stamp:clone(window.ui42.mountedFacts(r.id).stamp),context:clone(window.ui42.mountedFacts(r.id).context),pointerDown:r.down,active:active()};
    if(!cleanup)r.lastGuard=clone(v);return v;
  }
  async function finishDispose(){const r=rec(),id=r.id;document.removeEventListener('securitypolicyviolation',r.policyListener);window.removeEventListener('error',r.errorListener);const disposed=await window.ui42.destroy(id);current=null;return{id,disposed,events:clone(r.events),overflow:r.overflow,policy:clone(r.policy),errors:clone(r.errors)};}
  window.ui44Native=Object.freeze({prepare,guard:action=>guard(action),cleanupGuard:action=>guard(action,true),inspect:()=>light(rec()),checkpoint,
    settle:async()=>{await raf();return light(rec());},setup:async action=>{check(['undo','redo'].includes(action),'Closed actual history only');return window.ui42.history(rec().id,action);},
    finishDispose,finish:async()=>({before:await checkpoint(),...await finishDispose()}),documentGuard:()=>({nonce:config.nonce,url:location.href,title:document.title,documentFocused:document.hasFocus(),mountedId:current?.id??null})});
}
