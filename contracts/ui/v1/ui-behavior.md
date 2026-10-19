# OSR-42 optional UI contract — source proposal01

Base main857f8cb7b27bb2b0ed36d99780fb19911dcff1cf/tree c701ffcdec8661865a0f7e0ef699e5b470ffd6e0. Source-only proposal for pre-runtime freeze; no execution/review/status change. Align with mounted-api-additions.ts and host-and-lifecycle.md. MountedEditor.capture()/context() already exist; ready.response is a Response, not initial/context. New geometry/hostRequests/UI exports remain proposals.

Ship optional private bootstrap @klenwriter/editor-ui: public DOM/SDK dependencies, ./style.css, no KWDJ/CMS/framework import, second Session, semantic queue or TS text/mark/container legality. Host/profile modules construct command DTOs; native query/execute decides results. Root preparation decisions01 govern global Add at captured CURRENT native selection/boundary, with distinct root-gap/Text-caret literals. No after-hovered-block insertion or new native relative-insert command.

## Concrete proposed API

Type imports use public SDK/DOM names. Arrays/data are readonly and copied; factories are trusted data constructors, not mutation callbacks.

```ts
type UiLocale='ru'|'en';
type UiText=Readonly<{ru:string;en:string}>;
type UiJson=null|boolean|number|string|readonly UiJson[]|{readonly[k:string]:UiJson};
interface UiUnavailable {readonly status:'unavailable';readonly code:string;
 readonly message:UiText}
interface UiBlockContext {readonly node:DeepReadonly<NodeViewDto>;
 readonly parent:DeepReadonly<NodeViewDto>;readonly index:number;
 readonly ancestors:readonly DeepReadonly<NodeViewDto>[]}
interface UiActionContext {readonly context:DeepReadonly<SessionContextV2>;
 readonly state:DeepReadonly<StateDto>;readonly catalog:readonly string[];
 readonly block:UiBlockContext|null}
type UiCommandFactory=(captured:UiActionContext)=>CommandDto|UiUnavailable;
interface UiCommandAction {readonly kind:'command'|'toggle';readonly id:string;
 readonly label:UiText;readonly command:UiCommandFactory}
interface UiHostAction {readonly kind:'host';readonly id:string;
 readonly label:UiText;readonly __uiHostAction:unique symbol}
type UiAction=UiCommandAction|UiHostAction;
type UiCloseReason='accepted'|'cancelled'|'refused'|'invalidated'|'destroyed';
function defineUiHostAction<T extends UiJson>(options:{
 readonly id:string;readonly label:UiText;readonly scope:HTMLElement;
 readonly open:(connection:{readonly context:UiActionContext;
  readonly signal:AbortSignal;accept(value:T):void;cancel():void})=>
   (reason:UiCloseReason)=>void;
 readonly command:(captured:UiActionContext,result:T)=>CommandDto|UiUnavailable;
}):UiHostAction;
interface UiMoveChoice {readonly id:string;
 readonly direction:'up'|'down'|'nest'|'unnest';readonly label:UiText;
 readonly command:CommandDto|UiUnavailable}
interface UiProfile {readonly toolbar:readonly UiAction[];
 readonly insertions:readonly UiCommandAction[];
 readonly blockActions:readonly UiHostAction[];
 readonly moves:(c:UiActionContext & {readonly block:UiBlockContext})=>
  readonly UiMoveChoice[]|UiUnavailable}
type UiFailure=DomRefusal|SelectionReadFailure|Readonly<{status:'ui_refused';
 code:'ui.invalid_options'|'ui.unavailable'|'ui.callback_failed'|'ui.limit'|'ui.disposed';
 action:string|null}>;
type UiResult=UiFailure|Readonly<{status:'submitted';action:string;
 submission:Submission;focus:Promise<HostFocus>}>|Readonly<{
 status:'cancelled';action:string;restore:BookmarkRestore|null}>;
interface EditorUi {
 readonly ready:Promise<{readonly status:'ready'}|UiFailure>;
 setLocale(locale:UiLocale):void;
 setInteractionMode(mode:InteractionMode):ReturnType<MountedEditor['setInteractionMode']>;
 refresh():void;
 resources():Readonly<{listeners:number;observers:number;animationFrames:number;
  subscriptions:number;hostRequests:number;continuations:number}>;
 destroy():Readonly<{status:'destroy_requested';settled:Promise<void>}>;
}
function createEditorUi(options:{readonly editor:MountedEditor;
 readonly editorElement:HTMLElement; // ORIGINAL embedding reference
 readonly slots:Readonly<{toolbar:HTMLElement;gutter:HTMLElement;entry:HTMLElement}>;
 readonly locale:UiLocale;
 readonly profile:(context:DeepReadonly<SessionContextV2>)=>UiProfile|UiUnavailable;
 readonly onResult?:(result:UiResult)=>void;
}):EditorUi|UiFailure;
```

Slots: distinct connected roots outside editor/same document; own descendants only. editorElement observes Tab/focus, never grants authority. Native node/parent/index/ancestors + genuine geometry supply block context; no DOM-ID/TS flatten/legality. Cap32toolbar/32insertions/32moves,128ancestors,256fragments/label units, one popup/request/RAF/observer; overflow refuses.

## Activation, focus, host

Apply mounted-api-additions.ts and host-and-lifecycle.md unchanged. Capture BEFORE focus: editor Tab keydown/UI pointerdown/keyboard popup activation, not focusin/click. Pure capture refuses unsynchronized range. Own/query EXACT payload/stamp, guarded complete once; no restore/set_selection/stamp refresh before SDKcomplete. Keep original Submission/Response/queued/fatal, separate focus; no semantic replay. Toggle on/off/mixed from fresh query, not mutation PRE-state.

Host scope is connected hidden named dialog before capture. Its open implements a REAL form/initial focus/Tab trap/Apply/Cancel/Escape/cleanup: submit→accept({title:input.value}), Cancel/Escape→cancel(); Notes factory→createCommand('org.example.notes/command/set-title',{title:result.title}). Fixture proves native update/refusal. Host owns content/network/auth/DOM; UiJson result, no HTML. Terminal/stale/mode/replace/recovery/destroy aborts/closes once; late duplicates cannot submit. Keep scope through result-focus, cleanup cannot steal focus. Host controls direct only; no nested popup→new dialog lease v1.

Toolbar: named role=toolbar, one roving stop; Left/Right wrap, Home/End, Enter/Space once; Tab/ShiftTab exit. aria-disabled stays discoverable with visible described reason, activation blocked. Add: focused labelled listbox, Up/Down/Home/End, Enter/click accepts CURRENT captured position; Escape original valid bookmark; Tab dismiss/normal order. No second input; slash43 editor-focus separate. Move menu: explicit block/type/position/breadcrumb, menu/menuitem, Up/Down/Home/End/Enter/Space/Escape. Alt+Up/Down/Left/Right=up/down/unnest/nest ONLY while move-control/menu owns focus, factory+native query. No global/editor/native shortcut capture. Formatting/Add follows native RESULT lease; move focus:none keeps keyed control. External focus wins. Invalid Cancel→stable Add+stale reason, never guessed/disabled editor caret. Keyed controls survive unrelated DOM/locale changes.

Each activation checks mode/lifecycle/native access/composition/busy/full tokens. readonly preserves selection/copy/Find; disabled no editing focus; composing locks actions without UA loss/replay; recovery only real host resources. Preserve native/DOM reason+code via textContent. One native subscription refreshes; host uses ui.setInteractionMode or SAME-transition refresh after direct mode/replace/destroy (no mode event assumed/polling). Destroy releases UI scopes/caps/DOM/listeners/RAF/subscription, not editor; original continuations reach0 after settled.

## Labels/layout/proof

RU/EN exact catalogue docs/m0/ux-contract.md:98–124. Own controls: Добавить блок/Add block; Переместить блок/Move block; Выше/Move up; Ниже/Move down; Внутрь/Nest; Наружу/Unnest; Отмена/Cancel; Применить/Apply. Use accepted toolbar/composing/unavailable/staleSelection/staleDialog full sentences and whole move.position template; host paired labels. Persistent polite status, no idle log.

External static system-ui CSS; actual32×32px targets, spacing/visible focus, text4.5:1/large+boundaries3:1;200% wraps/no overlap or clipped labels; reduced motion; normal-flow entry. Genuine geometry presentation only. Finite own-chrome CSSOM top/left requires ordinary strict-CSP proof, else fallback. No cssText/style attr/authored resources/unsafe-inline/eval/hash learning/41-UA exemption reuse;40/41 assertions stay.

Four AC remain controls/focus; mixed toolbar/selection; native moves/undo; host dialogs/tokens/Cancel.42 ships real basic Add/menu/callbacks;43slash/44physicalDnD/46/47/50–52/66/CMS/AT remain separate. Frames01=3:44(K01/K02),02=3:112(Add),03=3:173(K04),04=3:226(nesting),05=3:312(states),06=3:357(refusal),07=3:423(K07),08=3:466(K01/K09). Local accepted evidence, no Figma API.

Freeze literals for mixed/reverse+collapsed Strong; root-gap AND Text-caret Add; root/nested move/noop/refusal/undo; real NotesD0 form Cancel/accept/stale/UTF8 refusal; full-token invalidation; original queued/reentry result/focus; Tab/modal/keyed nodes/32px/200%/CSP; packaged41 lock/modes. Label mocks/synthetic separately. Proposed installed16=Chrome/Safari×RU/EN×4flows(format/Add,move/undo,dialog/stale,actualUSOptionE lock/retry), exact literal checkpoints/closed protocol before candidate. Exact-SHA gates/build-onlyCI/independentreview apply; no execution claimed.
