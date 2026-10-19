// SPDX-License-Identifier: MIT OR Apache-2.0
// Frozen pre-candidate public shape, not runtime.
import type { CommandDto, DeepReadonly, NodeViewDto, SessionContextV2, StateDto, Submission } from "@klenwriter/editor-sdk";
import type { BookmarkRestore, DomRefusal, HostFocus, InteractionMode, MountedEditor, SelectionReadFailure } from "@klenwriter/editor-dom";
export type UiLocale='ru'|'en';
export type UiText=Readonly<{ru:string;en:string}>;
export type UiJson=null|boolean|number|string|readonly UiJson[]|{readonly[k:string]:UiJson};
export interface UiUnavailable {readonly status:'unavailable';readonly code:string;
 readonly message:UiText}
export interface UiBlockContext {readonly node:DeepReadonly<NodeViewDto>;
 readonly parent:DeepReadonly<NodeViewDto>;readonly index:number;
 readonly ancestors:readonly DeepReadonly<NodeViewDto>[]}
export interface UiActionContext {readonly context:DeepReadonly<SessionContextV2>;
 readonly state:DeepReadonly<StateDto>;readonly catalog:readonly string[];
 readonly block:UiBlockContext|null}
export type UiCommandFactory=(captured:UiActionContext)=>CommandDto|UiUnavailable;
export interface UiCommandAction {readonly kind:'command'|'toggle';readonly id:string;
 readonly label:UiText;readonly command:UiCommandFactory}
export interface UiHostAction {readonly kind:'host';readonly id:string;
 readonly label:UiText;readonly __uiHostAction:unique symbol}
export type UiAction=UiCommandAction|UiHostAction;
export type UiCloseReason='accepted'|'cancelled'|'refused'|'invalidated'|'destroyed';
export declare function defineUiHostAction<T extends UiJson>(options:{
 readonly id:string;readonly label:UiText;readonly scope:HTMLElement;
 readonly open:(connection:{readonly context:UiActionContext;
  readonly signal:AbortSignal;accept(value:T):void;cancel():void})=>
   (reason:UiCloseReason)=>void;
 readonly command:(captured:UiActionContext,result:T)=>CommandDto|UiUnavailable;
}):UiHostAction;
export interface UiMoveChoice {readonly id:string;
 readonly direction:'up'|'down'|'nest'|'unnest';readonly label:UiText;
 readonly command:CommandDto|UiUnavailable}
export interface UiProfile {readonly toolbar:readonly UiAction[];
 readonly insertions:readonly UiCommandAction[];
 readonly blockActions:readonly UiHostAction[];
 readonly moves:(c:UiActionContext & {readonly block:UiBlockContext})=>
  readonly UiMoveChoice[]|UiUnavailable}
export type UiFailure=DomRefusal|SelectionReadFailure|Readonly<{status:'ui_refused';
 code:'ui.invalid_options'|'ui.unavailable'|'ui.callback_failed'|'ui.limit'|'ui.disposed';
 action:string|null}>;
export type UiResult=UiFailure|Readonly<{status:'submitted';action:string;
 submission:Submission;focus:Promise<HostFocus>}>|Readonly<{
 status:'cancelled';action:string;restore:BookmarkRestore|null}>;
export interface EditorUi {
 readonly ready:Promise<{readonly status:'ready'}|UiFailure>;
 setLocale(locale:UiLocale):void;
 setInteractionMode(mode:InteractionMode):ReturnType<MountedEditor['setInteractionMode']>;
 refresh():void;
 resources():Readonly<{listeners:number;observers:number;animationFrames:number;
  subscriptions:number;hostRequests:number;continuations:number}>;
 destroy():Readonly<{status:'destroy_requested';settled:Promise<void>}>;
}
export declare function createEditorUi(options:{readonly editor:MountedEditor;
 readonly editorElement:HTMLElement; // ORIGINAL embedding reference
 readonly slots:Readonly<{toolbar:HTMLElement;gutter:HTMLElement;entry:HTMLElement}>;
 readonly locale:UiLocale;
 readonly profile:(context:DeepReadonly<SessionContextV2>)=>UiProfile|UiUnavailable;
 readonly onResult?:(result:UiResult)=>void;
}):EditorUi|UiFailure;
