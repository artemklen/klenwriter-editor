# Installed desktop acceptance protocol — source-authored

Run installed Chrome and Safari, each EN and RU, on one exact final source/tree,
source build identity and sealed local WASM hash after appropriate local checks.
Record actual browser/macOS versions, locale/input-source, fixture URL, guarded
foreground input, command traces, native canonical/selection/counter readbacks,
focus trace, screenshot and final resources. Playwright WebKit is not Safari;
controlled DOM dispatch is not physical input; ordinary RU keys are not IME.
No stopped OSR-38 campaign, profiling ladder or host diagnostic is involved.

Finite scenarios per browser/locale:
1. Tab from preceding host button into named toolbar; arrows/Home/End, Tab to
document and ShiftTab back. Visible focus, no trap, proper roving stop/labels.
2. Select ab/cd mixed range, keyboard Strong, one native command, exact V01
canonical/direction, document focus; pointer variant on fresh independent input.
3. Add Paragraph at captured explicit root gap, keyboard accept and fresh pointer
variant: V03 literal, one undo unit; no hidden selection write before command.
4. Move selected B up/down with menu and local shortcut, exact V04 order/IDs and
undo/redo. Refused Nest exposes reason. Keep initiating control/text focus.
5. Host-owned title dialog Cancel/Escape restores exact range; reopen, change
document via explicit host action then late accept refuses and current bytes
stay exact. Named modal/trap only actual modal. Repeated completion no action.
6. While actual browser native composition/dead-key window is unresolved attempt
format/move/Add/dialog with a distinct gesture; input/provisional subtree/focus
survive, no action replay after settlement. A missed OS composition window is
unobserved, never relabelled PASS from synthetic events. Controlled conflict
policy has its own separate lane. Preserve prior41 limitations of native cancel.
7. Read-only selection/copy/native Find; disabled command/focus refusal and host
recovery access. RU/EN labels,200% zoom,32px target checks, wrapping/selection
endpoint visible. No UA-style exception transfer for optional UI positioning.

Every row records PASS/REFUSED/FAILED/UNOBSERVED/UNSUPPORTED separately and the
actual action count. Cleanup only owned fixture windows/resources and restore
input source using established existing-source controls; no permission reset or
preferences edit. Failures remain failures in receipts even after a separate
successful cleanup. A source change invalidates affected proof.
