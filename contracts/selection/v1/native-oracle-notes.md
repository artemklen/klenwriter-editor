# OSR-40 native range data — final pre-candidate notes

Data-only companion to `/tmp/osr-40-native-oracles.json`, authored from clean
accepted runtime source `ff2bd3103eba9b47cd2a06098d1506d9a054a589` and root's
pre-candidate `contracts/selection/v1/README.md` decisions. This is not candidate
output, test execution, implementation or formal review. The outside Python
authoring tool constructs only explicit JSON literals/ASCII-key canonical
strings; it imports no editor code and executes no native/WASM/browser action.

## Exact seam chosen by root

- ABI2-only `selection_text{stamp,max_bytes}`; response exactly
  `kind,stamp,selection,projection_id,text,empty,selected_atoms`.
- Thin BridgeRequestV2 / SdkReplyV2 / SdkResponseV2 wrappers; original ABI1
  read request/reply shapes unchanged. New optional BridgeAdapter callback has
  typed default `profile.selection_text_unsupported`; no profile-ID branch or
  arbitrary query registry. Read uses immutable guarded Session getters through
  a bounded borrowed reader; no snapshot/prepare_tree, mutation or ID allocation.
- KWDJ projection ID `org.klenwriter.kwdj/selection-text/1`; Notes remains an
  independent opt-in. No KWDJ command17/policy silently enters Notes.
- Command17 `org.klenwriter.kwdj/command/delete-selection`, payload exactly
  `{"kind":"delete_selection"}`. Catalog17 /18 with one recipe and coherent
  additive KwdjIntentDto decoding in every advertised lane. Old16 payloads and
  semantic vectors remain unchanged.

## Literal coverage and fixed topology

The JSON contains24 native cases in all8 original L groups,8 independent
separator cases,5 concrete public text-cap cases, and a separate forward/reverse
positive formatting literal. Canonical strings are explicit compact KWDJ JSON,
with preserved scalar text and integer attributes. Native opaque IDs bind to
independent child-index role paths. No numeric allocator-token expectations or
candidate-produced expected positions exist.

- L1 old styled inline replacement retains P/L, retires original R, creates
  surviving right suffix N. Exact caret Child(P,1,After). Formatting adds strike
  to b/c only, retaining both original text IDs where their prefixes survive;
  its split suffix/marked-span IDs and directed mapped selection are explicit.
- L2 old compatible sibling helper joins across wholly selected list+scene,
  preserving A/L/C/Z and creating N. This remains a positive legacy baseline.
- L3 new item→item deletion preserves O/start7, both items and both textblock
  shells. Partial a/d stay in their original contexts; no list merge/hoist.
  A further literal selects all left text contents: left P1 remains empty,
  caret Child(P1,0,After), original L retired.
- L4 task-item→outside heading removes maximal Q,TI2,S in document order after
  right-prefix/left-suffix deletion. Retain task checked=true, heading level3,
  both partial endpoint ancestor paths, outside C/Z. Caret L:1 After.
- L5 inline HardBreak edges delete the BR; structural scene edges delete the
  scene once. Atom-only copy is empty text with semantic empty=false and [S].
- L6 e/accent across marks is scalar-readable separately, EGC-editable only as
  a whole. No normalization into precomposed text. Whole-cluster deletion keeps
  outside code-marked X unchanged.
- L7 actual negative admission, null/readOnly/domain/reference/code/stale/budget
  policies plus unselected domain elsewhere positive. A half-surrogate is
  **never installed**: invalid set_selection refuses, then pure projection
  reads the unchanged valid collapsed current selection.
- L8 retained ordered/root/task owner repair uses new valid basic scaffolding
  after removals. Ordered start7 survives; task replacement item is unchecked.
  Whole outside-selected containers are removed, not repaired unnecessarily.

## Maps resolved independently, with no pending guesses

Core `Position::affinity` gives Edge(Before) Before (`core/positions.rs:78–87`).
Detach emits ChildDelete then Retire, and Retire preserves the point affinity
(`engine/tree.rs:2221–2285`, `engine/mapping.rs:528–542`). Consequently old
scene-before maps to Child(root,1,Before); command caret is separately After.

For L1 end split R at1 creates N; R:2 maps to N:1. R:0 remains original R until
its retirement, then maps Deleted→Child(P,1,After). L3 right-prefix removal
retires R to Child(P2,0,After), while surviving N:1 retains original suffix
attachment. L4 U retirement within Q falls back to Child(TI,1,After); V within
TI2 to Child(T,1,After); S-before to root gap1 Before. Their fallback parents
remain live; no nearest-DOM guess is involved.

L8 removal retires the old subtree to owner gap0. Subsequent repair insertion
at0 sends After to gap1 and keeps Before at gap0 (`replace_offset`,
`mapping.rs:126–170,419–469`). Thus old T:1 After is Deleted→Child(O,1,After),
while old Child(O,0,Before) remains Mapped→itself. These exact maps fix the
removal-before-repair order in the data.

Every Changed isolated vector has revision1, one document event/undo entry,
then undo revision2 with exact original IDs/directed selection and redo revision3
with the same historical created IDs. Query/refusal/no-op changes no facets.
Deleted map provenance does not become Mapped simply because undo revives an ID;
restoring the historical selection is a separate native history operation.

## Separator and failure decisions

Text literal, BR LF, block fragments LF, no nesting LF. `a / scene / b` is
`a\n\nb`. Atom-only is empty text plus membership. Partial b/c is `b\nc`;
end(left)→start(right) projects LF. A single selected block adds no trailing LF;
two empty selected rows project LF, one selected empty row projects empty text
with empty=false, coincident inside gap is empty=true. No fake U+FFFC.

Boundary-only LF between incompatible contexts contains no erasable authored
text/whole subtree under the context-preservation policy: native new17 refuses
`kwdj.command_unsupported_context` and does not collapse selection. Same-parent
matching blocks keep the old lossless join behavior. Code same-block permits
the old empty InsertText path; cross-context code and selected domain/reference
content refuse. Unsupported unrelated content does not reject a basic range.

New read diagnostics are fixed by root: path empty/category sdk/details empty
for selection.required/profile.selection_text_unsupported and every
selection_text.* code. Existing native WorkMeter diagnostics retain original
details; concrete private meter literals bind transaction_work/transaction_bytes
with maximum1/observed2. No public budget-testing setter is introduced.

Source-proven invalid set_selection diagnostic is position.invalid, path empty,
category sdk/details empty, may_have_committed=false, current stamp. Source chain:
Session::set_selection → scalar validate_position → TreeError::Position →
bridge transaction_error (`session.rs:485–495`, `tree.rs:1802–1809`,
`engine/transaction.rs:159–170`, `bridge/lib.rs:228–245`). No unresolved existing
diagnostic spelling is claimed. New read codes are contract definitions, not
claims of existing runtime output.

Important envelope distinction: query_command's **nested** unavailable diagnostic
has stamp:null; actual outer Refused command/read gets current stamp through
Bridge::call. New17 successful presentation is active:none, not off; changed
mutation effect is `changed`. State/token placeholders in the data are explicit
oracle macros, never extra wire fields.

Read maxima: text1MiB, nodes200000/depth128/atoms4096, work1000000 units/64MiB,
encoded reply8MiB. Public text caps0/1 for literal ab refuse,2/exact1MiB succeed,
overmax1048577 refuses. No partial text. Hard-bound reachability depends on
earlier admitted/profile/transport ceilings; the data does not invent huge
admissible documents just to defeat another guard. Private lowered-budget reader
literals may test each refusal independently without altering public API.

Clipboard acknowledgement is resolved navigator.clipboard.writeText; captured
mount/context/stamp/intent must still match before one isolated native command17.
Late successful write reports copied_but_not_cut; no mapping/reselection/replay.
DataTransfer.setData is payload evidence only, never OS ACK. Indeterminate native
completion retains the actual fatal outcome and may_have_committed.

Await the root contract commit before any runtime/source/fixture implementation.
