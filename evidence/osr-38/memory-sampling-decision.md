# Memory sampling decision

Primary Codex decision during OSR-38 implementation, before production capture, 18.10.2026. This clarifies sample dimensions without changing the four acceptance criteria or introducing an SLA.

At least five interleaved independent baseline/candidate launches each retain at least 200 actual per-operation latency samples, allocation deltas and live checkpoints. A whole-process DHAT peak or attributable sampled RSS contributes exactly one real scalar per launch, at least five baseline plus five candidate launches. Report median, range and sample CV for these process scalars; never duplicate one peak into 200 samples or attach a fabricated per-process p99. Do not subtract all-time peaks to call the result a window peak.

Process-scalar comparison requires identical workload, attribution scope, frozen harness, source/artifact identities and environment. Adopt its absolute floor only after stable accepted64 calibration and before candidate capture. Use the same conjunctive absolute-floor plus `max(20%, 3 × baseline CV)` rule, CV ceiling10%, and second independent batch to confirm a regression. Missing, noisy or mismatched evidence is inconclusive. Actual per-operation allocator distributions and this process-scalar comparison must both be conclusive before AC4 closes. Shared CI timings alone cannot close it.
