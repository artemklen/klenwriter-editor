// SPDX-License-Identifier: MIT OR Apache-2.0
// OSR-39 public contract, frozen before adapter implementation.
import type { CommandDto, CreateEditorOptionsV2, DeepReadonly, EditorControllerV2, EventDto, MarkDto, MutationRequestV2, NodeViewDto, ProfileDto, QueryRequest, ReadRequest, Response, StampDto, Submission } from '@klenwriter/editor-sdk';
export type InteractionMode = 'editable' | 'readOnly' | 'disabled';
export type MountedLifecycle = 'loading' | 'ready' | 'recoveryRequired' | 'disposing' | 'destroyed' | 'fatal';
export type DomCode = 'dom.invalid_options' | 'dom.not_ready' | 'dom.disposed' | 'dom.renderer_binding_mismatch' | 'dom.renderer_missing' | 'dom.presentation_unsupported' | 'dom.command_unsupported' | 'dom.explicit_method_required' | 'dom.composition_conflict' | 'dom.mode_blocked' | 'dom.native_read_only' | 'dom.busy' | 'dom.stale_replace' | 'dom.reconcile_limit' | 'dom.recovery_required' | 'dom.recovery_callback_failed';
export interface DomDiagnostic {
  readonly code: DomCode;
  readonly phase: 'mount' | 'command' | 'render' | 'replace' | 'mode' | 'destroy';
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
export interface RecoveryPacket { readonly originalInput: Uint8Array | null; readonly region: RecoveryRegion | null }
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
export interface InputCommandBindings { readonly insertText?: (text: string) => CommandDto; readonly enter?: () => CommandDto; readonly lineBreak?: () => CommandDto; readonly deleteBackward?: () => CommandDto }
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
export interface MountEditorOptions { readonly element: HTMLElement; readonly editor: CreateEditorOptionsV2; readonly renderers: RendererCatalog; readonly mode?: InteractionMode; readonly onRecovery?: (packet: RecoveryPacket) => void; readonly onRefusal?: (failure: DomRefusal) => void }
export interface MountedResourceCounts { readonly sdk: ReturnType<EditorControllerV2['resources']>; readonly dom: Readonly<{ listeners: number; observers: number; continuations: number; retainedInputBytes: number; retainedRecoveryRegions: number }> }
export interface MountedEditor {
  readonly ready: Promise<MountedReady>;
  readonly lifecycle: MountedLifecycle;
  capture(): ReturnType<EditorControllerV2['capture']>;
  context(): ReturnType<EditorControllerV2['context']>;
  read(request: ReadRequest): Response | DomRefusal;
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
