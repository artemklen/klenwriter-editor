// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-authored consumers of the public API in contracts/drag/v1/api.md.
// No private-export additions, native handle fabrication or runtime DOM calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('D44-T01 public additive drag declarations preserve generic profiles, old geometry and original nominal host authority',()=>{
  const directory=mkdtempSync(join(tmpdir(),'editor-drag-types-'));
  try{
    writeFileSync(join(directory,'package.json'),'{"type":"module"}\n');
    const source=`
import type * as Ui from ${JSON.stringify(resolve('packages/ui/dist/index.js'))};
import type * as Dom from ${JSON.stringify(resolve('packages/dom/dist/index.js'))};
import type * as Sdk from ${JSON.stringify(resolve('packages/sdk/dist/index.js'))};
type Assert<T extends true>=T;
type Equal<A,B>=[A] extends [B]?([B] extends [A]?true:false):false;
type CompactKeys=Assert<Equal<keyof Ui.UiDragContext,'context'|'stamp'|'source'>>;
type HeaderKeys=Assert<Equal<keyof Dom.DragNodeHeader,'id'|'typeId'|'primitive'|'parent'|'index'|'childCount'>>;
type DestinationKeys=Assert<Equal<keyof Dom.DragDestination,'placement'|'reference'|'parent'|'before_index'>>;
type SnapshotKeys=Assert<Equal<keyof Dom.DragGeometrySnapshot,'status'|'stamp'|'context'|'source'|'sourceBox'|'hit'|'insideParents'|'destination'|'targetBox'|'viewport'|'work'>>;
type OldGeometryKinds=Assert<Equal<Dom.GeometryRequest['kind'],'selection'|'block'|'block_at_point'>>;
type ResultKinds=Assert<Equal<Dom.DragGeometryRead['status'],'drag_measured'|'dom_refused'|'sdk_failure'>>;
type ResourceKeys=Assert<Equal<keyof ReturnType<Ui.EditorUi['resources']>,'listeners'|'observers'|'animationFrames'|'subscriptions'|'hostRequests'|'continuations'|'dragGestures'|'pointerCaptures'>>;
// Existing generic profiles require neither optional feature.
const old:Ui.UiProfile={toolbar:[],insertions:[],blockActions:[],moves:()=>[]};
const slashOnly:Ui.UiProfile={...old,slash:{textBlockTypes:['example.notes/line'],choices:[]}};
const command:Sdk.CommandDto={id:'example.notes/move',payload_json:'{"kind":"move"}'};
const move:Ui.UiDragFactory=(captured,destination)=>{
 const context:Sdk.DeepReadonly<Sdk.SessionContextV2>=captured.context;
 const stamp:Sdk.DeepReadonly<Sdk.StampDto>=captured.stamp;
 const source:Dom.DragNodeHeader=captured.source;
 const before:number=destination.before_index;
 const unavailable:Ui.UiUnavailable={status:'unavailable',code:'example.unsupported',message:{ru:'Недоступно',en:'Unavailable'}};
 void context;void stamp;void source;void before;
 return destination.placement==='inside'?unavailable:command;
};
const dragOnly:Ui.UiProfile={...old,drag:{move}};
const both:Ui.UiProfile={...slashOnly,drag:{move}};
// @ts-expect-error The factory receives no copied StateDto/NodeView/catalog.
const notCompact:Ui.UiDragFactory=(captured:Ui.UiActionContext,destination:Dom.DragDestination)=>command;
// @ts-expect-error A drag profile requires a real command factory.
const noFactory:Ui.UiDragProfile={};
// @ts-expect-error Factory metadata is readonly.
dragOnly.drag!.move=move;
// @ts-expect-error UI profile does not expose HTML/native-session mutation.
dragOnly.drag!.insertHtml('<p>fake</p>');
declare const captured:Ui.UiDragContext;
// @ts-expect-error Captured identity is readonly.
captured.stamp.revision='new';
// @ts-expect-error Native source facts are readonly.
captured.source.parent='fake';
declare const editor:Dom.MountedEditor;
const request:Dom.DragGeometryRequest={kind:'drag',stamp:editor.capture()!,context:editor.context()!,source:'n',point:null,insideParent:null};
const measured:Dom.DragGeometryRead=editor.geometry.read(request);
editor.geometry.read({kind:'selection',stamp:editor.capture()!});
editor.geometry.read({kind:'block',stamp:editor.capture()!,node:'n'});
editor.geometry.read({kind:'block_at_point',stamp:editor.capture()!,x:10,y:20});
if(measured.status==='drag_measured'){
 const box:Dom.DragBox=measured.sourceBox;
 const work:Readonly<{objects:number;childSlots:number;ancestors:number;rects:number}>=measured.work;
 const destination:Dom.DragDestination|null=measured.destination;
 if(destination){const result:Sdk.CommandDto|Ui.UiUnavailable=move(captured,destination);void result;}
 // @ts-expect-error Geometry is not a DOM element or activation capability.
 measured.sourceBox.element.focus();
 // @ts-expect-error The bounded parent list is immutable.
 measured.insideParents.push(measured.source);
 // @ts-expect-error No selected-parent inference from a mutable fake flag.
 measured.destination={placement:'inside',reference:'x',parent:'x',before_index:0};
 void box;void work;
}
// @ts-expect-error No selector/element may replace the native source ID.
editor.geometry.read({kind:'drag',stamp:editor.capture()!,context:editor.context()!,source:document.body,point:null,insideParent:null});
// @ts-expect-error An explicit nullable parent field is required.
editor.geometry.read({kind:'drag',stamp:editor.capture()!,context:editor.context()!,source:'n',point:null});
// @ts-expect-error Placement is a closed finite union.
const wrongPlacement:Dom.DragDestination={placement:'nearest-parent',reference:'n',parent:'r',before_index:0};
// @ts-expect-error A copied descriptor cannot fabricate an original host lease.
editor.hostRequests.complete({stamp:editor.capture()!,context:editor.context()!},command,{focus:'none'});
const lease=editor.hostRequests.capture();
if(lease.status==='captured'){
 const completed=editor.hostRequests.complete(lease.request,command,{focus:'none'});
 if(completed.status==='submitted'){const original:Sdk.Submission=completed.submission;const focus:Promise<Dom.HostFocus>=completed.focus;void original;void focus;}
}
void old;void slashOnly;void dragOnly;void both;void noFactory;void notCompact;void wrongPlacement;
`;
    const program=join(directory,'consumer.ts');writeFileSync(program,source);
    const result=spawnSync(process.execPath,['node_modules/typescript/bin/tsc','--ignoreConfig','--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',program],{encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
