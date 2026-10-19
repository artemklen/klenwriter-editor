// SPDX-License-Identifier: MIT OR Apache-2.0
import type { CommandDto, DeepReadonly, PositionDto, SelectionDto, StampDto, StateDto, Submission } from '@klenwriter/editor-sdk';
import type { DomRefusal, InputCommandBindings, MountedMutation, RecoveryRegion } from './types.js';
import type { BlockCapture, CapturedBlock, DomView } from './view.js';
import { domRefusal, isDomRefusal } from './refusal.js';
export interface InputOwner { destroy(): void; listeners(): number }
interface InputConfiguration {
  readonly element: HTMLElement; readonly view: DomView; readonly bindings: InputCommandBindings;
  readonly canEdit: () => boolean; readonly canSelect: () => boolean; readonly busy: () => boolean;
  readonly capture: () => DeepReadonly<StampDto> | null;
  readonly readState: () => DeepReadonly<StateDto> | null;
  readonly submit: (request: MountedMutation) => Submission | DomRefusal;
  readonly report: (failure: DomRefusal) => unknown;
  readonly recover: (failure: DomRefusal, region?: RecoveryRegion | null) => void;
  readonly composing: (active: boolean) => void;
  readonly consumeRecords: () => number;
}
interface Pending {
  readonly inputType: string; readonly data: string | null; readonly stamp: DeepReadonly<StampDto>;
  readonly selection: DeepReadonly<SelectionDto>; readonly capture: BlockCapture;
  readonly block: CapturedBlock; readonly parent: Node; readonly previous: ChildNode | null;
  readonly next: ChildNode | null; readonly anchor: number; readonly focus: number;
}
const equal = (a: unknown,b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Browser correspondence only: no segmentation, normalization, IDs or semantic edits. */
export function attachInput(options: InputConfiguration): InputOwner {
  const { element,view } = options, doc = element.ownerDocument;
  const removals: (() => void)[] = [];
  let destroyed = false, composing = false, syncing = false, pending: Pending | null = null;
  const failure = (code: DomRefusal['diagnostic']['code']) => domRefusal(code,'command',options.capture());
  const listen = (target: EventTarget,name: string,callback: EventListener) => {
    target.addEventListener(name,callback); removals.push(() => target.removeEventListener(name,callback));
  };
  function refused(code: DomRefusal['diagnostic']['code']) { const value = failure(code); options.report(value); return value; }
  function syncSelection(): DeepReadonly<SelectionDto> | DomRefusal | null {
    const selection = view.readSelection();
    if (!selection || isDomRefusal(selection)) return selection;
    const state = options.readState();
    if (!state) return refused('dom.not_ready');
    if (!equal(state.selection,selection)) {
      syncing = true;
      let result: Submission | DomRefusal;
      try { result = options.submit({kind:'set_selection',stamp:state.stamp as StampDto,selection:selection as SelectionDto}); }
      finally { syncing = false; }
      if (isDomRefusal(result)) return result;
      if (result.status !== 'completed' || result.response.status !== 'ok') return refused('dom.busy');
    }
    return selection;
  }
  function command(inputType: string,data: string | null): CommandDto | null {
    switch (inputType) {
      case 'insertText': case 'insertReplacementText': return typeof data === 'string' ? options.bindings.insertText?.(data) ?? null : null;
      case 'insertParagraph': return options.bindings.enter?.() ?? null;
      case 'insertLineBreak': return options.bindings.lineBreak?.() ?? null;
      case 'deleteContentBackward': return options.bindings.deleteBackward?.() ?? null;
      default: return null;
    }
  }
  function submit(inputType: string,data: string | null): Submission | DomRefusal {
    const stamp = options.capture();
    if (!stamp) return refused('dom.not_ready');
    if (inputType === 'historyUndo' || inputType === 'historyRedo') return options.submit({kind:'history',stamp:stamp as StampDto,direction:inputType === 'historyUndo' ? 'undo' : 'redo'});
    let dto: CommandDto | null;
    try { dto = command(inputType,data); } catch { return refused('dom.command_unsupported'); }
    if (!dto) return refused('dom.command_unsupported');
    return options.submit({kind:'command',stamp:stamp as StampDto,command:dto,history_hint:{kind:'isolated'}});
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
    // The entire affected region was counted/capped before this bounded Range copy.
    const range = doc.createRange();
    try { range.setStart(block,0); range.setEnd(point.node,point.offset); return range.toString().length; }
    catch { return null; } finally { range.detach(); }
  }
  function preserve(code: DomRefusal['diagnostic']['code'],region?: RecoveryRegion | null) {
    const captured = region ?? view.captureRegion() ?? Object.freeze({kind:'retained_dom' as const,element,reason:'capture_limit' as const,ownership:'transferred_to_host' as const});
    options.recover(failure(code),captured); pending = null;
  }
  function begin(event: InputEvent,selection: DeepReadonly<SelectionDto>) {
    const stamp = options.capture(), ids = selectionBlocks(selection);
    if (!stamp || !ids || ids.length !== 1) { preserve('dom.composition_conflict'); return; }
    const firstCapture = view.captureBlocks(ids);
    if (isDomRefusal(firstCapture)) { preserve('dom.reconcile_limit'); return; }
    const block = firstCapture.blocks[0], parent = block?.element.parentNode;
    if (!block || !parent) { preserve('dom.recovery_required'); return; }
    const anchor = offset(block.element,selection.anchor), focus = offset(block.element,selection.focus);
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
    pending = {inputType:event.inputType,data:event.data,stamp,selection,capture,block,parent,previous,next:block.element.nextSibling,anchor,focus};
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
    if (p.inputType === 'deleteContentBackward') {
      if (a !== b) return live === before.slice(0,a)+before.slice(b);
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
    if (composing || event.isComposing) return;
    const p = pending;
    if (!p) { if (options.canEdit()) preserve('dom.recovery_required'); return; }
    if (options.consumeRecords() > 4096) { preserve('dom.reconcile_limit'); return; }
    if (event.inputType !== p.inputType || !equal(options.capture(),p.stamp)) { preserve('dom.stale_replace'); return; }
    if (!observed(p)) { preserve('dom.reconcile_limit'); return; }
    const capture = view.captureRegion();
    if (capture?.kind === 'retained_dom') { preserve('dom.reconcile_limit',capture); return; }
    // Retain owned provisional data before native publication is allowed to patch.
    pending = null; view.endProvisional();
    const result = submit(p.inputType,p.data);
    if (isDomRefusal(result) || result.status !== 'completed' || result.response.status !== 'ok') {
      options.recover(failure('dom.recovery_required'),capture); return;
    }
    // Native is authoritative, but a different browser deletion must remain visible
    // as recovered provisional input rather than an unreported substitution.
    if (p.inputType === 'deleteContentBackward' && p.anchor > 0) {
      const after = view.captureBlocks([p.block.id]);
      if (isDomRefusal(after) || capture?.kind === 'bounded' && after.blocks[0]?.originalText !== capture.provisionalText) options.recover(domRefusal('dom.presentation_unsupported','render',options.capture(),null,null,'alreadyPublished'),capture);
    }
  }
  listen(element,'beforeinput',event => {
    const input = event as InputEvent;
    if (destroyed) return;
    if (!options.canEdit()) { if (input.cancelable) input.preventDefault(); refused('dom.mode_blocked'); return; }
    if (composing || input.isComposing) return;
    if (view.hasProvisional()) { if (input.cancelable) input.preventDefault(); refused('dom.composition_conflict'); return; }
    if (options.busy()) { if (input.cancelable) input.preventDefault(); refused('dom.busy'); return; }
    const selection = syncSelection();
    if (!selection || isDomRefusal(selection)) { if (input.cancelable) input.preventDefault(); return; }
    if (options.busy()) { if (input.cancelable) input.preventDefault(); refused('dom.busy'); return; }
    let supported = input.inputType === 'historyUndo' || input.inputType === 'historyRedo';
    try { supported ||= command(input.inputType,input.data) !== null; } catch { supported = false; }
    if (!supported) { if (input.cancelable) input.preventDefault(); refused('dom.command_unsupported'); return; }
    if (input.cancelable) {
      input.preventDefault(); const result = submit(input.inputType,input.data);
      if (!isDomRefusal(result) && result.status === 'completed' && result.response.status === 'refused') refused('dom.command_unsupported');
    }
    else begin(input,selection);
  });
  listen(element,'input',event => { if (!destroyed) reconcile(event as InputEvent); });
  listen(doc,'selectionchange',() => {
    if (destroyed || syncing || composing || pending || !options.canSelect() || options.busy() || view.hasProvisional()) return;
    const selection = doc.getSelection();
    if (selection?.anchorNode && selection.focusNode && element.contains(selection.anchorNode) && element.contains(selection.focusNode)) syncSelection();
  });
  listen(element,'compositionstart',() => {
    if (destroyed || !options.canEdit()) return;
    const stamp = options.capture();
    composing = true;
    let refusal: DomRefusal | null = null;
    if (stamp) {
      const selection = view.readSelection();
      const ids = selection && !isDomRefusal(selection) ? selectionBlocks(selection) : null;
      refusal = view.beginProvisional(stamp,ids ?? undefined);
    } else refusal = failure('dom.not_ready');
    options.composing(true);
    if (refusal || !view.hasProvisional()) {
      options.recover(refusal ?? failure('dom.composition_conflict'),Object.freeze({kind:'retained_dom',element,reason:'capture_limit',ownership:'transferred_to_host'}));
    } else if (options.busy()) preserve('dom.busy');
  });
  listen(element,'compositionend',() => {
    if (destroyed) return;
    composing = false; options.composing(false);
    // Settlement is OSR-41: preserve the unresolved region explicitly.
    if (view.hasProvisional()) preserve('dom.composition_conflict');
  });
  return { destroy() { if (destroyed) return; destroyed = true; pending = null; for (const remove of removals.splice(0)) remove(); }, listeners:() => removals.length };
}
