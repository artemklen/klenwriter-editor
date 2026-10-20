# OSR-43 native read / catalog proposal

Source-authored proposal, not execution evidence or a review verdict. Baseline 3960664b286b0939d3e7d8e724183eb9f7b71ee6. The sibling `.sources.json` pins source bytes. Root concurrently authors untracked contracts/slash; those are not claimed as baseline Git contents. No repository code, tests, editor, native, WASM or browser execution in this task.

## Chosen bounded reader

Add ABI2 `text_window`, using a finite source-scan budget and typed refusal. No TextStore index, lazy indexing, mutation/history accounting change or universal O(window) claim. Current Node read clones the full leaf; `utf16_to_utf8` scans from start. Neither is the new reader. Existing eagerly maintained `NodeMetrics.text_utf16` and child ordinals permit bounded borrowed traversal. Long-leaf tail carets work from cached end; deep interior carets can exceed the explicit source budget and legitimately refuse.

Proposed exact DTO names/wire fields (readonly wrappers omitted):

```ts
type TextWindowRequestV2 = {
  kind:'text_window'; stamp:StampDto;
  before_utf16:number; after_utf16:number;
};
type TextWindowSpanV2 = {
  node:string; from_utf16:number; to_utf16:number; text:string;
};
type TextWindowNodeV2 = {node:string; type_id:string; primitive:string};
type TextWindowBoundaryV2 =
  'block'|'inline_atom'|'hard_break'|'window_limit';
type TextWindowReplyV2 = {
  kind:'text_window'; stamp:StampDto; selection:SelectionDto;
  block:TextWindowNodeV2; caret:PositionDto;
  ancestors:TextWindowNodeV2[];
  before:TextWindowSpanV2[]; after:TextWindowSpanV2[];
  before_stop:TextWindowBoundaryV2; after_stop:TextWindowBoundaryV2;
};
```

Closed records, including nested records; numeric caps/offsets follow existing nonnegative finite integer DTO encoding. `caret` is actual focus; selection echoes both native endpoints/affinities. No caller node/position/range or DOM ID. Spans on each side are in document order; each is the exact scalar-safe native `[from_utf16,to_utf16)` slice. A leaf may occur once per side; zero-length spans omitted. No normalized text, synthetic separator, attrs, marks or child-array copy. Block/ancestor headers contain only ID/type/primitive, never NodeView clones.

Admit actual logically collapsed selection: Text endpoints same leaf/UTF-16 offset (affinities may differ), or same Child position in an otherwise empty immediate TextBlock. Empty-block Child returns empty spans and actual block boundaries; it invents no Text ID. Null -> `selection.required`; noncollapsed, root-gap, other Child/Edge or non-TextBlock -> `text_window.unsupported_context`. Add retains existing42 root-gap insertion semantics. `block` is the immediate containing TextBlock; ancestors are actual parents nearest-first, excluding SyntheticRoot. Optional profile supplies eligible text types; Rust generic reader contains no slash grammar.

## Caps / algorithm

Fixed request/output sum <=256 UTF-16; cumulative source visits <=32768 Unicode scalars; <=1024 node visits; <=128 root-inclusive path nodes; conservative serialized response <=256KiB checked before string copies. Scalar meter includes caret lookup and copied output, including repeated visits. Node accounting includes empty nodes/barriers/ancestors. Exhausted source/node/depth budget refuses whole read, not successful partial prefix. Output-edge scalar rounding can yield fewer units than requested.

Expose a private checked cached ordinal accessor; verify parent.children[ordinal]==id, then step sibling indices under node budget. Do not call linear `parent_index`, whole-leaf `validate_position`/`text_point`, clone child vectors, or recursively traverse unbounded descendants. Use borrowed nodes/cached metrics; bound path before copying headers/text. Metadata inconsistency is typed failure, never permission to search around it.

Validate Text offset against cached UTF-16 length. Zero/end maps directly; other offsets scan from the nearer UTF-16 end, charging every examined scalar. Reverse UTF-8 decoder touches at most four bytes per scalar. Surrogate-interior caret refuses. Gather adjacent Text leaves only in same TextBlock. Marks split spans but do not stop lexical continuity; inline atom/hard_break/block edge does. Every included leaf shares the same source budget. No retained document index/cache is added.

Requested output edge splitting a surrogate rounds inward and reports `window_limit`. Even with zero requested units, inspect bounded immediate adjacency needed to establish true block/barrier versus clipped continuation. `window_limit` is never proof of block start/complete query. Reader does not decide grapheme validity: decomposed scalars stay exact; native query/execute keeps EGC authority.

Proposed diagnostics: `text_window.window_limit` (request sum>256), `.source_scan_limit`, `.node_limit`, `.depth_limit`, `.unsupported_context`; existing position/stamp diagnostics for malformed native positions/stale tokens. Missing, unknown, negative, fractional or bool request caps decode-refuse. No cap clamping. Fatal/disposed/native Refused remains original response, not fabricated empty text.

The source cap is a disclosed UX limit. Large absolute offsets near end remain supported; a valid interior caret can refuse even requesting one unit. UI existing42 snapshots may still read legacy unbounded Node DTOs: this proposal bounds the new native lexical read, not every existing UI allocation.

## Origin use / compatibility

Before ordinary input, capture this read at genuine before-stamp; after fresh successful changed ordinary native input and DOM correspondence, read at genuine after-stamp. Pure observations do not certify input origin or advance selection intent. Root private InputOwner callback only certifies `ownedPermit=false`; composition fallback (`ownedPermit=true`) never certifies ordinary input even with insertText type. Missing/budget/stale/ambiguous reads suppress opening. Empty Child -> actual Text is supported explicitly, without fabricated ID/ID-rank inference. InputEvent data/key is not native text authority.

Add DTOs to protocol v2, explicit ts-rs emission/generated declarations and strict SDK decoder. Keep ABI1 shapes/declarations/overloads unchanged. Bridge call_v2 uses borrowed `&self` Session reader and full five-field stamp check first. KwdjEndpoint currently intercepts only selection_text before legacy decode: explicitly route text_window too. Generic Notes Bridge supports this generic read without KWDJ semantics. Existing WASM ABI2 call/handle/resource ownership suffice; no new pump.

Extend SDK2 ReadRequestV2/read overload/direct v2 decode as for selection_text. No mutation publication/queue drain, bookmark revival, command or ordinary-origin permit. Validate kind/full stamp/closed records/scalar strings/span lengths/caps/header bounds before exposure; preserve native Refused/fatal. Public WASM/SDK exports additive. Mounted V2 typing forwards through existing controller; root slash owner separately requires editable/ready/unprotected/idle state, exact context/stamp/caret and genuine origin. Do not steal CompositionOwner's SelectionOwner observer.

Current capability digest includes actual build ID, registry digest and limits. New source changes build/capability identity automatically; do not widen closed SessionContextV2 or echo a JS capability. Optional profile gates use. ABI1 lacks this read; old/unsupported ABI2 is disclosed unavailable capability, never DOM/textContent fallback. No hidden query/second queue.

## Rust-derived static catalog

Extend existing Rust dom_inventory generator with separate KWDJ insertion projection, based only on actual KWDJ_SLASH_CANDIDATES plus typed native-target conversion and actual compiled-registry command witness. Emit separate generated KWDJ TS; leave renderer inventory outputs unchanged. Generator/example already in source identity; new KWDJ TS automatically source-closed. Do not embed the generated file's own build ID (hash cycle).

Public static exports agreed with root:

```ts
export const kwdjSlashCandidates:
  readonly {readonly id:string;readonly target:BlockTargetDto}[];
export const kwdjSlashTextBlockTypes: readonly string[];
```

Actual9 order/targets: paragraph; heading2; heading3; blockquote; bullet-list; ordered-list(start1); task-list; code-block(languageNone); scene-break. Target DTO snake-case kind, required nullable language, ordered start decimal-string. No invented H1/H4..6/table/media/poetry/callout. Text types also derive Rust/profile definitions, not UI tag guesses. Source-generation verifies actual command registration; optional host profile is bound to actual context and native exact query remains authority.

No KWDJ->generic UI dependency or dynamic catalog read. Root UiSlashProfile has textBlockTypes/choices; host maps generated metadata to localized labels/keywords and `command(c,range|null)`: existing kwdjCommand accept_slash for exact slash literal/range, insert_block for Add. Presentation labels/aliases may be independently authored keyed by generated IDs, not another target semantic list. Query every exact command at full stamp; native refusal/limits win. Generic Notes supplies own optional provider or none. No JS semantic eligibility mirror.

## Independent pre-candidate edge expectations

- `/head`, caret5 -> exact before `[0,5)`; marked `/he`+`ad` -> two original-ID spans/same literal; marks/history unchanged.
- `a😀b`, caret3/before3 -> `a😀`; caret2 refuses surrogate-interior. Before1 at caret3 yields no half scalar and window_limit. Decomposed e+U0301 unchanged.
- `/he`, hard_break, `ad` -> only `ad` before caret with hard_break stop. Atom analogous, no cross-block concatenation.
- Request256 accepted subject work;257 typed refusal. Unknown/negative/fraction/bool inputs refuse; independently stale each stamp field.
- C=32768, ASCII leaf length2C+2: caretC/zero output needs C lookup visits, succeeds; caretC+1 needs C+1 either way, source_scan_limit. CaretC/before1 exceeds cumulative lookup+output budget. Literal expectations, no learned outputs.
- Leaf>2C, caretend/before256 succeeds cached end+bounded reverse output; same deep interior may refuse.
- Node1024/1025 count empty/barriers. Depth cap valid admitted path; trees beyond engine/profile admission are admission failures, not invented successful public fixtures.
- Empty P Child0 -> exact empty block read; genuine insertion after-stamp exposes actual Text. Null/noncollapsed/root-gap unsupported, no native mutation.
- Reads/refusals preserve full counters/state/canonical/IDs/publications/history/undo/resources; no semantic identities allocated.
- Generated9/order/typed targets exact. Foreign/duplicate/bad descriptors/context cannot grant authority. Wrong literal/range/barrier/current caret remains native Refused. Add root-gap flow independent; Escape/Tab no text mutation.

## Minimal edits / remaining choices

Native lane: bounded reader module + checked ordinal accessor + Session entry; v2 DTO/routing/KWDJ endpoint; target-out + existing inventory generator/static KWDJ export; ts-rs + SDK2 read/strict decoding. Root owns mounted/UI typings, origin callback, key/presentation/request leases, strings and integration. No package cycle, core metrics/storage/history changes or new public mutation.

No unresolved product choice. Freeze exact diagnostic names and align generated export file naming before implementation. Material deep-interior scan refusal remains explicit; no authority/deadline/composition exception hides it.
