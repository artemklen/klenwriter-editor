// SPDX-License-Identifier: MIT OR Apache-2.0
// Public declaration consumer only; no private exports, native/session mocks or DOM execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('SL-TYPES frozen additive slash UI/DOM/ABI2 declarations preserve generic and ABI1 boundaries',()=>{
  const directory=mkdtempSync(join(tmpdir(),'editor-slash-types-'));
  try{
    writeFileSync(join(directory,'package.json'),'{"type":"module"}\n');
    const source=`
import type * as Ui from ${JSON.stringify(resolve('packages/ui/dist/index.js'))};
import type * as Dom from ${JSON.stringify(resolve('packages/dom/dist/index.js'))};
import type * as Sdk from ${JSON.stringify(resolve('packages/sdk/dist/index.js'))};
import type * as ExpectedUi from ${JSON.stringify(resolve('contracts/slash/v1/ui-api.js'))};
import type * as ExpectedDom from ${JSON.stringify(resolve('contracts/slash/v1/dom-api.js'))};
type Assert<T extends true>=T;
type Equal<A,B>=[A] extends [B]?([B] extends [A]?true:false):false;
type Range=Assert<Equal<Ui.UiSlashRange,ExpectedUi.UiSlashRange>>;
type Choice=Assert<Equal<Ui.UiSlashChoice,ExpectedUi.UiSlashChoice>>;
type Profile=Assert<Equal<Ui.UiSlashProfile,ExpectedUi.UiSlashProfile>>;
type Observation=Assert<Equal<Dom.OrdinaryInputObservation,ExpectedDom.OrdinaryInputObservation>>;
type ObservationKeys=Assert<Equal<keyof Dom.OrdinaryInputObservation,keyof ExpectedDom.OrdinaryInputObservation>>;
type InputKinds=Assert<Equal<Dom.OrdinaryInputType,ExpectedDom.OrdinaryInputType>>;
type Subscription=Assert<Equal<Dom.MountedInputObservations,ExpectedDom.MountedInputObservations>>;
type Presentation=Assert<Equal<Dom.MountedPopupPresentation,ExpectedDom.MountedPopupPresentation>>;
type Handle=Assert<Equal<Dom.MountedPopupPresentationHandle,ExpectedDom.MountedPopupPresentationHandle>>;
type Abi1Closed=Assert<Equal<Extract<Sdk.SdkReply,{kind:'text_window'}>,never>>;
// Existing profiles require no slash configuration or new host callback.
const oldProfile:Ui.UiProfile={toolbar:[],insertions:[],blockActions:[],moves:()=>[]};
// A generic host uses its own IDs and SDK CommandDto; there is no KWDJ import.
const command:Sdk.CommandDto={id:'example.notes/insert-line',payload_json:'{"kind":"insert_line"}'};
const genericProfile:Ui.UiProfile={...oldProfile,slash:{textBlockTypes:['example.notes/line'],choices:[{
 id:'example.notes/slash/line',label:{ru:'Строка',en:'Line'},keywords:{ru:['строка'],en:['line']},
 command:(context,slash)=>{const captured:Ui.UiActionContext=context;const range:Ui.UiSlashRange|null=slash;
  if(range){const literal:string=range.literal;const selection:Sdk.DeepReadonly<Sdk.SelectionDto>=range.range;void literal;void selection;}
  void captured;return command;}
}]}};
declare const factory:Ui.UiSlashChoice['command'];
declare const captured:Ui.UiActionContext;
const add:Sdk.CommandDto|Ui.UiUnavailable=factory(captured,null);
declare const slash:Ui.UiSlashRange;
const accept:Sdk.CommandDto|Ui.UiUnavailable=factory(captured,slash);
// @ts-expect-error Raw strings cannot substitute for an exact native range DTO.
factory(captured,'/line');
// @ts-expect-error Public localized metadata has exactly RU/EN.
genericProfile.slash!.choices[0]!.label.fr;
// @ts-expect-error Slash metadata keywords are readonly.
genericProfile.slash!.choices[0]!.keywords.en.push('changed');
// @ts-expect-error The optional profile property is readonly.
genericProfile.slash=undefined;

declare const mounted:Dom.MountedEditor;
declare const element:HTMLElement,listbox:HTMLElement,option:HTMLElement;
const subscription:(()=>void)|Dom.DomRefusal=mounted.inputObservations.subscribe(event=>{
 const witness:Sdk.DeepReadonly<Sdk.TextWindowReplyV2>|null=event.beforeWindow;
 const isTrusted:boolean=event.isTrusted;const hint:string|null=event.dataHint;
 void witness;void isTrusted;void hint;
 // @ts-expect-error Observation stamp cannot be rewritten to revive an input.
 event.after.revision='123';
 // @ts-expect-error Native witness spans remain deeply readonly.
 if(event.beforeWindow)event.beforeWindow.before.push({node:'fake',from_utf16:0,to_utf16:1,text:'/'});
 // @ts-expect-error The DTO contains no retained browser event or raw data authority.
 event.data;
});
const opened=mounted.popupPresentation.open({element,listbox,activeOption:option});
if(opened.status==='opened'){
 const handle:Dom.MountedPopupPresentationHandle=opened.presentation;
 const update=handle.update({activeOption:null});handle.dispose();void update;
 // @ts-expect-error An existing handle cannot retarget its root/listbox.
 handle.update({activeOption:null,listbox});
 // @ts-expect-error Presentation has no native selection/focus capability.
 handle.restoreSelection(slash.range);
}
// @ts-expect-error A selector is not a genuine editor element reference.
mounted.popupPresentation.open({element:'#editor',listbox,activeOption:null});
// @ts-expect-error Closed popup options require an activeOption, including explicit null.
mounted.popupPresentation.open({element,listbox});
// @ts-expect-error A copied descriptor does not fabricate a mounted request's brand.
mounted.hostRequests.release({stamp:mounted.capture()!,context:mounted.context()!});
const resources=mounted.resources();
const subscribers:number=resources.inputObservations.subscribers;
const handles:number=resources.popupPresentation.handles;
// @ts-expect-error New counters do not extend/change the old exact dom count object.
resources.dom.subscribers;

declare const v1:Sdk.EditorController,v2:Sdk.EditorControllerV2;
declare const options1:Sdk.CreateEditorOptionsV1,options2:Sdk.CreateEditorOptionsV2;
const request:Sdk.TextWindowRequestV2={kind:'text_window',stamp:mounted.capture()!,before_utf16:256,after_utf16:0};
const response:Sdk.ResponseV2=v2.read(request);
const mountedResponse:Sdk.ResponseV2|Dom.DomRefusal=mounted.read(request);
// @ts-expect-error ABI1 read remains closed to the additive ABI2 request.
v1.read(request);
// @ts-expect-error Text-window caps are numeric native bounds, not strings.
const badRequest:Sdk.TextWindowRequestV2={kind:'text_window',stamp:mounted.capture()!,before_utf16:'256',after_utf16:0};
// @ts-expect-error Read requests do not become mutation authority.
v2.submit(request);
void options1;void options2;void oldProfile;void genericProfile;void add;void accept;void subscription;void subscribers;void handles;void response;void mountedResponse;
`;
    const program=join(directory,'consumer.ts');writeFileSync(program,source);
    const result=spawnSync(process.execPath,['node_modules/typescript/bin/tsc','--ignoreConfig','--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',program],{encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
