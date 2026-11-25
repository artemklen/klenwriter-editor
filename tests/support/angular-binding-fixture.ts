// SPDX-License-Identifier: MIT OR Apache-2.0
import '@angular/compiler';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { KlenwriterEditorDirective } from '@klenwriter/editor-angular';
import type { KlenwriterEditorOptions, KlenwriterEditorRevision } from '@klenwriter/editor-angular';
import type { InteractionMode, MountedEditor, MountedReady } from '@klenwriter/editor-dom';
import { kwdjCommand } from '@klenwriter/editor-kwdj';
import { kwdjBasicRenderers } from '@klenwriter/editor-kwdj/dom';
import { loadSdkV2, sdkBuildId } from '@klenwriter/editor-sdk';
import type { LazyWasmLoaderV2 } from '@klenwriter/editor-sdk';

@Component({
  imports: [KlenwriterEditorDirective],
  template: `
    <div id="editor" aria-label="Angular editor" [kwEditor]="options()" [kwEditorMode]="mode()"
         (editorReady)="onReady($event)" (editorModeResult)="onMode($event)"
         (editorRevision)="onRevision($event)"></div>
    <output id="ready">{{ ready()?.status }}</output>
    <output id="mode">{{ modeResult() }}</output>
    <output id="revision">{{ revision()?.after?.revision }}</output>
  `,
})
class AngularEditorHost {
  readonly options = signal<KlenwriterEditorOptions>(null!);
  readonly mode = signal<InteractionMode>('readOnly');
  readonly ready = signal<MountedReady | null>(null);
  readonly modeResult = signal('');
  readonly revision = signal<KlenwriterEditorRevision | null>(null);
  readonly revisions: KlenwriterEditorRevision[] = [];
  readonly readyResult = deferred<MountedReady>();
  readyEvents = 0;

  onReady(result: MountedReady): void {
    this.readyEvents += 1;
    this.ready.set(result);
    this.readyResult.resolve(result);
  }

  onMode(result: ReturnType<MountedEditor['setInteractionMode']>): void {
    this.modeResult.set(result.status === 'updated' ? result.mode : result.diagnostic.code);
  }

  onRevision(event: KlenwriterEditorRevision): void {
    this.revisions.push(event);
    this.revision.set(event);
  }
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

function documentBytes(text: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    content: [{ content: [{ text, type: 'text' }], type: 'paragraph' }],
    profile: 'prose', schema: 'klenwriter.document', schema_version: 1,
  }));
}

export async function runAngularBindingProbe(load: LazyWasmLoaderV2 = () => loadSdkV2()) {
  check(!('Zone' in globalThis), 'The Angular binding test must run without Zone.js');
  const [wasm, registryJson] = await Promise.all([
    load(),
    fetch('/kwdj-registry.json').then(async response => {
      check(response.ok, 'The KWDJ browser fixture is unavailable');
      return await response.text();
    }),
  ]);
  const { promise: mountLoader, resolve: releaseMount } = deferred<typeof wasm>();
  const nativeSessions = () => (JSON.parse(wasm.resourceCounts()) as { sessions: number }).sessions;
  const options: KlenwriterEditorOptions = {
    renderers: kwdjBasicRenderers,
    editor: {
      input: documentBytes('Angular'),
      loader: () => mountLoader,
      options: {
        abi: 'editor-sdk/2', build_id: sdkBuildId, profile: kwdjBasicRenderers.definition.binding.profile,
        registry_json: registryJson, admission: 'validate', access: 'editable',
        profile_options_json: '{"identities":{"media":[],"references":[]},"limits":null}',
      },
    },
  };

  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  try {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(AngularEditorHost);
    const host = fixture.componentInstance;
    host.options.set(options);
    let mounted: MountedEditor | null = null;
    let revision: KlenwriterEditorRevision | null = null;
    let surface: HTMLElement | null = null;
    try {
      await fixture.whenStable();
      const root: HTMLElement = fixture.nativeElement;
      surface = root.querySelector<HTMLElement>('#editor');
      check(surface, 'Angular did not render the host');
      const debugEditor = fixture.debugElement.query(By.directive(KlenwriterEditorDirective));
      check(debugEditor, 'Angular did not create the directive');
      const binding = debugEditor.injector.get(KlenwriterEditorDirective);
      check(binding.mounted() === null, 'The binding exposed a handle during the native load');
      check(host.ready() === null && nativeSessions() === 0, 'A session opened before the loader settled');

      releaseMount(wasm);
      await host.readyResult.promise;
      await fixture.whenStable();
      mounted = binding.mounted();
      check(mounted, 'The binding did not expose the ready native handle');
      check(host.ready() === await mounted.ready && root.querySelector('#ready')?.textContent === 'ready',
        'Angular did not render the original native readiness in the zoneless template');
      check(surface.textContent?.toString() === 'Angular' && surface.getAttribute('contenteditable') === 'false',
        'Native mounting did not render the document with the initial read-only mode');
      check(mounted.resources().sdk.sessions === 1 && nativeSessions() === 1,
        'The Angular host did not own exactly one native session');

      host.options.set({ ...options, editor: { ...options.editor, input: documentBytes('Replacement') } });
      host.mode.set('editable');
      await fixture.whenStable();
      check(binding.mounted() === mounted && host.readyEvents === 1 && surface.textContent?.toString() === 'Angular',
        'Changing creation options remounted the editor');
      check(surface.getAttribute('contenteditable') === 'true' && root.querySelector('#mode')?.textContent === 'editable',
        'Angular did not apply the native mode update');

      const nativeEvents: KlenwriterEditorRevision[] = [];
      const unsubscribe = mounted.subscribe(event => {
        if (event.change.kind === 'document') nativeEvents.push(event);
      });
      check(typeof unsubscribe === 'function', 'The native document observer could not subscribe');
      try {
        const stamp = mounted.capture();
        const state = mounted.read({ kind: 'state' });
        check(stamp && state.status === 'ok' && state.value.kind === 'state', 'The native state and stamp are unavailable');
        const rootNode = mounted.read({ kind: 'node', stamp, node: state.value.state.root });
        check(rootNode.status === 'ok' && rootNode.value.kind === 'node', 'The native root is unavailable');
        const paragraph = mounted.read({ kind: 'node', stamp, node: rootNode.value.node.children[0] });
        check(paragraph.status === 'ok' && paragraph.value.kind === 'node', 'The native paragraph is unavailable');
        const leaf = paragraph.value.node.children[0];
        check(leaf, 'The native text leaf is unavailable');
        const caret = { kind: 'text', node: leaf, offset: 7, affinity: 'after' } as const;
        const selected = mounted.submit({ kind: 'set_selection', stamp, selection: { anchor: caret, focus: caret } });
        check(selected.status === 'completed' && selected.response.status === 'ok', 'Native selection failed');
        check(host.revisions.length === 0, 'A selection change escaped the document revision output');
        const current = mounted.capture();
        check(current, 'The selection lost the native stamp');
        const edited = mounted.submit({
          kind: 'command', stamp: current, command: kwdjCommand({ kind: 'insert_text', text: '!' }),
          history_hint: { kind: 'isolated' },
        });
        check(edited.status === 'completed' && edited.response.status === 'ok', 'Native text insertion failed');
        await fixture.whenStable();
        const revisions = [...host.revisions];
        [revision] = revisions;
        check(revisions.length === 1 && revision === nativeEvents[0] && revision.change.kind === 'document',
          'The directive must emit the original document event exactly once');
        check(revision.before.revision === revision.change.from_revision && revision.after.revision === revision.change.to_revision,
          'The Angular output lost native revision tokens');
        check(surface.textContent === 'Angular!' && root.querySelector('#revision')?.textContent === revision.after.revision,
          'The native revision did not reach the zoneless Angular view');
      } finally {
        unsubscribe();
      }
    } finally {
      fixture.destroy();
    }

    check(mounted && revision && surface, 'The editor lifecycle did not complete');
    check(mounted.lifecycle === 'destroyed', 'Angular destruction did not retire the native handle');
    const released = mounted.resources();
    check(released.sdk.sessions === 0 && released.sdk.listeners === 0 && nativeSessions() === 0,
      'Angular destruction leaked a native session or subscriber');
    check(released.dom.listeners === 0 && released.dom.observers === 0 && !surface.hasAttribute('contenteditable'),
      'Angular destruction leaked DOM ownership');

    const retired = TestBed.createComponent(AngularEditorHost);
    const retiredHost = retired.componentInstance;
    const { promise: retiredLoader, resolve: releaseRetired } = deferred<typeof wasm>();
    let loading = false;
    retiredHost.options.set({ ...options, editor: { ...options.editor, loader: () => {
      loading = true;
      return retiredLoader;
    } } });
    try {
      await retired.whenStable();
      check(loading, 'The retirement case did not enter a pending native load');
    } finally {
      retired.destroy();
      releaseRetired(wasm);
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    check(retiredHost.readyEvents === 0 && nativeSessions() === 0, 'A retired directive published a late ready result or opened a session');

    return { ready: true, mode: 'editable', revision: revision.after.revision, lifecycle: mounted.lifecycle,
      mountedSessions: released.sdk.sessions, nativeSessions: nativeSessions(), retiredWhileLoading: true };
  } finally {
    TestBed.resetTestingModule();
    TestBed.resetTestEnvironment();
  }
}
