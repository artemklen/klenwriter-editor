// SPDX-License-Identifier: MIT OR Apache-2.0
import type { CommandDto, DeepReadonly, NodeViewDto, SessionContextV2, StateDto } from '@klenwriter/editor-sdk';
import type { HostFocus, InteractionMode, MountedEditor, MountedHostRequest } from '@klenwriter/editor-dom';
import type { EditorUi, UiAction, UiActionContext, UiBlockContext, UiCloseReason, UiCommandAction, UiDragProfile, UiFailure, UiHostAction, UiJson, UiLocale, UiMoveChoice, UiProfile, UiResult, UiText, UiUnavailable } from './types.js';
import { command, element, fields, host, id, json, list, text, UiError, unavailable } from './data.js';
import { label } from './strings.js';
import { slashProfile } from './slash-profile.js';
import { SlashOwner } from './slash-owner.js';
import { DragOwner } from './drag-owner.js';

interface Options {
  readonly editor: MountedEditor; readonly editorElement: HTMLElement;
  readonly slots: Readonly<{ toolbar: HTMLElement; gutter: HTMLElement; entry: HTMLElement }>;
  readonly locale: UiLocale; readonly profile: (context: DeepReadonly<SessionContextV2>) => UiProfile | UiUnavailable;
  readonly onResult?: (result: UiResult) => void;
}
type Pending = {
  request: MountedHostRequest; context: UiActionContext; scope: HTMLElement;
  action: string | null; claimed: boolean; abort: AbortController | null;
  close: ((reason: UiCloseReason) => void) | null; closed: boolean;
};
type Availability = { available: boolean; reason: string; active: string | null; failure: UiFailure | null };
type Control = {
  button: HTMLButtonElement; reason: HTMLElement; scope: 'toolbar' | 'block' | 'add' | 'move' | 'popup';
  action: UiAction | null; choice: UiMoveChoice | null; command: CommandDto | null;
  availability: Availability; context: UiActionContext | null;
};
type Popup = { kind: 'add' | 'move'; element: HTMLElement; controls: Control[]; pending: Pending; trigger: HTMLButtonElement };
type Task = { done: ((value: unknown) => void) | null; dispose: (() => void) | null };
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const failure = (code: Extract<UiFailure, { status: 'ui_refused' }>['code'], action: string | null = null): UiFailure => Object.freeze({ status: 'ui_refused', code, action });
const unavailableAvailability = (): Availability => ({ available: false, reason: '', active: null, failure: null });
let nextUi = 1;

function action(value: unknown): UiAction {
  if (value && typeof value === 'object' && Object.getOwnPropertyDescriptor(value, 'kind')?.value === 'host') {
    if (!host(value as UiHostAction)) throw new UiError('ui.invalid_options');
    return value as UiHostAction;
  }
  const f = fields(value, ['kind', 'id', 'label', 'command']);
  if (f.kind !== 'command' && f.kind !== 'toggle' || typeof f.command !== 'function') throw new UiError('ui.invalid_options');
  return Object.freeze({ kind: f.kind, id: id(f.id), label: text(f.label), command: f.command as UiCommandAction['command'] });
}
function actions(value: unknown, allowed: 'all' | 'commands' | 'hosts'): readonly UiAction[] {
  const result = list(value).map(action), ids = new Set<string>();
  for (const item of result) {
    if (ids.has(item.id) || allowed === 'commands' && item.kind === 'host' || allowed === 'hosts' && item.kind !== 'host') throw new UiError('ui.invalid_options');
    ids.add(item.id);
  }
  return Object.freeze(result);
}
function profile(value: unknown): UiProfile | UiUnavailable {
  const absent = unavailable(value); if (absent) return absent;
  const f = fields(value, ['toolbar', 'insertions', 'blockActions', 'moves'], ['slash', 'drag']);
  if (typeof f.moves !== 'function') throw new UiError('ui.invalid_options');
  let drag: UiDragProfile | undefined;
  if (f.drag !== undefined) {
    const d = fields(f.drag, ['move']); if (typeof d.move !== 'function') throw new UiError('ui.invalid_options');
    drag = Object.freeze({ move: d.move as UiDragProfile['move'] });
  }
  return Object.freeze({ toolbar: actions(f.toolbar, 'all'), insertions: actions(f.insertions, 'commands') as readonly UiCommandAction[],
    blockActions: actions(f.blockActions, 'hosts') as readonly UiHostAction[], moves: f.moves as UiProfile['moves'],
    ...(f.slash !== undefined ? {slash:slashProfile(f.slash)} : {}), ...(drag ? { drag } : {}) });
}
function moves(value: unknown): readonly UiMoveChoice[] | UiUnavailable {
  const absent = unavailable(value); if (absent) return absent;
  const ids = new Set<string>();
  return Object.freeze(list(value).map(v => {
    const f = fields(v, ['id', 'direction', 'label', 'command']), key = id(f.id);
    if (ids.has(key) || !['up', 'down', 'nest', 'unnest'].includes(String(f.direction))) throw new UiError('ui.invalid_options');
    ids.add(key);
    return Object.freeze({ id: key, direction: f.direction as UiMoveChoice['direction'], label: text(f.label), command: unavailable(f.command) ?? command(f.command) });
  }));
}
function options(value: Options): Options {
  const f = fields(value, ['editor', 'editorElement', 'slots', 'locale', 'profile'], ['onResult']);
  const roots = fields(f.slots, ['toolbar', 'gutter', 'entry']);
  if (!element(f.editorElement) || !f.editorElement.isConnected || !['ru', 'en'].includes(String(f.locale)) || typeof f.profile !== 'function'
    || f.onResult !== undefined && typeof f.onResult !== 'function') throw new UiError('ui.invalid_options');
  const editorElement = f.editorElement, slots = Object.values(roots);
  for (const root of slots) if (!element(root) || !root.isConnected || root.ownerDocument !== editorElement.ownerDocument
    || root.contains(editorElement) || editorElement.contains(root)) throw new UiError('ui.invalid_options');
  for (let a = 0; a < slots.length; a++) for (let b = a + 1; b < slots.length; b++) {
    if ((slots[a] as HTMLElement).contains(slots[b] as HTMLElement) || (slots[b] as HTMLElement).contains(slots[a] as HTMLElement)) throw new UiError('ui.invalid_options');
  }
  const editor = f.editor as MountedEditor;
  if (!editor || typeof editor.capture !== 'function' || typeof editor.context !== 'function' || typeof editor.read !== 'function'
    || typeof editor.query !== 'function' || typeof editor.subscribe !== 'function' || !editor.hostRequests || !editor.geometry) throw new UiError('ui.invalid_options');
  return { editor, editorElement, slots: Object.freeze({ toolbar: roots.toolbar as HTMLElement, gutter: roots.gutter as HTMLElement, entry: roots.entry as HTMLElement }),
    locale: f.locale as UiLocale, profile: f.profile as Options['profile'], ...(f.onResult ? { onResult: f.onResult as Options['onResult'] } : {}) };
}

class Ui implements EditorUi {
  readonly ready: Promise<{ readonly status: 'ready' } | UiFailure>;
  #options: Options | null; #locale: UiLocale; #document: Document; #window: Window;
  #destroyed = false; #initialized = false; #profile: UiProfile | null = null; #profileContext: DeepReadonly<SessionContextV2> | null = null;
  #context: UiActionContext | null = null; #hover: string | null = null; #pointer: { x: number; y: number } | null = null;
  #toolbar: HTMLElement; #gutter: HTMLElement; #entry: HTMLElement; #addPopup: HTMLElement; #movePopup: HTMLElement;
  #statusOwner: 'loading' | 'availability' | 'feedback' = 'loading';
  #status: HTMLElement; #blockLabel: HTMLElement; #add: Control; #move: Control;
  #controls = new WeakMap<Element, Control>(); #toolbarControls = new Map<string, Control>(); #blockControls = new Map<string, Control>();
  #reasonHoverControl: Control | null = null; #reasonFocusControl: Control | null = null;
  #pending: Pending | null = null; #popup: Popup | null = null; #tasks = new Set<Task>();
  #slash: SlashOwner | null = null;
  #drag: DragOwner | null = null;
  #pointerGesture = new WeakMap<Control, { readonly pointerId: number; admitted: boolean; request: MountedHostRequest | null }>();
  #removals: (() => void)[] = []; #observer: ResizeObserver | null = null; #subscription: (() => void) | null = null;
  #raf: number | null = null; #followupFrames = 0; #rendering = false; #refreshAgain = false; #emitting = false; #callbackDepth = 0;
  #onResult: Options['onResult']; #settle: (() => void)[] = [];
  #prefix = `kw-ui-${nextUi++}`; #nextReason = 0;

  constructor(configuration: Options) {
    this.#options = configuration; this.#locale = configuration.locale;
    this.#document = configuration.editorElement.ownerDocument; this.#window = this.#document.defaultView!;
    this.#onResult = configuration.onResult;
    this.#toolbar = this.#node('div', 'kw-ui-toolbar'); this.#toolbar.setAttribute('role', 'toolbar');
    this.#toolbar.hidden = true; this.#toolbar.tabIndex = -1;
    this.#gutter = this.#node('div', 'kw-ui-gutter'); this.#entry = this.#node('div', 'kw-ui-entry');
    this.#status = this.#node('div', 'kw-ui-status'); this.#status.setAttribute('role', 'status'); this.#status.setAttribute('aria-live', 'polite');
    this.#blockLabel = this.#node('div', 'kw-ui-context');
    this.#blockLabel.id = `${this.#prefix}-block-context`;
    this.#addPopup = this.#node('div', 'kw-ui-popup'); this.#addPopup.setAttribute('role', 'listbox'); this.#addPopup.hidden = true;
    this.#movePopup = this.#node('div', 'kw-ui-popup'); this.#movePopup.setAttribute('role', 'menu'); this.#movePopup.hidden = true;
    this.#add = this.#control('add', 'add'); this.#move = this.#control('move', 'move');
    this.#move.button.setAttribute('aria-describedby', `${this.#move.reason.id} ${this.#blockLabel.id}`);
    this.#movePopup.setAttribute('aria-describedby', `${this.#move.reason.id} ${this.#blockLabel.id}`);
    this.#add.button.dataset.editorUiControl = 'add'; this.#move.button.dataset.editorUiControl = 'move';
    this.#add.button.setAttribute('aria-haspopup', 'listbox'); this.#move.button.setAttribute('aria-haspopup', 'menu');
    this.#add.button.setAttribute('aria-expanded', 'false'); this.#move.button.setAttribute('aria-expanded', 'false');
    this.#gutter.append(this.#blockLabel, this.#move.button, this.#move.reason, this.#movePopup);
    this.#entry.append(this.#add.button, this.#add.reason, this.#addPopup, this.#status);
    configuration.slots.toolbar.append(this.#toolbar); configuration.slots.gutter.append(this.#gutter); configuration.slots.entry.append(this.#entry);
    this.#setStatus(label('loading', this.#locale), 'loading'); this.#wire(); this.#labels();
    this.ready = configuration.editor.ready.then(() => {
      if (this.#destroyed) return failure('ui.disposed');
      this.#wireInput(); // Mounted input owner is attached before its ready promise resolves.
      this.#initialized = true;
      const subscription = configuration.editor.subscribe(event => { this.#drag?.publication(event); this.#slash?.publication(event); this.refresh(); });
      if (typeof subscription !== 'function') {
        const result: UiFailure = subscription.status === 'dom_refused' ? subscription : { status: 'sdk_failure', response: subscription };
        this.#show(result); return result;
      }
      this.#subscription = subscription;
      const result = this.#update();
      return result ?? Object.freeze({ status: 'ready' as const });
    }, () => { const result = failure('ui.callback_failed'); this.#show(result); return result; });
  }
  #node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
    const result = this.#document.createElement(tag); result.className = className; return result;
  }
  #control(key: string, scope: Control['scope']): Control {
    const button = this.#node('button', 'kw-ui-button'); button.type = 'button'; button.tabIndex = 0; button.dataset.editorUiAction = key;
    const reason = this.#node('span', 'kw-ui-reason'); reason.id = `${this.#prefix}-reason-${++this.#nextReason}`;
    button.setAttribute('aria-describedby', reason.id); button.setAttribute('aria-disabled', 'true');
    const result: Control = { button, reason, scope, action: null, choice: null, command: null,
      availability: unavailableAvailability(), context: null };
    this.#controls.set(button, result); return result;
  }
  #listen(target: EventTarget, name: string, callback: EventListener, capture = false): void {
    target.addEventListener(name, callback, capture); this.#removals.push(() => target.removeEventListener(name, callback, capture));
  }
  #wire(): void {
    const configuration = this.#options!;
    for (const slot of Object.values(configuration.slots)) {
      this.#listen(slot, 'pointerover', e => {
        const event = e as PointerEvent, control = this.#find(event.target);
        if (control && !control.button.contains(event.relatedTarget as Node)) this.#enterReason(true, control);
      });
      this.#listen(slot, 'pointerdown', e => this.#pointerDown(e as PointerEvent));
      this.#listen(slot, 'click', e => this.#click(e as MouseEvent));
      this.#listen(slot, 'keydown', e => this.#key(e as KeyboardEvent));
    }
    this.#listen(configuration.editorElement, 'keydown', e => {
      const event = e as KeyboardEvent;
      if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey && !this.#destroyed) {
        const scope = event.shiftKey ? configuration.slots.toolbar : configuration.slots.entry;
        this.#capture(scope);
      }
    }, true);
    this.#listen(configuration.editorElement, 'pointermove', e => {
      const event = e as PointerEvent;
      if (!this.#pending && !this.#tasks.size && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        this.#pointer = { x: event.clientX, y: event.clientY }; this.refresh();
      }
    });
    this.#listen(configuration.editorElement, 'keyup', () => { if (!this.#pending) { this.#hover = null; this.#pointer = null; } this.refresh(); });
    this.#listen(this.#document, 'selectionchange', () => this.refresh());
    this.#listen(this.#document, 'focusin', () => {
      const control = this.#controls.get(this.#document.activeElement!) ?? null;
      if (control !== this.#reasonFocusControl) this.#enterReason(false, control);
      this.#slash?.focusChanged();
      const current = this.#document.activeElement;
      if (this.#pending && !this.#pending.abort && current && !this.#insideUi(current)) {
        this.#releasePending('invalidated'); this.#hidePopup();
      }
    });
    this.#listen(this.#document, 'focusout', e => {
      if (this.#reasonFocusControl && this.#controls.get((e as FocusEvent).relatedTarget as Element) !== this.#reasonFocusControl) this.#leaveReason(false);
    });
    this.#listen(this.#document, 'pointermove', e => this.#reasonPointerMove(e as PointerEvent));
    this.#listen(this.#document, 'pointerout', e => { if ((e as PointerEvent).relatedTarget === null) this.#leaveReason(true); });
    this.#listen(this.#document, 'pointerdown', e => {
      const control = this.#reasonHoverControl;
      if (control && !control.button.contains(e.target as Node)) this.#leaveReason(true);
    });
    this.#listen(this.#document, 'keydown', e => this.#dismissReasons(e as KeyboardEvent));
    this.#listen(this.#window, 'resize', () => this.refresh());
    this.#listen(this.#window, 'scroll', () => this.refresh(), true);
    if (this.#document.fonts) this.#listen(this.#document.fonts, 'loadingdone', () => this.refresh());
    const observer = (this.#window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (observer) {
      this.#observer = new observer(() => this.refresh()); this.#observer.observe(configuration.editorElement);
      for (const slot of Object.values(configuration.slots)) this.#observer.observe(slot);
    }
  }
  #wireInput(): void {
    const element = this.#options!.editorElement;
    for (const name of ['compositionstart', 'beforeinput']) this.#listen(element, name, () => { this.#drag?.cancel(label('stale', this.#locale)); this.refresh(); });
    for (const name of ['dragstart', 'drop']) this.#listen(element, name, () => {
      this.#drag?.cancel(); this.#slash?.retire(); this.#releasePending('invalidated'); this.#hidePopup();
      this.#setStatus(label('externalDrop', this.#locale)); this.refresh();
    }, true);
    for (const name of ['compositionend', 'input']) this.#listen(element, name, () => {
      // An unchanged terminal has no native publication. Discard an older UI
      // frame so both finite followups are queued after the mounted owner.
      if (this.#raf !== null) { this.#window.cancelAnimationFrame(this.#raf); this.#raf = null; }
      this.#followupFrames = 2; this.refresh();
    });
  }
  #insideUi(element: Element): boolean {
    return !!this.#options && Object.values(this.#options.slots).some(slot => slot.contains(element));
  }
  #ownedFocus(scope: HTMLElement): boolean { return this.#document.hasFocus() && scope.isConnected && !!this.#document.activeElement && scope.contains(this.#document.activeElement); }
  #find(target: EventTarget | null): Control | null {
    const constructor = (this.#window as unknown as { Node: typeof Node }).Node;
    let node = target instanceof constructor ? target as Node : null;
    while (node && node !== this.#document) {
      if (node.nodeType === 1) { const result = this.#controls.get(node as Element); if (result) return result; }
      node = node.parentNode;
    }
    return null;
  }
  #reasonLive(control: Control): boolean {
    const parent = control.button.parentElement;
    return !this.#destroyed && control.scope !== 'popup' && control.button.isConnected && control.reason.isConnected
      && !control.button.hidden && !!parent && !parent.hidden && [this.#toolbar, this.#gutter, this.#entry].includes(parent)
      && control.button.nextSibling === control.reason && control.reason.textContent !== '';
  }
  #resetReason(control: Control): void {
    control.reason.removeAttribute('data-open'); control.reason.removeAttribute('data-dismissed');
  }
  #forgetReason(control: Control): void {
    if (this.#reasonHoverControl === control) this.#reasonHoverControl = null;
    if (this.#reasonFocusControl === control) this.#reasonFocusControl = null;
    this.#resetReason(control);
  }
  #leaveReason(hover: boolean): void {
    const control = hover ? this.#reasonHoverControl : this.#reasonFocusControl;
    if (hover) this.#reasonHoverControl = null; else this.#reasonFocusControl = null;
    if (control && control !== this.#reasonHoverControl && control !== this.#reasonFocusControl) this.#resetReason(control);
  }
  #enterReason(hover: boolean, control: Control | null, entry = true): void {
    if ((hover ? this.#reasonHoverControl : this.#reasonFocusControl) !== control) this.#leaveReason(hover);
    if (!control || !this.#reasonLive(control)) return;
    if (hover) this.#reasonHoverControl = control; else this.#reasonFocusControl = control;
    // A stable reason's dismissal resets only on genuine button/focus entry.
    if (entry) control.reason.removeAttribute('data-dismissed');
    if (!control.reason.hasAttribute('data-dismissed')) control.reason.setAttribute('data-open', '');
  }
  #reasonPointerMove(event: PointerEvent): void {
    const control = this.#reasonHoverControl; if (!control) return;
    if (!this.#reasonLive(control)) { this.#forgetReason(control); return; }
    // Reasons remain pointer-transparent. Read only the original button/reason
    // rectangles, including their gap; never move paint or capture a pointer.
    const button = control.button.getBoundingClientRect(), reason = control.reason.getBoundingClientRect();
    const rectangles = [button, reason];
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)
      || rectangles.some(rect => ![rect.x, rect.y, rect.width, rect.height, rect.x + rect.width, rect.y + rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0)
      || event.clientX < Math.min(button.x, reason.x) || event.clientX > Math.max(button.x + button.width, reason.x + reason.width)
      || event.clientY < Math.min(button.y, reason.y) || event.clientY > Math.max(button.y + button.height, reason.y + reason.height)) this.#leaveReason(true);
    // In particular, movement inside the union never clears data-dismissed.
  }
  #dismissReasons(event: KeyboardEvent): void {
    if (this.#destroyed || event.key !== 'Escape' || event.defaultPrevented || event.isComposing
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // Bubble after the existing popup handlers. This is visual dismissal only:
    // no prevention, propagation, focus, SDK request, result or native action.
    for (const control of [this.#reasonFocusControl, this.#reasonHoverControl]) if (control) {
      if (!this.#reasonLive(control)) { this.#forgetReason(control); continue; }
      control.reason.removeAttribute('data-open'); control.reason.setAttribute('data-dismissed', '');
    }
  }
  #scope(control: Control): HTMLElement {
    if (control.action?.kind === 'host') return host(control.action)!.scope;
    const roots = this.#options!.slots;
    return control.scope === 'toolbar' ? roots.toolbar : control.scope === 'add' ? roots.entry : roots.gutter;
  }
  #pointerDown(event: PointerEvent): void {
    this.#drag?.cancel();
    this.#slash?.foreignGesture(event.target);
    this.#pointerGesture = new WeakMap();
    const control = this.#find(event.target); if (!control || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || this.#destroyed) return;
    const gesture = { pointerId: event.pointerId, admitted: false, request: null as MountedHostRequest | null }; this.#pointerGesture.set(control, gesture);
    if (control.scope === 'add' && this.#slash?.closeAdd()) { event.preventDefault(); return; }
    if (!this.#pending && !this.#tasks.size && !this.#rendering && !this.#callbackDepth) this.#update();
    if (!control.availability.available || this.#tasks.size) { event.preventDefault(); this.#showControl(control); return; }
    if (this.#popup && control.scope === 'popup') { gesture.request = this.#popup.pending.request; gesture.admitted = true; return; }
    const capture = this.#capture(this.#scope(control));
    gesture.request = capture?.request ?? null; gesture.admitted = !!capture;
    if (!capture) event.preventDefault();
  }
  #click(event: MouseEvent): void {
    const control = this.#find(event.target), gesture = control ? this.#pointerGesture.get(control) : undefined;
    this.#pointerGesture = new WeakMap(); // Consume before callbacks or availability re-evaluation.
    this.refresh(); // Resume current placement next frame, including a refused click.
    if (!control || this.#destroyed) return;
    event.preventDefault();
    const pointerId = (event as PointerEvent).pointerId;
    const pending = this.#popup && control.scope === 'popup' ? this.#popup.pending : this.#pending;
    if (event.detail > 0 && (!gesture?.admitted || !gesture.request || pending?.request !== gesture.request || Number.isSafeInteger(pointerId) && pointerId >= 0 && pointerId !== gesture.pointerId)) return;
    this.#activate(control);
  }
  #key(event: KeyboardEvent): void {
    if (this.#destroyed) return;
    const control = this.#find(event.target);
    const menuOwned = !!this.#popup && this.#popup.element.contains(this.#document.activeElement);
    const moveOwned = this.#document.activeElement === this.#move.button || menuOwned && this.#popup?.kind === 'move';
    if (event.altKey && !event.ctrlKey && !event.metaKey && moveOwned && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); this.#shortcut(({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'unnest', ArrowRight: 'nest' } as const)[event.key as 'ArrowUp']); return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape' && this.#popup) { event.preventDefault(); this.#cancelPopup(true); return; }
    if (event.key === 'Tab' && this.#popup) { this.#cancelPopup(false); return; }
    const controls = menuOwned ? this.#popup!.controls : this.#toolbar.contains(this.#document.activeElement) ? [...this.#toolbarControls.values()] : [];
    const navigation = menuOwned ? ['ArrowUp', 'ArrowDown', 'Home', 'End'] : ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (controls.length && navigation.includes(event.key)) {
      event.preventDefault(); const at = controls.findIndex(c => c.button === this.#document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1
        : (Math.max(0, at) + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + controls.length) % controls.length;
      this.#rove(controls, controls[next]); controls[next]!.button.focus(); return;
    }
    if (control && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (!event.repeat) this.#activate(control, true); }
  }
  #rove(controls: readonly Control[], active?: Control): void {
    const selected = active ?? controls.find(c => c.button.tabIndex === 0) ?? controls[0];
    for (const control of controls) {
      control.button.tabIndex = control === selected ? 0 : -1;
      if (control.button.hasAttribute('aria-selected')) control.button.setAttribute('aria-selected', String(control === selected));
    }
  }
  #readNode(node: string, state: DeepReadonly<StateDto>): DeepReadonly<NodeViewDto> | UiFailure {
    const response = this.#options!.editor.read({ kind: 'node', stamp: state.stamp, node });
    if (response.status === 'dom_refused') return response;
    if (response.status !== 'ok' || response.value.kind !== 'node') return { status: 'sdk_failure', response };
    return response.value.node;
  }
  #snapshot(preferSelection = false): UiActionContext | UiFailure {
    const editor = this.#options!.editor, context = editor.context(), stamp = editor.capture();
    if (!context || !stamp) return failure('ui.unavailable');
    const reply = editor.read({ kind: 'state' });
    if (reply.status === 'dom_refused') return reply;
    if (reply.status !== 'ok' || reply.value.kind !== 'state') return { status: 'sdk_failure', response: reply };
    const state = reply.value.state;
    const catalog = editor.read({ kind: 'catalog' });
    if (catalog.status === 'dom_refused') return catalog;
    if (catalog.status !== 'ok' || catalog.value.kind !== 'catalog') return { status: 'sdk_failure', response: catalog };
    let target = preferSelection ? null : this.#hover;
    if (!preferSelection && this.#pointer && !this.#pending) {
      const measured = editor.geometry.read({ kind: 'block_at_point', stamp: state.stamp, ...this.#pointer });
      if (measured.status === 'measured' && measured.target.kind === 'block') target = this.#hover = measured.target.node;
    }
    if (!target && state.selection) {
      const point = state.selection.focus; target = point.kind === 'child' ? point.parent : point.node;
    }
    let block: UiBlockContext | null = null;
    if (target) {
      const seen = new Set<string>(); let current = this.#readNode(target, state);
      if ('status' in current) return current;
      while (current.primitive !== 'root' && !['text_block', 'container', 'block_atom'].includes(current.primitive)) {
        if (!current.parent) break;
        if (seen.size >= 128) return failure('ui.limit'); seen.add(current.id);
        current = this.#readNode(current.parent, state); if ('status' in current) return current;
        if (seen.has(current.id)) return failure('ui.unavailable');
      }
      if (current.primitive !== 'root' && current.parent) {
        const node = current, ancestors: DeepReadonly<NodeViewDto>[] = [];
        while (current.parent) {
          if (seen.size + ancestors.length >= 128) return failure('ui.limit');
          const parent = this.#readNode(current.parent, state); if ('status' in parent) return parent;
          if (ancestors.some(v => v.id === parent.id) || parent.id === node.id) return failure('ui.unavailable');
          ancestors.push(parent); current = parent;
        }
        const parent = ancestors[0], index = parent?.children.indexOf(node.id) ?? -1;
        if (parent && index >= 0) block = Object.freeze({ node, parent, index, ancestors: Object.freeze(ancestors) });
      }
    }
    if (!same(stamp, state.stamp) || !same(editor.capture(), state.stamp) || !same(context, editor.context())) return failure('ui.unavailable');
    return Object.freeze({ context, state, catalog: catalog.value.commands, block });
  }
  #sameCapture(pending: Pending, context: UiActionContext): boolean {
    return same(pending.context.context, context.context) && same(pending.context.state.stamp, context.state.stamp) && same(pending.context.state.selection, context.state.selection);
  }
  #capture(scope: HTMLElement, preferSelection = false): Pending | null {
    if (this.#destroyed || !this.#initialized || this.#tasks.size) return null;
    const editor = this.#options!.editor, status = editor.hostRequests.status();
    if (status.status !== 'available') { this.#show(status); return null; }
    const context = this.#snapshot(preferSelection); if ('status' in context) { this.#show(context); return null; }
    if (preferSelection) { this.#hover = context.block?.node.id ?? null; this.#pointer = null; }
    if (this.#pending) {
      const old = this.#pending;
      if (old.abort || old.claimed || !this.#sameCapture(old, context)) { this.#releasePending('invalidated'); this.#showStale(); return null; }
      if (old.scope === scope && (!preferSelection || old.context.block?.node.id === context.block?.node.id)) return old;
      this.#pending = null;
      if (!editor.hostRequests.release(old.request)) { this.#showStale(); return null; }
      if (this.#popup?.pending === old) this.#hidePopup();
    }
    const captured = editor.hostRequests.capture({ focusScope: scope });
    if (captured.status !== 'captured') { this.#show(captured); return null; }
    if (!same(context.state.stamp, editor.capture()) || !same(context.context, editor.context())) {
      editor.hostRequests.release(captured.request); this.#showStale(); return null;
    }
    return this.#pending = { request: captured.request, context, scope, action: null, claimed: false, abort: null, close: null, closed: false };
  }
  #availability(commandDto: CommandDto | UiUnavailable, context: UiActionContext, toggle = false): Availability {
    if ('status' in commandDto) return { available: false, reason: commandDto.message[this.#locale], active: null, failure: null };
    const editor = this.#options!.editor, status = editor.hostRequests.status();
    if (status.status !== 'available') return { available: false, reason: this.#reason(status), active: null, failure: status };
    const query = editor.query({ kind: 'query_command', stamp: context.state.stamp, command: commandDto });
    if (query.status === 'dom_refused') return { available: false, reason: this.#reason(query), active: null, failure: query };
    if (query.status !== 'ok' || query.value.kind !== 'availability') {
      const result: UiFailure = { status: 'sdk_failure', response: query };
      return { available: false, reason: this.#reason(result), active: null, failure: result };
    }
    const active = query.value.presentation?.active ?? null;
    return { available: query.value.available && (!toggle || active === 'on' || active === 'off' || active === 'mixed'),
      reason: query.value.diagnostic ? `${label('unavailable', this.#locale)} (${query.value.diagnostic.code.slice(0, 256)})`
        : query.value.available && (!toggle || ['on', 'off', 'mixed'].includes(active ?? '')) ? '' : label('unavailable', this.#locale), active, failure: null };
  }
  #commandAction(item: UiAction, context: UiActionContext): CommandDto | UiUnavailable | null {
    if (item.kind === 'host') return null;
    const value = this.#callback(() => item.command(context)); return unavailable(value) ?? command(value);
  }
  #renderControl(control: Control, item: UiAction, context: UiActionContext): void {
    control.action = item; control.context = context;
    if (control.button.textContent !== item.label[this.#locale]) control.button.textContent = item.label[this.#locale];
    const guard = this.#options!.editor.hostRequests.status();
    if (guard.status !== 'available') {
      control.command = null; control.availability = { available: false, reason: this.#reason(guard), active: null, failure: guard };
      this.#drawAvailability(control); return;
    }
    if (item.kind === 'host') {
      const definition = host(item)!;
      const scope = definition.scope, options = this.#options!;
      if (scope.ownerDocument !== this.#document || !scope.isConnected || scope.contains(options.editorElement) || options.editorElement.contains(scope)) throw new UiError('ui.invalid_options');
      const status = options.editor.hostRequests.status();
      control.command = null; control.availability = status.status === 'available' && (control.scope !== 'block' || context.block !== null) ? { available: true, active: null, failure: null, reason: '' }
        : status.status === 'available' ? { available: false, active: null, failure: null, reason: label('unavailable', this.#locale) }
        : { available: false, active: null, failure: status, reason: this.#reason(status) };
    } else {
      const value = this.#commandAction(item, context)!;
      control.command = 'status' in value ? null : value;
      control.availability = this.#availability(value, context, item.kind === 'toggle');
    }
    this.#drawAvailability(control);
  }
  #drawAvailability(control: Control): void {
    control.button.setAttribute('aria-disabled', String(!control.availability.available));
    if (control.reason.textContent !== control.availability.reason) {
      this.#resetReason(control); control.reason.textContent = control.availability.reason;
    }
    if (!control.availability.reason) this.#forgetReason(control);
    else if (this.#reasonLive(control)) {
      // A previously available, already focused/hovered button can gain a
      // reason without a new DOM entry event. Bind the actual current trigger
      // so Escape can dismiss it; unchanged text never resets dismissal.
      if (this.#document.activeElement === control.button && this.#reasonFocusControl !== control) this.#enterReason(false, control, false);
      if (control.button.matches(':hover') && this.#reasonHoverControl !== control) this.#enterReason(true, control, false);
      if ((control === this.#reasonHoverControl || control === this.#reasonFocusControl) && !control.reason.hasAttribute('data-dismissed')) control.reason.setAttribute('data-open', '');
    }
    if (control.action?.kind === 'toggle' && ['on', 'off', 'mixed'].includes(control.availability.active ?? '')) {
      control.button.setAttribute('aria-pressed', control.availability.active === 'on' ? 'true' : control.availability.active === 'off' ? 'false' : 'mixed');
    } else control.button.removeAttribute('aria-pressed');
  }
  #syncControls(map: Map<string, Control>, items: readonly UiAction[], parent: HTMLElement, scope: 'toolbar' | 'block', context: UiActionContext): void {
    const live = new Set<string>();
    let next: ChildNode | null = scope === 'toolbar' ? parent.firstChild : this.#movePopup.nextSibling;
    for (const item of items) {
      live.add(item.id); let control = map.get(item.id);
      if (!control) { control = this.#control(item.id, scope); map.set(item.id, control); }
      this.#renderControl(control, item, context);
      // Moving an already correctly placed focused button can blur it in a UA.
      if (control.button !== next) parent.insertBefore(control.button, next);
      next = control.button.nextSibling;
      if (control.reason !== next) parent.insertBefore(control.reason, next);
      next = control.reason.nextSibling;
    }
    for (const [key, control] of map) if (!live.has(key)) { this.#forgetReason(control); control.button.remove(); control.reason.remove(); map.delete(key); }
    if (scope === 'toolbar') { this.#toolbar.hidden = map.size === 0; this.#rove([...map.values()]); this.#toolbar.tabIndex = -1; }
  }
  #labels(): void {
    this.#toolbar.setAttribute('aria-label', label('toolbar', this.#locale));
    if (this.#add.button.textContent !== label('add', this.#locale)) this.#add.button.textContent = label('add', this.#locale);
    if (this.#move.button.textContent !== label('move', this.#locale)) this.#move.button.textContent = label('move', this.#locale);
    this.#addPopup.setAttribute('aria-label', label('picker', this.#locale)); this.#movePopup.setAttribute('aria-label', label('move', this.#locale));
    for (const root of [this.#toolbar, this.#gutter, this.#entry]) root.lang = this.#locale;
  }
  #update(): UiFailure | null {
    if (this.#destroyed || !this.#options || !this.#initialized) return null;
    // Drag motion uses compact composite geometry, never ordinary NodeView snapshots.
    if (this.#drag?.active) { this.#drag.check(); return null; }
    if (this.#rendering) { this.#refreshAgain = true; return null; }
    this.#rendering = true;
    try {
      const context = this.#snapshot();
      if ('status' in context) { this.#disable(context, true, context.status === 'dom_refused' ? 'availability' : 'feedback'); return context; }
      if (!same(this.#profileContext, context.context)) {
        this.#disposeDrag();
        this.#disposeSlash();
        this.#releasePending('invalidated'); this.#hidePopup();
        const selected = profile(this.#callback(() => this.#options!.profile(context.context)));
        if ('status' in selected) { const result = failure('ui.unavailable'); this.#setStatus(selected.message[this.#locale]); this.#disable(result, false); return result; }
        this.#profile = selected; this.#profileContext = context.context;
      }
      if (!same(context.state.stamp, this.#options.editor.capture()) || !same(context.context, this.#options.editor.context())) return failure('ui.unavailable');
      if (this.#pending && !this.#sameCapture(this.#pending, context)) { this.#releasePending('invalidated'); this.#hidePopup(); }
      this.#context = context; this.#labels();
      if (!this.#drag) this.#drag = new DragOwner({
        editor: this.#options.editor, element: this.#options.editorElement, gutter: this.#gutter, prefix: this.#prefix,
        source: () => this.#context?.block?.node.id ?? null,
        beforeOpen: () => {
          this.#slash?.retire(); this.#releasePending('invalidated'); this.#hidePopup();
          if (this.#raf !== null) this.#window.cancelAnimationFrame(this.#raf); this.#raf = null; this.#followupFrames = 0;
        },
        keyboard: () => {
          if (this.#destroyed || this.#callbackDepth || this.#tasks.size) return;
          try { this.#update(); if (this.#move.availability.available) this.#openPopup('move', this.#drag!.handle); else this.#showControl(this.#move); }
          catch (error) { const result = this.#error(error); this.#show(result); this.#emit(result); }
        },
        invoke: callback => this.#callback(callback), feedback: message => this.#setStatus(message),
        result: result => this.#emit(result), failure: result => { this.#show(result); this.#emit(result); }, reason: result => this.#reason(result),
        schedule: () => this.refresh(), moved: source => { this.#hover = source; this.#pointer = null; },
      }, this.#locale);
      this.#drag.configure(this.#profile!.drag ?? null, this.#locale);
      if (this.#profile!.slash && !this.#slash) this.#slash = new SlashOwner({
        editor:this.#options.editor,element:this.#options.editorElement,entry:this.#entry,add:this.#add.button,prefix:this.#prefix,
        snapshot:()=>this.#snapshot(true),invoke:callback=>this.#callback(callback),
        availability:(value,captured)=>this.#availability(value,captured),
        result:result=>this.#emit(result),failure:result=>{this.#show(result);this.#emit(result);},
        feedback:message=>this.#setStatus(message),schedule:()=>this.refresh(),
        beforeOpen:()=>{this.#releasePending('invalidated');this.#hidePopup();},
      },this.#profile!.slash,this.#locale);
      this.#syncControls(this.#toolbarControls, this.#profile!.toolbar, this.#toolbar, 'toolbar', context);
      this.#syncControls(this.#blockControls, this.#profile!.blockActions, this.#gutter, 'block', context);
      const status = this.#options.editor.hostRequests.status();
      this.#add.context = this.#move.context = context;
      this.#add.availability = { available: status.status === 'available' && (this.#profile!.slash?.choices.length ?? this.#profile!.insertions.length) > 0, active: null, failure: status.status === 'available' ? null : status, reason: status.status === 'available' ? '' : this.#reason(status) };
      this.#move.availability = { available: status.status === 'available' && context.block !== null, active: null, failure: status.status === 'available' ? null : status, reason: status.status === 'available' ? context.block ? '' : label('unavailable', this.#locale) : this.#reason(status) };
      this.#drawAvailability(this.#add); this.#drawAvailability(this.#move);
      this.#blockLabel.textContent = context.block ? `${label('block', this.#locale).replace('{position}', String(context.block.index + 1)).replace('{type}', this.#typeLabel(context.block.node))} — ${[...context.block.ancestors].reverse().map(node => this.#typeLabel(node)).join(' / ')}` : '';
      this.#position(context);
      if (this.#profile!.slash) this.#slash?.refresh(this.#profile!.slash,this.#locale);
      if (status.status !== 'available') { this.#releasePending('invalidated'); this.#hidePopup(); this.#setStatus(this.#reason(status), 'availability'); }
      else if (same(context.state.stamp, this.#options.editor.capture()) && same(context.context, this.#options.editor.context())
        && (this.#statusOwner === 'loading' || this.#statusOwner === 'availability')) this.#setStatus('');
      return null;
    } catch (error) {
      const result = this.#error(error); this.#releasePending('invalidated'); this.#hidePopup(); this.#disable(result); return result;
    } finally {
      for (const control of [this.#reasonHoverControl, this.#reasonFocusControl]) if (control && !this.#reasonLive(control)) this.#forgetReason(control);
      this.#rendering = false;
      if (this.#refreshAgain) { this.#refreshAgain = false; this.refresh(); }
    }
  }
  #placementHeld(): boolean {
    const controls = [...this.#toolbarControls.values(), ...this.#blockControls.values(), this.#add, this.#move, ...(this.#popup?.controls ?? [])];
    return controls.some(control => this.#pointerGesture.has(control) && control.button.matches(':active'));
  }
  #position(context: UiActionContext): void {
    if (this.#placementHeld()) return; // Presentation only; native action guards remain separate.
    this.#positionToolbar(context);
    const clear = () => { this.#gutter.classList.remove('kw-ui-floating'); this.#gutter.style.removeProperty('left'); this.#gutter.style.removeProperty('top'); };
    if (!context.block) { clear(); return; }
    // Reject an already known fallback without temporarily removing the
    // in-flow gutter and shrinking an ancestor scroll range under host focus.
    const preliminary = this.#options!.editor.geometry.read({ kind: 'block', stamp: context.state.stamp, node: context.block.node.id });
    if (preliminary.status !== 'measured' || !preliminary.visible || !preliminary.rects.length) { clear(); return; }
    const preliminaryBox = this.#gutter.getBoundingClientRect();
    const preliminaryX = preliminary.rects[0]!.x - preliminaryBox.width - 8;
    if (![preliminaryX, preliminaryBox.width, preliminary.viewport.x].every(Number.isFinite)
      || preliminaryBox.width <= 0 || preliminaryX < preliminary.viewport.x + 8) { clear(); return; }
    // For a viable float, fit the intended presentation before the FINAL read:
    // an earlier host slot leaving flow can also move the source block.
    this.#gutter.classList.add('kw-ui-floating');
    const result = this.#options!.editor.geometry.read({ kind: 'block', stamp: context.state.stamp, node: context.block.node.id });
    if (result.status !== 'measured' || !result.visible || !result.rects.length) { clear(); return; }
    const first = result.rects[0]!, box = this.#gutter.getBoundingClientRect();
    const x = first.x - box.width - 8, y = Math.max(result.viewport.y + 8, Math.min(first.y, result.viewport.y + result.viewport.height - box.height - 8));
    if (![x, y, box.width, box.height].every(Number.isFinite) || x < result.viewport.x + 8
      || box.height > result.viewport.height - 16 || box.width <= 0) { clear(); return; }
    this.#gutter.style.left = `${Math.round(x * 2) / 2}px`; this.#gutter.style.top = `${Math.round(y * 2) / 2}px`;
  }
  #clearToolbarPlacement(): void {
    this.#toolbar.classList.remove('kw-ui-toolbar-floating');
    this.#toolbar.style.removeProperty('left'); this.#toolbar.style.removeProperty('top');
  }
  #positionToolbar(context: UiActionContext): void {
    this.#clearToolbarPlacement();
    if (!this.#toolbarControls.size) return;
    const result = this.#options!.editor.geometry.read({ kind: 'selection', stamp: context.state.stamp });
    // Unavailable/busy/stale/unsupported geometry keeps the original entry;
    // geometry never supplies authority to capture or execute a command.
    if (result.status !== 'measured' || !result.visible) return;
    const viewport = result.viewport, clip = result.clip;
    const fragments = [...result.rects, ...(result.anchor ? [result.anchor] : []), ...(result.focus ? [result.focus] : [])].flatMap(rect => {
      const left = Math.max(rect.x, clip.x, viewport.x), right = Math.min(rect.x + rect.width, clip.x + clip.width, viewport.x + viewport.width);
      const top = Math.max(rect.y, clip.y, viewport.y), bottom = Math.min(rect.y + rect.height, clip.y + clip.height, viewport.y + viewport.height);
      return bottom > top && (right > left || rect.width === 0 && right === left) ? [{ left, right, top, bottom }] : [];
    });
    if (!fragments.length) return;
    // Relative offsets keep the toolbar's original flow box: taking it out of
    // flow would itself move the selection we have just measured.
    this.#toolbar.classList.add('kw-ui-toolbar-floating');
    const box = this.#toolbar.getBoundingClientRect(), first = fragments[0]!;
    const top = Math.min(...fragments.map(rect => rect.top)), bottom = Math.max(...fragments.map(rect => rect.bottom));
    const minX = viewport.x + 8, maxX = viewport.x + viewport.width - box.width - 8;
    const above = top - box.height - 8, below = bottom + 8;
    const y = above >= viewport.y + 8 ? above : below + box.height <= viewport.y + viewport.height - 8 ? below : null;
    if (y === null || maxX < minX || ![box.x, box.y, box.width, box.height, minX, maxX, y].every(Number.isFinite)
      || box.width <= 0 || box.height <= 0) { this.#clearToolbarPlacement(); return; }
    const x = Math.max(minX, Math.min(first.left, maxX));
    this.#toolbar.style.left = `${Math.round((x - box.x) * 2) / 2}px`;
    this.#toolbar.style.top = `${Math.round((y - box.y) * 2) / 2}px`;
    // A transformed host slot may not realize the requested offsets.
    // Never retain that position as a successful presentation measurement.
    const placed = this.#toolbar.getBoundingClientRect();
    if (![placed.x, placed.y, placed.width, placed.height].every(Number.isFinite)
      || Math.abs(placed.x - x) > 0.5 || Math.abs(placed.y - y) > 0.5
      || placed.x < minX - 0.5 || placed.x + placed.width > viewport.x + viewport.width - 7.5
      || placed.y < viewport.y + 7.5 || placed.y + placed.height > viewport.y + viewport.height - 7.5)
      { this.#clearToolbarPlacement(); return; }
    // Selection geometry describes editor ancestry, while this slot may have
    // different paint clips. Inspect at most128 own ancestors, with no retained
    // witness. Refuse presentation that a host clip could hide.
    let ancestor = this.#toolbar.parentElement, inspected = 0;
    while (ancestor) {
      if (++inspected > 128) { this.#clearToolbarPlacement(); return; }
      const style = this.#window.getComputedStyle(ancestor), outer = ancestor.getBoundingClientRect();
      const clipsX = /^(hidden|clip|auto|scroll)$/.test(style.overflowX), clipsY = /^(hidden|clip|auto|scroll)$/.test(style.overflowY);
      if ((clipsX && (placed.left < outer.left + ancestor.clientLeft - 0.5 || placed.right > outer.left + ancestor.clientLeft + ancestor.clientWidth + 0.5))
        || (clipsY && (placed.top < outer.top + ancestor.clientTop - 0.5 || placed.bottom > outer.top + ancestor.clientTop + ancestor.clientHeight + 0.5))
        || style.clipPath !== 'none' || style.transform !== 'none' || style.perspective !== 'none'
        || (clipsX || clipsY) && [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].some(value => parseFloat(value) !== 0)) {
        this.#clearToolbarPlacement(); return;
      }
      ancestor = ancestor.parentElement;
    }
  }
  #typeLabel(node: DeepReadonly<NodeViewDto>): string {
    return label(node.primitive === 'root' ? 'document' : node.primitive === 'text_block' ? 'textBlock'
      : node.primitive === 'container' ? 'container' : node.primitive === 'block_atom' ? 'object' : 'genericBlock', this.#locale);
  }
  #disable(result: UiFailure, show = true, owner: 'availability' | 'feedback' = 'feedback'): void {
    this.#drag?.cancel();
    this.#slash?.retire();
    this.#clearToolbarPlacement();
    for (const control of [...this.#toolbarControls.values(), ...this.#blockControls.values(), this.#add, this.#move]) {
      control.availability = { available: false, active: null, failure: result, reason: this.#reason(result) }; this.#drawAvailability(control);
    }
    if (show) this.#setStatus(this.#reason(result), owner);
  }
  #setStatus(message: string, owner: 'loading' | 'availability' | 'feedback' = 'feedback'): void {
    if (this.#destroyed) return;
    // Writer provenance is updated even when independent feedback has equal text.
    this.#statusOwner = owner; this.#status.textContent = message;
  }
  #showControl(control: Control): void { this.#setStatus(control.availability.reason || label('unavailable', this.#locale), control.availability.failure?.status === 'dom_refused' ? 'availability' : 'feedback'); }
  #reason(result: UiFailure): string {
    const code = result.status === 'dom_refused' ? result.diagnostic.code : result.status === 'sdk_failure'
      ? result.response.status === 'ok' ? '' : result.response.diagnostic.code : result.code;
    const key = code.includes('composition') ? 'composing' : code === 'dom.mode_blocked' ? 'disabled'
      : code === 'dom.native_read_only' ? 'readonly' : code.includes('stale') || code.includes('bookmark') ? 'stale'
      : code === 'ui.callback_failed' ? 'callback' : 'unavailable';
    return `${label(key, this.#locale)}${code ? ` (${code.slice(0, 256)})` : ''}`;
  }
  #error(error: unknown, action: string | null = null): UiFailure { return failure(error instanceof UiError ? error.code : 'ui.callback_failed', action); }
  #show(result: UiFailure): void { if (!this.#destroyed) this.#setStatus(this.#reason(result)); }
  #showStale(): void { if (!this.#destroyed) this.#setStatus(label('stale', this.#locale)); }
  #emit(result: UiResult): void {
    if (this.#destroyed || !this.#onResult || this.#emitting) return;
    this.#emitting = true;
    try { this.#onResult(result); } catch { this.#show(failure('ui.callback_failed')); }
    finally { this.#emitting = false; }
  }
  #callback<T>(callback: () => T): T {
    this.#callbackDepth++;
    try { return callback(); } finally { this.#callbackDepth--; }
  }
  #activate(control: Control, keyboard = false): void {
    if (!this.#destroyed && !this.#pending && !this.#tasks.size && !this.#rendering && !this.#callbackDepth) this.#update();
    if (!this.#options || this.#destroyed || this.#tasks.size || this.#callbackDepth || this.#rendering || !control.availability.available) { this.#showControl(control); return; }
    try {
      if (control.scope === 'add') { this.#openPopup('add'); return; }
      if (control.scope === 'move') { this.#openPopup('move', undefined, keyboard); return; }
      const pending = this.#popup && control.scope === 'popup' ? this.#popup.pending : this.#capture(this.#scope(control));
      if (!pending) return;
      if (control.action?.kind === 'host') { this.#openHost(control.action, pending); return; }
      const item = control.choice?.command ?? (control.action ? this.#commandAction(control.action, pending.context) : null);
      if (!item) throw new UiError('ui.callback_failed');
      const owned = unavailable(item) ?? command(item), availability = this.#availability(owned, pending.context, control.action?.kind === 'toggle');
      if (!availability.available || 'status' in owned) {
        this.#setStatus(availability.reason || label('unavailable', this.#locale));
        this.#emit(availability.failure ?? failure('ui.unavailable', control.action?.id ?? control.choice?.id ?? null));
        this.#releasePending('refused'); this.#hidePopup(); return;
      }
      this.#complete(pending, control.action?.id ?? control.choice!.id, owned, control.choice !== null);
    } catch (error) { const result = this.#error(error, control.action?.id ?? null); this.#show(result); this.#emit(result); this.#releasePending('refused'); this.#hidePopup(); }
  }
  #openPopup(kind: 'add' | 'move', initiating?: HTMLButtonElement, preferSelection = false): void {
    this.#drag?.cancel();
    if (this.#popup) { this.#cancelPopup(true); return; }
    if (kind === 'add' && this.#profile?.slash) {
      if (this.#slash?.closeAdd()) { this.#releasePending('cancelled'); return; }
      const pending = this.#capture(this.#options!.slots.entry);
      if (pending && this.#slash) { this.#pending = null; pending.claimed = true; this.#slash.openAdd(pending.request,pending.context); }
      return;
    }
    this.#slash?.retire();
    const trigger = initiating ?? (kind === 'add' ? this.#add.button : this.#move.button);
    const pending = this.#capture(kind === 'add' ? this.#options!.slots.entry : this.#options!.slots.gutter, preferSelection); if (!pending) return;
    // Normal keyboard Move names and positions the captured caret block. The
    // explicitly hovered Drag handle keeps its own source and existing request.
    if (preferSelection && (this.#update() || this.#pending !== pending)) return;
    const popup = kind === 'add' ? this.#addPopup : this.#movePopup;
    const choices = kind === 'move' && pending.context.block ? moves(this.#callback(() => this.#profile!.moves(pending.context as UiActionContext & { block: UiBlockContext }))) : null;
    if (choices && 'status' in choices) { this.#setStatus(choices.message[this.#locale]); this.#releasePending('refused'); return; }
    popup.replaceChildren(); const controls: Control[] = [];
    if (kind === 'add') {
      for (const item of this.#profile!.insertions) { const control = this.#control(item.id, 'popup'); this.#renderControl(control, item, pending.context); controls.push(control); }
    } else if (choices) {
      for (const choice of choices) {
        const control = this.#control(choice.id, 'popup'); control.choice = choice; control.context = pending.context;
        control.button.textContent = choice.label[this.#locale]; control.command = 'status' in choice.command ? null : choice.command;
        control.availability = this.#availability(choice.command, pending.context); this.#drawAvailability(control); controls.push(control);
      }
    }
    if (!same(pending.context.state.stamp, this.#options!.editor.capture()) || !same(pending.context.context, this.#options!.editor.context())) { this.#releasePending('invalidated'); this.#showStale(); return; }
    for (const control of controls) { control.button.setAttribute('role', kind === 'add' ? 'option' : 'menuitem'); if (kind === 'add') control.button.setAttribute('aria-selected', 'false'); popup.append(control.button, control.reason); }
    if (!controls.length) { const empty = this.#node('div', 'kw-ui-reason'); empty.textContent = label('empty', this.#locale); popup.append(empty); popup.tabIndex = 0; }
    this.#popup = { kind, element: popup, controls, pending, trigger }; popup.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    this.#rove(controls); (controls[0]?.button ?? popup).focus();
  }
  #shortcut(direction: UiMoveChoice['direction']): void {
    try {
      if (!this.#popup) this.#openPopup('move', undefined, true);
      const popup = this.#popup; if (!popup || popup.kind !== 'move') return;
      const candidates = popup.controls.filter(control => control.choice?.direction === direction);
      if (candidates.length === 1) this.#activate(candidates[0]!);
      else if (candidates.length) { this.#rove(popup.controls, candidates[0]); candidates[0]!.button.focus(); }
      else this.#setStatus(label('unavailable', this.#locale));
    } catch (error) { const result = this.#error(error); this.#show(result); this.#emit(result); }
  }
  #complete(pending: Pending, actionId: string, owned: CommandDto, moving: boolean): void {
    if (pending.claimed || this.#pending !== pending) return;
    pending.claimed = true; pending.action = actionId; this.#pending = null;
    const popup = this.#popup;
    const result = this.#options!.editor.hostRequests.complete(pending.request, owned, { focus: moving ? 'none' : 'native_result' });
    if (result.status !== 'submitted') { this.#show(result); this.#emit(result); this.#closeHost(pending, 'refused'); this.#hidePopup(); return; }
    const completion = result.submission.status === 'completed' ? Promise.resolve(result.submission.response) : result.submission.completion;
    this.#track(Promise.all([completion, result.focus]), ([response, focus]) => {
      if (response.status !== 'ok') this.#show({ status: 'sdk_failure', response });
      else if (moving && response.value.kind === 'mutation' && response.value.effect === 'unchanged') this.#setStatus(label('unchanged', this.#locale));
      else if (moving) {
        const context = this.#snapshot();
        if (!('status' in context) && context.block) this.#setStatus(label('position', this.#locale).replace('{position}', String(context.block.index + 1)));
      } else if (focus.failure) this.#show(focus.failure);
      this.#closeHost(pending, response.status === 'ok' ? 'accepted' : 'refused');
      if (this.#popup === popup && popup) {
        const owns = this.#ownedFocus(popup.element); this.#hidePopup();
        if (moving && owns && popup.trigger.isConnected) popup.trigger.focus({ preventScroll: true });
      }
      this.refresh();
    }, () => this.#closeHost(pending, 'destroyed'));
    this.#emit(Object.freeze({ status: 'submitted', action: actionId, submission: result.submission, focus: result.focus }));
  }
  #openHost(item: UiHostAction, pending: Pending): void {
    const definition = host(item)!;
    pending.action = item.id; pending.abort = new AbortController();
    try {
      const close = this.#callback(() => definition.open(Object.freeze({ context: pending.context, signal: pending.abort!.signal,
        accept: (value: UiJson) => this.#acceptHost(item, pending, value), cancel: () => this.#cancelHost(pending) })));
      if (typeof close !== 'function') throw new UiError('ui.callback_failed');
      pending.close = close;
      if (this.#destroyed || pending.closed) { pending.close = null; close(this.#destroyed ? 'destroyed' : 'invalidated'); }
    } catch (error) { const result = this.#error(error, item.id); this.#show(result); this.#emit(result); if (!pending.claimed) this.#releasePending('refused'); }
  }
  #acceptHost(item: UiHostAction, pending: Pending, value: unknown): void {
    if (this.#destroyed || pending.claimed || this.#pending !== pending) return;
    // Claim UI acceptance before traversing host-owned result data or callbacks.
    pending.claimed = true;
    try {
      const copied = json(value), result = this.#callback(() => host(item)!.command(pending.context, copied));
      const owned = unavailable(result) ?? command(result);
      if ('status' in owned) {
        this.#setStatus(owned.message[this.#locale]); this.#emit(failure('ui.unavailable', item.id)); this.#releasePending('refused'); return;
      }
      if (this.#destroyed || this.#pending !== pending) return;
      const availability = this.#availability(owned, pending.context);
      if (!availability.available) {
        const stale = !same(pending.context.context, this.#options!.editor.context()) || !same(pending.context.state.stamp, this.#options!.editor.capture());
        this.#setStatus(stale ? label('staleDialog', this.#locale) : availability.reason || label('unavailable', this.#locale));
        this.#emit(availability.failure ?? failure('ui.unavailable', item.id)); this.#releasePending('refused'); return;
      }
      pending.claimed = false; this.#complete(pending, item.id, owned, false);
    } catch (error) { const result = this.#error(error, item.id); this.#show(result); this.#emit(result); this.#releasePending('refused'); }
  }
  #cancelHost(pending: Pending): void {
    if (this.#destroyed || pending.claimed || this.#pending !== pending) return;
    const owned = this.#ownedFocus(pending.scope); pending.claimed = true; this.#pending = null;
    const result = this.#options!.editor.hostRequests.cancel(pending.request, { focus: owned });
    if (result.status === 'cancelled') this.#emit(Object.freeze({ status: 'cancelled', action: pending.action!, restore: result.restore }));
    else { this.#show(result); this.#emit(result); }
    this.#closeHost(pending, 'cancelled');
    if (result.status !== 'cancelled' && owned && this.#document.activeElement === this.#document.body) this.#add.button.focus();
    this.refresh();
  }
  #closeHost(pending: Pending, reason: UiCloseReason): void {
    if (pending.closed) return;
    pending.closed = true; pending.abort?.abort(); pending.abort = null;
    const close = pending.close; pending.close = null;
    if (close) try { close(reason); } catch { this.#show(failure('ui.callback_failed', pending.action)); }
  }
  #releasePending(reason: UiCloseReason): void {
    const pending = this.#pending; this.#pending = null;
    if (!pending) return;
    this.#options?.editor.hostRequests.release(pending.request); this.#closeHost(pending, reason);
  }
  #cancelPopup(focus: boolean): void {
    const popup = this.#popup; if (!popup || !this.#options) return;
    const pending = popup.pending, owned = this.#ownedFocus(popup.element);
    this.#pending = null; pending.claimed = true;
    const result = this.#options.editor.hostRequests.cancel(pending.request, { focus: popup.kind === 'add' && focus && owned });
    this.#hidePopup();
    if (result.status === 'cancelled') {
      this.#emit(Object.freeze({ status: 'cancelled', action: popup.kind, restore: result.restore }));
      if (owned && (popup.kind === 'move' || !focus) && popup.trigger.isConnected
        && (this.#document.activeElement === this.#document.body || popup.element.contains(this.#document.activeElement))) popup.trigger.focus({ preventScroll: true });
    }
    else { this.#show(result); this.#emit(result); if (focus && owned && this.#document.activeElement === this.#document.body) this.#add.button.focus(); }
  }
  #hidePopup(): void {
    const popup = this.#popup; this.#popup = null;
    if (popup) { popup.element.hidden = true; popup.trigger.setAttribute('aria-expanded', 'false'); popup.element.replaceChildren(); }
  }
  #track<T>(promise: Promise<T>, callback: (value: T) => void, dispose: () => void): void {
    const task: Task = { done: value => callback(value as T), dispose }; this.#tasks.add(task);
    void promise.then(value => {
      try { task.done?.(value); } catch { if (!this.#destroyed) this.#show(failure('ui.callback_failed')); }
      finally { task.done = null; task.dispose = null; this.#tasks.delete(task); this.#finishDisposal(); }
    }, () => {
      try { if (!this.#destroyed) this.#show(failure('ui.callback_failed')); task.dispose?.(); }
      finally { task.done = null; task.dispose = null; this.#tasks.delete(task); this.#finishDisposal(); }
    });
  }
  setLocale(locale: UiLocale): void {
    if (this.#destroyed) return;
    if (locale !== 'ru' && locale !== 'en') { this.#show(failure('ui.invalid_options')); return; }
    this.#drag?.cancel(); this.#locale = locale; this.#labels(); this.refresh();
  }
  setInteractionMode(mode: InteractionMode): ReturnType<MountedEditor['setInteractionMode']> {
    if (!this.#options || this.#destroyed) return { status: 'dom_refused', diagnostic: { code: 'dom.disposed', phase: 'mode', stamp: null, node: null, typeId: null, publication: 'none' } };
    this.#drag?.cancel(); const result = this.#options.editor.setInteractionMode(mode); this.#releasePending('invalidated'); this.#hidePopup(); this.#slash?.retire(); this.refresh(); return result;
  }
  refresh(): void {
    if (this.#destroyed || !this.#initialized || this.#raf !== null) return;
    if (this.#drag?.active) { this.#drag.check(); return; }
    this.#raf = this.#window.requestAnimationFrame(() => {
      this.#raf = null; if (this.#followupFrames > 0) this.#followupFrames--;
      this.#update(); if (this.#followupFrames > 0) this.refresh();
    });
  }
  resources(): ReturnType<EditorUi['resources']> {
    const slash = this.#slash?.resources(), drag = this.#drag?.resources();
    return Object.freeze({ listeners: this.#removals.length + (slash?.listeners ?? 0) + (drag?.listeners ?? 0), observers: this.#observer ? 1 : 0, animationFrames: (this.#raf === null ? 0 : 1) + (drag?.animationFrames ?? 0),
      subscriptions: (this.#subscription ? 1 : 0) + (slash?.subscriptions ?? 0), hostRequests: (this.#pending ? 1 : 0) + (slash?.hostRequests ?? 0) + (drag?.hostRequests ?? 0), continuations: this.#tasks.size + (slash?.continuations ?? 0) + (drag?.continuations ?? 0),
      dragGestures: drag?.dragGestures ?? 0, pointerCaptures: drag?.pointerCaptures ?? 0 });
  }
  #disposeDrag(): void {
    const owner = this.#drag; this.#drag = null;
    if (owner) this.#track(owner.destroy(), () => {}, () => {});
  }
  #disposeSlash(): void {
    const owner = this.#slash; this.#slash = null;
    if (owner) this.#track(owner.destroy(),()=>{},()=>{});
  }
  #finishDisposal(): void { if (this.#destroyed && !this.#tasks.size) for (const resolve of this.#settle.splice(0)) resolve(); }
  destroy(): ReturnType<EditorUi['destroy']> {
    if (!this.#destroyed) {
      this.#destroyed = true; this.#onResult = undefined;
      if (this.#raf !== null) this.#window.cancelAnimationFrame(this.#raf); this.#raf = null; this.#followupFrames = 0;
      this.#releasePending('destroyed'); this.#hidePopup();
      this.#disposeSlash();
      this.#disposeDrag();
      for (const task of this.#tasks) { task.done = null; task.dispose?.(); task.dispose = null; }
      this.#subscription?.(); this.#subscription = null; this.#observer?.disconnect(); this.#observer = null;
      for (const remove of this.#removals.splice(0)) remove();
      this.#leaveReason(true); this.#leaveReason(false);
      this.#toolbar.remove(); this.#gutter.remove(); this.#entry.remove();
      this.#toolbarControls.clear(); this.#blockControls.clear(); this.#profile = null; this.#profileContext = null; this.#context = null;
      this.#options = null; this.#pointer = null; this.#hover = null;
    }
    return Object.freeze({ status: 'destroy_requested', settled: new Promise<void>(resolve => { this.#settle.push(resolve); this.#finishDisposal(); }) });
  }
}

export function createEditorUi(configuration: Options): EditorUi | UiFailure {
  try { return new Ui(options(configuration)); }
  catch { return failure('ui.invalid_options'); }
}
