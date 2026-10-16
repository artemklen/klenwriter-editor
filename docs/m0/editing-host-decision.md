# ADR-001 — One editing host per document surface

Decision owner: primary architecture agent. Updated: 2026-10-17 (Europe/Moscow).

**Choose a single `contenteditable` host for the v1 document surface.** Blocks remain separate model nodes and stable DOM nodes inside that host. Block menus, handles and toolbar controls do not require separate editing roots.

**Status: comparison and architecture decision complete; implementation remains gated separately.** OSR-58 records both successful primitives and missing behavior, including mouse autoscroll. This is a DOM-only spike, not acceptance of a production renderer, Rust reconciliation or release. M0 still contains extension/Unicode contracts, performance protocol, CMS inventory and architecture acceptance. Review and matching CI are recorded in the PR/Linear closeout. Real screen-reader acceptance remains deferred beyond v1 by the owner; no support claim is made.

## What was compared

The same three paragraphs, inline `strong` mark, Unicode text, read-only atomic card, nested paragraph, CSS and instrumentation. Single mode has one named multiline textbox; islands mode has three named multiline textboxes. Both expose explicit `tabindex=0` on actual editing hosts. No selection overlays, custom keyboard navigation, custom history, renderer patches or editor library favor either candidate.

The final scroll viewport is 180px so the nested paragraph really requires scrolling. The earlier 280px fixture exercised nested selection but did not force scrolling; it is not counted as autoscroll evidence. Native RU/EN traces were captured with that earlier viewport and do not prove scroll behavior.

This spike isolates browser topology. The eventual authoritative state is still a generic Rust document/session with transactions; KWDJ remains a separate profile. Building a Rust kernel here would not answer whether the browser can select across independent editing hosts. The empty eight-byte WASM module checks only compilation under the representative CSP.

## Automated observations

Local platform: macOS 27.0.1 (26A434), arm64, Node 26.12.0. Playwright 1.64.1: Chromium 156.0.8078.4, Firefox 157.0, WebKit 27.2. Headless, one worker to avoid clipboard races. Lockfile and source hashes accompany the evidence.

Expanded run: **102 harness cases** (17 scenarios × 2 modes × 3 engines): **28 MET, 26 GAP, 48 OBSERVATION**, zero harness failures. Exact counts and any harness failures are in the [machine-readable result](../../evidence/osr-58/automated/observations.json). MET/GAP evaluates a particular baseline requirement; OBSERVATION covers probes without a product pass predicate. A successful harness can record a missing behavior. The original 78-case run is historical evidence, not the current matrix.

All three engines agree on the original document-topology comparison below:

| Requirement | Single host | Per-block fields |
| --- | --- | --- |
| Shift+Right across paragraph boundary | MET | GAP: stays in current field |
| Shift+Left across paragraph boundary | MET | GAP: stays in current field |
| Mouse drag p1 → p2 | MET | GAP: selection clipped to p1 |
| Select All from p2 selects entire document, excludes page controls | MET | GAP: selects p2 only |
| Selection through atom into nested p3, with actual scroll | MET | GAP: stays in current field |
| Native Copy → separate textarea, Cut → Undo at document scope | MET | GAP: clipboard contains p2 only; local cut/undo itself works |
| Explicit focus of external button → same editing host → type | MET | MET |

Single-host nested-selection scroll offsets were 128px / 54px / 127px in Chromium / Firefox / WebKit. Different offsets are not an error: the required outcome is selection visibility and correct endpoints.

Typing retained the original text and bold mark. Native Undo grouping is not deterministic enough to define the product contract: the first expanded Chromium run removed only the last character of ` test` in one Undo, while three unchanged targeted repeats restored the whole insertion. The first failure is retained; the cause of the grouping difference remains unknown. The final probe records one-Undo restoration separately and checks that Undo removes only a suffix of the inserted text, preserving original text, marks and other blocks. Unicode insertion preserved the fixture text, but `insertText` is **not OS IME**. Synthetic composition events only checked instrumentation; they did not insert characters through an input method.

Clipboard fidelity is a separate result: WebKit's native copy/paste changed the fixture's decomposed `e` + U+0301 into U+00E9 in both modes. The MET result above means document scope and cut/undo restoration, **not code-point-preserving clipboard serialization**. The production clipboard adapter needs an explicit format/normalization contract and regression vectors; native clipboard output cannot be treated as the canonical document representation.

The final clipboard test seeds a unique marker into the initial p2 DOM fixture before any user edit/history, asserts that this marker reaches the independent destination, compares exact and NFC-equivalent text separately, verifies a real cut effect and only then verifies undo. This closes the stale-clipboard/no-op-cut false-positive risk found in independent review. NFC comparison is a test classification, not permission for the core to normalize text silently.

An intermediate setup typed the marker through the keyboard before cut; WebKit's following Undo also removed that previously typed marker. That [exploratory trace](../../evidence/osr-58/baseline/typed-marker-cut-undo.json) is preserved. The final fixture isolates cut/undo from prior typing history; the difference reinforces why production owns transaction/history grouping rather than inheriting browser behavior.

Accessible structure: axe 4.14.0 reports no violations in the final fixture in all six combinations. AX snapshots expose one document textbox versus three paragraph textboxes. This is structural evidence, **not a VoiceOver/NVDA pass**. Initial axe runs flagged the single-host scroll region; explicit tabindex on each editing host resolved it. The first failing run is preserved instead of being omitted.

Tab topology differs: single enters one editor stop, islands three. WebKit's current macOS Tab policy skips buttons. A Tab-out/Shift-Tab-back probe reset the single-host caret in WebKit and the islands caret in all three engines; explicit `focus()` out/back retained it in this fixture. These are different operations. Production must maintain a model selection bookmark for toolbar/dialog return, not infer it from an incidental native focus result.

## Expanded boundary and autoscroll observations

- Fresh clipboard marker pasted over an actual cross-block Range: single host MET in all three engines; islands GAP because selection cannot span the boundary. Exact replacement and subsequent Undo are checked independently of clipboard freshness.
- Enter at the end of p1, then Backspace to rejoin: Chromium/WebKit temporarily duplicate `id=p1` when splitting the native paragraph. Firefox does not duplicate it in this fixture. All restore the initial HTML after joining. Native DOM IDs are therefore not authoritative model IDs: the adapter must allocate/validate identity when reconciling structural edits.
- Mouse held outside the lower viewport until the complete caret is visible, or 20 polls at 100ms (actual held duration is recorded): Playwright WebKit single-host MET; Chromium single-host GAP because the caret is clipped at the top despite reaching p3; Firefox single-host GAP because selection stops on the atomic card instead of p3. Full visibility requires the complete caret rectangle inside the client viewport, excluding borders/scrollbars, with zero tolerance. The earlier intersection-only oracle stopped too early and incorrectly classified Chromium MET; intersection and full visibility are now recorded separately. All islands fail document-level selection. The trace records before/held/after geometry; scroll alone cannot count as success.
- Installed-browser CUA drag is a different, shorter gesture, without a controllable two-second hold. Chrome/Safari reach p3 but leave the endpoint below the viewport; Firefox stops at the card. Islands stay within p1 (Firefox's brief gesture ends collapsed). These are native limitations/observations, not a passing pointer-held test. Do not equate the WebKit result with installed Safari.

**Consequence:** OSR-40 owns explicit edge autoscroll and endpoint visibility, in both directions, across atoms/nesting, with pointer cancellation and focus return. OSR-39 owns bounded structural reconciliation and unique model/DOM identity. These are required for production acceptance; the spike does not implement them.

## Native OS input and Find observations

Environment: macOS 27.0.1 (26A434), existing U.S. and RussianWin sources. Installed Chrome 155.0.8059.85, Safari 27.0.1, official Mozilla-signed Firefox 158.0. [Version/signature/source diagnosis](firefox-launch-diagnosis.md) explains the earlier Firefox startup failure and Chrome trust bit. No Japanese input source or VoiceOver was enabled; U.S. was restored.

| Probe, both topologies | Chrome | Safari | Firefox |
| --- | --- | --- | --- |
| Physical RussianWin → `привет`, U.S. input | Observed (initial native lane) | Observed (initial native lane) | Observed in new lane |
| Option+E, E; Escape then x; blur then refocus/reposition + e | Three clean sessions | Three clean sessions | Three clean sessions |
| Select `omega.`, compose é, Undo | Replacement once; original text restored | Replacement once; original text restored | Replacement once; original text restored |
| Native Find `Charlie`, navigate to nested p3 | One match, visible endpoint | One match, visible endpoint | One match, visible endpoint |
| Real screen reader | Deferred beyond v1 | Deferred beyond v1 | Deferred beyond v1 |

The 18 designated composition sessions each finish with `Alpha bold omega.é ´x ´e`: committed é, spacing accent after Escape, spacing accent after blur, then a separate e. This is a sequence of observed native DOM edits, **not a Rust exactly-once commit test**. Refocus includes explicit caret repositioning; it does not prove automatic caret recovery. The six replacement probes cover an intra-paragraph selection; production composition across a paragraph/atom boundary remains an OSR-41 acceptance vector.

Chrome repeats used a separate Incognito window. `compositionend.trusted` remains false while start/update/input are trusted. Inspection of the exact Chromium version shows a scoped dispatch path that does not set the trust bit; see the linked diagnosis and raw values. This corroborates the result and avoids mistaking `false` for proof of synthetic input. It is not runtime debugging of the installed binary. Production must not drop a valid composition end solely on that bit.

Safari can report an empty `compositionend.data` after blur even though the spacing accent remains in the DOM. Thus neither end-event data, Escape nor blur alone decides whether text was cancelled. The adapter snapshots original/provisional text and model range, reads the bounded final DOM delta, and reconciles it once using a session/revision token. Trailing input must not create a second transaction; a genuinely cancelled unchanged range creates none. Conflict/destroy policies preserve recoverable text and refuse destructive remounts.

Exploratory Safari fast batches missed characters or duplicated an accent. They are retained, not counted as clean comparative runs; their individual cause is unproven. Three fresh checkpointed islands repeats agreed. A later inactive Safari-window attempt could edit some text but did not perform application shortcuts reliably; ordinary activation via Finder restored Find and composition. The rejected attempt is not evidence of a browser input defect. Each accepted native run has a fresh fixture and trace provenance. Clicking Download itself blurs the editor before the final snapshot; intermediate phases require the checkpoints/events captured before export. The native `endpointVisible` flag means vertical intersection, not full-caret visibility; inspect raw geometry and screenshots.

Find uses `native=1`: diagnostic copies of document text are hidden, preventing false extra matches. After opening Find with a reused query, activate the match (Return) before taking the screenshot/export. An earlier Safari single export without that step has no selected match and remains exploratory.

## Browser support decision

**v1 required: desktop Chrome and Safari, RU/EN input. Firefox: experimental compatibility, outside the v1 support promise.** This supersedes the initial three-browser promise with the owner's authorization to prioritize Chrome/Safari. Firefox remains in the same three-engine measurement harness; honest GAP observations remain visible and must not be converted to success. A broken collector is still a CI failure, while experimental product gaps do not by themselves block v1 release.

The launch problem alone was not a reason to exclude Firefox: the official signed app works, and RU/EN/Find/composition were exercised. The complete matrix then exposed an additional Gecko selection/atomic-boundary path, beyond the shared need for explicit edge autoscroll. Deferring its support reduces the mandatory first-release validation/remediation scope. It does not remove Chrome/Safari autoscroll work or claim Firefox is unusable. Promote Firefox only after an installed-browser acceptance run of the production adapter, including atoms, both drag directions, viewport-edge hold, correct visible endpoint, Find, RU/EN composition, clipboard/history and focus; no browser-name hacks belong in the Rust core.

## Why choose this approach

The product presents a continuous document. The measured native primitives match that behavior under a single host. Independent editing fields would require our own cross-host selection, Select All, clipboard scopes, cut/undo coordination, focus traversal and AT semantics. These features can be built; the prototype does not prove islands impossible. It proves they are absent from the native baseline and therefore become our implementation burden.

The attraction of islands is local browser mutation scope: one editable paragraph is easier to inspect in isolation, and block-specific forms can be natural. For this editor, that advantage does not compensate for taking ownership of continuous document selection before the kernel and renderer exist. We retain islands for genuinely independent form controls outside the document's continuous selection domain.

## Boundaries established now

1. Exactly one editing root per continuous document surface. Tables and nested blocks must participate in the same selection model; table-specific interaction still needs its own proof.
2. Rust owns committed document state, validation, transactions and history. Browser DOM is a temporary input/rendering representation. Native undo in this spike is evidence about baseline browser behavior, not the production history design.
3. TS maps DOM selection to stable model positions, reconciles bounded changed regions and preserves node identity. It must never replace the whole editing root per keystroke.
4. During native composition, the active range remains browser-owned. Do not remount, normalize or reformat it. Reconcile committed text exactly once. **Blur/Escape are observations, not proof of cancellation.** An unresolved transition preserves available original/provisional text and rejects destructive remounts.
5. Toolbar/dialog return uses explicit selection bookmarks and epochs. Keyboard access, visible focus, semantic labels and machine-checkable accessibility remain required in v1. Real VoiceOver/screen-reader acceptance is deferred beyond v1 by the owner; future support needs an explicit interaction contract and actual assistive-technology testing, not only axe/AX.
6. No virtualization that unmounts offscreen text until native selection, browser Find, composition, scroll, keyboard/focus, semantics and axe are measured with it. The full-DOM baseline remains. Screen-reader behavior remains unverified and needs future real AT acceptance before support can be claimed; it does not block v1.
7. v1 support target is desktop Chrome and Safari with RU/EN input; Firefox is experimental until its separate acceptance gate. No mobile, collaboration, CJK guarantee or arbitrary nested third-party editing roots. The document still stores valid Unicode; this boundary is a tested input promise, not a text encoding restriction.

## Evolution and libraries

The editing-root decision belongs to the browser adapter, not the Rust document schema, command API or KWDJ codec. Independent profiles, declarative nodes and trusted Rust semantic extensions can grow without changing the editing topology. A future mobile/CJK adapter, virtualization strategy or collaborative session needs new contracts and evidence; none is made free by WASM.

Runtime dependencies in this spike: **none**. Browser APIs expose the behavior we need to measure, without an editor library implementing missing behavior behind the comparison. No Tiptap, ProseMirror, React, Angular or Rust core is bundled here.

Development dependencies: **Playwright** supplies repeatable three-engine input, traces and screenshots; without it this matrix is manual and more difficult to reproduce. **axe-core via @axe-core/playwright** catches machine-detectable accessibility defects; without it these checks need separate tooling/manual review. Neither replaces OS input or assistive technology. Production Rust dependency choices remain in the main architecture document and are not validated by this spike.

## Follow-through and remaining gates

OSR-58 answers the topology question with versioned evidence, including failures. It does not require implementing a production editor to finish a feasibility comparison.

- OSR-39: bounded DOM reconciliation, stable identity and split/join validation, no whole-root remount.
- OSR-40: model selection mapping/bookmarks, explicit edge scroll, visible endpoint, atomic/nested boundaries.
- OSR-41: exactly-once model commits, native event ordering/deduplication, Escape/blur/replacement including cross-block vectors.
- OSR-47: clipboard format and normalization contract; arbitrary DOM is not canonical data.
- OSR-45/OSR-71: Chrome/Safari release acceptance; three-engine observation harness; [Firefox promotion OSR-73](https://linear.app/klenwriter/issue/OSR-73) separately.
- OSR-56/OSR-26 and the other M0 contract/performance/inventory/license tasks remain open. Real screen readers are deferred beyond v1, not a hidden remaining M0 gate.

## Evidence

- [Automated observations with source hashes](../../evidence/osr-58/automated/observations.json)
- [Served source fingerprint and CSP](../../evidence/osr-58/source-manifest.json)
- [Native continuation: operator matrix, 45 raw exports and Find screenshots](../../evidence/osr-58/native/continuation/README.md)
- [Initial native traces and provenance](../../evidence/osr-58/native/README.md)
- [First expanded Undo failure](../../evidence/osr-58/automated/initial-failure/README.md)
- [Initial failing harness run](../../evidence/osr-58/baseline/initial-run-summary.json)
- [Native protocol](native-protocol.md)

Sources used to interpret limits: [Selection API](https://www.w3.org/TR/selection-api/), [Input Events Level 2](https://www.w3.org/TR/input-events-2/), [Playwright browser distinctions](https://playwright.dev/docs/browsers#webkit), [Playwright input insertion](https://playwright.dev/docs/api/class-keyboard#keyboard-insert-text). The choice above follows our measurements, not a claim that the standards guarantee identical browser behavior.
