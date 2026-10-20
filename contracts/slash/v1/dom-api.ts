// SPDX-License-Identifier: MIT OR Apache-2.0
// Pre-candidate additive public DOM specification, not runtime implementation.
import type {DeepReadonly,StampDto,SelectionDto,SessionContextV2,TextWindowReplyV2} from '@klenwriter/editor-sdk';
import type {DomRefusal} from '@klenwriter/editor-dom';
export type OrdinaryInputType = 'insertText'|'insertReplacementText'|
  'insertParagraph'|'insertLineBreak'|'deleteContentBackward'|'deleteContentForward'|
  'historyUndo'|'historyRedo';
export interface OrdinaryInputObservation {
  readonly kind:'ordinary_input';
  readonly inputType:OrdinaryInputType;
  readonly isTrusted:boolean;
  readonly dataHint:string|null;
  readonly before:DeepReadonly<StampDto>;
  readonly after:DeepReadonly<StampDto>;
  readonly context:DeepReadonly<SessionContextV2>;
  readonly selectionBefore:DeepReadonly<SelectionDto>|null;
  readonly selectionAfter:DeepReadonly<SelectionDto>|null;
  readonly beforeWindow:DeepReadonly<TextWindowReplyV2>|null;
}
export interface MountedInputObservations {
  subscribe(observer:(event:OrdinaryInputObservation)=>void):(()=>void)|DomRefusal;
}
export interface MountedPopupPresentationHandle {
  update(options:{readonly activeOption:HTMLElement|null}):Readonly<{
    status:'updated';stamp:DeepReadonly<StampDto>;context:DeepReadonly<SessionContextV2>}>|DomRefusal;
  dispose():void;
}
export interface MountedPopupPresentation {
  open(options:{readonly element:HTMLElement;readonly listbox:HTMLElement;
    readonly activeOption:HTMLElement|null}):Readonly<{
    status:'opened';presentation:MountedPopupPresentationHandle;
    stamp:DeepReadonly<StampDto>;context:DeepReadonly<SessionContextV2>}>|DomRefusal;
}
// MountedEditor adds readonly inputObservations and popupPresentation.
// MountedResourceCounts adds inputObservations:{subscribers:number} and
// popupPresentation:{handles:number}; existing dom object remains unchanged.
