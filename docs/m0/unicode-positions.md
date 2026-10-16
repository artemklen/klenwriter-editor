# ADR-003 — Typed positions, deterministic maps and session history

Status: architectural decision and executable M0 vectors; production implementation belongs to OSR-33/34/36/40. Decider: primary Codex. Date: 2026-10-17. Issue: [OSR-59](https://linear.app/klenwriter/issue/OSR-59).

## Decision

Use text-leaf identity plus a UTF-16 offset at the DOM/SDK boundary, separately typed UTF-8 byte offsets inside Rust, and extended grapheme clusters for user editing/navigation. These are three different units. Structural positions address child boundaries or before/after an atomic node; an image is not assigned an invented text length. Anchor and focus preserve direction; a reverse selection is not silently sorted in the returned selection.

The reason for UTF-16 at the boundary is precise alignment with DOM Text offsets and JavaScript strings. Using bytes publicly would require every host to reproduce conversion; using grapheme indices as storage positions would make every edit and Unicode upgrade renumber subsequent positions. UTF-16 is not the navigation unit and does not authorize slicing surrogate pairs.

## Position types and validation

```ts
type TextPosition = { kind: 'text'; leaf: string; utf16: number; affinity: 'before' | 'after' };
type ChildPosition = { kind: 'child'; parent: string; index: number; affinity: 'before' | 'after' };
type EdgePosition = { kind: 'edge'; node: string; side: 'before' | 'after' };
type Selection = { anchor: Position; focus: Position };
```

Offsets and child indices are finite nonnegative integers within admitted bounds; text offsets must be scalar boundaries. Input containing lone UTF-16 surrogates is refused before encoding to Rust; replacing them with U+FFFD would lose data. A UTF-8 byte offset inside a multibyte scalar is refused. No NFC/NFKC conversion occurs in coordinate conversion or normal editing. Codec normalization, where explicitly prescribed, is a different operation with its own corpus.

Scalar-valid positions are not necessarily grapheme boundaries: offset 1 in `e\u0301` splits the cluster. Conversion can represent that scalar boundary without changing text; user-facing cursor deletion, replacement and mark application require cluster boundaries or an explicit profile command that reports its boundary policy. We refuse ambiguous programmatic edit ranges rather than silently expand them. Native browser selection is read, converted and checked before mutation. A read-only selection may reflect browser granularity; it does not override edit admission.

Segmentation uses a pinned `unicode-segmentation` release and its declared Unicode version in the release manifest; its grapheme tables are the authority for semantic delete/navigation commands. `Intl.Segmenter` is only a browser comparison lane, not an unversioned production authority. Pinning and upgrading Unicode tables is a behavioral change requiring vectors. Native visual left/right and bidi layout remain browser responsibilities; model maps use logical order. RTL support here means preserving and mapping text, not claiming a complete bidi interaction implementation.

Clusters are computed across adjacent text leaves in the same inline text sequence, including mark boundaries. Styling cannot make an accent or ZWJ family splittable. An inline atom or hard break is a structural boundary. A text leaf split that would bisect a cluster is refused; a mark split preserves the logical text sequence and returns a leaf map. Empty text and empty containers have explicit positions; normalization cannot delete their only valid caret target without a map.

## Transaction mapping rules

All maps relate a specific before revision to a specific after revision. Affinity describes attachment at an insertion boundary, not visual caret direction. Mapping a multi-step transaction composes its ordered step maps, including structural normalization. A refusal produces the identity map and no committed state change.

| Operation | Rule |
| --- | --- |
| Insert length L at p | x<p unchanged; x>p shifts by L; x=p stays for `before`, shifts for `after` |
| Replace [a,b) with length L | x<a unchanged; x>b shifts by L−(b−a); x=b maps to a+L; x=a maps to a or a+L by affinity; deleted interior maps to the chosen replacement edge and is marked deleted |
| Delete [a,b) | Replace with L=0; strictly interior points land at a with deleted provenance; interval endpoints map to a without deleted provenance |
| Split leaf at k | Positions left of k remain left; right of k move to new right ID with offset−k; at k `before` stays at left end, `after` moves to right start |
| Join right into left | Left positions unchanged; right positions map to left at old-left-length + offset; right ID retired and map retained |
| Move subtree | Descendant IDs and text offsets remain; parent child-boundaries remap by remove then insert; destination is expressed against the pre-operation tree and adjusted once |
| Delete subtree | Descendant positions carry deleted provenance and fall back to the deleted node's former parent gap; if that parent is deleted, walk the recorded deletion chain to the nearest surviving ancestor gap |
| Mark split/merge | Logical text offsets are unchanged; leaf identity/offset maps point into the resulting runs; adjacent text cluster checks span run boundaries |
| Atomic insert/delete | Before/after positions and adjacent child gaps map structurally, never through a fake character offset |
| Undo/redo | Restore stored semantic operation and selection snapshots; document revision increases monotonically; reverse maps accompany the result |

Fallback is derived from the operation and original tree, never DOM nearest-node heuristics. A gap at the end of a surviving parent remains its end; an empty valid parent uses child index 0. If schema rules disallow a caret there, the command must supply a deterministic valid target as part of its candidate or refuse. Map results distinguish `mapped`, `deleted`, `stale` and `invalid`; returning a plausible point without provenance hides loss.

When an insertion occurs at a structural gap i, `before` stays at i and `after` advances by inserted child count. Deletion of children [a,b) clamps interior gaps to a and shifts later gaps by −(b−a). A same-parent move removes once and inserts once; destinations within the moved subtree or self-containing moves are refused. No map may refer to a retired ID without an explicit successor/fallback.

## History and lifecycle

A node ID is opaque and unique within one session. A session has a distinct identity and each mount generation has its own token. Newly created nodes never reuse a retired ID; undo may revive the same historical identity with its stored content. Export excludes session/node IDs, generations, selections, history and caches unless a profile explicitly defines its own unrelated persisted identifier. Reopening creates new session IDs; stable addressing across remount is not promised.

Document revision is a canonical decimal u64 string in JS DTOs. Undo does not decrement it: commit r→r+1, undo r+1→r+2, redo r+2→r+3. Selection-only change increments selection epoch, not document revision/dirty/history. A dirty-revision event conservatively reports document changes; revision inequality does not prove content inequality. Host compares an explicit canonical snapshot with the last saved baseline when deciding whether Undo-to-baseline may clear user-visible dirty state without a server write. Record that equivalence for the current revision while keeping server ETag/receipt identity separate. Until a successful comparison, dirty remains conservative; failed export or provisional composition cannot be declared clean. This comparison occurs at snapshot/recovery boundaries, not by exporting on every input or checking history depth.

History groups are explicit: composition commit, paste, drop, toolbar command and compound command are separate entries. Adjacent typing can group only with same session/generation, compatible command kind and mark context, contiguous mapped range and no intervening selection/host operation. A time threshold is a UI grouping policy recorded in the transaction, not the sole correctness criterion. Native historyUndo/historyRedo are intercepted and routed to the engine; browser native history never becomes a second authority.

Each entry stores forward/inverse semantic changes, selection before/after, mapping and necessary deleted content under resource limits. A failed command creates no entry. External document replacement starts a new history generation after explicit host policy; it never merges with local undo. A separate memory budget bounds history and map retention. Eviction is observable; stale async bookmarks outside retained maps are refused while preserving user input.

History replays stored internal semantic operations rather than admitting a new user gesture. It still validates scalar boundaries, expected state, schema and resource constraints, but does not reapply user-command grapheme guards to the inverse. For example, inserting U+0301 after `a` creates `á`; its exact inverse removes the inserted scalar even though the saved boundary now lies inside that grapheme. Refusing that inverse would break undo. This privilege is internal to verified history replay and cannot be requested by an arbitrary SDK command.

Async dialog commands require captured session/generation/revision and selection epoch. Default stale policy is refusal; an explicit command may request map-based rebase only when every intermediate map exists and no deleted/ambiguous target violates that command's semantics. This is local rebasing, not collaborative conflict resolution.

## Alternatives, future changes and dependencies

- A single flattened integer is compact but makes atoms/nesting and identity preservation implicit. The discriminated types expose those cases.
- Persisting session IDs would simplify reopening bookmarks but changes KWDJ and import/duplicate semantics. A future external annotation/collaboration layer needs a separate durable identity design.
- Browser native undo is mature for DOM, but cannot guarantee atomic model/schema/history operations; M0 already measured grouping differences.
- Custom Unicode segmentation would require maintaining UAX #29 rules and tables. We use `unicode-segmentation`; it does not provide bidi layout, normalization or the CMS word-count policy.
- A rope may improve large-leaf edits, but does not change public position units or mapping rules. String remains replaceable behind a TextStore boundary after performance evidence.

`evidence/osr-59/position-vectors.json` is the coordinate contract: UTF-8/UTF-16, emoji ZWJ, combining sequences, Cyrillic, RTL logical order, empty text and reverse selection. `operation-vectors.json` supplies independently authored commit/undo/redo states, selection and provenance for 16 operations, cascade deletion, atoms/hard breaks, marks and atomic refusal. The reference checker executes a bounded operation interpreter against these expectations; [report and limitations](../../evidence/osr-59/README.md) include source hashes. Production Rust/DOM conformance, visual bidi movement and every production command's inverse are required later; the checker is not a replacement engine.
