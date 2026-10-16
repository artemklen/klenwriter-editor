# ADR-001 — One editing host per document surface

Decision owner: primary architecture agent. Date: 2026-10-16.

**Choose a single `contenteditable` host for the v1 document surface.** Blocks remain separate model nodes and stable DOM nodes inside that host. Block menus, handles and toolbar controls do not require separate editing roots.

**Status: architecture choice recorded; OSR-58 and M0 are still in progress.** The DOM comparison is implemented and measured. Native Firefox input and several native input transitions remain unverified. Real screen-reader acceptance is deferred beyond v1 by the owner's 2026-10-16 decision; no support claim is made. This is not approval of a production renderer, Rust input reconciliation or a release.

## What was compared

The same three paragraphs, inline `strong` mark, Unicode text, read-only atomic card, nested paragraph, CSS and instrumentation. Single mode has one named multiline textbox; islands mode has three named multiline textboxes. Both expose explicit `tabindex=0` on actual editing hosts. No selection overlays, custom keyboard navigation, custom history, renderer patches or editor library favor either candidate.

The final scroll viewport is 180px so the nested paragraph really requires scrolling. The earlier 280px fixture exercised nested selection but did not force scrolling; it is not counted as autoscroll evidence. Native RU/EN traces were captured with that earlier viewport and do not prove scroll behavior.

This spike isolates browser topology. The eventual authoritative state is still a generic Rust document/session with transactions; KWDJ remains a separate profile. Building a Rust kernel here would not answer whether the browser can select across independent editing hosts. The empty eight-byte WASM module checks only compilation under the representative CSP.

## Automated observations

Local platform: macOS 27.0.1 (26A434), arm64, Node 26.12.0. Playwright 1.64.1: Chromium 156.0.8078.4, Firefox 157.0, WebKit 27.2. Headless, one worker to avoid clipboard races. Lockfile and source hashes accompany the evidence.

Final run: **78 harness cases completed with no harness/assertion failures**. Of the 42 explicitly evaluated document-level comparison observations: **24 MET, 18 GAP**. Another 36 are observations, fixture checks or instrumentation controls. A green harness case can deliberately record a missing behavior; it does not mean the editor requirement passed.

All three engines produced the same comparison below:

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

Typing and native undo retained sample text and the bold mark in all six combinations. Unicode insertion preserved the fixture text, but `insertText` is **not OS IME**. Synthetic composition events only checked instrumentation; they did not insert characters through an input method.

Clipboard fidelity is a separate result: WebKit's native copy/paste changed the fixture's decomposed `e` + U+0301 into U+00E9 in both modes. The MET result above means document scope and cut/undo restoration, **not code-point-preserving clipboard serialization**. The production clipboard adapter needs an explicit format/normalization contract and regression vectors; native clipboard output cannot be treated as the canonical document representation.

The final clipboard test seeds a unique marker into the initial p2 DOM fixture before any user edit/history, asserts that this marker reaches the independent destination, compares exact and NFC-equivalent text separately, verifies a real cut effect and only then verifies undo. This closes the stale-clipboard/no-op-cut false-positive risk found in independent review. NFC comparison is a test classification, not permission for the core to normalize text silently.

An intermediate setup typed the marker through the keyboard before cut; WebKit's following Undo also removed that previously typed marker. That [exploratory trace](../../evidence/osr-58/baseline/typed-marker-cut-undo.json) is preserved. The final fixture isolates cut/undo from prior typing history; the difference reinforces why production owns transaction/history grouping rather than inheriting browser behavior.

Accessible structure: axe 4.14.0 reports no violations in the final fixture in all six combinations. AX snapshots expose one document textbox versus three paragraph textboxes. This is structural evidence, **not a VoiceOver/NVDA pass**. Initial axe runs flagged the single-host scroll region; explicit tabindex on each editing host resolved it. The first failing run is preserved instead of being omitted.

Tab topology differs: single enters one editor stop, islands three. WebKit's current macOS Tab policy skips buttons. A Tab-out/Shift-Tab-back probe reset the single-host caret in WebKit and the islands caret in all three engines; explicit `focus()` out/back retained it in this fixture. These are different operations. Production must maintain a model selection bookmark for toolbar/dialog return, not infer it from an incidental native focus result.

## Native OS input observations

| Browser | RU physical keys → `привет` | U.S. Option+E, E → `é` | Real AT |
| --- | --- | --- | --- |
| Installed Chrome 155.0.8059.85 | Observed in both modes | Native provisional/committed text observed; end-event trust caveat below | NOT_RUN |
| Installed Safari 27.0.1 | Observed in both modes | Real composition observed in both modes | NOT_RUN |
| Firefox 157.0, Playwright build, native UI attempt | NOT_RUN: profile creation failed | NOT_RUN | NOT_RUN |

Firefox native startup returned `NS_ERROR_FILE_ACCESS_DENIED` while creating a profile; subsequent native accessibility calls timed out. The process started for this test was terminated. The automated Firefox results remain valid, but do not fill this native lane. No Japanese IME was installed; no VoiceOver setting was changed. The user's revised v1 input target is RU & EN. CJK can be added later with its own proof, rather than being implicitly supported today.

In both Chrome traces, `compositionstart`, `compositionupdate` and input events were trusted, but `compositionend` was **untrusted**. Root re-read confirmed this after independent review. Its cause has not been isolated; neither the recorder nor this observation proves a fully native event lifecycle. Retain the text-insertion observation, but repeat this lane in a clean native environment before accepting composition-end ordering or exactly-once reconciliation. Do not silently discard the anomalous event or attribute it to Chrome itself without a differentiating test.

Safari dead-key Escape/blur exploration produced spacing accents and, in one trace, a still-open composition flag after blur. Escape was not a universal text-removing cancel. This is one exploratory trace, not a fully repeated transition suite. It identifies a required follow-up; it does not prove a production exactly-once algorithm.

One islands run was contaminated by residual native composition after navigation, and a rapid language-switch batch initially delivered its first key in the old layout. These are retained as test setup failures. Clean RU runs followed explicit confirmation of the selected input source. The contaminated run must not be used to rank the editing topologies.

## Why choose this approach

The product presents a continuous document. The measured native primitives match that behavior under a single host. Independent editing fields would require our own cross-host selection, Select All, clipboard scopes, cut/undo coordination, focus traversal and AT semantics. These features can be built; the prototype does not prove islands impossible. It proves they are absent from the native baseline and therefore become our implementation burden.

The attraction of islands is local browser mutation scope: one editable paragraph is easier to inspect in isolation, and block-specific forms can be natural. For this editor, that advantage does not compensate for taking ownership of continuous document selection before the kernel and renderer exist. We retain islands for genuinely independent form controls outside the document's continuous selection domain.

## Boundaries established now

1. Exactly one editing root per continuous document surface. Tables and nested blocks must participate in the same selection model; table-specific interaction still needs its own proof.
2. Rust owns committed document state, validation, transactions and history. Browser DOM is a temporary input/rendering representation. Native undo in this spike is evidence about baseline browser behavior, not the production history design.
3. TS maps DOM selection to stable model positions, reconciles bounded changed regions and preserves node identity. It must never replace the whole editing root per keystroke.
4. During native composition, the active range remains browser-owned. Do not remount, normalize or reformat it. Reconcile committed text exactly once. **Blur/Escape are observations, not proof of cancellation.** An unresolved transition preserves available original/provisional text and rejects destructive remounts.
5. Toolbar/dialog return uses explicit selection bookmarks and epochs. Keyboard access, visible focus, semantic labels and machine-checkable accessibility remain required in v1. Real VoiceOver/screen-reader acceptance is deferred beyond v1 by the owner; future support needs an explicit interaction contract and actual assistive-technology testing, not only axe/AX.
6. No virtualization that unmounts offscreen text until native selection, browser Find, composition, scroll and AT are measured with it. The full-DOM baseline remains.
7. v1 support target is desktop Chromium, Firefox and Safari with RU/EN input. No mobile, collaboration, CJK guarantee or arbitrary nested third-party editing roots. The document still stores valid Unicode; this boundary is a tested input promise, not a text encoding restriction.

## Evolution and libraries

The editing-root decision belongs to the browser adapter, not the Rust document schema, command API or KWDJ codec. Independent profiles, declarative nodes and trusted Rust semantic extensions can grow without changing the editing topology. A future mobile/CJK adapter, virtualization strategy or collaborative session needs new contracts and evidence; none is made free by WASM.

Runtime dependencies in this spike: **none**. Browser APIs expose the behavior we need to measure, without an editor library implementing missing behavior behind the comparison. No Tiptap, ProseMirror, React, Angular or Rust core is bundled here.

Development dependencies: **Playwright** supplies repeatable three-engine input, traces and screenshots; without it this matrix is manual and more difficult to reproduce. **axe-core via @axe-core/playwright** catches machine-detectable accessibility defects; without it these checks need separate tooling/manual review. Neither replaces OS input or assistive technology. Production Rust dependency choices remain in the main architecture document and are not validated by this spike.

## Remaining M0 gates

- Native Firefox RU/EN/dead-key lane on a usable profile.
- Clean, repeated dead-key Escape/blur/refocus and selection-replacement transitions in both modes across the three native browsers.
- Real screen-reader smoke is **DEFERRED beyond v1 by owner decision**, not a remaining M0 gate and not a passed check. AX/axe evidence remains in scope; it does not establish screen-reader support.
- Native browser Find; mouse autoscroll across atom/nested content. The measured autoscroll above is keyboard selection.
- Paste replacing a cross-block selection, Enter/Backspace structural boundaries, and subsequent model reconciliation: not implemented/measured here.
- Independent review and matching CI at the candidate SHA. Production renderer acceptance stays behind OSR-58; this ADR does not close that gate.

## Evidence

- [Automated observations with source hashes](../../evidence/osr-58/automated/observations.json)
- [Served source fingerprint and CSP](../../evidence/osr-58/source-manifest.json)
- [Native traces and their provenance](../../evidence/osr-58/native/README.md)
- [Initial failing harness run](../../evidence/osr-58/baseline/initial-run-summary.json)
- [Native protocol](native-protocol.md)

Sources used to interpret limits: [Selection API](https://www.w3.org/TR/selection-api/), [Input Events Level 2](https://www.w3.org/TR/input-events-2/), [Playwright browser distinctions](https://playwright.dev/docs/browsers#webkit), [Playwright input insertion](https://playwright.dev/docs/api/class-keyboard#keyboard-insert-text). The choice above follows our measurements, not a claim that the standards guarantee identical browser behavior.
