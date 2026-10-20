# Root contract selection before the first candidate

The native-api.md source-authored proposal is selected as the normative ABI2
read/catalog contract, with these final clarifications. Its historical proposal
wording and original source pins remain preserved; it is not an executed result.

* Names are TextWindowRequestV2, TextWindowReplyV2, TextWindowSpanV2,
  TextWindowNodeV2 and TextWindowBoundaryV2, with the exact closed fields in that
  document. Diagnostic names listed there are selected. Path depth128 counts
  the root-inclusive path; source32768 and node1024 are cumulative budgets.
* The new generated file is packages/kwdj/src/slash-candidates.generated.ts.
  Existing generator source supplies exact nine ordered native targets and
  eligible compiled text type IDs. Public exports kwdjSlashCandidates and
  kwdjSlashTextBlockTypes are additive and immutable. UI strings are independent
  presentation metadata, not a second target registry.
* UI reads before_utf16:256/after_utf16:0. A clipped unresolved lexical boundary
  refuses/closes; the window cap is not silently increased for an ambiguous
  query of maximum length. Root UI legacy42 Node reads are outside this new
  reader's allocation guarantee.
* UI/additive shape and renderer signatures are ui-api.ts and
  presentation-api.ts. behavior.md, strings.json and source-authored input/key
  expectations determine presentation. Initial opening requires a single
  ordinary insertText slash with exact before/after native witnesses, rather
  than arbitrary multi-character paste/replacement. Active query updates also
  retain exact origin/freshness; dismissal cannot revive the old anchor.
* Native-source-oracles contain complete canonical/history goldens and clearly
  marked incomplete negative/mounted seeds. A seed is never a reported pass.
  The original preparation title saying not frozen is preserved as provenance;
  the supplied literal expectations are frozen by this root contract selection.
* Source-only authors are implementation assistants, not the independent formal
  reviewer. Formal exact-head review remains a separate Grok session after
  actual checks and delivery evidence.
* DOM API is dom-api.ts. At most32 observation subscribers and one live popup
  presentation handle. No public serial/input permit/semantic authority is
  introduced. A dataHint over256 units becomes null. Observer errors cannot
  change native completion or replay input. Subscriber reentry/stale/lifecycle
  changes suppress subsequent stale notifications; callbacks added during a
  delivery do not receive that delivery. Unsubscribe/dispose are idempotent.
* Popup options are closed own-data records. Validate the original element by
  identity before DOM property access; listbox/option must be genuine connected
  same-document objects outside the editing root, with matching roles and
  browser ID resolution to those exact objects. Bound local option validation
  at32 with distinct IDs. This is not an unbounded global DOM/duplicate-ID audit.
  Drain real pending mutation records before owned presentation writes, then
  disconnect/write/reobserve; no broad attribute whitelist. Restore only own
  last-written attributes, preserving foreign edits. Handle updates/restoration
  never authorize selection, focus, native input or command mutation.
* ARIA correction BEFORE freeze: installed axe-core4.14.0 role metadata permits
  aria-controls/aria-activedescendant/aria-haspopup on textbox but not
  aria-expanded. The root stays textbox and the popup handle owns exactly
  aria-haspopup=listbox, aria-controls and aria-activedescendant. The shared Add
  button owns expanded/controls for the same picker, including slash opening.
  This overrides the original DOM source-preparation report's root-expanded
  suggestion. No runtime candidate/browser outcome prompted this correction.
* Active admitted Enter with unavailable/no results is consumed in capture
  phase (preventDefault/stopPropagation), keeps the picker/reason and dispatches
  zero. It must not fall through to native insertParagraph. Tab/modifiers and
  composition retain their separate native ownership rules.
