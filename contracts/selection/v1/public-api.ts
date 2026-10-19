// SPDX-License-Identifier: MIT OR Apache-2.0
// OSR-40 pre-candidate contract declarations; not runtime implementation.
import type { DeepReadonly, ReadRequest, ReadRequestV2, Response, ResponseV2, SelectionDto, SelectionTextRequestV2, SessionContextV2, StampDto, Submission } from '@klenwriter/editor-sdk';
import type { DomRefusal } from '@klenwriter/editor-dom';

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

/** Additive SDK2 and mounted read overloads; legacy reads retain their narrow result. */
export interface SelectionTextReadOverloads {
  (request: ReadRequest): Response;
  (request: SelectionTextRequestV2): ResponseV2;
  (request: ReadRequestV2): ResponseV2;
}
export interface MountedSelectionTextReadOverloads {
  (request: ReadRequest): Response | DomRefusal;
  (request: SelectionTextRequestV2): ResponseV2 | DomRefusal;
  (request: ReadRequestV2): ResponseV2 | DomRefusal;
}

// Additive live DOM contract:
// MountedEditor.selection: MountedSelectionController (stable identity, including before ready/after destroy).
// MountedEditor.clipboard: MountedClipboardController (same stable ownership).
// EditorControllerV2.read uses SelectionTextReadOverloads.
// MountedEditor.read uses MountedSelectionTextReadOverloads.
// SDK1 read remains ReadRequest -> Response and rejects selection_text at runtime.
// MutationRequestV2 excludes ReadRequestV2, never queues selection_text as mutation.
// MountEditorOptions.clipboard?: ClipboardConfiguration.
// InputCommandBindings.deleteSelection?: () => CommandDto.
// MountedResourceCounts.selection: SelectionResourceCounts, .clipboard: ClipboardResourceCounts.
// Existing resources.dom five fields and disposal shape remain unchanged.
// New DomCode: dom.invalid_bookmark | dom.stale_selection | dom.selection_unsynchronized |
// dom.selection_missing | dom.selection_limit | dom.clipboard_unavailable |
// dom.clipboard_write_failed | dom.clipboard_timeout | dom.selection_geometry_unsupported.
// New diagnostic phases: selection | clipboard.
// Existing lifecycle/mode/composition/busy codes are reused without native-code fabrication.
