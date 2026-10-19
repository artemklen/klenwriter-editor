# Installed selection input and observation

The frozen v1 files remain unchanged. The decisions below concern the installed
fixture and its input delivery, rather than native selection semantics or new
expected values. Independent review must check these qualifications against the
actual installed reports.

## Safari page control and platform keys

`v1/mounted-selection-design.md:130` says “no Apple Events after Safari
bootstrap/physical input”. This wording is ambiguous about the recipient.
The accepted native39 implementation sends physical keys through System Events
(`scripts/dom-native-acceptance.mjs` and its Safari adapter). Its separate ban
prevents Safari page JavaScript/control calls after physical input.

Selection40 follows that distinction explicitly: after Safari bootstrap,
JavaScript/URL/title page control uses only its closed same-origin HTTP broker.
There are no later Safari-app Apple Events. Mouse input uses the guarded CGEvent
path. Keys use a fresh read-only strict Swift AX preflight and one fixed System
Events script, with exact PID/app/window checks before and after the key, all
within the original one-second page-guard deadline. Actual Apple Events to
System Events are disclosed; this is not a claim of zero Apple Events to every
recipient. There is no transport fallback or replay after uncertain completion.
The platform post receipt is not browser acknowledgement: trusted UA traces and
unchanged semantic assertions must establish delivery. This recipient-specific
interpretation of the frozen wording is an explicit review item.

## Geometry after document mutation

The shared geometry helper's monotonic Range comparison measures scroll
progression in a stable document. Comparing a retired Text from before Cut with
the live range after Cut is undefined across DOM roots. That instrumentation now
runs only for existing scrollport fixtures. All scroll comparisons and assertions
remain intact; no detached-node exception is suppressed inside a scroll trace.

## Focus cancellation witness

Frozen mounted-selection rules preserve an external control's focus and range;
they prohibit restoring a global editor range while a text input owns it. The
original BM-E05 external-input witness and its selection 1..4 remain unchanged.
An installed attempt confirmed that real ShiftTab to the text input moves the
document range outside the editor, while cancelling its RAF and preserving the
native selection. That text-input behavior cannot simultaneously prove an owned
editor DOM caret during the five stable focus-cancellation samples.

Only the two installed focus-scroll cases therefore prepare a same-ID non-text
listbox in the original control's DOM/tab position, before fixture focus or input.
The original input object is restored at owned teardown. The general fixture,
bookmark tests and frozen literals remain unchanged. No range setter, synthetic
focus event, scroll correction or endpoint adjustment occurs during or after the
gesture. Actual ShiftTab reachability, retained raw range, complete caret
visibility, first stop RAF, five stable samples and Tab return must still pass
in each installed browser and locale. Setup alone proves none of those outcomes.
