# Baseline-only floor adoption method

Primary Codex records this technical method before candidate performance
capture, under the delegated OSR-26 authority. This document adopts no numeric
floor. The full accepted64 calibration is still running; every actual floor
will require a new source-bound policy receipt after successful calibration
and before the first candidate launch.

Existing OSR-61 measurement floors retain their precise scopes:

- Export latency: 200,000 ns.
- Cold packaged startup: 5,000,000 ns.
- Sampled process RSS: 33,554,432 bytes.

For every other latency case, let B be the median of the five accepted-source
run-p95 values and q be the largest observed timer increment among those same
five raw launches. The proposed floor is `ceil(max(10*q, 0.01*B))` ns. Both
inputs, the calculated integer and the per-case rationale must be retained in
the adoption config. This uses accepted-source magnitude and measured timer
resolution; candidate timings never choose the floor. It also applies to warm
lifecycle latency, whose scope differs from cold startup.

For exact byte counters (per-operation native allocations, live checkpoints,
coherent whole-process allocator peak and actual WASM capacity), the proposed
new absolute floor is zero bytes. These are directly counted integers rather
than timer estimates. The existing relative threshold and independent
confirmation still apply; this does not equate allocator peak, WASM capacity
and RSS or permit subtraction of unrelated peaks. The RSS floor above stays
fixed. Unknown units or dimensions require an explicit decision rather than a
fallback formula. Bundle ceilings remain with OSR-80.

Adoption requires the complete frozen plan, unchanged source/harness/artifact
bindings, all original raw samples and requests, at least five genuine launches
per case, at least 200 samples for each per-operation case, and the separately
declared single-scalar sampling for each process peak/RSS/startup launch.
`validateCalibration` must accept raw integrity, sampling, timer quality,
uncensored results and CV at or below 10% for every case. An incomplete, noisy
or quantized case prevents adoption; it does not enlarge a floor. No launch
may be selected or discarded to make these conditions pass.
An all-zero byte baseline still has undefined CV under the frozen protocol and
cannot be adopted automatically merely because the counter is exact.

After calibration, primary must inspect the full proposal, record actual
per-case numeric values and rationale, and execute the existing exclusive
`adoptFloors` entrypoint. Its timestamp must follow calibration completion and
precede candidate capture. A regression still requires both the adopted
absolute delta and `max(20%, 3*baseline CV)`, with the frozen second independent
batch rule. These are measurement guard bands, not product latency, memory or
bundle SLAs.
