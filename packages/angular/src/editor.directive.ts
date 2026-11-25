// SPDX-License-Identifier: MIT OR Apache-2.0
import { DestroyRef, Directive, ElementRef, afterNextRender, afterRenderEffect, inject, input, output, signal } from '@angular/core';
import type { OutputEmitterRef } from '@angular/core';
import { mountEditor } from '@klenwriter/editor-dom';
import type { InteractionMode, MountedEditor, MountedReady, MountEditorOptions } from '@klenwriter/editor-dom';

export type KlenwriterEditorOptions = Omit<MountEditorOptions, 'element' | 'mode'>;
export type KlenwriterEditorRevision = Parameters<Parameters<MountedEditor['subscribe']>[0]>[0];

@Directive({ selector: '[kwEditor]', exportAs: 'kwEditor', standalone: true })
export class KlenwriterEditorDirective {
  /** Creation options are read once. Use the native handle to replace the document explicitly. */
  readonly kwEditor = input.required<KlenwriterEditorOptions>();
  readonly kwEditorMode = input<InteractionMode>();
  readonly editorReady = output<MountedReady>();
  readonly editorRevision: OutputEmitterRef<KlenwriterEditorRevision> = output<KlenwriterEditorRevision>();
  readonly editorModeResult = output<ReturnType<MountedEditor['setInteractionMode']>>();

  readonly #mounted = signal<MountedEditor | null>(null);
  #owner: MountedEditor | null = null;
  #unsubscribe: (() => void) | null = null;
  #defaultMode: InteractionMode = 'editable';
  #appliedMode: InteractionMode | undefined;

  constructor() {
    const element = inject(ElementRef<HTMLElement>).nativeElement;

    afterNextRender({ mixedReadWrite: () => this.#mount(element) });
    afterRenderEffect({ mixedReadWrite: () => {
      const mounted = this.#mounted();
      const mode = this.kwEditorMode() ?? this.#defaultMode;
      if (!mounted || mode === this.#appliedMode) return;
      const result = mounted.setInteractionMode(mode);
      if (result.status === 'updated') this.#appliedMode = result.mode;
      if (this.#owner === mounted) this.editorModeResult.emit(result);
    } });

    inject(DestroyRef).onDestroy(() => {
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

  #mount(element: HTMLElement): void {
    const options = this.kwEditor();
    this.#defaultMode = options.editor.options.access === 'read_only' ? 'readOnly' : 'editable';
    this.#appliedMode = this.kwEditorMode() ?? this.#defaultMode;
    const owner = mountEditor({ ...options, element, mode: this.#appliedMode });
    this.#owner = owner;

    void owner.ready.then(result => {
      if (this.#owner !== owner) return;
      if (result.status === 'ready') {
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
