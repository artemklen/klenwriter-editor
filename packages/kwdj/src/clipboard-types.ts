// SPDX-License-Identifier: MIT OR Apache-2.0
/** Untrusted clipboard conversion data. Only native admission can validate or insert a candidate. */
export const clipboardDiagnosticOrder = Object.freeze([
  'clipboard.rich_branch_rejected', 'clipboard.plain_fallback_used', 'clipboard.unsupported_semantics',
  'clipboard.unsafe_url_rejected', 'clipboard.media_item_forbidden', 'clipboard.remote_image_forbidden',
  'clipboard.editor_metadata_ignored', 'clipboard.invalid_input', 'clipboard.invalid_context',
  'clipboard.empty_payload', 'clipboard.admission_rejected',
] as const);
export type ClipboardDiagnostic = typeof clipboardDiagnosticOrder[number];
export interface ClipboardProfileBinding {
  readonly profile_id: string; readonly profile_version: string; readonly codec_id: string; readonly wire_version: number;
}
export interface ClipboardDecodeRepresentation {
  readonly status: 'complete_local' | 'unavailable' | 'oversize_not_retained' | 'unread_due_limit' | 'read_failed';
  readonly text: string | null;
}
/** Explicit host policy can only narrow the native-safe http(s)/origin-relative URL subset. */
export interface ClipboardUrlPolicy {
  readonly allow_origin_relative: boolean;
  readonly allowed_schemes: readonly ('http' | 'https')[];
  readonly allowed_origins?: readonly string[];
}
export interface ClipboardDecodeInput {
  readonly source_profile: ClipboardProfileBinding;
  readonly mode: 'prose' | 'poetry';
  readonly insertion_context: 'root' | 'prose_block' | 'verse';
  readonly media: 'present' | 'not_observed' | 'unknown';
  readonly plain: ClipboardDecodeRepresentation;
  readonly html: ClipboardDecodeRepresentation;
  readonly url_policy: ClipboardUrlPolicy;
}
export interface ClipboardCandidateMark {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, string>>;
}
/** ID-free canonical-shaped KWDJ data; the type does not confer grammar/admission authority. */
export interface ClipboardCandidateNode {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, string | number | boolean>>;
  readonly text?: string;
  readonly marks?: readonly ClipboardCandidateMark[];
  readonly content?: readonly ClipboardCandidateNode[];
}
export interface ClipboardFragmentCandidate {
  readonly format_id: 'org.klenwriter.kwdj/clipboard-fragment/1';
  readonly source_profile: ClipboardProfileBinding;
  readonly mode: 'prose' | 'poetry';
  readonly kind: 'inline' | 'blocks';
  readonly content: readonly ClipboardCandidateNode[];
  readonly open_start: boolean;
  readonly open_end: boolean;
}
export type ClipboardDecodeResult =
  | Readonly<{ status: 'candidate'; fragment: ClipboardFragmentCandidate; diagnostics: readonly ClipboardDiagnostic[] }>
  | Readonly<{ status: 'refused'; diagnostics: readonly ClipboardDiagnostic[] }>;
/** Structural parser seam. No DOM node, source object or parser implementation escapes the decoder. */
export type ClipboardHtmlNode =
  | Readonly<{kind: 'text' | 'comment'; value: string}>
  | Readonly<{kind: 'doctype'; name: string; publicId: string; systemId: string}>
  | Readonly<{kind: 'element'; tagName: string; namespaceURI: string;
      attributes: readonly Readonly<{name: string; value: string; namespace: string | null; prefix: string | null}>[];
      children: readonly ClipboardHtmlNode[]}>;
