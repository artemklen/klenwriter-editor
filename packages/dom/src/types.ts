// SPDX-License-Identifier: MIT OR Apache-2.0
// OSR-40 adds selection/clipboard capabilities; the OSR-39 contract snapshot remains frozen.
import type { CommandDto, CreateEditorOptionsV2, DeepReadonly, EditorControllerV2, EventDto, MarkDto, MutationRequestV2, NodeViewDto, ProfileDto, QueryRequest, ReadRequest, ReadRequestV2, Response, ResponseV2, SelectionDto, SelectionTextRequestV2, SessionContextV2, StampDto, Submission } from '@klenwriter/editor-sdk';
export type InteractionMode = 'editable' | 'readOnly' | 'disabled';
export type MountedLifecycle = 'loading' | 'ready' | 'recoveryRequired' | 'disposing' | 'destroyed' | 'fatal';
export type DomCode = 'dom.invalid_options' | 'dom.not_ready' | 'dom.disposed' | 'dom.renderer_binding_mismatch' | 'dom.renderer_missing' | 'dom.presentation_unsupported' | 'dom.command_unsupported' | 'dom.explicit_method_required' | 'dom.composition_conflict' | 'dom.mode_blocked' | 'dom.native_read_only' | 'dom.busy' | 'dom.stale_replace' | 'dom.reconcile_limit' | 'dom.recovery_required' | 'dom.recovery_callback_failed' | 'dom.invalid_bookmark' | 'dom.stale_selection' | 'dom.selection_unsynchronized' | 'dom.selection_missing' | 'dom.selection_limit' | 'dom.clipboard_unavailable' | 'dom.clipboard_write_failed' | 'dom.clipboard_timeout' | 'dom.selection_geometry_unsupported' | CompositionDomCode;
export interface DomDiagnostic {
  readonly code: DomCode;
  readonly phase: 'mount' | 'command' | 'render' | 'replace' | 'mode' | 'destroy' | 'selection' | 'clipboard' | 'composition';
  readonly stamp: DeepReadonly<StampDto> | null;
  readonly node: string | null;
  readonly typeId: string | null;
  readonly publication: 'none' | 'alreadyPublished' | 'unknown';
}
export interface DomRefusal { readonly status: 'dom_refused'; readonly diagnostic: DomDiagnostic }
export type MountedMutation = Exclude<MutationRequestV2, { kind: 'remount' | 'destroy' }>;
export type MountedSubmission = Submission | DomRefusal;
export type RecoveryRegion =
  | { readonly kind: 'bounded'; readonly stamp: DeepReadonly<StampDto> | null; readonly originalText: string; readonly provisionalText: string; readonly affectedNodeIds: readonly string[] }
  | { readonly kind: 'retained_dom'; readonly element: HTMLElement; readonly reason: 'capture_limit'; readonly ownership: 'transferred_to_host' };
export interface RecoveryPacket { readonly originalInput: Uint8Array | null; readonly region: RecoveryRegion | null; readonly composition?: CompositionRecovery | null }
export interface DestroyReceipt { readonly status: 'destroy_requested'; readonly sdk: Submission; readonly recovery: RecoveryPacket | null; readonly callbackFailure: DomRefusal | null }
export type MountedReady = { readonly status: 'ready'; readonly response: Response }
  | { readonly status: 'sdk_failure'; readonly response: Response; readonly recovery: RecoveryPacket | null }
  | (DomRefusal & { readonly response: Response | null; readonly recovery: RecoveryPacket | null });
export type DomTag = 'span' | 'br' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'pre' | 'code' | 'blockquote' | 'ul' | 'ol' | 'li' | 'div' | 'section' | 'hr' | 'strong' | 'em' | 's' | 'sub' | 'sup' | 'a';
export type DomAttribute = 'href' | 'title' | 'start' | 'role' | 'aria-label' | 'aria-checked';
export interface DomPresentation { readonly tag: DomTag; readonly attributes?: Readonly<Partial<Record<DomAttribute, string>>>; readonly classes?: readonly string[]; readonly label?: string }
export interface RegistryNodeWitness { readonly id: string; readonly owner: string; readonly primitive: string; readonly attributes: readonly string[] }
export interface RegistryMarkWitness { readonly id: string; readonly owner: string; readonly attributes: readonly string[] }
export interface TrustedRegistryInventory { readonly nodes: readonly RegistryNodeWitness[]; readonly marks: readonly RegistryMarkWitness[]; readonly commands: readonly string[] }
export interface NodeRendererDefinition { readonly primitive: string; readonly attributes: readonly string[]; readonly present: (node: DeepReadonly<NodeViewDto>) => DomPresentation | DomRefusal }
export interface MarkRendererDefinition { readonly attributes: readonly string[]; readonly present: (mark: DeepReadonly<MarkDto>) => DomPresentation | DomRefusal }
/** Data-only command construction for browser gestures; semantics remain native. */
export interface InputCommandBindings { readonly insertText?: (text: string) => CommandDto; readonly enter?: () => CommandDto; readonly lineBreak?: () => CommandDto; readonly deleteBackward?: () => CommandDto; readonly deleteSelection?: () => CommandDto }
export interface RendererCatalogDefinition {
  readonly binding: Readonly<{ buildId: string; profile: DeepReadonly<ProfileDto>; registryDigest: string }>;
  readonly inventory: TrustedRegistryInventory;
  readonly nodes: Readonly<Record<string, NodeRendererDefinition>>;
  readonly marks: Readonly<Record<string, MarkRendererDefinition>>;
  readonly commandGate: (request: DeepReadonly<QueryRequest | MountedMutation>) => DomRefusal | null;
  readonly input?: InputCommandBindings;
}
/** Created only by defineRendererCatalog; opaque trusted capability witness. */
export interface RendererCatalog { readonly definition: RendererCatalogDefinition; readonly __rendererCatalog: unique symbol }
export interface MountEditorOptions { readonly element: HTMLElement; readonly editor: CreateEditorOptionsV2; readonly renderers: RendererCatalog; readonly mode?: InteractionMode; readonly onRecovery?: (packet: RecoveryPacket) => void; readonly onRefusal?: (failure: DomRefusal) => void; readonly clipboard?: ClipboardConfiguration }
export interface MountedResourceCounts { readonly sdk: ReturnType<EditorControllerV2['resources']>; readonly dom: Readonly<{ listeners: number; observers: number; continuations: number; retainedInputBytes: number; retainedRecoveryRegions: number }>; readonly selection: SelectionResourceCounts; readonly clipboard: ClipboardResourceCounts }
export interface MountedEditor {
  readonly ready: Promise<MountedReady>;
  readonly lifecycle: MountedLifecycle;
  capture(): ReturnType<EditorControllerV2['capture']>;
  context(): ReturnType<EditorControllerV2['context']>;
  readonly selection: MountedSelectionController;
  readonly clipboard: MountedClipboardController;
  read(request: ReadRequest): Response | DomRefusal;
  read(request: SelectionTextRequestV2): ResponseV2 | DomRefusal;
  read(request: ReadRequestV2): ResponseV2 | DomRefusal;
  query(request: QueryRequest): Response | DomRefusal;
  submit(request: MountedMutation): MountedSubmission;
  subscribe(listener: (event: DeepReadonly<EventDto>) => void): ReturnType<EditorControllerV2['subscribe']> | DomRefusal;
  setInteractionMode(mode: InteractionMode): { readonly status: 'updated'; readonly mode: InteractionMode } | DomRefusal;
  replace(input: Uint8Array): Promise<Submission | DomRefusal>;
  destroy(): DestroyReceipt;
  resources(): MountedResourceCounts;
  nativeResources(): ReturnType<EditorControllerV2['nativeResources']>;
  originalInput(): Uint8Array | null;
}

export interface SelectionBookmark {
  readonly selection: DeepReadonly<SelectionDto> | null;
  readonly stamp: DeepReadonly<StampDto>;
  readonly context: DeepReadonly<SessionContextV2>;
  readonly __selectionBookmark: unique symbol;
}
export interface SelectionReadFailure { readonly status: 'sdk_failure'; readonly response: Response }
export type BookmarkCapture = { readonly status: 'captured'; readonly bookmark: SelectionBookmark } | DomRefusal | SelectionReadFailure;
export type BookmarkRestore = Submission | DomRefusal | SelectionReadFailure;
export interface MountedSelectionController {
  captureBookmark(): BookmarkCapture;
  restoreBookmark(bookmark: SelectionBookmark, options?: { readonly policy?: 'exact' | 'mapped'; readonly focus?: boolean }): BookmarkRestore;
  releaseBookmark(bookmark: SelectionBookmark): boolean;
}
export interface SelectionResourceCounts {
  readonly bookmarks: number;
  readonly restoreTickets: number;
  readonly activePointers: number;
  readonly animationFrames: number;
}

export type ClipboardFailure = DomRefusal | SelectionReadFailure | { readonly status: 'native_unavailable'; readonly response: Response };
export interface ClipboardOutcome {
  readonly action: 'copy' | 'cut';
  readonly status: 'copied' | 'cut' | 'empty' | 'refused' | 'write_failed' | 'copied_but_not_cut' | 'indeterminate';
  readonly clipboard: 'not_attempted' | 'confirmed' | 'unconfirmed';
  readonly failure: ClipboardFailure | null;
  /** Original native command ticket; never fabricated from a read/query. */
  readonly submission: Submission | null;
}
export interface MountedClipboardController {
  copy(): Promise<ClipboardOutcome>;
  cut(): Promise<ClipboardOutcome>;
}
export interface ClipboardConfiguration {
  /** Trusted host platform adapter; default is this document's navigator.clipboard.writeText. */
  readonly writeText?: (text: string) => Promise<void>;
  readonly onResult?: (outcome: ClipboardOutcome) => void;
}
export interface ClipboardResourceCounts { readonly pending: number; readonly continuations: number; readonly retainedTextBytes: number }

// OSR-41 additive recovery provenance, frozen before implementation.
/** An immutable description; referenced DOM/Event objects remain host-owned capabilities. */
export type CompositionUnappliedInput =
  | { readonly kind: 'bounded'; readonly source: 'beforeinput' | 'keydown' | 'composition'; readonly inputType: string | null;
      readonly data: string | null; readonly key: string | null; readonly code: string | null; readonly defaultPrevented: boolean }
  | { readonly kind: 'retained_event'; readonly event: InputEvent | KeyboardEvent | CompositionEvent;
      readonly reason: 'capture_limit'; readonly ownership: 'transferred_to_host' };

export interface CompositionRecovery {
  /** Checked, decimal u64 local generation; never an allocator or document ID. */
  readonly generation: string;
  readonly reason: 'native_refused' | 'native_fatal' | 'native_unknown' | 'stale' | 'ambiguous_tail'
    | 'settle_limit' | 'capture_limit' | 'generation_limit' | 'busy' | 'destroyed';
  /** Null only when a start checkpoint could not be admitted; never invented. */
  readonly context: DeepReadonly<SessionContextV2> | null;
  readonly base: DeepReadonly<StampDto> | null;
  readonly selection: DeepReadonly<SelectionDto> | null;
  readonly affectedNodeIds: readonly string[];
  /** The actual native ticket; no replacement ticket or invented terminal response. */
  readonly submission: Submission | null;
  readonly response: DeepReadonly<Response> | null;
  readonly nativeOutcome: 'not_submitted' | 'queued' | 'completed' | 'unknown';
  readonly unappliedInput: CompositionUnappliedInput | null;
  readonly disposition: 'committed_restored' | 'provisional_retained' | 'dom_transferred';
}

export type CompositionDomCode = 'dom.composition_ambiguous' | 'dom.composition_stale' | 'dom.composition_settle_limit' | 'dom.composition_limit';
