// SPDX-License-Identifier: MIT OR Apache-2.0
/** An opt-in host field for a named KWDJ container. Model children stay in the mounted editor. */
import type { MountedEditor, MountedHostRequest } from '@klenwriter/editor-dom';
import type { DeepReadonly, NodeViewDto, PositionDto, SelectionDto, StampDto, StateDto } from '@klenwriter/editor-sdk';
import { kwdjCommand } from './index.js';

export interface KwdjContainerLabelOptions {
  readonly editor: MountedEditor;
  readonly editorElement: HTMLElement;
  readonly input: HTMLInputElement;
  readonly node: string;
}

type ModelNode = DeepReadonly<NodeViewDto>;
type ModelPoint = DeepReadonly<PositionDto>;
type ModelSelection = DeepReadonly<SelectionDto>;
type ModelStamp = DeepReadonly<StampDto>;
type Side = 'before' | 'after';

const MAX_NODE_READS = 128;
const owners = new WeakMap<MountedEditor, LabelOwner>();
const inputs = new WeakSet<HTMLInputElement>();
const compositionInputs = new Set([
  'insertCompositionText', 'deleteCompositionText', 'insertFromComposition',
  'deleteByComposition', 'insertFromCompositionText',
]);

function readState(editor: MountedEditor): DeepReadonly<StateDto> | null {
  const reply = editor.read({ kind: 'state' });
  return reply.status === 'ok' && reply.value.kind === 'state' ? reply.value.state : null;
}

function readNode(editor: MountedEditor, node: string, stamp: ModelStamp): ModelNode | null {
  const reply = editor.read({ kind: 'node', node, stamp });
  return reply.status === 'ok' && reply.value.kind === 'node' ? reply.value.node : null;
}

function labelOf(node: ModelNode | null): string | null {
  if (!node || node.primitive !== 'container'
    || (node.type_id !== 'org.klenwriter.kwdj/spoiler' && node.type_id !== 'org.klenwriter.kwdj/disclosure')) return null;
  const label = node.attributes.label;
  // A text input strips CR and LF from its value. Keep those authored labels in the SDK.
  return label?.kind === 'string' && !/[\r\n]/u.test(label.value) ? label.value : null;
}

function sameGeneration(stamp: ModelStamp | null, previous: ModelStamp): stamp is ModelStamp {
  return stamp !== null && stamp.session === previous.session && stamp.generation === previous.generation;
}

function samePoint(a: ModelPoint, b: ModelPoint): boolean {
  if (a.kind === 'text' && b.kind === 'text') return a.node === b.node && a.offset === b.offset;
  if (a.kind === 'child' && b.kind === 'child') return a.parent === b.parent && a.index === b.index;
  return a.kind === 'edge' && b.kind === 'edge' && a.node === b.node && a.side === b.side;
}

function collapsed(selection: ModelSelection | null): ModelPoint | null {
  return selection && samePoint(selection.anchor, selection.focus) ? selection.anchor : null;
}

/** One stamped reader per routed key. Limit navigation even for very wide or deeply nested trees. */
class LabelTree {
  readonly #nodes = new Map<string, ModelNode | null>();

  constructor(readonly editor: MountedEditor, readonly stamp: ModelStamp) {}

  read(id: string): ModelNode | null {
    if (this.#nodes.has(id)) return this.#nodes.get(id) ?? null;
    if (this.#nodes.size >= MAX_NODE_READS) return null;
    const node = readNode(this.editor, id, this.stamp);
    this.#nodes.set(id, node);
    return node;
  }

  childAt(point: ModelPoint, side: Side): ModelNode | null {
    if (point.kind === 'edge') return point.side === side ? this.read(point.node) : null;
    if (point.kind === 'child') {
      const id = this.read(point.parent)?.children[point.index - Number(side === 'after')];
      return id === undefined ? null : this.read(id);
    }
    const leaf = this.read(point.node);
    if (!leaf?.parent || leaf.text === null || point.offset !== (side === 'before' ? leaf.text.length : 0)) return null;
    const parent = this.read(leaf.parent);
    if (!parent) return null;
    const index = parent.children.indexOf(leaf.id);
    if (index < 0) return null;
    const id = parent.children[index + (side === 'before' ? 1 : -1)];
    return id === undefined ? null : this.read(id);
  }

  cross(point: ModelPoint, side: Side): PositionDto | null {
    const child = this.childAt(point, side);
    if (child?.primitive === 'block_atom') {
      return { kind: 'edge', node: child.id, side: side === 'before' ? 'after' : 'before' };
    }
    if (child?.primitive === 'hard_break' && child.parent) {
      const parent = this.read(child.parent);
      if (!parent) return null;
      const index = parent.children.indexOf(child.id);
      if (index >= 0) return { kind: 'child', parent: parent.id, index: index + Number(side === 'before'), affinity: 'after' };
    }
    return null;
  }

  caret(id: string, side: Side): PositionDto | null {
    const node = this.read(id);
    if (!node) return null;
    if (node.primitive === 'block_atom') return { kind: 'edge', node: id, side };
    const first = side === 'before';
    if (node.primitive === 'text_block') {
      const index = first ? 0 : node.children.length;
      const leaf = node.children[first ? 0 : index - 1];
      if (leaf !== undefined) {
        const child = this.read(leaf);
        if (!child) return null;
        if (child.primitive === 'text' && child.text !== null) {
          return { kind: 'text', node: leaf, offset: first ? 0 : child.text.length, affinity: 'after' };
        }
      }
      return { kind: 'child', parent: node.id, index, affinity: 'after' };
    }
    if (node.primitive !== 'container') return null;
    if (node.children.length === 0) return { kind: 'child', parent: id, index: 0, affinity: 'after' };
    for (let step = 0; step < node.children.length && this.#nodes.size < MAX_NODE_READS; step++) {
      const child = node.children[first ? step : node.children.length - 1 - step];
      const point = child === undefined ? null : this.caret(child, side);
      if (point) return point;
    }
    return null;
  }

  next(id: string): PositionDto | null {
    let node = this.read(id);
    while (node?.parent) {
      const parent = this.read(node.parent);
      if (!parent) return null;
      const offset = parent.children.indexOf(node.id);
      if (offset < 0) return null;
      const sibling = parent.children[offset + 1];
      if (sibling !== undefined) return this.caret(sibling, 'before');
      node = parent;
    }
    return null;
  }
}

interface LabelComposition {
  readonly request: MountedHostRequest | null;
  latest: {
    readonly value: string;
    readonly data: string | null;
    readonly inputEvent: Event;
    terminalEcho: boolean;
  } | null;
}

interface Binding {
  readonly node: string;
  readonly input: HTMLInputElement;
  readonly stamp: ModelStamp;
  readonly originalReadOnly: boolean;
  readonly originalDisabled: boolean;
  pending: boolean;
  composition: LabelComposition | null;
  retire(): void;
}

interface Continuation {
  readonly binding: Binding;
  readonly next: PositionDto;
}

function ownedField(root: HTMLElement, input: HTMLInputElement): boolean {
  return root.isConnected && input.isConnected && input.ownerDocument === root.ownerDocument && !root.contains(input);
}

function routedKey(event: KeyboardEvent): boolean {
  return event.isTrusted && !event.defaultPrevented && event.cancelable && !event.isComposing
    && !event.altKey && !event.ctrlKey && !event.metaKey && !event.repeat
    && (event.key === 'Tab' || (!event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')));
}

function completedOk(result: ReturnType<MountedEditor['selection']['restoreBookmark']>): boolean {
  return result.status === 'completed' && result.response.status === 'ok';
}

class LabelOwner {
  readonly #document: Document;
  readonly #bindings = new Map<string, Binding>();
  readonly #observer: MutationObserver;
  readonly #unsubscribe: () => void;
  #continuation: Continuation | null = null;
  #bodyBinding: Binding | null = null;

  constructor(readonly editor: MountedEditor, readonly root: HTMLElement) {
    this.#document = root.ownerDocument;
    const unsubscribe = editor.subscribe(event => {
      const point = collapsed(event.selection_after);
      if (!point || !this.#continuation || !samePoint(point, this.#continuation.next)
        || event.change.kind === 'document') this.#continuation = null;
      if (event.change.kind === 'document') {
        this.#bodyBinding = null;
        for (const binding of this.#bindings.values()) this.#sync(binding);
      }
    });
    if (typeof unsubscribe !== 'function') throw new TypeError('The editor must be ready');
    this.#unsubscribe = unsubscribe;
    this.#observer = new MutationObserver(records => {
      // Replace rebuilds the root with a fresh generation and no document event.
      const stamp = editor.capture();
      const modeChanged = records.some(record => record.type === 'attributes');
      for (const binding of this.#bindings.values()) {
        if (!sameGeneration(stamp, binding.stamp)) binding.retire();
        else if (modeChanged) this.#sync(binding);
      }
    });
    this.#observer.observe(root, { childList: true, attributes: true, attributeFilter: ['contenteditable', 'aria-disabled'] });
    // A ready editor already owns document-bubble navigation inside its tables.
    this.#document.addEventListener('keydown', this.#rootKey);
    root.addEventListener('focusout', this.#resetRoute);
    root.addEventListener('pointerdown', this.#resetRoute);
  }

  bind(node: string, input: HTMLInputElement, stamp: ModelStamp): () => void {
    if (this.#bindings.has(node) || inputs.has(input)) throw new TypeError('Label already bound');
    const onInput = (event: Event) => {
      if (!event.isTrusted) {
        this.#cancelComposition(binding);
        this.#sync(binding);
        return;
      }
      const { inputType, isComposing, data } = event as InputEvent;
      const composingInput = isComposing || compositionInputs.has(inputType);
      if (binding.composition) {
        if (composingInput) {
          const latest = { value: input.value, data, inputEvent: event, terminalEcho: false };
          binding.composition.latest = latest;
          // Chromium can emit an untrusted end between the trusted input's
          // microtask checkpoint and the next task.
          queueMicrotask(() => { latest.terminalEcho = true; });
          setTimeout(() => { latest.terminalEcho = false; }, 0);
        }
        return;
      }
      if (composingInput || inputType === 'historyUndo' || inputType === 'historyRedo') {
        this.#sync(binding);
        return;
      }
      this.#write(binding);
    };
    const onCompositionStart = (event: CompositionEvent) => {
      if (!event.isTrusted || binding.composition) return;
      // Bind the edit to the stamp before the browser writes provisional text.
      const request = this.#available(binding) ? this.#capture(input) : null;
      binding.composition = { request, latest: null };
    };
    const onCompositionEnd = (event: CompositionEvent) => {
      const composition = binding.composition;
      if (!composition) return;
      const terminalData = event.data;
      if (!event.isTrusted) {
        const { latest } = composition;
        if (!latest?.terminalEcho || latest.inputEvent.eventPhase !== Event.NONE
          || latest.data !== terminalData || latest.value !== input.value) return;
      }
      queueMicrotask(() => {
        if (this.#bindings.get(node) !== binding || binding.composition !== composition) return;
        binding.composition = null;
        const { request, latest } = composition;
        try {
          // Some native browsers deliver an untrusted end after trusted text input.
          // The starting request and the observed field value authorize the edit.
          if (request && latest && latest.data === terminalData && latest.value === input.value) this.#write(binding, request);
          else this.#sync(binding);
        } finally {
          if (request) this.editor.hostRequests.release(request);
        }
      });
    };
    const onBlur = () => {
      if (!binding.composition) return;
      this.#cancelComposition(binding);
      this.#sync(binding);
    };
    const onKey = (event: KeyboardEvent) => this.#fieldKey(event, binding);
    const binding: Binding = {
      node, input, stamp, pending: false, composition: null,
      originalReadOnly: input.readOnly, originalDisabled: input.disabled,
      retire: () => {
        if (this.#bindings.get(node) !== binding) return;
        this.#cancelComposition(binding);
        this.#bindings.delete(node);
        inputs.delete(input);
        if (this.#continuation?.binding === binding) this.#continuation = null;
        if (this.#bodyBinding === binding) this.#bodyBinding = null;
        input.removeEventListener('input', onInput);
        input.removeEventListener('keydown', onKey);
        input.removeEventListener('compositionstart', onCompositionStart);
        input.removeEventListener('compositionend', onCompositionEnd);
        input.removeEventListener('blur', onBlur);
        input.readOnly = binding.originalReadOnly;
        input.disabled = binding.originalDisabled;
        if (this.#bindings.size === 0) {
          this.#observer.disconnect();
          this.#unsubscribe();
          this.#document.removeEventListener('keydown', this.#rootKey);
          this.root.removeEventListener('focusout', this.#resetRoute);
          this.root.removeEventListener('pointerdown', this.#resetRoute);
          owners.delete(this.editor);
        }
      },
    };
    this.#bindings.set(node, binding);
    inputs.add(input);
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    input.addEventListener('compositionstart', onCompositionStart);
    input.addEventListener('compositionend', onCompositionEnd);
    input.addEventListener('blur', onBlur);
    this.#sync(binding);
    return binding.retire;
  }

  #currentLabel(binding: Binding): string | null {
    const stamp = this.editor.capture();
    if (!sameGeneration(stamp, binding.stamp) || !ownedField(this.root, binding.input)) return null;
    return labelOf(readNode(this.editor, binding.node, stamp));
  }

  #sync(binding: Binding): void {
    const label = this.#currentLabel(binding);
    if (label === null) { binding.retire(); return; }
    const { input } = binding;
    input.readOnly = binding.originalReadOnly || this.root.getAttribute('contenteditable') !== 'true';
    input.disabled = binding.originalDisabled || this.root.getAttribute('aria-disabled') === 'true';
    if (input.readOnly || input.disabled) this.#cancelComposition(binding);
    if (!binding.composition && input.value !== label) input.value = label;
  }

  #available(binding: Binding): boolean {
    return this.#bindings.get(binding.node) === binding && ownedField(this.root, binding.input)
      && !binding.input.readOnly && !binding.input.disabled && !binding.composition && !binding.pending
      && this.editor.hostRequests.status().status === 'available';
  }

  #capture(input: HTMLInputElement): MountedHostRequest | null {
    const captured = this.editor.hostRequests.capture({ focusScope: input });
    return captured.status === 'captured' ? captured.request : null;
  }

  #cancelComposition(binding: Binding): void {
    const request = binding.composition?.request;
    binding.composition = null;
    if (request) this.editor.hostRequests.release(request);
  }

  #write(binding: Binding, originalRequest?: MountedHostRequest): void {
    const { input } = binding;
    const label = this.#currentLabel(binding);
    if (label === null) { binding.retire(); return; }
    if (input.value === label) return;
    if (input.ownerDocument.activeElement !== input || !this.#available(binding)) { this.#sync(binding); return; }
    const command = kwdjCommand({ kind: 'set_container_label', node: binding.node, label: input.value });
    const request = originalRequest ?? this.#capture(input);
    if (!request) { this.#sync(binding); return; }
    const result = this.editor.hostRequests.complete(request, command, { focus: 'none' });
    if (result.status !== 'submitted' || result.submission.status === 'completed') { this.#sync(binding); return; }
    binding.pending = true;
    const settled = () => {
      if (this.#bindings.get(binding.node) !== binding) return;
      binding.pending = false;
      this.#sync(binding);
    };
    void result.submission.completion.then(settled, settled);
  }

  #focusBody(point: PositionDto, from: HTMLElement, stamp: ModelStamp): boolean {
    const selection = { anchor: point, focus: point };
    if (!completedOk(this.editor.submit({ kind: 'set_selection', stamp, selection }))) return false;
    if (from === this.root) return true;
    if (this.root.ownerDocument.activeElement !== from) return false;
    const captured = this.editor.selection.captureBookmark();
    if (captured.status !== 'captured') return false;
    const result = this.editor.selection.restoreBookmark(captured.bookmark, { policy: 'exact', focus: true });
    this.editor.selection.releaseBookmark(captured.bookmark);
    return completedOk(result) && this.root.ownerDocument.activeElement === this.root;
  }

  #focusField(binding: Binding): boolean {
    const { input } = binding;
    input.focus();
    if (input.ownerDocument.activeElement !== input) return false;
    input.setSelectionRange(input.value.length, input.value.length);
    return true;
  }

  #fieldKey(event: KeyboardEvent, binding: Binding): void {
    if (!routedKey(event) || !this.#available(binding) || event.shiftKey
      || binding.input.ownerDocument.activeElement !== binding.input) return;
    const { input } = binding;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    if (event.key !== 'Tab' && (event.key !== 'ArrowRight' || !atEnd)) return;
    const stamp = this.editor.capture();
    const point = stamp ? new LabelTree(this.editor, stamp).caret(binding.node, 'before') : null;
    if (stamp && point && this.#focusBody(point, input, stamp)) {
      this.#continuation = null;
      this.#bodyBinding = binding;
      event.preventDefault();
    }
  }

  #resetRoute = (): void => {
    this.#continuation = null;
    this.#bodyBinding = null;
  };

  #currentRootPoint(point: ModelPoint, stamp: ModelStamp): boolean {
    const captured = this.editor.selection.captureBookmark();
    if (captured.status !== 'captured') return false;
    const { bookmark } = captured;
    this.editor.selection.releaseBookmark(bookmark);
    const actual = collapsed(bookmark.selection);
    return !!actual && samePoint(point, actual)
      && bookmark.stamp.session === stamp.session && bookmark.stamp.generation === stamp.generation
      && bookmark.stamp.revision === stamp.revision && bookmark.stamp.selection_epoch === stamp.selection_epoch
      && bookmark.stamp.history_epoch === stamp.history_epoch;
  }

  #rootKey = (event: KeyboardEvent): void => {
    if (!routedKey(event) || this.#document.activeElement !== this.root
      || !event.composedPath().includes(this.root)) return;
    const state = readState(this.editor);
    const point = state ? collapsed(state.selection) : null;
    if (!state || !point) return;
    const tree = new LabelTree(this.editor, state.stamp);
    const backwards = event.shiftKey || event.key === 'ArrowLeft';
    const tab = event.key === 'Tab';
    const continuation = this.#continuation;
    if (continuation && samePoint(point, continuation.next)) {
      if (backwards && this.#available(continuation.binding)) {
        const target = tree.caret(continuation.binding.node, tab ? 'before' : 'after');
        if (target && this.#currentRootPoint(point, state.stamp) && this.#focusBody(target, this.root, state.stamp)) {
          this.#continuation = null;
          this.#bodyBinding = continuation.binding;
          event.preventDefault();
        }
      }
      return;
    }

    let current = tree.read(point.kind === 'child' ? point.parent : point.node);
    let binding: Binding | undefined;
    while (current) {
      const candidate = this.#bindings.get(current.id);
      if (candidate && candidate === this.#bodyBinding) {
        binding = candidate;
        break;
      }
      binding ??= candidate;
      if (binding && !this.#bodyBinding) break;
      current = current.parent ? tree.read(current.parent) : null;
    }
    if (binding !== this.#bodyBinding) this.#bodyBinding = null;
    if (!binding) return;
    const crossing = tab ? null : tree.cross(point, backwards ? 'after' : 'before');
    if (crossing) {
      if (this.#available(binding) && this.#currentRootPoint(point, state.stamp)
        && this.#focusBody(crossing, this.root, state.stamp)) event.preventDefault();
      return;
    }
    if (!tab) {
      const boundary = tree.caret(binding.node, backwards ? 'before' : 'after');
      if (!boundary) return;
      const atBoundary = samePoint(point, boundary)
        || (boundary.kind === 'edge' && tree.childAt(point, boundary.side)?.id === boundary.node);
      if (!atBoundary) return;
    }
    if (!this.#available(binding)) return;
    if (backwards) {
      if (this.#currentRootPoint(point, state.stamp) && this.#focusField(binding)) event.preventDefault();
      return;
    }
    const next = tree.next(binding.node);
    if (next && this.#currentRootPoint(point, state.stamp) && this.#focusBody(next, this.root, state.stamp)) {
      this.#continuation = { binding, next };
      this.#bodyBinding = null;
      event.preventDefault();
    }
  };
}

/** Bind a host-owned sibling input. Call the returned disposer before removing the field or editor. */
export function bindKwdjContainerLabel({ editor, editorElement, input, node }: KwdjContainerLabelOptions): () => void {
  const view = editorElement.ownerDocument.defaultView;
  const stamp = editor.capture();
  if (!view || !(input instanceof view.HTMLInputElement) || input.type !== 'text' || !ownedField(editorElement, input)
    || inputs.has(input) || editor.lifecycle !== 'ready' || !stamp || labelOf(readNode(editor, node, stamp)) === null) {
    throw new TypeError('Expected a connected external text input and a single-line spoiler or disclosure label');
  }
  let owner = owners.get(editor);
  if (owner && owner.root !== editorElement) throw new TypeError('Label fields must use the same mounted editor root');
  if (!owner) {
    owner = new LabelOwner(editor, editorElement);
    owners.set(editor, owner);
  }
  return owner.bind(node, input, stamp);
}
