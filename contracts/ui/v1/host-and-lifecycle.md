# Mounted host requests and prospective focus

This contract accompanies mounted-api-additions.ts. The original SDK2
Submission/Response, including native Refused/fatal/queued completion, is retained.
There is one SDK pump, no second action queue or semantic retry.

Pure status applies lifecycle/native access/editable mode/composition/replace/
commit/busy/intent exhaustion gates. It does not allocate or report through an
onRefusal callback. Failures use existing diagnostic codes, plus
dom.invalid_host_request/dom.stale_host_request with host_request phase.
Geometry has geometry phase. Native read failures retain original Response in
SelectionReadFailure. Shared bookmark limit64 yields dom.selection_limit.

Capture acquires an exact bookmark and genuine SDK request before focus moves.
It does not sync or write browser/native selection; unsynchronized range refuses.
Both full context and all five stamp fields and shared intent bind the private
entry. Opaque descriptor copies, proxies or same ID/stamp strings confer no
authority. Partial allocation releases what it acquired. Live cap64 includes
shared SelectionOwner bookmarks; SDK total128 is a separate limit.

Optional focusScope is a genuine connected HTMLElement of the same ownerDocument,
outside the editing root and not an ancestor containing it. A hidden precreated
connected dialog shell is valid; body/wrapper leases are invalid. Capture need
not find focus there. A scope is a presentation lease, not modal verification or
universal host authorization. Strong scope references exist only for live work.

The first terminal attempt claims/removes its genuine handle before inspecting
options/command getters or calling host code. Unknown/used handles refuse
dom.invalid_host_request. A retired/invalidated genuine handle refuses stale
where retained retirement identity is known; no descriptor is resurrected.
Completion owns finite command data and validates exact original bookmark,
context/stamp/intent/endpoints and mounted user gates before native dispatch.
Extract pure validateExact from existing restore; no mapping/release/focus/
scroll/set_selection. Restoring before SDK completion is forbidden because it
can change epochs and invalidate the captured request.

Factor existing mounted submit forwarding once, preserving raw-kind/catalog/
composition/fatal/SelectionOwner frame/InputOwner ordering. The user-action
editability guard is separate from existing input boolean. Final dispatch alone
calls SDK.completeHostRequest. Same command/stamp is queried and executed.
Capability/guard refusal and terminal malformed command require a fresh gesture,
never an invisible replay. Terminal work releases bookmark and SDK request even
on refusal.

Cancel releases SDK request and restores the exact valid bookmark using existing
OSR-40 semantics, default focus true. It creates no document transaction; actual
set_selection may advance state/history barriers. Release the bookmark after
precheck failure too. Invalid cancellation must not fabricate a caret. UI uses
its stable Add entry and visible stale-selection reason, and never disabled
editing focus. release is idempotent/no command/no focus.

Result focus is a separate promise: restored/not_requested/not_restored, with
failure provenance when applicable. focus:none yields not_requested. Missing,
detached, replaced or externally focused lease cannot steal focus. A native
result-focus permit is bound to the ORIGINAL submission frame, original result
stamp/selection, context/generation and captured scope. A completed synchronous
own state-only/no-op action MAY recognize only its own known frame publication/
end invalidation for this prospective focus step. Existing bookmark invalidation
on state-only/no-op/queued is unchanged and no old bookmark is revived. Any
subscriber/factory/focus reentry, foreign intent/publication, mode/lifecycle or
facts change suppresses focus. Never capture a fresh arbitrary serial afterward
to forgive reentry. Queued work without provable original continuity returns
truthful not_restored while preserving its original ticket and native outcome.

At focus time require document.hasFocus and activeElement still inside the SAME
connected captured scope. Recheck exact native result/current continuity before
AND after host.focus, then write RESULT range through owned view/range-writing
protection. Focus has no semantic ticket. Formatting returns document focus when
valid; control-initiated move uses none and keeps its initiating control stable.

Retire new handles on ANY actual mode transition, replace attempt, recovery/fatal/
destroy, generation/context change and shared intent invalidation. Read/query
do not invalidate. Existing harmless snapshot/release behavior is preserved;
selection/history/stored mark semantics remain native. Do not invalidate unrelated
OSR-40 bookmarks merely to dispose host handles. Destroy clears request/bookmark/
DOM/scope references immediately. Original queued continuations retain only
minimal completion counters, not dead scope/command queue. Expose
resources.hostRequests pending/focusContinuations; include focus continuations in
dom.continuations. All counts become0 after terminal settlement.
