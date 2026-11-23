// SPDX-License-Identifier: MIT OR Apache-2.0
import { mountEditor } from '@klenwriter/editor-dom';
import type {
  DomRefusal, InteractionMode, MountEditorOptions, MountedEditor, MountedMutation, MountedSubmission,
} from '@klenwriter/editor-dom';

export { artifactStage } from '@klenwriter/editor-dom';
export type { MountedEditor as VanillaEditor } from '@klenwriter/editor-dom';

export interface VanillaInteractionOptions {
  readonly readOnly?: boolean | undefined;
  readonly disabled?: boolean | undefined;
}
export type VanillaMountOptions = MountEditorOptions & VanillaInteractionOptions;
export type VanillaInteractionUpdate =
  | (VanillaInteractionOptions & { readonly readOnly: boolean })
  | (VanillaInteractionOptions & { readonly disabled: boolean });
export type VanillaUpdate = MountedMutation | VanillaInteractionUpdate;
export type VanillaRevisionListener = Parameters<MountedEditor['subscribe']>[0];
export interface VanillaExportOptions { readonly maxBytes?: number }

type InteractionFlags = Readonly<{ readOnly: boolean; disabled: boolean }>;
type InteractionResult = ReturnType<MountedEditor['setInteractionMode']>;
const flagsByEditor = new WeakMap<MountedEditor, InteractionFlags>();
const editableFlags: InteractionFlags = { readOnly: false, disabled: false };

type SdkResponse = Extract<MountedSubmission, { readonly status: 'completed' }>['response'];
type ExportResponse = SdkResponse | DomRefusal;
type SnapshotStamp = NonNullable<ReturnType<MountedEditor['capture']>>;
export type VanillaExportResult =
  | { readonly status: 'exported'; readonly canonicalJson: string; readonly stamp: SnapshotStamp }
  | { readonly status: 'export_failed'; readonly stage: 'capture' | 'snapshot'; readonly response: ExportResponse }
  // A host can retry the original release through update() or destroy the mount.
  | { readonly status: 'export_failed'; readonly stage: 'release'; readonly response: ExportResponse; readonly snapshotHandle: string };

function flag(descriptor: PropertyDescriptor | undefined): boolean | undefined {
  if (descriptor === undefined) return undefined;
  const valid = 'value' in descriptor && (descriptor.value === undefined || typeof descriptor.value === 'boolean');
  if (!descriptor.enumerable || !valid) throw new TypeError('Invalid interaction option');
  return descriptor.value;
}

function dataValue(input: unknown, key: string): unknown {
  if (!input || typeof input !== 'object') return undefined;
  return Object.getOwnPropertyDescriptor(input, key)?.value;
}

function interactionMode(flags: InteractionFlags): InteractionMode {
  if (flags.disabled) return 'disabled';
  return flags.readOnly ? 'readOnly' : 'editable';
}

function prepareMount(options: VanillaMountOptions): { options: MountEditorOptions; flags: InteractionFlags } {
  const { readOnly: readOnlyOption, disabled: disabledOption, ...descriptors } = Object.getOwnPropertyDescriptors(options);
  const readOnly = flag(readOnlyOption);
  const disabled = flag(disabledOption);
  const mode = descriptors.mode?.value;
  const nativeOptions = dataValue(descriptors.editor?.value, 'options');
  const flags: InteractionFlags = {
    readOnly: readOnly ?? (mode === 'readOnly' || dataValue(nativeOptions, 'access') === 'read_only'),
    disabled: disabled ?? (mode === 'disabled'),
  };
  if (!readOnlyOption && !disabledOption) return { options, flags };

  if (readOnly !== undefined || disabled !== undefined) {
    if (descriptors.mode && (!descriptors.mode.enumerable || !('value' in descriptors.mode)
        || mode != null && mode !== 'editable' && mode !== 'readOnly' && mode !== 'disabled')) {
      throw new TypeError('Invalid interaction mode');
    }
    descriptors.mode = { enumerable: true, value: interactionMode(flags) };
  }
  // Keep the original descriptors for the DOM owner's option validation.
  return { options: Object.create(Object.getPrototypeOf(options), descriptors), flags };
}

export function mount(options: VanillaMountOptions): MountedEditor {
  let prepared: ReturnType<typeof prepareMount>;
  try {
    prepared = prepareMount(options);
  } catch {
    return mountEditor(options);
  }
  const editor = mountEditor(prepared.options);
  flagsByEditor.set(editor, prepared.flags);
  return editor;
}

function updateInteraction(editor: MountedEditor, request: VanillaInteractionUpdate): InteractionResult {
  const previous = flagsByEditor.get(editor);
  const current = previous ?? editableFlags;
  let next: InteractionFlags;
  try {
    const options = Object.getOwnPropertyDescriptors(request);
    if (Reflect.ownKeys(options).some(key => key !== 'readOnly' && key !== 'disabled')) {
      throw new TypeError('Unknown interaction option');
    }
    const readOnly = flag(options.readOnly);
    const disabled = flag(options.disabled);
    if (readOnly === undefined && disabled === undefined) throw new TypeError('Missing interaction option');
    next = { readOnly: readOnly ?? current.readOnly, disabled: disabled ?? current.disabled };
  } catch {
    // The mounted owner produces the usual typed refusal for invalid modes.
    return editor.setInteractionMode(request as unknown as InteractionMode);
  }
  const result = editor.setInteractionMode(interactionMode(next));
  // A focus callback can complete a newer update while this mode is applied.
  if (result.status === 'updated' && flagsByEditor.get(editor) === previous) flagsByEditor.set(editor, next);
  return result;
}

export function update(editor: MountedEditor, request: MountedMutation): MountedSubmission;
export function update(editor: MountedEditor, request: VanillaInteractionUpdate): InteractionResult;
export function update(editor: MountedEditor, request: VanillaUpdate): MountedSubmission | InteractionResult;
export function update(editor: MountedEditor, request: VanillaUpdate): MountedSubmission | InteractionResult {
  if (!request || typeof request !== 'object' || 'kind' in request) return editor.submit(request);
  return updateInteraction(editor, request);
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

  const handle = snapshot.value.handle;
  const released = await settle(editor.submit({ kind: 'release_snapshot', handle }));
  if (released.status !== 'ok' || released.value.kind !== 'released') {
    return { status: 'export_failed', stage: 'release', response: released, snapshotHandle: handle };
  }
  return { status: 'exported', canonicalJson: snapshot.value.canonical_json, stamp: snapshot.value.stamp };
}

export { exportDocument as export };
