// SPDX-License-Identifier: MIT OR Apache-2.0
/** Synchronous raw capture only; parser, target fencing and retained-slot ownership are external. */
export const clipboardCaptureLimits = Object.freeze({ metadataEntries: 16, mimeUtf16: 128,
  representationUtf16: 524288, aggregateUtf16: 1048576 });
export const unsupportedClipboardFragmentMime = 'application/vnd.klenwriter.editor.fragment+json';
export type ClipboardRepresentationStatus = 'complete_local' | 'oversize_not_retained' | 'unread_due_limit'
  | 'read_failed' | 'unavailable';
export interface ClipboardRepresentationCapture {
  readonly status: ClipboardRepresentationStatus;
  readonly availability: 'declared' | 'not_declared' | 'unknown';
  readonly readAttempted: boolean;
  /** Exact exposed UTF-16 string, never encoded, normalized, trimmed or replaced with a prefix/hash. */
  readonly text: string | null;
  /** Known only after an actual string return; may exceed the retention cap when text is null. */
  readonly utf16Units: number | null;
}
export interface ClipboardMetadataCapture {
  readonly status: 'complete' | 'limit' | 'read_failed' | 'unavailable';
  readonly types: readonly string[];
  readonly items: readonly Readonly<{ kind: 'string' | 'file'; type: string }>[];
  readonly counts: Readonly<{ types: number | null; items: number | null; files: number | null }>;
  readonly media: 'present' | 'not_observed' | 'unknown';
  readonly internalFragment: 'present' | 'not_observed' | 'unknown';
}
export interface ClipboardCapture {
  readonly format: 'clipboard-capture/1';
  readonly scope: 'selected_exposed_strings';
  /** Capture completeness only. This never authorizes parsing, fallback or native insertion. */
  readonly status: 'captured' | 'refused';
  readonly reason: null | 'metadata_unavailable' | 'metadata_limit' | 'metadata_read_failed'
    | 'unsupported_internal' | 'representation_limit' | 'representation_read_failed' | 'no_selected_format';
  readonly metadata: ClipboardMetadataCapture;
  readonly representations: Readonly<{ 'text/plain': ClipboardRepresentationCapture; 'text/html': ClipboardRepresentationCapture }>;
  readonly retainedUtf16Units: number;
}
const selected = ['text/plain', 'text/html'] as const;
type Mime = typeof selected[number];
type CaptureReason = ClipboardCapture['reason'];
type MetadataStatus = ClipboardMetadataCapture['status'];
class MetadataLimit extends Error {}
class MetadataUnavailable extends Error {}
const unavailable = (availability: ClipboardRepresentationCapture['availability']): ClipboardRepresentationCapture =>
  Object.freeze({ status: 'unavailable', availability, readAttempted: false, text: null, utf16Units: null });
const list = (value: unknown): object => {
  if (!value || typeof value !== 'object') throw new MetadataUnavailable();
  return value;
};
const count = (value: object): number => {
  const length = (value as { length?: unknown }).length;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) throw new TypeError();
  return length;
};
const mime = (value: unknown): string => {
  if (typeof value !== 'string') throw new TypeError();
  if (value.length > clipboardCaptureLimits.mimeUtf16) throw new MetadataLimit();
  return value;
};

/**
 * Capture at most two selected string representations, plain first, without keeping the source.
 *
 * getData materializes a whole platform string before its length is available. These limits bound
 * subsequent application work/retention, not that initial platform allocation or synchronous time.
 * An empty return is the exact exposed string only: it does not prove an empty/readable OS payload.
 * Missing/blocked formats remain unavailable with explicit availability and terminal reason.
 * Metadata work counts types + items + declared file entries, before any indexed metadata reads;
 * file entries themselves and all getAsFile/getAsString methods are never accessed.
 */
export function captureClipboard(source: unknown): ClipboardCapture {
  const types: string[] = [], items: { kind: 'string' | 'file'; type: string }[] = [];
  const counts: { types: number | null; items: number | null; files: number | null } = { types: null, items: null, files: null };
  const declared = new Set<string>();
  let media = false, internal = false, metadataStatus: MetadataStatus = 'unavailable';
  let reason: CaptureReason = null, retained = 0;
  const representations: Record<Mime, ClipboardRepresentationCapture> = {
    'text/plain': unavailable('unknown'), 'text/html': unavailable('unknown'),
  };
  const finish = (): ClipboardCapture => Object.freeze({ format: 'clipboard-capture/1', scope: 'selected_exposed_strings',
    status: reason === null ? 'captured' : 'refused', reason,
    metadata: Object.freeze({ status: metadataStatus, types: Object.freeze(types),
      items: Object.freeze(items.map(item => Object.freeze(item))), counts: Object.freeze(counts),
      media: media ? 'present' : metadataStatus === 'complete' ? 'not_observed' : 'unknown',
      internalFragment: internal ? 'present' : metadataStatus === 'complete' ? 'not_observed' : 'unknown' }),
    representations: Object.freeze(representations), retainedUtf16Units: retained });
  const noteMime = (value: string): void => {
    // Metadata comparison is bounded first; the original MIME spelling is retained above.
    const lower = value.toLowerCase(); declared.add(lower);
    if (lower === 'files' || lower.startsWith('image/') || lower.startsWith('audio/') || lower.startsWith('video/')) media = true;
    if (lower === unsupportedClipboardFragmentMime) internal = true;
  };
  try {
    const value = list(source) as { types?: unknown; items?: unknown; files?: unknown };
    const rawTypes = list(value.types); counts.types = count(rawTypes);
    if (counts.types > clipboardCaptureLimits.metadataEntries) throw new MetadataLimit();
    const rawItems = list(value.items); counts.items = count(rawItems);
    if (counts.items > clipboardCaptureLimits.metadataEntries) throw new MetadataLimit();
    const rawFiles = list(value.files); counts.files = count(rawFiles);
    if (counts.files > 0) media = true;
    if (counts.files > clipboardCaptureLimits.metadataEntries) throw new MetadataLimit();
    if (counts.types + counts.items + counts.files > clipboardCaptureLimits.metadataEntries) throw new MetadataLimit();
    for (let i = 0; i < counts.types; i++) {
      const value = mime((rawTypes as Record<number, unknown>)[i]); types.push(value); noteMime(value);
    }
    for (let i = 0; i < counts.items; i++) {
      const raw = list((rawItems as Record<number, unknown>)[i]) as { kind?: unknown; type?: unknown };
      const kind = raw.kind;
      if (kind !== 'string' && kind !== 'file') throw new TypeError();
      if (kind === 'file') media = true;
      const type = mime(raw.type); items.push({ kind, type }); noteMime(type);
    }
    metadataStatus = 'complete';
  } catch (error) {
    metadataStatus = error instanceof MetadataLimit ? 'limit' : error instanceof MetadataUnavailable ? 'unavailable' : 'read_failed';
    reason = internal ? 'unsupported_internal' : metadataStatus === 'limit' ? 'metadata_limit' : metadataStatus === 'unavailable' ? 'metadata_unavailable' : 'metadata_read_failed';
    for (const format of selected) representations[format] = Object.freeze({ ...unavailable(declared.has(format) ? 'declared' : 'unknown'),
      status: metadataStatus === 'limit' ? 'unread_due_limit' : metadataStatus === 'read_failed' ? 'read_failed' : 'unavailable' });
    return finish();
  }
  for (const format of selected) representations[format] = unavailable(declared.has(format) ? 'declared' : 'not_declared');
  // A known unsupported internal format prevents ALL source string reads, not a silent plain fallback.
  if (internal) { reason = 'unsupported_internal'; return finish(); }
  if (!selected.some(format => declared.has(format))) { reason = 'no_selected_format'; return finish(); }
  let read: unknown;
  try { read = (source as { getData?: unknown }).getData; } catch { /* Report below, preserving metadata. */ }
  if (typeof read !== 'function') {
    reason = 'representation_read_failed';
    for (const format of selected) if (declared.has(format)) representations[format] = Object.freeze({ ...unavailable('declared'), status: 'read_failed' });
    return finish();
  }
  let exhausted = false;
  for (const format of selected) {
    if (!declared.has(format)) continue;
    if (exhausted) {
      representations[format] = Object.freeze({ ...unavailable('declared'), status: 'unread_due_limit' }); continue;
    }
    try {
      const text: unknown = Reflect.apply(read, source, [format]);
      if (typeof text !== 'string') throw new TypeError();
      // No encoding/hash/regex/trim/parse/body-copy occurs before these code-unit checks.
      const units = text.length;
      if (units > clipboardCaptureLimits.representationUtf16 || units > clipboardCaptureLimits.aggregateUtf16 - retained) {
        representations[format] = Object.freeze({ status: 'oversize_not_retained', availability: 'declared', readAttempted: true, text: null, utf16Units: units });
        exhausted = true; reason = 'representation_limit'; continue;
      }
      representations[format] = Object.freeze({ status: 'complete_local', availability: 'declared', readAttempted: true, text, utf16Units: units });
      retained += units;
    } catch {
      representations[format] = Object.freeze({ status: 'read_failed', availability: 'declared', readAttempted: true, text: null, utf16Units: null });
      reason ??= 'representation_read_failed';
    }
  }
  return finish();
}
