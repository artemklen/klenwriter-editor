// SPDX-License-Identifier: MIT OR Apache-2.0
import type { CommandDto, DeepReadonly, PositionDto, SelectionDto, SessionContextV2, StampDto, StateDto, Submission } from '@klenwriter/editor-sdk';
import type { CompositionRecovery, DomRefusal, InputCommandBindings, MountedMutation, RecoveryRegion } from './types.js';
import type { SelectionOwner } from './selection.js';
import type { BlockCapture, CapturedBlock, DomView } from './view.js';
import { domRegionLimits } from './view.js';
import { domRefusal, isDomRefusal } from './refusal.js';
import { CompositionOwner } from './composition.js';
import type { OrdinaryInputCapture } from './input-observations.js';
export interface InputOwner {
  destroy(): void; listeners(): number;
  isProtected(): boolean; isCommitting(): boolean;
  retained(reason?:CompositionRecovery['reason']): ReturnType<CompositionOwner['retained']>;
  resources(): { readonly continuations:number; readonly retainedInputBytes:number; readonly retainedRecoveryRegions:number };
  externalSubmission(request:MountedMutation,result:Submission|DomRefusal):void;
}
interface InputConfiguration {
  readonly element: HTMLElement; readonly view: DomView; readonly bindings: InputCommandBindings; readonly selection: SelectionOwner;
  readonly canEdit: () => boolean; readonly canSelect: () => boolean; readonly busy: () => boolean;
  readonly capture: () => DeepReadonly<StampDto> | null;
  readonly context: () => DeepReadonly<SessionContextV2> | null;
  readonly readState: () => DeepReadonly<StateDto> | null;
  readonly submit: (request: MountedMutation, observation?:OrdinaryInputCapture|null) => Submission | DomRefusal;
  readonly beforeObservation?: (input:InputEvent) => OrdinaryInputCapture|null;
  readonly afterObservation?: (capture:OrdinaryInputCapture|null,result:Submission|DomRefusal) => void;
  readonly observationBusy?: () => boolean;
  readonly submitComposition: (request: MountedMutation) => Submission | DomRefusal;
  readonly report: (failure: DomRefusal) => unknown;
  readonly recover: (failure: DomRefusal, region?: RecoveryRegion | null, composition?: CompositionRecovery | null) => void;
  readonly composing: (active: boolean) => void;
  readonly consumeRecords: () => number;
  readonly onResources?: (resources:ReturnType<CompositionOwner['resources']>) => void;
}
interface Pending {
  readonly ownedPermit:boolean; readonly observation:OrdinaryInputCapture|null;
  readonly inputType: string; readonly data: string | null; readonly stamp: DeepReadonly<StampDto>;
  readonly selection: DeepReadonly<SelectionDto>; readonly capture: BlockCapture;
  readonly block: CapturedBlock; readonly parent: Node; readonly previous: ChildNode | null;
  readonly next: ChildNode | null; readonly anchor: number; readonly focus: number; readonly noncollapsed: boolean;
}
const equal = (a: unknown,b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Browser correspondence only: no segmentation, normalization, IDs or semantic edits. */
export function attachInput(options: InputConfiguration): InputOwner {
  const { element,view } = options, doc = element.ownerDocument;
  const removals: (() => void)[] = [];
  let destroyed = false, pending: Pending | null = null;
  // One held physical shortcut, not a native ticket or a retained DOM event.
  let historyKeyHeld: 'undo'|'redo'|null = null;
  const failure = (code: DomRefusal['diagnostic']['code']) => domRefusal(code,'command',options.capture());
  const listen = (target: EventTarget,name: string,callback: EventListener,capture=false) => {
    target.addEventListener(name,callback,capture); removals.push(() => target.removeEventListener(name,callback,capture));
  };
  function refused(code: DomRefusal['diagnostic']['code']) { const value = failure(code); options.report(value); return value; }
  const syncSelection = () => options.selection.syncFromDom(true);
  function command(inputType: string,data: string | null,noncollapsed = doc.getSelection()?.isCollapsed === false): CommandDto | null {
    switch (inputType) {
      case 'insertText': case 'insertReplacementText': return typeof data === 'string' ? options.bindings.insertText?.(data) ?? null : null;
      case 'insertParagraph': return options.bindings.enter?.() ?? null;
      case 'insertLineBreak': return options.bindings.lineBreak?.() ?? null;
      case 'deleteContentBackward': return noncollapsed ? options.bindings.deleteSelection?.() ?? null : options.bindings.deleteBackward?.() ?? null;
      case 'deleteContentForward': return noncollapsed ? options.bindings.deleteSelection?.() ?? null : null;
      default: return null;
    }
  }
  function submit(inputType: string,data: string | null,noncollapsed?:boolean,ownedPermit=false,observation:OrdinaryInputCapture|null=null): Submission | DomRefusal {
    const stamp = options.capture();
    if (!stamp) return refused('dom.not_ready');
    const dispatch=(request:MountedMutation)=>ownedPermit?options.submitComposition(request):options.submit(request,observation);
    if (inputType === 'historyUndo' || inputType === 'historyRedo') return dispatch({kind:'history',stamp:stamp as StampDto,direction:inputType === 'historyUndo' ? 'undo' : 'redo'});
    let dto: CommandDto | null;
    try { dto = command(inputType,data,noncollapsed); } catch { return refused('dom.command_unsupported'); }
    if (!dto) return refused('dom.command_unsupported');
    return dispatch({kind:'command',stamp:stamp as StampDto,command:dto,history_hint:{kind:'isolated'}});
  }
  function selectionBlocks(selection: DeepReadonly<SelectionDto>): readonly string[] | null {
    const ids: string[] = [];
    for (const point of [selection.anchor,selection.focus]) {
      const dom = view.domPoint(point);
      if (isDomRefusal(dom)) return null;
      const id = view.ownedBlockAt(dom.node);
      if (!id) return null;
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }
  function offset(block: HTMLElement,position: DeepReadonly<PositionDto>): number | null {
    const point = view.domPoint(position);
    if (isDomRefusal(point) || point.node !== block && !block.contains(point.node)) return null;
    // DOM correspondence uses the same hard-break/placeholder representation as
    // boundedText. Range.toString() omits BR and cannot supply this coordinate.
    const stack: {node:Node|null;depth:number}[] = [{node:block,depth:0}];
    let units = 0, visited = 0;
    while (stack.length) {
      const {node,depth} = stack.pop()!;
      if (node === null) return units;
      if (++visited > domRegionLimits.nodes || depth > domRegionLimits.depth) return null;
      if (node === point.node) {
        if (node.nodeType === 3) return point.offset <= domRegionLimits.utf16-units ? units+point.offset : null;
        if (!Number.isSafeInteger(point.offset) || point.offset < 0 || point.offset > node.childNodes.length) return null;
        stack.push({node:null,depth});
        if (point.offset > domRegionLimits.nodes-visited-stack.length) return null;
        for (let i = point.offset-1; i >= 0; i--) stack.push({node:node.childNodes[i],depth:depth+1});
        continue;
      }
      if (node.nodeType === 3) {
        const length = (node as Text).data.length;
        if (length > domRegionLimits.utf16-units) return null;
        units += length;
      } else if (node.nodeType === 1 && (node as Element).tagName === 'BR') {
        const text = view.boundedText(node); if (isDomRefusal(text) || text.length > domRegionLimits.utf16-units) return null;
        units += text.length;
      } else {
        if (node.childNodes.length > domRegionLimits.nodes-visited-stack.length) return null;
        for (let i = node.childNodes.length-1; i >= 0; i--) stack.push({node:node.childNodes[i],depth:depth+1});
      }
    }
    return null;
  }
  function preserve(code: DomRefusal['diagnostic']['code'],region?: RecoveryRegion | null) {
    const captured = region ?? view.captureRegion() ?? Object.freeze({kind:'retained_dom' as const,element,reason:'capture_limit' as const,ownership:'transferred_to_host' as const});
    options.recover(failure(code),captured); pending = null;
  }
  function begin(event: InputEvent,selection: DeepReadonly<SelectionDto>,ownedPermit:boolean,observation:OrdinaryInputCapture|null) {
    const stamp = options.capture(), ids = selectionBlocks(selection);
    if (!stamp || !ids || ids.length !== 1) { preserve('dom.composition_conflict'); return; }
    const firstCapture = view.captureBlocks(ids);
    if (isDomRefusal(firstCapture)) { preserve('dom.reconcile_limit'); return; }
    const block = firstCapture.blocks[0], parent = block?.element.parentNode;
    if (!block || !parent) { preserve('dom.recovery_required'); return; }
    const anchor = offset(block.element,selection.anchor), focus = equal(selection.anchor,selection.focus) ? anchor : offset(block.element,selection.focus);
    if (anchor === null || focus === null) { preserve('dom.presentation_unsupported'); return; }
    const affected = [...ids];
    const previous = block.element.previousSibling;
    // A join observes only the immediate actual sibling; copied IDs are never read.
    if (event.inputType === 'deleteContentBackward' && anchor === 0 && focus === 0 && previous) {
      const previousId = view.ownedBlockAt(previous);
      if (previousId && !affected.includes(previousId)) affected.unshift(previousId);
    }
    const capture = view.captureBlocks(affected);
    if (isDomRefusal(capture)) { preserve('dom.reconcile_limit'); return; }
    const refusal = view.beginProvisional(stamp,affected);
    if (refusal) { preserve(refusal.diagnostic.code); return; }
    pending = {ownedPermit,observation,inputType:event.inputType,data:event.data,stamp,selection,capture,block,parent,previous,next:block.element.nextSibling,anchor,focus,noncollapsed:doc.getSelection()?.isCollapsed===false};
  }
  function bounded(node: Node): string | null { const result = view.boundedText(node); return isDomRefusal(result) ? null : result; }
  function observed(p: Pending): boolean {
    const before = p.block.originalText, a = Math.min(p.anchor,p.focus), b = Math.max(p.anchor,p.focus);
    const live = bounded(p.block.element);
    if (live === null) return false;
    if (p.inputType === 'insertText' || p.inputType === 'insertReplacementText') return p.block.element.parentNode === p.parent
      && p.block.element.nextSibling === p.next && p.block.element.previousSibling === p.previous
      && p.data !== null && live === before.slice(0,a)+p.data+before.slice(b);
    if (p.inputType === 'insertLineBreak') return p.block.element.parentNode === p.parent && live === before.slice(0,a)+'\n'+before.slice(b);
    if (p.inputType === 'insertParagraph') {
      if (p.block.element.parentNode !== p.parent || p.block.element.previousSibling !== p.previous) return false;
      const sibling = p.block.element.nextSibling;
      if (!sibling || sibling === p.next || sibling.nextSibling !== p.next || view.ownedBlockAt(sibling)) return false;
      let right = bounded(sibling);
      // A fresh browser empty-block placeholder has no authored hard-break authority.
      // This narrow correspondence is confined to a just-created split sibling.
      if (right === '\n' && sibling.childNodes.length === 1 && sibling.firstChild?.nodeType === 1 && (sibling.firstChild as Element).tagName === 'BR') right = '';
      return right !== null && live === before.slice(0,a) && right === before.slice(b);
    }
    if (p.inputType === 'deleteContentBackward' || p.inputType === 'deleteContentForward') {
      if (a !== b) return live === before.slice(0,a)+before.slice(b);
      if (p.inputType === 'deleteContentForward') return false;
      if (a > 0) {
        // Only observe a contiguous deletion ending at the captured caret. Native
        // pinned EGC admission chooses its exact boundary; JS never segments text.
        const removed = before.length-live.length;
        return removed > 0 && removed <= a && live === before.slice(0,a-removed)+before.slice(a);
      }
      const left = p.capture.blocks.find(row => row.id !== p.block.id);
      if (!left || p.previous !== left.element || left.element.parentNode !== p.parent || element.contains(p.block.element)) return false;
      const joined = bounded(left.element);
      return joined === left.originalText+before && left.element.nextSibling === p.next;
    }
    return false;
  }
  function reconcile(event: InputEvent) {
    if (event.isComposing) return;
    const p = pending;
    if (!p) { if (options.canEdit()) preserve('dom.recovery_required'); return; }
    if (options.consumeRecords() > 4096) { preserve('dom.reconcile_limit'); return; }
    if (event.inputType !== p.inputType || !equal(options.capture(),p.stamp)) { preserve('dom.stale_replace'); return; }
    if (!observed(p)) { preserve('dom.reconcile_limit'); return; }
    const capture = view.captureRegion();
    if (capture?.kind === 'retained_dom') { preserve('dom.reconcile_limit',capture); return; }
    // Retain owned provisional data before native publication is allowed to patch.
    pending = null; view.endProvisional();
    const result = submit(p.inputType,p.data,p.noncollapsed,p.ownedPermit,p.observation);
    if (isDomRefusal(result) || result.status !== 'completed' || result.response.status !== 'ok') {
      options.recover(failure('dom.recovery_required'),capture); return;
    }
    // Native is authoritative, but a different browser deletion must remain visible
    // as recovered provisional input rather than an unreported substitution.
    if ((p.inputType === 'deleteContentBackward' || p.inputType === 'deleteContentForward') && p.anchor > 0) {
      const after = view.captureBlocks([p.block.id]);
      if (isDomRefusal(after) || capture?.kind === 'bounded' && after.blocks[0]?.originalText !== capture.provisionalText) { options.recover(domRefusal('dom.presentation_unsupported','render',options.capture(),null,null,'alreadyPublished'),capture); return; }
    }
    if(!p.ownedPermit)options.afterObservation?.(p.observation,result);
  }
  function ordinaryBeforeInput(input:InputEvent,ownedPermit=false):Submission|DomRefusal|null {
    if(options.observationBusy?.()){if(input.cancelable)input.preventDefault();return failure('dom.busy');}
    options.selection.invalidate(false,input); options.selection.cancel();
    if (destroyed) return null;
    if (!options.canEdit()) { if (input.cancelable) input.preventDefault(); return refused('dom.mode_blocked'); }
    if (input.isComposing) return null;
    if (view.hasProvisional()) { if (input.cancelable) input.preventDefault(); return refused('dom.composition_conflict'); }
    if (options.busy()) { if (input.cancelable) input.preventDefault(); return refused('dom.busy'); }
    const selection = ownedPermit?view.readSelection():syncSelection();
    if (!selection || isDomRefusal(selection)) { if (input.cancelable) input.preventDefault(); return isDomRefusal(selection)?selection:null; }
    if (ownedPermit && !equal(selection,options.readState()?.selection)) { if(input.cancelable)input.preventDefault();return refused('dom.stale_selection'); }
    if (options.busy()) { if (input.cancelable) input.preventDefault(); return refused('dom.busy'); }
    const observation=ownedPermit?null:options.beforeObservation?.(input)??null;
    let supported = input.inputType === 'historyUndo' || input.inputType === 'historyRedo';
    try { supported ||= command(input.inputType,input.data) !== null; } catch { supported = false; }
    if (!supported) { if (input.cancelable) input.preventDefault(); return refused('dom.command_unsupported'); }
    if (input.cancelable) {
      input.preventDefault(); const result = submit(input.inputType,input.data,undefined,ownedPermit,observation);
      if (!ownedPermit && !isDomRefusal(result) && result.status === 'completed' && result.response.status === 'refused') refused('dom.command_unsupported');
      if(!ownedPermit)options.afterObservation?.(observation,result);
      return result;
    }
    else begin(input,selection,ownedPermit,observation);
    return null;
  }
  const composition=new CompositionOwner({...options,submit:options.submitComposition,ordinary:input=>ordinaryBeforeInput(input,true)});
  function historyKeydown(event:KeyboardEvent):void {
    if(destroyed || !event.isTrusted)return;
    const shortcut=event.code==='KeyZ' && !event.altKey && event.ctrlKey!==event.metaKey;
    if(!shortcut){historyKeyHeld=null;return;}
    if(event.defaultPrevented || !event.cancelable || !doc.hasFocus() || !options.selection.ownsFocus()
      || !event.target || !element.contains(event.target as Node))return;
    // Own the browser default even when an edit guard refuses this shortcut.
    event.preventDefault();
    if(historyKeyHeld!==null || event.repeat)return;
    const direction=event.shiftKey?'redo':'undo';historyKeyHeld=direction;
    if(!options.canEdit()){refused('dom.mode_blocked');return;}
    if(options.observationBusy?.() || options.busy()){refused('dom.busy');return;}
    if(event.isComposing || event.keyCode===229 || composition.isProtected() || composition.isCommitting() || view.hasProvisional()){
      refused('dom.composition_conflict');return;
    }
    options.selection.invalidate(false,event);options.selection.cancel();
    const selection=syncSelection();
    if(!selection || isDomRefusal(selection))return;
    const stamp=options.capture(),state=options.readState(),context=options.context();
    if(!stamp || !state){refused('dom.not_ready');return;}
    if(!equal(stamp,state.stamp) || !equal(selection,state.selection) || !equal(stamp,options.capture())
      || !equal(context,options.context())){refused('dom.stale_selection');return;}
    if(destroyed || !doc.hasFocus() || !options.selection.ownsFocus() || !options.canEdit()
      || options.observationBusy?.() || options.busy() || composition.isProtected() || view.hasProvisional())return;
    if(!equal(stamp,options.capture()) || !equal(context,options.context())){refused('dom.stale_selection');return;}
    // This is the original key's input submission, not a synthetic beforeinput
    // observation. The native engine owns availability, history and selection.
    options.submit({kind:'history',stamp:stamp as StampDto,direction},null);
  }
  // Internal block moves use the outside UI's pointer capability, never HTML
  // drag data. Refuse before the browser can insert/navigate or delete a source.
  // Capture also covers genuine descendants that stop bubbling. Payloads are
  // deliberately not inspected, copied or passed to a profile constructor.
  for(const name of ['dragstart','dragover','drop'])listen(element,name,event=>{
    if(destroyed)return;
    if(event.cancelable)event.preventDefault();
    if(name!=='dragover')refused('dom.command_unsupported');
  },true);
  listen(element,'beforeinput',event=>{
    const input=event as InputEvent;
    if(destroyed)return;
    if(historyKeyHeld!==null && input.inputType===(historyKeyHeld==='undo'?'historyUndo':'historyRedo')){
      if(input.cancelable)input.preventDefault();
      return; // A UA echo of the held shortcut cannot apply history twice.
    }
    historyKeyHeld=null;
    if(input.inputType==='insertFromDrop'||input.inputType==='deleteByDrag'){
      if(input.cancelable)input.preventDefault();
      refused('dom.command_unsupported');return;
    }
    if(options.observationBusy?.()){if(input.cancelable)input.preventDefault();return;}
    if(!composition.beforeInput(input))ordinaryBeforeInput(input);
  });
  listen(element,'input',event=>{const input=event as InputEvent;if(!destroyed && !composition.input(input))reconcile(input);});
  listen(element,'compositionstart',event=>{historyKeyHeld=null;if(!destroyed)composition.start(event as CompositionEvent);});
  listen(element,'compositionupdate',event=>{if(!destroyed)composition.update(event as CompositionEvent);});
  listen(element,'compositionend',event=>{if(!destroyed)composition.end(event as CompositionEvent);});
  listen(element,'keydown',event=>{if(!destroyed){composition.keydown(event as KeyboardEvent);historyKeydown(event as KeyboardEvent);}});
  listen(element,'keyup',event=>{if((event as KeyboardEvent).code==='KeyZ')historyKeyHeld=null;if(!destroyed)composition.keyup(event as KeyboardEvent);});
  listen(element,'pointerdown',()=>{historyKeyHeld=null;},true);
  listen(element,'blur',event=>{historyKeyHeld=null;if(!destroyed)composition.blur(event);});
  if(doc.defaultView?.addEventListener)listen(doc.defaultView,'blur',()=>{historyKeyHeld=null;});
  return {
    destroy() { if (destroyed) return; destroyed=true;pending=null;historyKeyHeld=null;composition.destroy();for(const remove of removals.splice(0))remove(); },
    listeners:()=>removals.length,isProtected:()=>composition.isProtected(),isCommitting:()=>composition.isCommitting(),
    retained:reason=>composition.retained(reason),resources:()=>composition.resources(),
    externalSubmission:(request,result)=>composition.externalSubmission(request,result),
  };
}
