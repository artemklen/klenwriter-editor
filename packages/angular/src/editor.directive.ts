// SPDX-License-Identifier: MIT OR Apache-2.0
import { DestroyRef, Directive, ElementRef, afterNextRender, afterRenderEffect, inject, input, output, signal } from '@angular/core';
import type { OutputEmitterRef } from '@angular/core';
import { mountEditor } from '@klenwriter/editor-dom';
import type { InteractionMode, MountedEditor, MountedReady, MountEditorOptions } from '@klenwriter/editor-dom';

export type KlenwriterEditorOptions = Omit<MountEditorOptions, 'element' | 'mode'>;
export type KlenwriterEditorRevision = Parameters<Parameters<MountedEditor['subscribe']>[0]>[0];

@Directive({
  selector: '[kwEditor]', exportAs: 'kwEditor', standalone: true,
  host: { '(compositionstart)': 'cancelModeRetry()', '(compositionend)': 'retryModeAfterComposition()' },
})
export class KlenwriterEditorDirective {
  /** Creation options are read once. Use the native handle to replace the document explicitly. */
  readonly kwEditor = input.required<KlenwriterEditorOptions>();
  readonly kwEditorMode = input<InteractionMode>();
  readonly editorReady = output<MountedReady>();
  readonly editorRevision: OutputEmitterRef<KlenwriterEditorRevision> = output<KlenwriterEditorRevision>();
  readonly editorModeResult = output<ReturnType<MountedEditor['setInteractionMode']>>();

  readonly #mounted = signal<MountedEditor | null>(null);
  readonly #element = inject(ElementRef<HTMLElement>).nativeElement;
  readonly #destroyRef = inject(DestroyRef);
  #owner: MountedEditor | null = null;
  #unsubscribe: (() => void) | null = null;
  #defaultMode: InteractionMode = 'editable';
  #appliedMode: InteractionMode | undefined;
  #modeFrame: number | undefined;

  constructor() {
    afterNextRender({ mixedReadWrite: () => this.#mount() });
    afterRenderEffect({ mixedReadWrite: () => {
      this.#applyMode(this.#mounted(), this.kwEditorMode() ?? this.#defaultMode);
    } });

    this.#destroyRef.onDestroy(() => {
      this.cancelModeRetry();
      const owner = this.#owner;
      this.#owner = null;
      this.#mounted.set(null);
      this.#unsubscribe?.();
      this.#unsubscribe = null;
      owner?.destroy();
    });
  }

  /** The ready SDK handle, retired automatically when Angular destroys the directive. */
  mounted(): MountedEditor | null {
    return this.#mounted();
  }

  protected cancelModeRetry(): void {
    if (this.#modeFrame === undefined) return;
    this.#element.ownerDocument.defaultView?.cancelAnimationFrame(this.#modeFrame);
    this.#modeFrame = undefined;
  }

  protected retryModeAfterComposition(): void {
    if (!this.#owner || this.#modeFrame !== undefined || this.#appliedMode === (this.kwEditorMode() ?? this.#defaultMode)) return;
    this.#modeFrame = this.#element.ownerDocument.defaultView?.requestAnimationFrame(() => {
      this.#modeFrame = undefined;
      if (this.#applyMode(this.#mounted(), this.kwEditorMode() ?? this.#defaultMode, true)) {
        this.retryModeAfterComposition();
      }
    });
  }

  #applyMode(mounted: MountedEditor | null, mode: InteractionMode, retry = false): boolean {
    if (!mounted || this.#owner !== mounted || mode === this.#appliedMode) return false;
    const result = mounted.setInteractionMode(mode);
    if (result.status === 'updated') this.#appliedMode = result.mode;
    const pending = result.status === 'dom_refused' && result.diagnostic.code === 'dom.composition_conflict';
    if (this.#owner === mounted && (!retry || !pending)) this.editorModeResult.emit(result);
    return pending;
  }

  #mount(): void {
    const options = this.kwEditor();
    this.#defaultMode = options.editor.options.access === 'read_only' ? 'readOnly' : 'editable';
    this.#appliedMode = this.kwEditorMode() ?? this.#defaultMode;
    const owner = mountEditor({ ...options, element: this.#element, mode: this.#appliedMode });
    if (this.#destroyRef.destroyed) {
      owner.destroy();
      return;
    }
    this.#owner = owner;

    void owner.ready.then(result => {
      if (this.#owner !== owner) return;
      if (result.status === 'ready') {
        this.#applyMode(owner, this.kwEditorMode() ?? this.#defaultMode);
        if (this.#owner !== owner) return;
        const unsubscribe = owner.subscribe(event => {
          if (this.#owner === owner && event.change.kind === 'document') this.editorRevision.emit(event);
        });
        if (typeof unsubscribe === 'function') this.#unsubscribe = unsubscribe;
        this.#mounted.set(owner);
      }
      this.editorReady.emit(result);
    });
  }
}
