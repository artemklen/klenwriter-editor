# NC014 feedback-refresh observation correction

**SOURCE_AUTHORING_CORRECTION_NOT_ACCEPTANCE**, before application/candidate.
Old frozen native/v1 output, all original before/action/after assertions and all
raw failed reports remain unchanged. This corrects only the setup of the newly
added feedback-refresh purity observation; no production/API change or new case.

The completed Chromium case captures the original native refusal outcome at
9221.671–9223.903ms: dialog.hidden=true, closeReasons=['refused'], activeTag=BUTTON.
Its existing native/canonical/state/results assertions and diagnostic
notes.invalid_attribute pass. Ordinary refresh begins9232.766ms, followed by the
explicit two-frame wait9233.974–9264.179ms. Inspection9268.105–9270.518ms has BODY;
refusal text and semantic facets remain identical. The added comparison failed.
Host close sets hidden=true, without choosing a new focus target (ui-host.js:58).
These records demonstrate a transient hidden-control focus baseline, not the
cause of the eventual focus change. Delayed UA focus fixup is consistent with
source/trace; no focus-event/call observer exists, so it is not causally proven.

Normative isolated observation: preserve ALL original outcome assertions first.
Then explicitly focus the connected external fixture control #ui-after, require
it focused, and allow the existing finite presentation-frame setup to complete.
Capture a NEW feedbackBefore checkpoint. Native canonical/state/rows/events,
context/results/failures/focus results/mode/dialog stay equal to the original
after outcome; status retains the actual original refusal text and independently
frozen notes.invalid_attribute. The focus transition is explicit setup, not a
purity expectation across hidden-dialog disposal.

Now request ONLY ordinary UI refresh and its existing finite two-frame wait.
Require FULL inspection equality to feedbackBefore, including connected active
ID/tag, resources, context, native and result facets, plus exact refusal text and
frozen diagnostic. #ui-after remains focused. This Notes case has nativeTrace
recording disabled by its original mount configuration; inspect does not add
trace-call counters to this equality. No status setter, native mutation, range
setter, focus repair DURING measurement, suppressed assertion or extra test.
The old failed attachment stays FAILED; a new actual run is required separately.
