# Native continuation evidence

Captured by the primary operator on macOS 27.0.1 (26A434), using installed Chrome 155.0.8059.85, Safari 27.0.1 and official Mozilla-signed Firefox 158.0. The captured interval crosses midnight in Europe/Moscow on 2026-10-16–17; raw timestamps use UTC. Browser version and Firefox launch diagnosis are in [the diagnosis note](../../../../docs/m0/firefox-launch-diagnosis.md).

This directory preserves **45 raw JSON exports**, byte-for-byte, from filenames with timestamps at least `1792183000000`; the last imported timestamp is `1792185005722`. [index.json](index.json) contains each file's SHA-256, source fingerprint, session times, event counts, final p1 text, composition ends, selection and geometry. Earlier native exports remain in the parent directory. The machine index records observations and does not assign PASS from a category name.

The 18 clean composition runs below were explicitly selected by the primary operator. Other categories were inferred from events and then checked against the operator's protocol and screenshots. A shared event count or sequence is not evidence of duplicate runs: the clean runs have distinct `startedAt` values and event-relative timings, and each records the original fixture before editing.

## Provenance matrix

| Evidence class | Raw exports | What it establishes |
| --- | ---: | --- |
| Clean composition | 18 | Three independent runs for each browser/mode pair: dead-key commit, Escape transition and blur/refocus transition |
| Accepted native Find | 6 | One browser/mode result, corroborated by native Find UI screenshot, matching p3 selection and viewport geometry |
| Selection replacement + Undo | 6 | One browser/mode trace of selected text replacement by dead-key composition, followed by native Undo |
| RU/EN | 2 | Firefox single/islands physical RussianWin input followed by English input; existing Chrome/Safari RU evidence remains in the parent directory |
| Brief drag observations | 7 | Captured selection/scroll outcomes, with the limitations below; no pointer-held autoscroll acceptance inferred |
| Exploratory/setup | 6 | Earlier composition/setup attempts and one empty snapshot, retained outside the clean set |

## Clean composition runs

Link labels below are timestamp suffixes; the original filenames retain their full `179218…` timestamps.

| Browser | Mode | Three independent raw runs |
| --- | --- | --- |
| Firefox 158 | Single | [3787499](osr-58-single-1792183787499.json), [3824535](osr-58-single-1792183824535.json), [3827129](osr-58-single-1792183827129.json) |
| Firefox 158 | Islands | [4053771](osr-58-islands-1792184053771.json), [4056641](osr-58-islands-1792184056641.json), [4059249](osr-58-islands-1792184059249.json) |
| Safari 27.0.1 | Single | [3935227](osr-58-single-1792183935227.json), [3950585](osr-58-single-1792183950585.json), [3952267](osr-58-single-1792183952267.json) |
| Safari 27.0.1 | Islands | [4010137](osr-58-islands-1792184010137.json), [4030695](osr-58-islands-1792184030695.json), [4035416](osr-58-islands-1792184035416.json) |
| Chrome 155 | Single | [4402629](osr-58-single-1792184402629.json), [4413083](osr-58-single-1792184413083.json), [4423064](osr-58-single-1792184423064.json) |
| Chrome 155 | Islands | [4329770](osr-58-islands-1792184329770.json), [4368559](osr-58-islands-1792184368559.json), [4381217](osr-58-islands-1792184381217.json) |

All 18 captured final p1 texts are `Alpha bold omega.é ´x ´e`, with three composition starts/ends and `composing=false` at export. Escape leaves a spacing accent in this protocol; it does not universally cancel by removing text. Firefox's end data are `é`, `´`, `´`, with trusted ends. Safari's end data are `é`, `´`, empty string, also trusted, while its DOM retains the accent. Chrome's ends carry `é`, `´`, `´` with `trusted=false`; the raw value is preserved and [the exact-version source inspection](../../../../docs/m0/firefox-launch-diagnosis.md#chrome-155-why-native-composition-can-end-with-istrustedfalse) describes its limits. Equal final text does not imply identical event ordering or a proven production reconciliation algorithm.

**Capture boundary:** clicking Download moves focus and can commit/finish composition before the exported final snapshot. Treat the events and the operator's intermediate AX/UI checkpoints as phase evidence. The final exported `composing=false`, active element and selection are not assertions about the state immediately before the Download click. In Safari's clean runs the final focus rectangle is unavailable; index geometry is `null`, not a fabricated failure or success.

## Accepted native Find

The native browser Find UI searched `Charlie`. The six accepted captures show one match in nested p3, scroll movement to the match, and the selected match in the editor. Diagnostic text copies were hidden with `native=1`, so these results do not count a duplicate occurrence in the recorder panel.

| Browser / mode | Raw export | Screenshot | Final viewport scrollTop |
| --- | --- | --- | ---: |
| Chrome / single | [4453701](osr-58-single-1792184453701.json) | [Find](screenshots/osr58-chrome-single-find.jpg) | 128 |
| Chrome / islands | [4477112](osr-58-islands-1792184477112.json) | [Find](screenshots/osr58-chrome-islands-find.jpg) | 128 |
| Firefox / single | [4518593](osr-58-single-1792184518593.json) | [Find](screenshots/osr58-firefox-single-find.jpg) | 128.75 |
| Firefox / islands | [4505414](osr-58-islands-1792184505414.json) | [Find](screenshots/osr58-firefox-islands-find.jpg) | 128.75 |
| Safari / single | [4892985](osr-58-single-1792184892985.json) | [Find](screenshots/osr58-safari-single-find.jpg) | 128 |
| Safari / islands | [4843107](osr-58-islands-1792184843107.json) | [Find](screenshots/osr58-safari-islands-find.jpg) | 128 |

Each raw selection is `Charlie`, with p3 endpoints 0→7. Page events do not themselves record the browser's Find field; the screenshots provide that independent UI evidence. In the machine index, `endpointVisible` means **any vertical intersection** of the focus rectangle with the viewport plus its x coordinate inside the viewport, not a guarantee that the whole caret is visible. Find acceptance here is based on the actual rectangle and screenshot checks, not that boolean alone. Resized screenshots are presentation evidence; CSS-pixel geometry comes from the JSON.

## Replacement, RU/EN and exploratory traces

| Browser | Single replacement + Undo | Islands replacement + Undo | Final selection after Undo |
| --- | --- | --- | --- |
| Firefox | [4761090](osr-58-single-1792184761090.json) | [4752965](osr-58-islands-1792184752965.json) | Collapsed |
| Safari | [4865788](osr-58-single-1792184865788.json) | [4872965](osr-58-islands-1792184872965.json) | `omega.` |
| Chrome | [4941020](osr-58-single-1792184941020.json) | [4929637](osr-58-islands-1792184929637.json) | `o` |

These six traces restore the sample document text after Undo. Their different selection outcomes remain evidence; text restoration is not selection-bookmark restoration. Firefox RU/EN runs are [single 4724955](osr-58-single-1792184724955.json) and [islands 4733730](osr-58-islands-1792184733730.json), with final p1 `Alpha bold omega.привет hello`.

Exploratory exports are Safari single [3841876](osr-58-single-1792183841876.json), [3932372](osr-58-single-1792183932372.json), islands [3958239](osr-58-islands-1792183958239.json), [3959940](osr-58-islands-1792183959940.json), [3961654](osr-58-islands-1792183961654.json), and single [4862809](osr-58-single-1792184862809.json). The first two share a session start and record different points in that session; neither is counted as an independent clean repetition. The three islands setup attempts have differing composition outcomes, and the last single export has no recorded events. They are retained, not silently promoted into the clean set.

## Brief drag limits

The seven inferred drag exports are Firefox single [4658231](osr-58-single-1792184658231.json), [4705035](osr-58-single-1792184705035.json), islands [5005722](osr-58-islands-1792185005722.json); Safari single [4916823](osr-58-single-1792184916823.json), islands [4925966](osr-58-islands-1792184925966.json); Chrome single [4971810](osr-58-single-1792184971810.json), islands [4983201](osr-58-islands-1792184983201.json).

Chrome/Safari single-host captures reach p3 but retain scrollTop 0 and an offscreen focus endpoint. Their islands captures stay in p1. Firefox captures show partial movement/scroll, including one collapsed selection. These snapshots do not prove sustained pointer-held autoscroll: the page recorder does not record mouse-button holding duration, and a final scroll offset alone is insufficient. The separate automated held-pointer protocol has its own oracle and results; no outcome from that protocol is inferred here.

## Artifact integrity and image processing

The six Find images were independently inspected for the native query, match, mode and unrelated UI. They contain only the test page/browser controls; no unrelated document or personal browsing content was visible. Chrome/Safari source screenshots had a large white padded canvas. Their presentation copies crop the upper-left browser area (offset 1,1 because `sips` treated zero offsets as centered), then resize in a separate command. Firefox copies are resized without cropping. [screenshots/manifest.json](screenshots/manifest.json) records input/output hashes, dimensions and transformations. No text or result was painted into the images.

The [first expanded automated failure](../../automated/initial-failure/README.md) is preserved separately, including its original trace, screenshot, error context, source hashes and the subsequent three-repeat log. It is not erased by later successful runs.
