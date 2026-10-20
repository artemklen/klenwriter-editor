# Preserve constructor timestamps and record posting-clock times separately

Frozen at6a64c54 before this candidate or its physical execution. The one
read-only prerequisite completed in Terminal with helperExecutionCount1 and
eventsPosted0/releasesPosted0. Its receipt SHA256 is
39c4529c178e2e80b966d69782475e65c0ad48743fd2289318946e506add4b70.
All three default-source in-memory CGEvents had timestamp0 and eventNumber0.
Both current left-button tables reported false; AX/post access were true.
Those are current finite observations, not historical ACKs or future authority.

Chrome07/09 received a strict Quote DOM triple at the same point without manual
timestamp rewriting. Chrome10/11, which rewrote timestamps, received no Quote
pointer events. This correlation is not proof of cause. The local Apple SDK
describes timestamps roughly since startup but specifies neither constructor
defaults nor an identity between that value and DispatchTime's clock. Do not
replace an owned event's constructor metadata with an assumed clock conversion.

For normal Chrome pointers, capture the three allocated constructor timestamps
before any post. Leave them unchanged. Immediately before each original guarded
post, require that event.timestamp still equals its captured constructor value;
record the actual read-back as moveTimestampNs/downTimestampNs/upTimestampNs.
Record constructor values, including zero, exactly as canonical UInt64 strings.
Do not hardcode zero as a universal expected constructor result.

Separately record DispatchTime.now().uptimeNanoseconds immediately before each
post as movePostUptimeNs/downPostUptimeNs/upPostUptimeNs. These are source-side
post-clock metadata: positive canonical UInt64 strings, strictly increasing.
They are not CGEvent timestamps, WindowServer ACKs or DOM observations.

The closed pairTiming object now has eleven keys: timestampPolicy fixed to
"constructor-default", downEventNumber, upEventNumber, moveTimestampNs,
downTimestampNs, upTimestampNs, movePostUptimeNs, downPostUptimeNs,
upPostUptimeNs, requestedPauseMs25 and actual finite nonnegative elapsedMs.
Validate exact keys, integer ranges, paired event-number equality, retained
constructor values at the helper, and strictly ordered separate post-clock
times before clearing pending. This corrects the added transport assumption
that constructor-domain timestamps must be rewritten to positive ordered
DispatchTime values; it does not relax any product or DOM acceptance assertion.

Keep the original private PID routing/preflight, move/down/up at the same
guarded point, both fixed25ms pauses, exact matching event numbers, full window
checks and original1s deadline. Safari/keys/Find/zoom and up-only cleanup retain
their current unchanged programs and metadata. No new source read, retry,
fallback, release, target, capture or activation is added. Missing/mismatched
trusted DOM down/up/click still fails under the original observation bound;
text/history/focus/resource assertions and original failed reports are preserved.
