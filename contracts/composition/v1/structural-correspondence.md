# Composition structural correspondence v1

This is pre-candidate contract data for OSR-41, authored against reviewed main
`69d8cffe2704d7c868c240344c7c3131b0b10d82`, tree
`385f01e4fed9c539f75f01273fdc86f59e90921c`. It is not an observed browser result.
The root state/event tables and public API contract govern lifecycle, intent,
settlement, diagnostics and recovery. `dom-oracles.json` supplies independent
literal presentation observations; `native-oracles.json` supplies Rust semantics.
Neither document promotes DOM text, event data or a TypeScript normalizer into
document authority.

## Admission and original window

Synchronize the original owned DOM selection before provisional ownership. Take
the baseline after that legitimate state-only setup, then capture the complete
mount/context/stamp/generation/intent and directed native range. Direction and
affinity are retained; only document order chooses the left/right observation
boundaries. UTF-16 offsets remain unit counts on scalar boundaries, not scalar
indices. Rust alone admits an edit at EGC boundaries.

Positive structural windows are finite:

| Shape | Required observation |
| --- | --- |
| One existing text block | Both endpoints resolve into this exact block. Native/profile admission remains authoritative. |
| Compatible same-parent paragraphs | Exact same actual content parent and native parent; endpoint paragraph type/attrs agree. Every intervening sibling is recorded in order. Middle entries are fully selected paragraphs or fully selected `scene_break` atoms. |
| Paragraph → scene → paragraph | The selected scene occupies its own structural entry. The right paragraph and scene are selected members, not LF text or a gap to ignore. |

Cross-parent or unequal endpoint attrs, an incomplete atom edge, unknown middle
container/atom, cloned identity, noncontiguous window or missing endpoint is an
explicit unsupported correspondence/recovery. Do not flatten nested containers
to make them compatible. This narrower DOM admission does not change the native
headless refusal vectors, which must still execute directly against Rust/WASM.

Before the first provisional mutation retain:

1. Ordered entries: native ID/type/primitive/attrs/marks/children and actual
   element/content references; include each selected scene and all endpoint
   children required to address the original range.
2. Original endpoint raw DOM objects/offsets and their independently observed
   directed selection; original unselected prefix and suffix **at those exact
   boundaries**, including authored hard-break/mark/atom membership.
3. Actual common content parent, immediate outside sibling objects (including
   explicit null boundaries), and their original native/DOM identity/metadata.
   The native full stamp and outside mutation observations must remain valid.
4. Protected entry/ancestor object references, adapter-write observations, and
   enough bounded original input/provenance to survive failure without a new
   whole-document snapshot.

Outside sentinels are not a request to serialize unrelated blocks. A mutation
outside the authorized window invalidates correspondence; shallow sentinel
identity is not proof that an unobserved outside subtree was unchanged. The
literal fixtures additionally pin their small outside heading/text objects and
all metadata. No copied `id` or `data-editor-node` attribute creates authority.

## Bounds, charged before copying

| Budget | Inclusive maximum | Accounting |
| --- | ---: | --- |
| Structural entries | 8 | Every endpoint and middle sibling, **including scene atoms**. Eight permits two endpoints plus at most six middle entries. |
| Visited nodes | 131072 | All visited actual nodes, including wrappers/Text/BR/atoms and consulted ancestor/sentinel nodes. Charge known child counts before pushing/copying a traversal. |
| Depth | 128 | Entry outer node is depth0; every traversed child adds1. Do not reset depth inside a wrapper. Ancestor traversal is independently bounded by the same maximum. |
| Text observation | 2097152 UTF-16 units | Sum across the whole bounded observation, not per entry. Original and current observations are each bounded before allocation. Authored BR costs one unit in the diagnostic text representation; placeholders cost zero. |
| Mutation records | 4096 | Whole active generation through the pre-publication stable checkpoint, including records with multiple added/removed nodes. Charge those node visits separately. Event/update delivery cannot reset this budget. |

2097152 is a UTF-16 **unit** limit, not a two-megabyte byte claim. If old recovery
text fields use inter-block LF separators, charge those separators too; those
fields remain diagnostic recoverable text, never structural serialization.
Native command/transport/output budgets may refuse earlier. Exactly-at-limit
observations are admissible to observation only, not a promise of native success.

Exceeding any bound or losing a sentinel transfers the actual intact region to
the host when a complete bounded copy is unavailable. Never clone an unbounded
subtree, truncate the sole input, or clear it while reporting a limit refusal.
Node/depth fixtures can be generated from the literal recipes in the JSON without
running editor semantics; they remain separate controlled limit witnesses.

## Final delta, without structural normalization

Settlement reads the actual bounded DOM, under the root's two-stable-RAF,
eight-read/250ms policy. `compositionend.data`, input data, trust, Escape, blur,
elapsed time and event order are not the replacement source.

For a changed positive window, independently establish all of the following:

- The original outside siblings, content parent, metadata, context and targeting
  ownership still delimit the same complete window. Any newer native stamp or
  explicit target invalidates it, even when a host target was NativeNoop.
- Original unselected prefix/suffix are exact in text, boundary membership,
  marks/attrs and untouched-object sentinels. Use captured offsets and lengths;
  do not discover a different range by longest common prefix/suffix, repeated
  text matching, LF joining, Unicode normalization or EGC segmentation.
- The current inside shape matches an explicitly supported literal. Cross-block
  positives retain the original left paragraph outer, have one resulting
  paragraph in the window, and contain no selected middle/right shell or atom.
  No fresh unsupported atom/BR/container or unexplained outside deletion is
  accepted as replacement text.
- The resulting contiguous actual Text input between those exact boundaries is
  the replacement string. Preserve its UTF-16 units exactly. Do not derive it
  from event data, concatenate unknown atom labels, or silently map U+00E9 to
  `e`+U+0301 (or vice versa).

The adapter submits this string once through the existing bound InsertText and
the original native range, using isolated history. There is no DeleteSelection
then InsertText pair and no independent JS document/normalization algorithm.
Rust owns deleted nodes, normalization, caret/marks, maps, IDs, history and undo.
After actual native publication, verify affected presentation against its real
response/view data. A disagreement after commit retains the original native
outcome and recovery truth; it does not become an atomic pre-commit refusal.

Unchanged cancellation requires **complete** original structural, text and
sentinel correspondence, not equal flattened text. It dispatches zero document
commands and adds zero undo entries after the declared baseline. State-only
selection/stored-marks/barrier consequences are asserted separately by the root
state/native tables; no blanket claim that all epochs stayed unchanged.

## Actual objects and writer provenance

Browser provisional ownership does not promise that the original Text survives.
A real UA may replace a Text object or remove selected scene/right siblings.
The adapter must retain the composing ownership and must not detach/remount the
active subtree itself. At each provisional checkpoint pin the surviving block,
parent, unselected wrappers/BR/code/outside objects and capture actual old/new
Text references. Adapter-created DOM writes are allowed only after generation
claim and safe retention, at the root settlement/publication boundary.

An observer record alone cannot identify its writer. Positive fixture protocols
exclude host DOM writes during the native interval and separately record adapter
write/lifecycle observations. A controlled fixture's declared UA-like Text
replacement is labelled **controlled DOM mutation**, not physical native input.
Installed observations report whether an actual UA replaced Text or merely
changed character data; absence of Text replacement does not fabricate a witness.
Identical cloned Text with copied IDs is not an owned mapping before settlement.

The JSON defines fixed raw `childNodes` paths and offsets independently of the
production mapper. The expected DOM is the rendered presentation of the literal
native document, not a snapshot generated from candidate output. Generated DOM
IDs are captured once and compared for identity; their serial values are not
invented. Undo restores original native historical identities. DOM object reuse
after settlement follows the affected native patch; it is not an obligation to
resurrect a retired UA Text object.

## Failure and ownership

Retain newest bounded original/current input and structural/range provenance
**before** releasing protection, callback or native publication. Native Refused
retains its exact response/ticket/code and unchanged native state; after safe
retention restore only the affected committed presentation using existing rows
or guarded native reads. Keep editing disabled/recovery visible. A stale outside
publication uses the newer committed authority; it never restores an obsolete
base over the newer document.

Incomplete/oversize capture keeps the actual intact region with an explicit
ownership transfer. Fatal/unknown retains original may-have-committed truth and
available input; do not promise base restoration or retry. Unapplied subsequent
input is separately bounded or transfers its original InputEvent ownership as
specified by the root additive provenance contract. Never replay it as part of
the previous composition.

Absent/throwing/reentrant host callbacks and destroy must preserve the sole
packet. Late queued completion cannot write into a newer mount or mutate the
destroy receipt. Pending settle RAF/timer/native ticket and retained input have
truthful ownership counters; transferred host recovery ownership is not silently
counted as released data. Final disposal proves all adapter/SDK resources zero
after their actual terminal completion and preserves/consumes the host packet
separately.
