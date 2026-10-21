// SPDX-License-Identifier: MIT OR Apache-2.0
import type { CommandDto, DeepReadonly, EventDto, Response, SessionContextV2, StampDto } from '@klenwriter/editor-sdk';
import type { CssRect, DragDestination, DragGeometrySnapshot, DragNodeHeader, HostFocus, MountedEditor, MountedHostRequest } from '@klenwriter/editor-dom';
import type { UiDragProfile, UiFailure, UiLocale, UiResult } from './types.js';
import { command, unavailable } from './data.js';
import { label } from './strings.js';

interface Options {
  editor: MountedEditor; element: HTMLElement; gutter: HTMLElement; prefix: string;
  source: () => string | null; beforeOpen: () => void; keyboard: () => void;
  invoke: <T>(callback: () => T) => T; feedback: (message: string) => void;
  failure: (value: UiFailure) => void; reason: (value: UiFailure) => string;
  result: (value: UiResult) => void; schedule: () => void; moved: (source: string) => void;
}
interface Candidate { destination: DragDestination; command: CommandDto | null; available: boolean; reason: string }
interface CompletionTask { done: ((value: [Response, HostFocus]) => void) | null; failed: (() => void) | null; settled?: Promise<void> }
// Pending promise callbacks retain these cells/sets, never the owner or its DOM.
function observeCompletion(tasks: Set<CompletionTask>, task: CompletionTask, original: Promise<[Response, HostFocus]>): Promise<void> {
  const finish = (): void => { task.done = null; task.failed = null; tasks.delete(task); };
  return original.then(value => {
    const done = task.done; task.done = null;
    try { done?.(value); } catch { try { task.failed?.(); } catch { /* original completion remains settled */ } }
    finally { finish(); }
  }, () => {
    try { task.failed?.(); } catch { /* original completion remains settled */ }
    finally { finish(); }
  });
}
interface Gesture {
  request: MountedHostRequest; stamp: DeepReadonly<StampDto>; context: DeepReadonly<SessionContextV2>;
  source: DragNodeHeader; pointerId: number; origin: { x: number; y: number }; point: { x: number; y: number };
  began: number; lastFrame: number; dragging: boolean; captured: boolean; inside: string | null;
  geometry: DragGeometrySnapshot; candidate: Candidate | null; changes: number;
  owners: HTMLElement[]; scrollMs: number; scrollTicks: number; scrollPixels: number;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const refused = (code: 'ui.unavailable' | 'ui.callback_failed' | 'ui.limit'): UiFailure => ({ status: 'ui_refused', code, action: 'drag-move' });
const inside = (point: { x: number; y: number }, box: CssRect): boolean => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
const full = (a: CssRect, b: CssRect): boolean => a.width > 0 && a.height > 0 && a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
function intersect(a: CssRect, b: CssRect): CssRect {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

/** One original pointer/request owner. Motion reads compact geometry, never UI snapshots. */
export class DragOwner {
  readonly handle: HTMLButtonElement;
  #options: Options | null; #locale: UiLocale; #profile: UiDragProfile | null = null;
  #document: Document; #window: Window; #reason: HTMLElement; #preview: HTMLElement; #outline: HTMLElement; #line: HTMLElement; #parents: HTMLElement;
  #gesture: Gesture | null = null; #claim: Gesture | null = null; #starting = false; #destroyed = false; #building = false;
  #raf: number | null = null; #removals: (() => void)[] = []; #tasks = new Set<CompletionTask>();
  #parentKey = ''; #parentOptions: HTMLElement[] = [];
  #epoch = 0;
  // Cancellation releases all live authority immediately. Only the original
  // mouse identity survives to consume its otherwise-unowned terminal defaults.
  #retiredPointer: number | null = null; #retiredUp = false;
  constructor(options: Options, locale: UiLocale) {
    this.#options = options; this.#locale = locale; this.#document = options.element.ownerDocument; this.#window = this.#document.defaultView!;
    const node = (name: string): HTMLDivElement => { const e = this.#document.createElement('div'); e.className = name; return e; };
    this.handle = this.#document.createElement('button'); this.handle.type = 'button'; this.handle.tabIndex = 0;
    this.handle.className = 'kw-ui-button kw-ui-drag-handle'; this.handle.dataset.editorUiControl = 'drag';
    this.handle.draggable = false; this.handle.setAttribute('aria-haspopup', 'menu'); this.handle.setAttribute('aria-expanded', 'false');
    this.#reason = node('kw-ui-reason'); this.#reason.id = `${options.prefix}-drag-reason`;
    this.#parents = node('kw-ui-drag-parents'); this.#parents.id = `${options.prefix}-drag-parents`;
    this.#parents.setAttribute('role', 'listbox'); this.#parents.hidden = true;
    this.handle.setAttribute('aria-describedby', this.#reason.id);
    this.#preview = node('kw-ui-drag-preview'); this.#preview.hidden = true; this.#preview.setAttribute('aria-hidden', 'true');
    this.#outline = node('kw-ui-drag-outline'); this.#outline.hidden = true; this.#outline.setAttribute('aria-hidden', 'true');
    this.#line = node('kw-ui-drag-line'); this.#line.hidden = true; this.#line.setAttribute('aria-hidden', 'true');
    // Keep the established editor-to-Tab Move stop before the additive handle.
    options.gutter.append(this.handle, this.#reason, this.#preview, this.#outline, this.#line, this.#parents);
    this.#listen(this.handle, 'pointerdown', event => this.#down(event as PointerEvent));
    this.#listen(this.handle, 'click', event => { event.preventDefault(); event.stopPropagation(); });
    this.#listen(this.handle, 'keydown', event => {
      const e = event as KeyboardEvent;
      if (!this.active && !e.altKey && !e.ctrlKey && !e.metaKey && ['Enter', ' '].includes(e.key)) {
        this.#clearRetiredPointer();
        e.preventDefault(); e.stopPropagation(); if (!e.repeat) this.#options?.keyboard();
      }
    });
    this.#listen(this.#document, 'pointerdown', () => {
      if (this.active) this.cancel(label('dragCancelled', this.#locale));
      this.#clearRetiredPointer(); // A new down is fresh input, including reused mouse IDs.
    }, true);
    this.#listen(this.#window, 'pointermove', event => this.#move(event as PointerEvent), true);
    this.#listen(this.#window, 'pointerup', event => this.#up(event as PointerEvent), true);
    this.#listen(this.#window, 'click', event => {
      const click = event as PointerEvent;
      if (click.detail === 0) { this.#clearRetiredPointer(); return; } // Keyboard/AT activation passes.
      if (this.#retiredPointer === null || !this.#retiredUp || click.pointerId !== this.#retiredPointer || click.pointerType !== 'mouse' || click.button !== 0) return;
      this.#clearRetiredPointer();
      click.preventDefault(); click.stopPropagation();
    }, true);
    for (const name of ['pointercancel', 'lostpointercapture']) this.#listen(this.#window, name, event => {
      if ((event as PointerEvent).pointerId === this.#gesture?.pointerId) this.cancel(label('dragCancelled', this.#locale));
    }, true);
    this.#listen(this.#document, 'keydown', event => this.#key(event as KeyboardEvent), true);
    for (const name of ['compositionstart', 'beforeinput', 'selectionchange']) this.#listen(this.#document, name, () => {
      if (name !== 'selectionchange') this.#clearRetiredPointer();
      if (this.active) this.cancel(label('stale', this.#locale));
    }, true);
    this.#listen(this.#window, 'blur', () => this.cancel(label('dragCancelled', this.#locale)));
    this.#listen(this.#window, 'resize', () => this.cancel(label('dragGeometry', this.#locale)));
    this.#listen(this.#document, 'visibilitychange', () => { if (this.#document.hidden) this.cancel(label('dragCancelled', this.#locale)); });
    this.#listen(this.#document, 'focusin', () => {
      const active = this.#document.activeElement, o = this.#options;
      if (this.active && o && active && !o.element.contains(active) && !o.gutter.contains(active)) this.cancel(label('dragCancelled', this.#locale));
    });
    this.configure(null, locale);
  }
  #listen(target: EventTarget, name: string, listener: EventListener, capture = false): void {
    target.addEventListener(name, listener, capture); this.#removals.push(() => target.removeEventListener(name, listener, capture));
  }
  #clearRetiredPointer(): void { this.#retiredPointer = null; this.#retiredUp = false; }
  get active(): boolean { return this.#starting || this.#gesture !== null || this.#claim !== null; }
  configure(profile: UiDragProfile | null, locale: UiLocale): void {
    if (this.#profile !== profile || this.#locale !== locale) this.cancel(label('dragCancelled', this.#locale));
    this.#profile = profile; this.#locale = locale;
    if (this.active || this.#destroyed) return;
    const o = this.#options!, status = o.editor.hostRequests.status();
    const available = !!profile && !!o.source() && status.status === 'available';
    const name = label('drag', locale); if (this.handle.textContent !== name) this.handle.textContent = name;
    this.handle.setAttribute('aria-label', name); this.handle.setAttribute('aria-disabled', String(!available));
    this.#reason.textContent = !profile ? label('dragMissing', locale) : status.status !== 'available' ? o.reason(status) : available ? '' : label('unavailable', locale);
  }
  publication(_event: DeepReadonly<EventDto>): void { if (this.#gesture || this.#starting) this.cancel(label('stale', this.#locale)); }
  check(): void { const g = this.#gesture; if (g && !this.#fresh(g)) this.cancel(label('stale', this.#locale)); }
  #fresh(g: Gesture): boolean {
    const o = this.#options;
    return !this.#destroyed && !!o && (this.#gesture === g || this.#claim === g) && this.handle.isConnected && o.element.isConnected
      && o.editor.hostRequests.status().status === 'available' && same(g.stamp, o.editor.capture()) && same(g.context, o.editor.context());
  }
  #owners(): HTMLElement[] | null {
    const o = this.#options!, page = this.#document.scrollingElement, owners: HTMLElement[] = [];
    let current: HTMLElement | null = o.element, count = 0;
    while (current) {
      if (++count > 128) return null;
      const style = this.#window.getComputedStyle(current);
      if (style.transform !== 'none' || style.perspective !== 'none') return null;
      if (current !== page && /^(auto|scroll)$/.test(style.overflowY) && current.scrollHeight > current.clientHeight) {
        if (style.scrollBehavior === 'smooth' || style.scrollSnapType !== 'none') return null;
        owners.push(current);
      }
      if (owners.length > 1) return null; current = current.parentElement;
    }
    const constructor = (this.#window as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement;
    if (page instanceof constructor && page.scrollHeight > page.clientHeight) {
      const style = this.#window.getComputedStyle(page);
      if (style.scrollBehavior === 'smooth' || style.scrollSnapType !== 'none') return null;
      owners.push(page);
    }
    return owners;
  }
  #down(event: PointerEvent): void {
    this.#clearRetiredPointer();
    event.stopPropagation();
    if (event.button !== 0 || event.buttons !== 1 || !event.isPrimary || event.pointerType !== 'mouse' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    event.preventDefault();
    if (this.active || this.#building || this.#tasks.size || this.#destroyed) return;
    const o = this.#options!, factory = this.#profile, source = o.source(), stamp = o.editor.capture(), context = o.editor.context();
    if (!factory || !source || !stamp || !context || o.editor.hostRequests.status().status !== 'available') { o.feedback(this.#reason.textContent || label('unavailable', this.#locale)); return; }
    this.#starting = true; const epoch = this.#epoch, began = this.#window.performance.now(); let request: MountedHostRequest | null = null;
    try {
      o.beforeOpen();
      if (this.#destroyed || epoch !== this.#epoch || !same(stamp, o.editor.capture()) || !same(context, o.editor.context())) return;
      const measured = o.editor.geometry.read({ kind: 'drag', stamp, context, source, point: null, insideParent: null });
      if (measured.status !== 'drag_measured') { o.failure(measured); return; }
      const owners = this.#owners(); if (!owners) { o.feedback(label('dragGeometry', this.#locale)); return; }
      const captured = o.editor.hostRequests.capture({ focusScope: o.gutter });
      if (captured.status !== 'captured') { o.failure(captured); return; } request = captured.request;
      if (this.#destroyed || epoch !== this.#epoch || !same(stamp, o.editor.capture()) || !same(context, o.editor.context()) || !same(request.stamp, stamp) || !same(request.context, context)) return;
      const g: Gesture = { request, stamp, context, source: measured.source, pointerId: event.pointerId,
        origin: { x: event.clientX, y: event.clientY }, point: { x: event.clientX, y: event.clientY }, began, lastFrame: began,
        dragging: false, captured: false, inside: null, geometry: measured, candidate: null, changes: 0, owners, scrollMs: 0, scrollTicks: 0, scrollPixels: 0 };
      this.#gesture = g; request = null;
      try { this.handle.setPointerCapture(event.pointerId); g.captured = this.handle.hasPointerCapture(event.pointerId); } catch { /* refusal below */ }
      if (!g.captured) { this.cancel(label('dragGeometry', this.#locale)); return; }
      this.#schedule();
    } catch { o.failure(refused('ui.callback_failed')); this.cancel(); }
    finally { if (request) o.editor.hostRequests.release(request); this.#starting = false; }
  }
  #move(event: PointerEvent): void {
    const g = this.#gesture; if (!g) return;
    if (event.pointerId !== g.pointerId || event.pointerType !== 'mouse' || event.buttons !== 1 || !event.isPrimary || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) { this.cancel(label('dragCancelled', this.#locale)); return; }
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) { this.cancel(label('dragGeometry', this.#locale)); return; }
    event.preventDefault(); g.point = { x: event.clientX, y: event.clientY };
    if (!g.dragging && (g.point.x - g.origin.x) ** 2 + (g.point.y - g.origin.y) ** 2 >= 16) g.dragging = true;
    this.#schedule();
  }
  #schedule(): void {
    if (this.#raf !== null || !this.#gesture || this.#destroyed) return;
    this.#raf = this.#window.requestAnimationFrame(now => {
      this.#raf = null; const g = this.#gesture; if (!g) return;
      try {
        if (!this.#fresh(g)) { this.cancel(label('stale', this.#locale)); return; }
        if (now - g.began >= 30000) { this.cancel(label('dragLimit', this.#locale)); return; }
        const dt = Math.max(0, Math.min(32, now - g.lastFrame)); g.lastFrame = now;
        if (g.dragging) {
          if (!this.#measure(g)) return;
          if (this.#scroll(g, dt) && !this.#measure(g)) return;
          this.#draw(g);
        }
        this.#schedule();
      } catch { this.cancel(label('callback', this.#locale)); if (!this.#destroyed) this.#options?.failure(refused('ui.callback_failed')); }
    });
  }
  #clip(g: Gesture): CssRect {
    const element = this.#options!.element, rect = element.getBoundingClientRect();
    const client = { x: rect.x + element.clientLeft, y: rect.y + element.clientTop, width: element.clientWidth, height: element.clientHeight };
    if (!element.isConnected || ![client.x, client.y, client.width, client.height, client.x + client.width, client.y + client.height].every(Number.isFinite)
      || client.width < 0 || client.height < 0) return { x: 0, y: 0, width: 0, height: 0 };
    return intersect(intersect((g.geometry.targetBox ?? g.geometry.sourceBox).clip, g.geometry.viewport), client);
  }
  #measure(g: Gesture): boolean {
    const o = this.#options!; if (!this.#fresh(g)) { this.cancel(label('stale', this.#locale)); return false; }
    const clip = this.#clip(g), p = g.point;
    if (clip.width <= 0 || clip.height <= 0) {
      this.cancel(label('dragGeometry', this.#locale)); return false;
    }
    // The original gutter may overlap editor padding at wide/nested layouts.
    // Travelling through that owned UI has no destination, just like the gap
    // outside the host. A release there still has no candidate to complete.
    const hit = inside(p, clip) ? this.#document.elementFromPoint(p.x, p.y) : null;
    if (!inside(p, clip) || hit === o.element || !!hit && o.gutter.contains(hit)) {
      const measured = o.editor.geometry.read({ kind: 'drag', stamp: g.stamp, context: g.context, source: g.source.id, point: null, insideParent: null });
      if (measured.status !== 'drag_measured') { this.cancel(o.reason(measured)); return false; }
      if (!same(measured.source, g.source) || !this.#fresh(g)) { this.cancel(label('stale', this.#locale)); return false; }
      g.geometry = measured; g.candidate = null; return true;
    }
    const point = { x: p.x, y: p.y };
    const measured = o.editor.geometry.read({ kind: 'drag', stamp: g.stamp, context: g.context, source: g.source.id, point, insideParent: g.inside });
    if (measured.status !== 'drag_measured') { this.cancel(o.reason(measured)); return false; }
    if (!same(measured.source, g.source) || !this.#fresh(g)) { this.cancel(label('stale', this.#locale)); return false; }
    g.geometry = measured;
    if (!measured.destination) { g.candidate = null; return true; }
    if (same(g.candidate?.destination, measured.destination)) return true;
    if (++g.changes > 128) { this.cancel(label('dragLimit', this.#locale)); return false; }
    const profile = this.#profile; if (!profile) { this.cancel(label('dragMissing', this.#locale)); return false; }
    this.#building = true;
    try {
      const captured = Object.freeze({ context: g.context, stamp: g.stamp, source: g.source });
      const result = o.invoke(() => profile.move(captured, measured.destination!)), absent = unavailable(result);
      if (!this.#fresh(g)) { this.cancel(label('stale', this.#locale)); return false; }
      if (absent) { g.candidate = { destination: measured.destination, command: null, available: false, reason: absent.message[this.#locale] }; return true; }
      const owned = command(result), query = o.editor.query({ kind: 'query_command', stamp: g.stamp, command: owned });
      if (!this.#fresh(g)) { this.cancel(label('stale', this.#locale)); return false; }
      if (query.status === 'dom_refused') { this.cancel(o.reason(query)); return false; }
      if (query.status !== 'ok' || query.value.kind !== 'availability') { this.cancel(o.reason({ status: 'sdk_failure', response: query })); return false; }
      g.candidate = { destination: measured.destination, command: owned, available: query.value.available,
        reason: query.value.diagnostic ? `${label('unavailable', this.#locale)} (${query.value.diagnostic.code.slice(0, 256)})` : query.value.available ? '' : label('unavailable', this.#locale) };
      return true;
    } catch { this.cancel(label('callback', this.#locale)); o.failure(refused('ui.callback_failed')); return false; }
    finally { this.#building = false; }
  }
  #scroll(g: Gesture, dt: number): boolean {
    const clip = this.#clip(g), p = g.point;
    if (p.x < clip.x || p.x > clip.x + clip.width || p.y < clip.y - 24 || p.y > clip.y + clip.height + 24 || dt === 0) return false;
    const direction = p.y <= clip.y + 24 ? -1 : p.y >= clip.y + clip.height - 24 ? 1 : 0;
    if (!direction) return false;
    const currentOwners = this.#owners();
    if (!currentOwners || currentOwners.length !== g.owners.length || currentOwners.some((owner, index) => owner !== g.owners[index])) {
      this.cancel(label('dragGeometry', this.#locale)); return false;
    }
    for (const owner of g.owners) {
      if (!owner.isConnected) { this.cancel(label('dragGeometry', this.#locale)); return false; }
      const before = owner.scrollTop, maximum = owner.scrollHeight - owner.clientHeight;
      if (direction < 0 ? before <= 0 : before >= maximum) continue;
      if (g.scrollMs + dt > 10000 || g.scrollTicks >= 600 || g.scrollPixels >= 6000) { this.cancel(label('dragLimit', this.#locale)); return false; }
      const step = direction * Math.min(20, 600 * dt / 1000, 6000 - g.scrollPixels);
      owner.scrollTop = Math.max(0, Math.min(maximum, before + step));
      const actual = Math.abs(owner.scrollTop - before); g.scrollMs += dt; g.scrollTicks++; g.scrollPixels += actual;
      return actual > 0;
    }
    return false;
  }
  #endpoint(g: Gesture): CssRect | null {
    const box = g.geometry.targetBox, destination = g.geometry.destination; if (!box || !destination) return null;
    const r = box.rect, line = { x: r.x, y: destination.placement === 'before' ? r.y : r.y + r.height - 2, width: r.width, height: 2 };
    return full(line, this.#clip(g)) ? line : null;
  }
  #place(element: HTMLElement, rect: CssRect): void {
    element.style.left = `${rect.x}px`; element.style.top = `${rect.y}px`; element.style.width = `${rect.width}px`; element.style.height = `${rect.height}px`;
  }
  #name(header: DragNodeHeader): string {
    const kind = label(header.primitive === 'root' ? 'document' : header.primitive === 'container' ? 'container' : header.primitive === 'text_block' ? 'textBlock' : header.primitive === 'block_atom' ? 'object' : 'genericBlock', this.#locale);
    return header.index === null ? kind : `${kind} ${header.index + 1}`;
  }
  #draw(g: Gesture): void {
    if (!this.#gesture || !g.dragging) return;
    const box = intersect(g.geometry.sourceBox.rect, g.geometry.sourceBox.clip); this.#place(this.#outline, box); this.#outline.hidden = box.width <= 0 || box.height <= 0;
    const line = this.#endpoint(g); this.#line.hidden = !line || !g.candidate?.available; if (line) this.#place(this.#line, line);
    const d = g.geometry.destination, target = d?.placement === 'inside' ? g.geometry.insideParents.find(h => h.id === d.parent) : g.geometry.hit;
    const description = d && target ? label(d.placement === 'inside' ? 'dragInside' : d.placement === 'before' ? 'dragBefore' : 'dragAfter', this.#locale).replace('{block}', this.#name(target)) : label('dragGeometry', this.#locale);
    const parentAt = d ? g.geometry.insideParents.findIndex(header => header.id === d.parent) : -1;
    const breadcrumb = parentAt < 0 ? '' : [...g.geometry.insideParents.slice(parentAt)].reverse().map(header => this.#name(header)).join(' / ');
    const reason = g.candidate?.reason || (!line ? label('dragGeometry', this.#locale) : '');
    this.#preview.textContent = `${label('dragPreview', this.#locale)} — ${description}${breadcrumb ? ` — ${breadcrumb}` : ''}${reason ? ` — ${reason}` : ''}`;
    this.#preview.hidden = false; const v = g.geometry.viewport;
    this.#preview.style.left = `${Math.max(v.x + 8, Math.min(g.point.x + 16, v.x + v.width - 248))}px`;
    this.#preview.style.top = `${Math.max(v.y + 8, Math.min(g.point.y + 16, v.y + v.height - 88))}px`;
    const headers = g.geometry.insideParents, key = JSON.stringify(headers);
    if (key !== this.#parentKey) {
      this.#parentKey = key; this.#parents.replaceChildren(); this.#parentOptions = [];
      const instruction = this.#document.createElement('div'); instruction.setAttribute('role', 'presentation');
      instruction.className = 'kw-ui-drag-parent-instruction'; instruction.textContent = label('dragParents', this.#locale); this.#parents.append(instruction);
      for (const text of [label('dragEdge', this.#locale), ...headers.map(h => label('dragInside', this.#locale).replace('{block}', this.#name(h)))]) {
        const option = this.#document.createElement('div'); option.setAttribute('role', 'option'); option.textContent = text; this.#parents.append(option); this.#parentOptions.push(option);
      }
    }
    this.#parents.setAttribute('aria-label', label('dragParents', this.#locale)); this.#parents.hidden = headers.length === 0;
    const at = g.inside === null ? 0 : headers.findIndex(h => h.id === g.inside) + 1;
    this.#parentOptions.forEach((e, i) => e.setAttribute('aria-selected', String(i === at)));
    const option = this.#parentOptions[at]; if (option) this.#parents.scrollTop = Math.max(0, Math.min(option.offsetTop, option.offsetTop + option.offsetHeight - this.#parents.clientHeight));
  }
  #key(event: KeyboardEvent): void {
    this.#clearRetiredPointer();
    const g = this.#gesture; if (!g) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancel(label('dragCancelled', this.#locale), true); return; }
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && ['ArrowRight', 'ArrowLeft'].includes(event.key) && g.dragging) {
      event.preventDefault(); event.stopPropagation();
      const ids: (string | null)[] = [null, ...g.geometry.insideParents.map(h => h.id)], at = Math.max(0, ids.indexOf(g.inside));
      g.inside = ids[(at + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length]!;
      g.candidate = null; this.#options?.feedback(g.inside ? label('dragInside', this.#locale).replace('{block}', this.#name(g.geometry.insideParents.find(h => h.id === g.inside)!)) : label('dragEdge', this.#locale));
      this.#schedule(); return;
    }
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
    this.cancel(label('dragCancelled', this.#locale));
  }
  #stop(g: Gesture): void {
    if (this.#raf !== null) this.#window.cancelAnimationFrame(this.#raf); this.#raf = null;
    const captured = g.captured; g.captured = false;
    if (captured) try { if (this.handle.hasPointerCapture(g.pointerId)) this.handle.releasePointerCapture(g.pointerId); } catch { /* terminal remains retired */ }
    for (const e of [this.#preview, this.#outline, this.#line, this.#parents]) e.hidden = true;
    this.#parentKey = ''; this.#parents.replaceChildren(); this.#parentOptions = [];
  }
  #up(event: PointerEvent): void {
    if (this.#claim) return; // A repeated up cannot consume/cancel an already claimed terminal.
    if (!this.#gesture && !this.#starting && this.#retiredPointer !== null && !this.#retiredUp
      && event.pointerId === this.#retiredPointer && event.pointerType === 'mouse' && event.button === 0 && event.buttons === 0 && event.isPrimary) {
      this.#retiredUp = true;
      event.preventDefault(); event.stopPropagation(); return;
    }
    if (this.#building || this.#starting) { this.cancel(label('dragCancelled', this.#locale)); return; }
    const g = this.#gesture; if (!g) return;
    if (event.pointerId !== g.pointerId || event.pointerType !== 'mouse' || event.button !== 0 || event.buttons !== 0 || !event.isPrimary
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) { this.cancel(label('dragCancelled', this.#locale)); return; }
    event.preventDefault(); event.stopPropagation();
    g.point = { x: event.clientX, y: event.clientY };
    this.#gesture = null; this.#claim = g; this.#stop(g); // Claim before measurement/profile callbacks.
    const o = this.#options!;
    try {
      if (!g.dragging) return;
      if (this.#window.performance.now() - g.began >= 30000) { o.feedback(label('dragLimit', this.#locale)); return; }
      if (!this.#measure(g) || !this.#fresh(g)) return;
      const candidate = g.candidate;
      if (!inside(g.point, this.#clip(g)) || !this.#endpoint(g) || !candidate?.available || !candidate.command) { o.feedback(candidate?.reason || label('dragGeometry', this.#locale)); return; }
      const result = o.editor.hostRequests.complete(g.request, candidate.command, { focus: 'none' });
      this.#claim = null;
      if (result.status !== 'submitted') { o.failure(result); return; }
      const completion = result.submission.status === 'completed' ? Promise.resolve(result.submission.response) : result.submission.completion;
      const source = g.source.id;
      const task: CompletionTask = { done: ([response, focus]) => {
        if (this.#destroyed) return;
        if (response.status !== 'ok') o.failure({ status: 'sdk_failure', response });
        else { o.moved(source); o.feedback(response.value.kind === 'mutation' && response.value.effect === 'unchanged' ? label('unchanged', this.#locale) : label('dragMoved', this.#locale)); }
        if (focus.failure) o.failure(focus.failure); o.schedule();
      }, failed: () => { if (!this.#destroyed) o.failure(refused('ui.callback_failed')); } };
      this.#tasks.add(task);
      task.settled = observeCompletion(this.#tasks, task, Promise.all([completion, result.focus]));
      o.result(Object.freeze({ status: 'submitted', action: 'drag-move', submission: result.submission, focus: result.focus }));
    } catch { if (!this.#destroyed) o.failure(refused('ui.callback_failed')); }
    finally { if (this.#claim === g) { this.#claim = null; o.editor.hostRequests.release(g.request); } o.schedule(); }
  }
  cancel(message = '', announce = false): void {
    this.#epoch++;
    const held = this.#gesture, g = held ?? this.#claim; this.#gesture = null; this.#claim = null;
    if (held?.captured) { this.#retiredPointer = held.pointerId; this.#retiredUp = false; }
    if (g) { this.#stop(g); this.#options?.editor.hostRequests.release(g.request); }
    if (!this.#destroyed && g) {
      if (message) this.#options?.feedback(message);
      if (announce) this.#options?.result({ status: 'cancelled', action: 'drag-move', restore: null });
      this.#options?.schedule();
    }
  }
  resources(): { listeners: number; animationFrames: number; hostRequests: number; continuations: number; dragGestures: number; pointerCaptures: number } {
    return { listeners: this.#removals.length, animationFrames: this.#raf === null ? 0 : 1, hostRequests: this.#gesture || this.#claim ? 1 : 0,
      continuations: this.#tasks.size, dragGestures: this.#gesture ? 1 : 0, pointerCaptures: this.#gesture?.captured ? 1 : 0 };
  }
  destroy(): Promise<void> {
    if (!this.#destroyed) {
      this.#destroyed = true; this.cancel(); for (const remove of this.#removals.splice(0)) remove();
      this.#clearRetiredPointer();
      for (const task of this.#tasks) { task.done = null; task.failed = null; }
      for (const e of [this.handle, this.#reason, this.#preview, this.#outline, this.#line, this.#parents]) e.remove();
      this.#profile = null; this.#parentOptions = []; this.#options = null;
    }
    return Promise.all([...this.#tasks].map(task => task.settled)).then(() => {});
  }
}
