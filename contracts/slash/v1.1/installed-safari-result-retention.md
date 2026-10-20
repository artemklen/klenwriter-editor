# Safari result retention and finite transport capacity

Authored at22b825a before this retention candidate or its physical run.
Original Safari01 remains FAILED. Its saved client log has71,638,175 bytes;
the first RU prepare starts at byte70,277,690. Before that point294
native-result records occupy34,856,190 bytes, in addition to the full HTTP
responses already retained. Twice the observed pre-RU size exceeds128 MiB;
this is a sizing projection, not a future RU observation or acceptance.

Retain every original full HTTP request/response, including the complete
host/read result, once in client.jsonl before acknowledging its native RPC.
The later native-result marker retains id/method and a closed resultReference
with kind=http-response, path=host/read, the same id and done=true. It refers
to the one preceding completed HTTP response whose value has that id and
done=true; value.result is the complete original result. No result fields,
strings, statuses, errors or trace entries are pruned, truncated, normalized,
compressed or reconstructed. Pending responses remain fully retained too.
Failure to record either the full response or marker still stops before ACK.
Saved-log verification must resolve every marker uniquely backwards and compare
its original complete result; acknowledgement must follow both records.

Keep each broker/client journal bound at128 MiB. For the same fixed20-row
installed43 protocol, set the combined actual request-plus-response traffic
allowance to256 MiB, accounting for the full page/result POST and full host/read
reply. This is a cumulative I/O allowance, not a result/allocation limit or a
larger workload. Accounting still runs for every actual input chunk/output body.
Requests remain4 KiB, results4 MiB, commands2048, polls16384, command15 seconds,
run600 seconds and guard-to-post1 second. Every overflow still stops explicitly.
These finite limits do not guarantee that every future attempt fits.

No native/editor/input/selection/guard/ordinary-source/semantic assertion or
action inventory changes. Original frozen v1 files and all prior attempts stay
unchanged; this additive revision replaces only duplicated client retention
and the cumulative traffic sizing assumption. It confers no runtime PASS.
