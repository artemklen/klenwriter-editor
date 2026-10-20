# Safari cleanup through two original bounded results

Authored at9074ef8 before this split-finish candidate or its physical run.
Safari02 remains FAILED16P1F3NR. N07-ru physical actions and zoom-reset
checkpoint completed; finish request519 was dispatched but returned no result
within15 seconds. Its destruction/release outcome remains UNOBSERVED. The last
checkpoint has2817 native calls whose compact JSON alone occupies2,523,311B.
Two such call arrays exceed4 MiB. This is a source/data size explanation;
neither the missing finish packet nor completed destruction was observed.

For Safari's private adapter call(finish), perform exactly one original
checkpoint RPC followed by exactly one finishDispose RPC. The latter executes
the existing destroy, original tabindex restoration and active-mount retirement,
returning the complete original disposed maps/trace and policy/overflow fields.
It performs no second checkpoint. Extend only the closed no-argument private
RPC allowlist and page-client mounted-ID retirement for finishDispose.

Both responses retain all original fields and full trace arrays independently,
each within the unchanged4 MiB result bound. Each original response is persisted
before its own ACK; record the two RPC IDs, mount ID, order and outcome. Assemble
the coordinator's existing finish value as {before, ...disposeResult}, without
changing its fields or original released() assertions. No prefix encoding,
trace reconstruction, pruning, truncation or invented zero counters is allowed.
The original Chrome finish retains the same checkpoint-then-dispose behavior.

There is no new input, setup, recapture, selection/history command or arbitrary
native operation between these two calls. The first response proves no release.
An unknown/failed checkpoint stops before disposal; an unknown/failed disposal
is not retried. Either failure remains explicit FAILED, with missing release
evidence preserved. Only both completed responses and all existing assertions
may prove cleanup. No prior failed row is rewritten or replayed.

All input/trust/semantic assertions, fixed20-row/action inventory, request4 KiB,
result4 MiB, log128 MiB, traffic256 MiB, commands2048, polls16384, command15s,
run600s and guard1s bounds remain. Two bounded results need not fit every future
case; any remaining overflow still stops. Original frozen files are unchanged.
