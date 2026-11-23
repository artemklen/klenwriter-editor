// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DomRefusal, MountedEditor, MountedMutation, MountedSubmission } from '@klenwriter/editor-dom';

export { artifactStage, mountEditor as mount } from '@klenwriter/editor-dom';
export type { MountEditorOptions as VanillaMountOptions, MountedEditor as VanillaEditor } from '@klenwriter/editor-dom';

export type VanillaUpdate = MountedMutation;
export type VanillaRevisionListener = Parameters<MountedEditor['subscribe']>[0];
export interface VanillaExportOptions { readonly maxBytes?: number }

type SdkResponse = Extract<MountedSubmission, { readonly status: 'completed' }>['response'];
type ExportResponse = SdkResponse | DomRefusal;
type SnapshotStamp = NonNullable<ReturnType<MountedEditor['capture']>>;
export type VanillaExportResult =
  | { readonly status: 'exported'; readonly canonicalJson: string; readonly stamp: SnapshotStamp }
  | { readonly status: 'export_failed'; readonly stage: 'capture' | 'snapshot' | 'release'; readonly response: ExportResponse };

export function update(editor: MountedEditor, request: VanillaUpdate): MountedSubmission {
  return editor.submit(request);
}

export function subscribe(editor: MountedEditor, listener: VanillaRevisionListener): ReturnType<MountedEditor['subscribe']> {
  return editor.subscribe(listener);
}

export function destroy(editor: MountedEditor): ReturnType<MountedEditor['destroy']> {
  return editor.destroy();
}

function settle(submission: MountedSubmission): ExportResponse | Promise<SdkResponse> {
  if (submission.status === 'queued') return submission.completion;
  return submission.status === 'completed' ? submission.response : submission;
}

async function exportDocument(editor: MountedEditor, { maxBytes = 16_777_216 }: VanillaExportOptions = {}): Promise<VanillaExportResult> {
  let stamp = editor.capture();
  if (stamp === null) {
    // A retired view can still export the native document during recovery.
    const state = editor.read({ kind: 'state' });
    if (state.status !== 'ok' || state.value.kind !== 'state') {
      return { status: 'export_failed', stage: 'capture', response: state };
    }
    stamp = state.value.state.stamp;
  }

  const snapshot = await settle(editor.submit({ kind: 'snapshot', stamp, max_bytes: maxBytes }));
  if (snapshot.status !== 'ok' || snapshot.value.kind !== 'snapshot') {
    return { status: 'export_failed', stage: 'snapshot', response: snapshot };
  }

  const released = await settle(editor.submit({ kind: 'release_snapshot', handle: snapshot.value.handle }));
  if (released.status !== 'ok' || released.value.kind !== 'released') {
    return { status: 'export_failed', stage: 'release', response: released };
  }
  return { status: 'exported', canonicalJson: snapshot.value.canonical_json, stamp: snapshot.value.stamp };
}

export { exportDocument as export };
