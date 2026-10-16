# Native trace provenance

Captured 2026-10-16 with native macOS CUA key input. OS: macOS 27.0.1 build 26A434. Browser versions verified from app bundles: Safari 27.0.1, Chrome 155.0.8059.85 (UA intentionally reduces Chrome version). Existing sources: U.S., RussianWin. No CJK source added, no VoiceOver toggled.

Files contain only the public sample fixture and test keystrokes. `isTrusted` is useful supporting evidence but alone does not prove OS input: provenance is the native key route plus observed dead-key provisional text and composition sequence. Chrome's accessibility caret-placement helper landed at p2 start for the single-host test; that trace is not a p1-end boundary test.

- `chrome-single-ru-deadkey.json`, `chrome-islands-ru-deadkey.json`: successful real `é` composition then physical RussianWin `привет`; trace includes source fingerprint.

  Caveat from independent review, verified by root: Chrome's composition start/update/input are trusted but compositionend is untrusted in both traces. The cause is unknown. Text insertion was observed through native key input, but the complete event lifecycle must be rerun in a clean native environment before it can be an acceptance trace.
- `safari-single-ru.json`, `safari-islands-ru.json`: clean physical RussianWin input, after switching and confirming the input source.
- `safari-islands-ru-deadkey.json`: successful U.S. `é` composition after clean RU run.
- `safari-single-deadkey-escape-blur.json`: earliest exploratory single-host trace; commit works, Escape/blur do not show a universal cancel. Predates source fingerprint and precise DOM-path instrumentation, so treat it as exploratory, not exact-source acceptance. Duplicate retained under baseline for original run context.
- `safari-islands-contaminated-setup.json`: rejected as comparative evidence. Residual OS composition after navigating from the previous test contaminated selection/input. Kept to make the discarded result inspectable.

Native traces used the earlier 280px viewport. Final automated scroll evidence uses 180px. The source fingerprints differ honestly across these harness revisions. Only the final automated observation manifest covers the final source hashes. No real Firefox OS input or real screen-reader result is claimed.
