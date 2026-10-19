// SPDX-License-Identifier: MIT OR Apache-2.0
import type { CommandDto, DeepReadonly, NodeViewDto, SessionContextV2, StateDto } from '@klenwriter/editor-sdk';
import type { HostFocus, InteractionMode, MountedEditor, MountedHostRequest } from '@klenwriter/editor-dom';
import type { EditorUi, UiAction, UiActionContext, UiBlockContext, UiCloseReason, UiCommandAction, UiFailure, UiHostAction, UiJson, UiLocale, UiMoveChoice, UiProfile, UiResult, UiText, UiUnavailable } from './types.js';
import { command, element, fields, host, id, json, list, text, UiError, unavailable } from './data.js';
import { label } from './strings.js';

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
  const f = fields(value, ['toolbar', 'insertions', 'blockActions', 'moves']);
  if (typeof f.moves !== 'function') throw new UiError('ui.invalid_options');
  return Object.freeze({ toolbar: actions(f.toolbar, 'all'), insertions: actions(f.insertions, 'commands') as readonly UiCommandAction[],
    blockActions: actions(f.blockActions, 'hosts') as readonly UiHostAction[], moves: f.moves as UiProfile['moves'] });
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
  #status: HTMLElement; #blockLabel: HTMLElement; #add: Control; #move: Control;
  #controls = new WeakMap<Element, Control>(); #toolbarControls = new Map<string, Control>(); #blockControls = new Map<string, Control>();
  #pending: Pending | null = null; #popup: Popup | null = null; #tasks = new Set<Task>();
  #removals: (() => void)[] = []; #observer: ResizeObserver | null = null; #subscription: (() => void) | null = null;
  #raf: number | null = null; #followupFrames = 0; #rendering = false; #refreshAgain = false; #emitting = false; #callbackDepth = 0;
  #onResult: Options['onResult']; #settle: (() => void)[] = [];
  #prefix = `kw-ui-${nextUi++}`; #nextReason = 0;

  constructor(configuration: Options) {
    this.#options = configuration; this.#locale = configuration.locale;
    this.#document = configuration.editorElement.ownerDocument; this.#window = this.#document.defaultView!;
    this.#onResult = configuration.onResult;
    this.#toolbar = this.#node('div', 'kw-ui-toolbar'); this.#toolbar.setAttribute('role', 'toolbar');
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
    this.#status.textContent = label('loading', this.#locale); this.#wire(); this.#labels();
    this.ready = configuration.editor.ready.then(() => {
      if (this.#destroyed) return failure('ui.disposed');
      this.#initialized = true;
      const subscription = configuration.editor.subscribe(() => this.refresh());
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
    for (const name of ['compositionstart', 'beforeinput']) this.#listen(configuration.editorElement, name, () => this.refresh());
    for (const name of ['compositionend', 'input']) this.#listen(configuration.editorElement, name, () => {
      // A zero-change composition terminal has no native publication. Two
      // finite presentation frames follow the terminal, never an action retry.
      this.#followupFrames = 2; this.refresh();
    });
    this.#listen(this.#document, 'selectionchange', () => this.refresh());
    this.#listen(this.#document, 'focusin', () => {
      const current = this.#document.activeElement;
      if (this.#pending && !this.#pending.abort && current && !this.#insideUi(current)) {
        this.#releasePending('invalidated'); this.#hidePopup();
      }
    });
    this.#listen(this.#window, 'resize', () => this.refresh());
    this.#listen(this.#window, 'scroll', () => this.refresh(), true);
    if (this.#document.fonts) this.#listen(this.#document.fonts, 'loadingdone', () => this.refresh());
    const observer = (this.#window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (observer) {
      this.#observer = new observer(() => this.refresh()); this.#observer.observe(configuration.editorElement);
      for (const slot of Object.values(configuration.slots)) this.#observer.observe(slot);
    }
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
  #scope(control: Control): HTMLElement {
    if (control.action?.kind === 'host') return host(control.action)!.scope;
    const roots = this.#options!.slots;
    return control.scope === 'toolbar' ? roots.toolbar : control.scope === 'add' ? roots.entry : roots.gutter;
  }
  #pointerDown(event: PointerEvent): void {
    const control = this.#find(event.target); if (!control || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || this.#destroyed) return;
    if (!this.#pending && !this.#tasks.size && !this.#rendering && !this.#callbackDepth) this.#update();
    if (!control.availability.available || this.#tasks.size) { event.preventDefault(); this.#showControl(control); return; }
    if (this.#popup && control.scope === 'popup') return;
    const capture = this.#capture(this.#scope(control));
    if (!capture) event.preventDefault();
  }
  #click(event: MouseEvent): void {
    const control = this.#find(event.target); if (!control || this.#destroyed) return;
    event.preventDefault(); this.#activate(control);
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
    if (control && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (!event.repeat) this.#activate(control); }
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
  #snapshot(): UiActionContext | UiFailure {
    const editor = this.#options!.editor, context = editor.context(), stamp = editor.capture();
    if (!context || !stamp) return failure('ui.unavailable');
    const reply = editor.read({ kind: 'state' });
    if (reply.status === 'dom_refused') return reply;
    if (reply.status !== 'ok' || reply.value.kind !== 'state') return { status: 'sdk_failure', response: reply };
    const state = reply.value.state;
    const catalog = editor.read({ kind: 'catalog' });
    if (catalog.status === 'dom_refused') return catalog;
    if (catalog.status !== 'ok' || catalog.value.kind !== 'catalog') return { status: 'sdk_failure', response: catalog };
    let target = this.#hover;
    if (this.#pointer && !this.#pending) {
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
  #capture(scope: HTMLElement): Pending | null {
    if (this.#destroyed || !this.#initialized || this.#tasks.size) return null;
    const editor = this.#options!.editor, status = editor.hostRequests.status();
    if (status.status !== 'available') { this.#show(status); return null; }
    const context = this.#snapshot(); if ('status' in context) { this.#show(context); return null; }
    if (this.#pending) {
      const old = this.#pending;
      if (old.abort || old.claimed || !this.#sameCapture(old, context)) { this.#releasePending('invalidated'); this.#showStale(); return null; }
      if (old.scope === scope) return old;
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
    control.button.setAttribute('aria-disabled', String(!control.availability.available)); control.reason.textContent = control.availability.reason;
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
    for (const [key, control] of map) if (!live.has(key)) { control.button.remove(); control.reason.remove(); map.delete(key); }
    if (scope === 'toolbar') { this.#rove([...map.values()]); this.#toolbar.tabIndex = map.size ? -1 : 0; }
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
    if (this.#rendering) { this.#refreshAgain = true; return null; }
    this.#rendering = true;
    try {
      const context = this.#snapshot();
      if ('status' in context) { this.#disable(context); return context; }
      if (!same(this.#profileContext, context.context)) {
        this.#releasePending('invalidated'); this.#hidePopup();
        const selected = profile(this.#callback(() => this.#options!.profile(context.context)));
        if ('status' in selected) { const result = failure('ui.unavailable'); this.#status.textContent = selected.message[this.#locale]; this.#disable(result, false); return result; }
        this.#profile = selected; this.#profileContext = context.context;
      }
      if (!same(context.state.stamp, this.#options.editor.capture()) || !same(context.context, this.#options.editor.context())) return failure('ui.unavailable');
      if (this.#pending && !this.#sameCapture(this.#pending, context)) { this.#releasePending('invalidated'); this.#hidePopup(); }
      this.#context = context; this.#labels();
      this.#syncControls(this.#toolbarControls, this.#profile!.toolbar, this.#toolbar, 'toolbar', context);
      this.#syncControls(this.#blockControls, this.#profile!.blockActions, this.#gutter, 'block', context);
      const status = this.#options.editor.hostRequests.status();
      this.#add.context = this.#move.context = context;
      this.#add.availability = { available: status.status === 'available' && this.#profile!.insertions.length > 0, active: null, failure: status.status === 'available' ? null : status, reason: status.status === 'available' ? '' : this.#reason(status) };
      this.#move.availability = { available: status.status === 'available' && context.block !== null, active: null, failure: status.status === 'available' ? null : status, reason: status.status === 'available' ? context.block ? '' : label('unavailable', this.#locale) : this.#reason(status) };
      this.#drawAvailability(this.#add); this.#drawAvailability(this.#move);
      this.#blockLabel.textContent = context.block ? `${label('block', this.#locale).replace('{position}', String(context.block.index + 1)).replace('{type}', this.#typeLabel(context.block.node))} — ${[...context.block.ancestors].reverse().map(node => this.#typeLabel(node)).join(' / ')}` : '';
      this.#position(context);
      if (status.status !== 'available') { this.#releasePending('invalidated'); this.#hidePopup(); this.#status.textContent = this.#reason(status); }
      else if (same(context.state.stamp, this.#options.editor.capture()) && same(context.context, this.#options.editor.context())
        && (this.#status.textContent === label('loading', 'ru') || this.#status.textContent === label('loading', 'en'))) this.#status.textContent = '';
      return null;
    } catch (error) {
      const result = this.#error(error); this.#releasePending('invalidated'); this.#hidePopup(); this.#disable(result); return result;
    } finally {
      this.#rendering = false;
      if (this.#refreshAgain) { this.#refreshAgain = false; this.refresh(); }
    }
  }
  #position(context: UiActionContext): void {
    const clear = () => { this.#gutter.classList.remove('kw-ui-floating'); this.#gutter.style.removeProperty('left'); this.#gutter.style.removeProperty('top'); };
    if (!context.block) { clear(); return; }
    const result = this.#options!.editor.geometry.read({ kind: 'block', stamp: context.state.stamp, node: context.block.node.id });
    if (result.status !== 'measured' || !result.visible || !result.rects.length) { clear(); return; }
    const first = result.rects[0]!, box = this.#gutter.getBoundingClientRect();
    const x = first.x - box.width - 8, y = Math.max(result.viewport.y + 8, Math.min(first.y, result.viewport.y + result.viewport.height - box.height - 8));
    if (![x, y, box.width, box.height].every(Number.isFinite) || x < result.viewport.x + 8
      || box.height > result.viewport.height - 16 || box.width <= 0) { clear(); return; }
    this.#gutter.classList.add('kw-ui-floating'); this.#gutter.style.left = `${Math.round(x * 2) / 2}px`; this.#gutter.style.top = `${Math.round(y * 2) / 2}px`;
  }
  #typeLabel(node: DeepReadonly<NodeViewDto>): string {
    return label(node.primitive === 'root' ? 'document' : node.primitive === 'text_block' ? 'textBlock'
      : node.primitive === 'container' ? 'container' : node.primitive === 'block_atom' ? 'object' : 'genericBlock', this.#locale);
  }
  #disable(result: UiFailure, show = true): void {
    for (const control of [...this.#toolbarControls.values(), ...this.#blockControls.values(), this.#add, this.#move]) {
      control.availability = { available: false, active: null, failure: result, reason: this.#reason(result) }; this.#drawAvailability(control);
    }
    if (show) this.#status.textContent = this.#reason(result);
  }
  #showControl(control: Control): void { this.#status.textContent = control.availability.reason || label('unavailable', this.#locale); }
  #reason(result: UiFailure): string {
    const code = result.status === 'dom_refused' ? result.diagnostic.code : result.status === 'sdk_failure'
      ? result.response.status === 'ok' ? '' : result.response.diagnostic.code : result.code;
    const key = code.includes('composition') ? 'composing' : code === 'dom.mode_blocked' ? 'disabled'
      : code === 'dom.native_read_only' ? 'readonly' : code.includes('stale') || code.includes('bookmark') ? 'stale'
      : code === 'ui.callback_failed' ? 'callback' : 'unavailable';
    return `${label(key, this.#locale)}${code ? ` (${code.slice(0, 256)})` : ''}`;
  }
  #error(error: unknown, action: string | null = null): UiFailure { return failure(error instanceof UiError ? error.code : 'ui.callback_failed', action); }
  #show(result: UiFailure): void { if (!this.#destroyed) this.#status.textContent = this.#reason(result); }
  #showStale(): void { if (!this.#destroyed) this.#status.textContent = label('stale', this.#locale); }
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
  #activate(control: Control): void {
    if (!this.#destroyed && !this.#pending && !this.#tasks.size && !this.#rendering && !this.#callbackDepth) this.#update();
    if (!this.#options || this.#destroyed || this.#tasks.size || this.#callbackDepth || this.#rendering || !control.availability.available) { this.#showControl(control); return; }
    try {
      if (control.scope === 'add') { this.#openPopup('add'); return; }
      if (control.scope === 'move') { this.#openPopup('move'); return; }
      const pending = this.#popup && control.scope === 'popup' ? this.#popup.pending : this.#capture(this.#scope(control));
      if (!pending) return;
      if (control.action?.kind === 'host') { this.#openHost(control.action, pending); return; }
      const item = control.choice?.command ?? (control.action ? this.#commandAction(control.action, pending.context) : null);
      if (!item) throw new UiError('ui.callback_failed');
      const owned = unavailable(item) ?? command(item), availability = this.#availability(owned, pending.context, control.action?.kind === 'toggle');
      if (!availability.available || 'status' in owned) {
        this.#status.textContent = availability.reason || label('unavailable', this.#locale);
        this.#emit(availability.failure ?? failure('ui.unavailable', control.action?.id ?? control.choice?.id ?? null));
        this.#releasePending('refused'); this.#hidePopup(); return;
      }
      this.#complete(pending, control.action?.id ?? control.choice!.id, owned, control.choice !== null);
    } catch (error) { const result = this.#error(error, control.action?.id ?? null); this.#show(result); this.#emit(result); this.#releasePending('refused'); this.#hidePopup(); }
  }
  #openPopup(kind: 'add' | 'move'): void {
    if (this.#popup) { this.#cancelPopup(true); return; }
    const trigger = kind === 'add' ? this.#add.button : this.#move.button;
    const pending = this.#capture(kind === 'add' ? this.#options!.slots.entry : this.#options!.slots.gutter); if (!pending) return;
    const popup = kind === 'add' ? this.#addPopup : this.#movePopup;
    const choices = kind === 'move' && pending.context.block ? moves(this.#callback(() => this.#profile!.moves(pending.context as UiActionContext & { block: UiBlockContext }))) : null;
    if (choices && 'status' in choices) { this.#status.textContent = choices.message[this.#locale]; this.#releasePending('refused'); return; }
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
      if (!this.#popup) this.#openPopup('move');
      const popup = this.#popup; if (!popup || popup.kind !== 'move') return;
      const candidates = popup.controls.filter(control => control.choice?.direction === direction);
      if (candidates.length === 1) this.#activate(candidates[0]!);
      else if (candidates.length) { this.#rove(popup.controls, candidates[0]); candidates[0]!.button.focus(); }
      else this.#status.textContent = label('unavailable', this.#locale);
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
      else if (moving && response.value.kind === 'mutation' && response.value.effect === 'unchanged') this.#status.textContent = label('unchanged', this.#locale);
      else if (moving) {
        const context = this.#snapshot();
        if (!('status' in context) && context.block) this.#status.textContent = label('position', this.#locale).replace('{position}', String(context.block.index + 1));
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
        this.#status.textContent = owned.message[this.#locale]; this.#emit(failure('ui.unavailable', item.id)); this.#releasePending('refused'); return;
      }
      if (this.#destroyed || this.#pending !== pending) return;
      const availability = this.#availability(owned, pending.context);
      if (!availability.available) {
        const stale = !same(pending.context.context, this.#options!.editor.context()) || !same(pending.context.state.stamp, this.#options!.editor.capture());
        this.#status.textContent = stale ? label('staleDialog', this.#locale) : availability.reason || label('unavailable', this.#locale);
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
    this.#locale = locale; this.#labels(); this.refresh();
  }
  setInteractionMode(mode: InteractionMode): ReturnType<MountedEditor['setInteractionMode']> {
    if (!this.#options || this.#destroyed) return { status: 'dom_refused', diagnostic: { code: 'dom.disposed', phase: 'mode', stamp: null, node: null, typeId: null, publication: 'none' } };
    const result = this.#options.editor.setInteractionMode(mode); this.#releasePending('invalidated'); this.#hidePopup(); this.refresh(); return result;
  }
  refresh(): void {
    if (this.#destroyed || !this.#initialized || this.#raf !== null) return;
    this.#raf = this.#window.requestAnimationFrame(() => {
      this.#raf = null; if (this.#followupFrames > 0) this.#followupFrames--;
      this.#update(); if (this.#followupFrames > 0) this.refresh();
    });
  }
  resources(): ReturnType<EditorUi['resources']> {
    return Object.freeze({ listeners: this.#removals.length, observers: this.#observer ? 1 : 0, animationFrames: this.#raf === null ? 0 : 1,
      subscriptions: this.#subscription ? 1 : 0, hostRequests: this.#pending ? 1 : 0, continuations: this.#tasks.size });
  }
  #finishDisposal(): void { if (this.#destroyed && !this.#tasks.size) for (const resolve of this.#settle.splice(0)) resolve(); }
  destroy(): ReturnType<EditorUi['destroy']> {
    if (!this.#destroyed) {
      this.#destroyed = true; this.#onResult = undefined;
      if (this.#raf !== null) this.#window.cancelAnimationFrame(this.#raf); this.#raf = null; this.#followupFrames = 0;
      this.#releasePending('destroyed'); this.#hidePopup();
      for (const task of this.#tasks) { task.done = null; task.dispose?.(); task.dispose = null; }
      this.#subscription?.(); this.#subscription = null; this.#observer?.disconnect(); this.#observer = null;
      for (const remove of this.#removals.splice(0)) remove();
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
