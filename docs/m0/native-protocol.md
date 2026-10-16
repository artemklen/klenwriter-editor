# OSR-58: native RU / EN input and accessibility protocol

Scope decision, 2026-10-16: RU and EN are the v1 input target. CJK IMEs are outside the acceptance matrix. Unicode preservation is still required; an unsupported input method must never justify corrupting stored text.

Accessibility scope decision, 2026-10-16: the owner deferred VoiceOver/screen-reader acceptance beyond v1. Do not enable VoiceOver for this run. Keyboard access, visible focus, semantic labels and AX/axe checks remain required. Screen-reader support is unverified, not passed.

Use the same fixture at `/?mode=single` and `/?mode=islands`. Record browser/version, OS/build, input source, source fingerprint, actual text and event trace. `Reset sample` changes the fixture; finish any OS composition before resetting or navigating. Do not put personal text into the trace.

1. With U.S. active, click the first paragraph and place a caret with actual navigation keys. Type `hello`, then undo. Select across paragraph boundaries with Shift/arrows, in both directions; repeat with mouse drag. Select All; copy into the labelled clipboard destination, cut, undo. Include the read-only card and nested paragraph; check scroll.
2. Activate existing RussianWin, confirm the selected OS input source, then type physical keys `g h b d t n`: expect `привет`. Switching and typing in one unobserved batch races the OS input source change; it is a test setup error if the first key arrives in the previous layout.
3. Return to U.S. and confirm it. Option+E starts a real dead-key composition. Capture provisional text/events, then E: expect exactly one `é`. Separately try Escape and blur; record what the OS commits instead of assuming either action cancels. Re-enter and finish the pending composition; check text and undo. A second paragraph boundary case is required before production acceptance.
4. Keyboard only: reach editor, every block, controls and exit; restore the caret after an explicit toolbar leave/return. Record Safari's current Tab policy; do not silently alter the user's keyboard-navigation preferences.
5. Browser Find for `Charlie`: verify visible match and navigation into the scrolled region. Native browser Find and an implementation's future search are different contracts.
6. Future screen-reader lane, DEFERRED beyond v1: find the named editor, read blocks and read-only card, enter editing, select and replace across a boundary, invoke a control and return. A future authorized run must record actual spoken output and usable operations. AX snapshots and axe are insufficient to mark this lane passed.

Export a trace before reset. Repeat an unexpected result from a clean fixture at least three times, retaining the first failure. Restore the original U.S. input source and any explicitly changed settings at the end. A blank/failed native lane is NOT_RUN, not PASS.

The prototype measures browser DOM topology only. There is no Rust session, transaction history, model commit counter or production reconciliation. Its empty WASM module proves only the CSP compilation allowance.

References: [Input Events Level 2](https://www.w3.org/TR/input-events-2/), [Selection API](https://www.w3.org/TR/selection-api/), [Playwright keyboard input](https://playwright.dev/docs/api/class-keyboard#keyboard-insert-text), [Playwright WebKit and Safari](https://playwright.dev/docs/browsers#webkit).
