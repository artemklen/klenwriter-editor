// SPDX-License-Identifier: MIT OR Apache-2.0
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { KlenwriterEditorDirective } from '@klenwriter/editor-angular';
import type { KlenwriterEditorOptions, KlenwriterEditorRevision } from '@klenwriter/editor-angular';
import type { MountedEditor, MountedReady, MountedSubmission } from '@klenwriter/editor-dom';
import { kwdjBasicRenderers } from '@klenwriter/editor-kwdj/dom';
import registry from '@klenwriter/editor-kwdj/registry.json';
import { loadSdkV2, sdkAbiV2, sdkBuildId } from '@klenwriter/editor-sdk';

const encoder = new TextEncoder();
const storageKey = 'klenwriter-angular-quickstart';

async function response(submission: MountedSubmission) {
  if (submission.status === 'dom_refused') {
    throw new Error(submission.diagnostic.code);
  }
  const result = submission.status === 'queued' ? await submission.completion : submission.response;
  if (result.status !== 'ok') throw new Error(JSON.stringify(result));
  return result.value;
}

@Component({
  selector: 'quickstart-app',
  imports: [KlenwriterEditorDirective],
  template: `
    <main>
      <h1>Angular zoneless quickstart</h1>
      <div id="editor" role="textbox" aria-label="Document" aria-multiline="true"
           [kwEditor]="options" #binding="kwEditor"
           (editorReady)="ready($event)" (editorRevision)="revisionChanged($event)"></div>
      <fieldset [disabled]="!binding.mounted() || busy()">
        <button type="button" (click)="save(binding)">Save</button>
        <button type="button" (click)="reopen(binding)">Reopen saved</button>
      </fieldset>
      <p role="status">{{ status() }}</p>
      <output id="revision" aria-label="Document revision">{{ revision() }}</output>
      <details>
        <summary>Canonical JSON</summary>
        <pre id="canonical">{{ canonical() }}</pre>
      </details>
    </main>
  `,
})
class QuickstartApp {
  protected readonly status = signal('Opening editor');
  protected readonly revision = signal<string | null>(null);
  protected readonly canonical = signal('');
  protected readonly busy = signal(false);
  protected readonly options: KlenwriterEditorOptions = {
    renderers: kwdjBasicRenderers,
    editor: {
      input: encoder.encode(JSON.stringify({
        schema: 'klenwriter.document', schema_version: 1, profile: 'prose',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello, editor.' }] }],
      })),
      loader: () => loadSdkV2(),
      options: {
        abi: sdkAbiV2, build_id: sdkBuildId,
        profile: {
          ...kwdjBasicRenderers.definition.binding.profile,
          extensions: [...kwdjBasicRenderers.definition.binding.profile.extensions],
        },
        registry_json: JSON.stringify(registry), admission: 'validate', access: 'editable',
        profile_options_json: '{"identities":{"media":[],"references":[]},"limits":null}',
      },
    },
  };

  protected ready(result: MountedReady) {
    this.status.set(result.status === 'ready' ? 'Editor ready' : 'Could not open editor');
  }

  protected revisionChanged(event: KlenwriterEditorRevision) {
    this.revision.set(event.after?.revision ?? null);
  }

  protected save(binding: KlenwriterEditorDirective) {
    return this.perform(binding, async editor => {
      localStorage.setItem(storageKey, await this.snapshot(editor));
      return 'Saved in this browser';
    });
  }

  protected reopen(binding: KlenwriterEditorDirective) {
    return this.perform(binding, async editor => {
      const saved = localStorage.getItem(storageKey);
      if (saved === null) return 'No saved document';
      await response(await editor.replace(encoder.encode(saved)));
      await this.snapshot(editor);
      return 'Reopened saved document';
    });
  }

  private async snapshot(editor: MountedEditor) {
    const stamp = editor.capture();
    if (!stamp) throw new Error('Editor revision is unavailable');
    const snapshot = await response(editor.submit({ kind: 'snapshot', stamp, max_bytes: 1_048_576 }));
    if (snapshot.kind !== 'snapshot') throw new Error('Editor snapshot is unavailable');
    await response(editor.submit({ kind: 'release_snapshot', handle: snapshot.handle }));
    this.canonical.set(snapshot.canonical_json);
    return snapshot.canonical_json;
  }

  private async perform(binding: KlenwriterEditorDirective, action: (editor: MountedEditor) => Promise<string>) {
    const editor = binding.mounted();
    if (!editor || this.busy()) return;
    this.busy.set(true);
    try {
      this.status.set(await action(editor));
    } catch (error) {
      this.status.set('Editor action failed');
      console.error(error);
    } finally {
      this.busy.set(false);
    }
  }
}

void bootstrapApplication(QuickstartApp, { providers: [provideZonelessChangeDetection()] });
