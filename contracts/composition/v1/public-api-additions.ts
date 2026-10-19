// SPDX-License-Identifier: MIT OR Apache-2.0
// OSR-41 pre-candidate specification, not an implementation entry point.
import type { DeepReadonly, Response, SelectionDto, SessionContextV2, StampDto, Submission } from '@klenwriter/editor-sdk';

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

// Additive live contract: RecoveryPacket gains this OPTIONAL property.
// Existing originalInput/region fields and bounded/retained_dom meanings stay intact.
export interface CompositionRecoveryPacketAddition { readonly composition?: CompositionRecovery | null }

// Additive DomDiagnostic.phase member: 'composition'. Additive DomCode members:
export type CompositionDomCode = 'dom.composition_ambiguous' | 'dom.composition_stale' | 'dom.composition_settle_limit' | 'dom.composition_limit';
// Native Refused keeps its original diagnostic in response; the DOM notification
// uses existing dom.recovery_required, phase composition, publication none.
// No new MountedEditor method, composition command, SDK or public queue is added.
