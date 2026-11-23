// SPDX-License-Identifier: MIT OR Apache-2.0
import { mountEditor } from '@klenwriter/editor-dom';
import type {
  DomRefusal, InteractionMode, MountEditorOptions, MountedEditor, MountedMutation, MountedSubmission,
} from '@klenwriter/editor-dom';
import { createEditorUi } from '@klenwriter/editor-ui';
import type { EditorUi, UiFailure, UiLocale } from '@klenwriter/editor-ui';

export { artifactStage } from '@klenwriter/editor-dom';

export interface VanillaInteractionOptions {
  readonly readOnly?: boolean | undefined;
  readonly disabled?: boolean | undefined;
}
export type VanillaUiOptions = Omit<Parameters<typeof createEditorUi>[0], 'editor' | 'editorElement' | 'locale'>;
export type VanillaMountOptions = MountEditorOptions & VanillaInteractionOptions & {
  readonly locale?: UiLocale | undefined;
  readonly ui?: VanillaUiOptions | undefined;
};
export type VanillaEditor = MountedEditor & { readonly uiReady?: EditorUi['ready'] };
export type VanillaInteractionUpdate =
  (VanillaInteractionOptions & { readonly locale?: never }) &
  ({ readonly readOnly: boolean } | { readonly disabled: boolean });
export interface VanillaLocaleUpdate {
  readonly locale: UiLocale;
  readonly readOnly?: never;
  readonly disabled?: never;
}
export type VanillaUpdate = MountedMutation | VanillaInteractionUpdate | VanillaLocaleUpdate;
export type VanillaRevisionListener = Parameters<MountedEditor['subscribe']>[0];
export interface VanillaExportOptions { readonly maxBytes?: number }

type InteractionFlags = Readonly<{ readOnly: boolean; disabled: boolean }>;
type InteractionResult = ReturnType<MountedEditor['setInteractionMode']>;
type UiRefusal = Extract<UiFailure, { readonly status: 'ui_refused' }>;
export type VanillaLocaleResult = { readonly status: 'updated'; readonly locale: UiLocale } | UiRefusal;
interface AttachedUi {
  readonly ui: EditorUi;
  ready: boolean;
}
interface InteractionState {
  readonly setMode: MountedEditor['setInteractionMode'];
  flags: InteractionFlags;
  applying: boolean;
  chrome?: AttachedUi;
}
const interactionByEditor = new WeakMap<MountedEditor, InteractionState>();
const editableFlags: InteractionFlags = { readOnly: false, disabled: false };

type SdkResponse = Extract<MountedSubmission, { readonly status: 'completed' }>['response'];
type ExportResponse = SdkResponse | DomRefusal;
type SnapshotStamp = NonNullable<ReturnType<MountedEditor['capture']>>;
export type VanillaExportResult =
  | { readonly status: 'exported'; readonly canonicalJson: string; readonly stamp: SnapshotStamp }
  | { readonly status: 'export_failed'; readonly stage: 'capture' | 'snapshot'; readonly response: ExportResponse }
  // A host can retry the original release through update() or destroy the mount.
  | { readonly status: 'export_failed'; readonly stage: 'release'; readonly response: ExportResponse; readonly snapshotHandle: string };

function optionValue(descriptor: PropertyDescriptor | undefined): unknown {
  if (descriptor === undefined) return undefined;
  if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError('Invalid mount or update option');
  return descriptor.value;
}

function flag(descriptor: PropertyDescriptor | undefined): boolean | undefined {
  const value = optionValue(descriptor);
  if (value !== undefined && typeof value !== 'boolean') throw new TypeError('Invalid interaction option');
  return value;
}

function localeOption(descriptor: PropertyDescriptor | undefined): UiLocale | undefined {
  const value = optionValue(descriptor);
  if (value !== undefined && value !== 'ru' && value !== 'en') throw new TypeError('Invalid locale');
  return value;
}

function dataValue(input: unknown, key: string): unknown {
  if (!input || typeof input !== 'object') return undefined;
  return Object.getOwnPropertyDescriptor(input, key)?.value;
}

function interactionMode(flags: InteractionFlags): InteractionMode {
  if (flags.disabled) return 'disabled';
  return flags.readOnly ? 'readOnly' : 'editable';
}

function interactionState(editor: MountedEditor, flags = editableFlags): InteractionState {
  const existing = interactionByEditor.get(editor);
  if (existing) return existing;
  const state = { setMode: editor.setInteractionMode.bind(editor), flags, applying: false };
  interactionByEditor.set(editor, state);
  return state;
}

function applyMode(
  editor: MountedEditor, state: InteractionState, mode: InteractionMode, flags?: InteractionFlags,
): InteractionResult {
  if (state.applying) {
    return Object.freeze({
      status: 'dom_refused',
      diagnostic: Object.freeze({
        code: 'dom.busy', phase: 'mode', stamp: editor.capture(), node: null, typeId: null, publication: 'none',
      }),
    });
  }
  state.applying = true;
  try {
    const result = state.setMode(mode);
    if (result.status === 'updated') {
      if (flags) state.flags = flags;
      state.chrome?.ui.refresh();
    }
    return result;
  } finally {
    state.applying = false;
  }
}

interface PreparedMount {
  readonly options: MountEditorOptions;
  readonly flags: InteractionFlags;
  readonly locale: UiLocale;
  readonly ui: unknown;
}

function prepareMount(options: VanillaMountOptions): PreparedMount {
  const {
    readOnly: readOnlyOption, disabled: disabledOption, locale: localeDescriptor, ui: uiDescriptor, ...descriptors
  } = Object.getOwnPropertyDescriptors(options);
  const readOnly = flag(readOnlyOption);
  const disabled = flag(disabledOption);
  const locale = localeOption(localeDescriptor) ?? 'en';
  const ui = optionValue(uiDescriptor);
  const mode = descriptors.mode?.value;
  const nativeOptions = dataValue(descriptors.editor?.value, 'options');
  const flags: InteractionFlags = {
    readOnly: readOnly ?? (mode === 'readOnly' || dataValue(nativeOptions, 'access') === 'read_only'),
    disabled: disabled ?? (mode === 'disabled'),
  };
  if (!readOnlyOption && !disabledOption && !localeDescriptor && !uiDescriptor) {
    return { options, flags, locale, ui };
  }

  if (readOnly !== undefined || disabled !== undefined) {
    if (descriptors.mode && (!descriptors.mode.enumerable || !('value' in descriptors.mode)
        || mode != null && mode !== 'editable' && mode !== 'readOnly' && mode !== 'disabled')) {
      throw new TypeError('Invalid interaction mode');
    }
    descriptors.mode = { enumerable: true, value: interactionMode(flags) };
  }
  // Keep the original descriptors for the DOM owner's option validation.
  return { options: Object.create(Object.getPrototypeOf(options), descriptors), flags, locale, ui };
}

function uiRefusal(code: UiRefusal['code']): UiRefusal {
  return Object.freeze({ status: 'ui_refused', code, action: null });
}

function createChrome(editor: MountedEditor, prepared: PreparedMount): EditorUi | UiFailure {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(prepared.ui);
    if (Reflect.ownKeys(descriptors).some(key => key !== 'slots' && key !== 'profile' && key !== 'onResult')) {
      return uiRefusal('ui.invalid_options');
    }
    return createEditorUi(Object.create(Object.getPrototypeOf(prepared.ui), {
      ...descriptors,
      editor: { enumerable: true, value: editor },
      editorElement: { enumerable: true, value: dataValue(prepared.options, 'element') },
      locale: { enumerable: true, value: prepared.locale },
    }));
  } catch {
    return uiRefusal('ui.invalid_options');
  }
}

function attachChrome(editor: MountedEditor, state: InteractionState, prepared: PreparedMount): void {
  const ui = createChrome(editor, prepared);
  if (!('ready' in ui)) {
    Object.defineProperty(editor, 'uiReady', { value: Promise.resolve(ui) });
    return;
  }

  const attachment: AttachedUi = { ui, ready: false };
  state.chrome = attachment;
  Object.defineProperty(editor, 'uiReady', {
    value: ui.ready.then(result => {
      attachment.ready = result.status === 'ready';
      return result;
    }),
  });
  const destroyEditor = editor.destroy.bind(editor);
  Object.defineProperty(editor, 'destroy', {
    configurable: true,
    writable: true,
    value(): ReturnType<MountedEditor['destroy']> {
      const chrome = state.chrome;
      delete state.chrome;
      let receipt: ReturnType<MountedEditor['destroy']>;
      try {
        chrome?.ui.destroy();
      } finally {
        receipt = destroyEditor();
      }
      return receipt;
    },
  });
}

export function mount(options: VanillaMountOptions): VanillaEditor {
  let prepared: PreparedMount;
  try {
    prepared = prepareMount(options);
  } catch {
    return mountEditor(options);
  }
  const editor = mountEditor(prepared.options);
  const state = interactionState(editor, prepared.flags);
  // Keep direct mode changes on the mounted handle in the same flag state.
  Object.defineProperty(editor, 'setInteractionMode', {
    configurable: true,
    writable: true,
    value(mode: InteractionMode) {
      return applyMode(editor, state, mode, {
        readOnly: mode === 'readOnly' || mode === 'disabled' && state.flags.readOnly,
        disabled: mode === 'disabled',
      });
    },
  });
  if (prepared.ui !== undefined) attachChrome(editor, state, prepared);
  return editor;
}

function updateInteraction(editor: MountedEditor, request: VanillaInteractionUpdate): InteractionResult {
  const state = interactionState(editor);
  let next: InteractionFlags;
  try {
    const options = Object.getOwnPropertyDescriptors(request);
    if (Reflect.ownKeys(options).some(key => key !== 'readOnly' && key !== 'disabled')) {
      throw new TypeError('Unknown interaction option');
    }
    const readOnly = flag(options.readOnly);
    const disabled = flag(options.disabled);
    if (readOnly === undefined && disabled === undefined) throw new TypeError('Missing interaction option');
    next = { readOnly: readOnly ?? state.flags.readOnly, disabled: disabled ?? state.flags.disabled };
  } catch {
    // The mounted owner produces the usual typed refusal for invalid modes.
    return applyMode(editor, state, request as unknown as InteractionMode);
  }
  return applyMode(editor, state, interactionMode(next), next);
}

function updateLocale(editor: MountedEditor, request: unknown): VanillaLocaleResult {
  let locale: UiLocale | undefined;
  try {
    const options = Object.getOwnPropertyDescriptors(request);
    if (Reflect.ownKeys(options).length === 1) locale = localeOption(options.locale);
  } catch {
    return uiRefusal('ui.invalid_options');
  }
  if (locale === undefined) return uiRefusal('ui.invalid_options');
  if (editor.lifecycle === 'destroyed' || editor.lifecycle === 'disposing') return uiRefusal('ui.disposed');
  const chrome = interactionByEditor.get(editor)?.chrome;
  if (!chrome?.ready || editor.lifecycle !== 'ready') return uiRefusal('ui.unavailable');
  chrome.ui.setLocale(locale);
  return Object.freeze({ status: 'updated', locale });
}

export function update(editor: MountedEditor, request: MountedMutation): MountedSubmission;
export function update(editor: MountedEditor, request: VanillaInteractionUpdate): InteractionResult;
export function update(editor: MountedEditor, request: VanillaLocaleUpdate): VanillaLocaleResult;
export function update(editor: MountedEditor, request: VanillaUpdate): MountedSubmission | InteractionResult | VanillaLocaleResult;
export function update(editor: MountedEditor, request: VanillaUpdate): MountedSubmission | InteractionResult | VanillaLocaleResult {
  if (!request || typeof request !== 'object' || 'kind' in request) return editor.submit(request);
  if ('locale' in request) return updateLocale(editor, request);
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
