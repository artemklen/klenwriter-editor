# Installed live Bridge resource baseline

The original installed-v1 files and their manifest stay unchanged. Their fresh
setup wording, “one session; no extra snapshots/cursors”, is read together with
the existing generic Bridge ownership contract. The new43 coordinator's literal
live `protected_cursors: 0` expectation was incorrect.

`crates/bridge/src/lib.rs` opens one `ProtectionStart::Now` in `Bridge::open`,
stores it in `self.protection`, and increments `PROTECTIONS` once on successful
admission. `own_resource_counts` reports that protection while the Bridge is
live. `destroy` releases it and decrements the counter. This belongs to every
opened Bridge session, independently of DOM mounting or subscriptions.

Therefore one fresh live fixture must have exactly:

```json
{"sessions":1,"snapshot_handles":0,"snapshot_bytes":"0","protected_cursors":1}
```

Zero or additional live protections refuse this exact baseline. This changes no
semantic literal, input action, target, history, timing or ownership rule. The
frozen no-mutation resource delta remains zero. After fixture disposal all four
native resource fields must still be exactly zero (with string `"0"` for bytes),
as required by installed-v1/facade-plan.md and the original coordinator cleanup.

The first Chrome43 attempt at `f522930` is preserved as FAILED before physical
input: zero actions and nineteen NOT_RUN rows. Its observed value motivates the
source audit; the corrected expectation is derived from Bridge ownership, not
from treating that failed observation as a golden or successful installed run.
