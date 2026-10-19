# OSR-40 selection contract v1

Primary implementer decision, 19.10.2026, branch `osr-40`, accepted main
`ff2bd3103eba9b47cd2a06098d1506d9a054a589`. Both dependencies39/59 are Done.
The original five Linear AC, architecture v2, master plan v3 and ADR-003 remain
normative. This pre-candidate contract is design/data, not executed acceptance
or independent review. Runtime implementation starts only after this directory's
manifest and literal data are committed. OSR-38's stopped work stays stopped.

The copied proposal documents preserve their original provenance/status text.
Their pending/optional alternatives are superseded only by this decision and
`public-api.ts`; they are not implementation evidence. No expected output may be
regenerated from a candidate. Existing `contracts/dom/v1/` bytes are preserved;
its old public-types pin is a historical snapshot in `legacy/dom-types.v39.ts`,
not a claim that the evolving live types still have that old hash.

## Native authority and compatibility

Accept native proposal option B: pure profile-owned selected-text read and one
new KWDJ DeleteSelection command17. Native range order, UTF-16/scalar and EGC
admission, transaction/history, normalization, IDs/maps remain Rust authority.
No semantic TS slice, second document, flattened atom character, snapshot read
or `prepare_tree` side effects are allowed.

The closed ABI2 request is `selection_text{stamp,max_bytes}`; reply has exactly
`kind,stamp,selection,projection_id,text,empty,selected_atoms` as specified in
`native-range-design.md`. Use thin `BridgeRequestV2`, `SdkReplyV2`,
`SdkResponseV2` wrappers and a narrow default-unsupported BridgeAdapter callback.
Legacy ABI1 request/reply envelopes do not acquire this read. SDK2 exports
ReadRequestV2/ResponseV2 and an explicit guarded read path; old read requests
retain their responses, command Submissions remain the original existing type.
No open query registry/profile-ID branch in generic core/bridge is introduced.
KWDJ projection ID is `org.klenwriter.kwdj/selection-text/1`. Notes does not
silently gain KWDJ policy or command17; default read refusal is
`profile.selection_text_unsupported`.

Accept native proposal text grammar: text literal, hard_break one LF, selected
block fragments joined by LF, no extra nesting LF. A selected scene_break is an
empty block fragment plus exact selected_atoms membership; `a / scene / b`
copies `"a" + LF + LF + "b"`. Atom-only is text empty, semantic empty=false.
Reverse selection preserves directed endpoints but produces the same payload.
Scalar-readable EGC interiors may copy; destructive edits still require native
EGC boundaries across marked leaves. Half-surrogates cannot become a native
selection. No normalization, rounding, fake U+FFFC or Intl.Segmenter authority.

Read caps: UTF-8 text1MiB, requested smaller max_bytes honored including0,
visited nodes200000, depth128, selected atoms4096, work1000000 units/64MiB,
encoded reply8MiB. Charge/preflight before allocation; no partial/truncated
result. Exact native stamp check precedes read. Null selection refuses
`selection.required`; semantic collapsed selection returns empty=true. New read
codes: `selection_text.output_limit`, `selection_text.node_limit`,
`selection_text.depth_limit`, `selection_text.atom_limit`,
`selection_text.reply_limit`, `selection_text.unsupported_context`; limit
diagnostics have path empty/category sdk/details empty unless an existing
native WorkMeter diagnostic supplies its original limit details. Projection is
facet-pure, including IDs/marks/history/barriers/events/maps/resources.

Command ID `org.klenwriter.kwdj/command/delete-selection`, closed payload
`{"kind":"delete_selection"}`. Preserve old16 payload/semantics; append native
intent/catalog and decoder coherently in all advertised lanes (base17/recipe18).
Same inline-parent and matching sibling textblocks reuse old native delete/join
identity policy. Cross-parent or unequal endpoint metadata keeps both partial
endpoint paths/attrs, removes selected suffix/prefix and maximal fully selected
middle subtrees in document order. No lossy hoist/join/list renumber/task reset.
Structural container/root gaps and atom edges can select whole children;
TextBlock edges retain the existing inline-content/shell convention.

Retained empty basic owners are repaired in the same plan: root/quote/item gets
empty paragraph; ordinary list gets list_item→empty paragraph; task_list gets
unchecked task_item→empty paragraph. Whole containers selected from outside are
removed rather than repaired. Caret at surviving text start After, or surviving
structural start gap After; repaired owner caret is Child(new paragraph,0,After).
Same-parent helper keeps its existing caret. Boundary-only LF between unequal
contexts with no removable authored content refuses unsupported_context rather
than inventing an edit or claiming a cut. Null selection uses existing required
diagnostic; semantic collapsed range is unchanged. Code same-block keeps old
empty-insert support; cross-context code, selected domain/reference/custom
content or unsupported ancestor grammar refuses. Unsupported unrelated content
elsewhere is not itself a reason to reject a basic owned range. Native final
stored-marks validation/Keep is retained. Changed command has one native
publication/isolated undo unit; query/refusal/no-op is pure. Native oracle data
fixes topology, IDs, maps, history and refusal envelopes independently.

## Mounted ownership, bookmarks and focus

Accept `mounted-selection-design.md` and exact `public-api.ts` with these final
choices. One selection owner per mount replaces input's old selection publisher
and Tab guard, shares the one private SDK2/event boundary and owned-object view.
There is one active primary left mouse pointer, one RAF, at most one restore
ticket,64 live privately branded immutable bookmarks. No parallel publisher,
second SDK, map journal, canonical export per tick or document-level input RPC.

Capture is pure current-model capture; pending mismatched owned DOM refuses
selection_unsynchronized without flushing. Null is representable; focus=true
null refuses selection_missing. Exact is default and requires full stamp/context/
generation and unchanged intent; mapped is explicit, uses native map_position
for both endpoints against one current stamp, and refuses deleted/stale/invalid/
missing provenance. Handle consumed only at actual dispatch; release idempotent.
Copied/foreign/expired handles refuse. Busy/reentrant/provisional/disabled blocks
before queue, readOnly permits selection. Unexpected actual queued native
Submission is retained/returned once; it is never cancelled, fabricated or replayed.
An explicit replacement attempt invalidates handles when it starts, even if
admission later fails; native state/generation still remains unchanged on that
failure. Ordinary mode changes retain handles but cancel active interactions.

Intent is a checked invalidation serial independent of selection_epoch. Owned
targeting keys/pointer/beforeinput, explicit host set_selection/history and
unknown/state-only/barrier/stored-marks/reentrant provenance invalidate older
targets, even if native is unchanged. A direct synchronous facade host command
may maintain a constant-size document-continuity certificate only when its
expected document publication finishes with no intervening targeting input or
queued/reentrant mutation. This permits explicitly mapped restoration after
known document updates. Unknown provenance increments invalidation; fresh capture
cannot revalidate older handles. Native map_position remains the sole map chain.

New owned DOM Text/Child endpoints use After; exact known correspondence retains
native Before/After. Direction/RTL is separate. Owned Cmd+A/Ctrl+A prevents the
browser default and publishes exactly Child(root,0,After) to
Child(root,current child count,After); foreign control gestures remain native.
The Unicode data fixes independent root counts and whole-cluster keyboard cases.
Focus=false preserves outside
focus/range; requested focus=true transfers immediately only after final guards,
then rechecks synchronous focus-handler effects. No async focus stealing. Ordinary
Tab/Shift-Tab return restores current model selection, not an old bookmark;
explicit toolbar/dialog return uses a bookmark. Original native outcomes remain
unchanged on later UI failure; report truthful separate DOM publication status.
Keep39 provisional preservation and pre-removal empty-block caret relocation.

Selection-only operations preserve doc/revision/IDs/dirty and undo-entry counts.
Native selection_epoch/stored marks/barrier/history_epoch/events follow actual
native semantics, including sealing an open typing group. Read/map/capture/
refused restoration is pure. No JS restoration of historical stored marks.

## Clipboard completion and public seam

`public-api.ts` adds mounted.clipboard copy/cut, optional trusted platform
writeText/onResult adapters, and separate resource counters. Default writer is
the owning document's navigator.clipboard.writeText. It must resolve a Promise;
unsupported/rejection/synchronous throw refuses destructive work. One operation
per mount, bounded1MiB retained payload and15s owned write deadline. No retry,
late deletion or persistent clipboard text/history. Host adapter promises cannot
be forcibly cancelled: cancellation/deadline releases library retention and
reports external write unconfirmed, which may still complete externally.

The gesture/API requires an exact owned host DOM/model selection and active
host ownership; a host control/another mount's range is left alone. ReadOnly copy
is allowed; cut requires both UI editable mode and native edit access. Native
read_only cut refuses dom.native_read_only; UI readOnly cut with native editable
refuses dom.mode_blocked. Provisional/composing/busy/disabled
refuses. Capture current stamp/context/intent before pure native projection. For
cut query full command17 admission before the external write, retaining original
native unavailable response. A semantic empty range returns empty/not_attempted;
an atom-only nonempty selection still writes empty text and deletes the atom.

An owned trusted copy/cut event is prevented synchronously; DataTransfer payload
may be populated for observations but never counted as OS ACK. Confirmed write
means the platform writer resolved; installed OS readback remains a distinct
mandatory evidence lane after this fixture's own write. Then recheck identical
stamp/context/intent/ownership before exactly one isolated delete. Never map or
reinstall an old destructive selection to make cut succeed. External clipboard
write and native document edit are separate effects.

Outcome table: copied = confirmed write/no delete; cut = confirmed write and
actual successful native changed ticket; empty = no write/command; refused =
pre-write failure; write_failed = unconfirmed write and no native dispatch;
copied_but_not_cut = confirmed external write plus stale ownership or actual
native refusal/no-op, document not changed by this cut; indeterminate = actual
native fatal/unknown (preserve may_have_committed and original ticket). Actual
queued ticket is never revoked; wait its real completion once. Cancellation
before native dispatch cannot claim confirmed external write until observed.
onResult throws cannot rewrite outcome or skip cleanup; no host callback after
destroy. Native/read failures are preserved in explicit wrappers, not forged
native command failures. DOM diagnostic additions are exactly in public-api.ts.
Full HTML/paste/import/sanitization/multiformat pipeline remains47.

## Pointer, geometry and evidence

Accept independent `scroll-oracles.json` literal fixture/model/rawDOM role tables
and timing. Its proposal status is provenance; this paragraph accepts the exact
decisions. Copy pinned JetBrainsMono Regular2.211 unchanged as test-only asset
with its OFL1.1 notice. Exact font face must be loaded before geometry check;
font bytes/copyright/license are pinned, no system fallback/network font.

Viewport1024×768/zoom100; row24px/font16px; scrollport client x100/y80/w640/h240;
padding20/40 gives scrollHeight1596/max1356. Clipped ancestor x96/y100/w648/h180
uses overflow:clip and no extra scroll owner. No borders/margins/transforms/
smooth scroll; border-radius0, clip-path:none, mask:none. Nonrectangular clips
are outside the supported geometry contract and refuse explicitly. Actual
geometry/font/DPR/visualViewport is checked before input.
R16 scene_break, R24..31 quote→list; root57 children. Exact down R04:1/After→
R63:3/After and up R59:2/After→R00:0/After. Setup scroll only before gesture.
No wheel/scrollTop/scrollIntoView/endpoint injection during or after gesture.

One supported nearest vertical scroll owner plus viewport, at most32 clipping
ancestors; finite axis-aligned client geometry, no transforms or hidden zero-area
intersection. Unsupported geometry reports selection_geometry_unsupported and
cancels. Effective clip is viewport/visualViewport∩scrollport client∩all relevant
clipping ancestors. Use actual browser DOM hit testing/native visual selection,
bounded point projection to edge inset and same owned anchor; do not segment or
fabricate native semantic endpoints. Before an explicit edge-focus publication,
validate its actual collapsed caret is wholly visible. A naive half-pixel edge
hit can land on a partly clipped line: use at most8 bounded actual browser
hit/caret probes toward the visible interior, refusing missing/unsupported
geometry. Do not publish a clipped endpoint and repair it after release/cancel.
Raw in-progress UA observations retain their own provenance; stable/terminal
visibility is mandatory. One native publication per scheduled frame, bounded
scroll step at most24CSSpx per frame and no background RAF while idle.

Hold≤8s, observations100ms, visibility≤0.5CSSpx tolerance, terminal exact endpoint
and finite positive-height collapsed focus-caret rect fully inside effective clip.
All four edges matter.12 controlled cases =2 directions×2 clip modes×terminal
release/active release/active cancel. Active endings require two scroll advances
and directional scroll range remaining; dynamic validated stop position is a
stability baseline, not a preauthored intermediate semantic oracle. Invariant
anchor at every publication/sample and monotonic focus progress are required.
After release/cancel allow at most one passive settlement frame within100ms,
then5×100ms unchanged selection/all scroll owners and zero owned RAF/capture.
Cancel also on lost capture/blur/external owner/mode/provisional/replacement/
recovery/destroy. A synthetic pointercancel proves only controlled cancellation;
native focus-loss cancellation has separate provenance, never called physical
pointercancel. Installed real held release/focus return is mandatory both ways.

Same literal semantics in mounted Chromium/Firefox/WebKit; browser protocol
input is labelled automated. Installed actual Chrome/Safari EN/RU additionally
exercise selection keys, forward/reverse mouse selections, held gestures both
ways, active release, focus cancellation/return and clipboard OS readback.
No general desktop RPC; extend only guarded fresh fixture nonce/URL/title/mount
commands with fresh foreground ownership per physical transition, bounded
coordinates, one pointer owner, no replay after unknown delivery. Safari uses
bootstrap-only Apple Events; zero Apple Events after bootstrap/physical input.
Restore only owned input state and close only guarded fixture window.

Firefox experimental behavioral GAP is allowed by the original v1 contract only
as a measured unmet behavior/73 follow-up. Configured assertions are not weakened;
semantic data loss/offset/stale errors and setup/instrumentation failures remain
failures. Chrome/Safari acceptance is mandatory. Minimal host UX: named textbox,
native focus/navigation; polite persistent stale message EN “The selection
changed. Select the text again.” / RU “Выделение изменилось. Выберите текст снова.”
No per-caret live-region chatter. Static DOM/axe is not real assistive-technology
acceptance; full UI/localization/AT belongs66, CMS save/recovery69 is separate.

## Delivery

All nine mandatory local commands on exact committed SHA, native/compiled-WASM
literal comparisons, real packaged mounted tests and installed evidence with raw
traces/hashes. One prepared build-only CI, independent exact-SHA Grok review,
normal exact-head merge, one automatic postmerge build, durable archive/readback/
cleanup precede Done. No deploy/publish. Existing39 assertions and fixture bytes
remain; any later implementation correction keeps failed evidence qualified.
Rollback: revert40 PR; persisted KWDJ schema unchanged.41/42/44/45/46/47/50/65/
66/67/69/71/73/80 remain separate; no reopened38 campaign or inherited waiver.
