# Preparing the explicit floor config

`scripts/reliability/prepare-floor-config.mjs` prepares a draft from a completed
accepted64 calibration using the frozen `floor-adoption-method.md`. It preserves
the complete numeric basis and quality report and rejects mixed workload hashes
across the five launches. This operator helper is separate from the frozen
measurement harness; it does not alter captured requests, timings or executables.

Run with the repository's pinned Node24 after the full calibration completes:

```sh
node scripts/reliability/prepare-floor-config.mjs preparation-input.json
```

The input names `root`, `calibration`, `candidateSource`, `proposalOutput`,
`configOutput` and `policyOutput`. For this frozen comparison the candidate is
`9130cf9c3480db7499cdb88818722ea032becba3`; later source changes require explicit
source/harness equivalence or a new producer. All three output paths must be new.
The helper retains the full proposal/quality, creates a draft config only when
the complete calibration qualifies, and exits1 without a config when it does
not. Stable nonzero counters with CV0 are allowed; undefined CV is refused.

It writes no policy or candidate event. The temporary in-memory prospective
policy only invokes the existing raw-evidence validator and is never serialized
as an adoption. Primary must inspect every numeric value and create the actual
adoption config with an explicit decision rationale, then invoke the separate
`perf-policy.mjs` entrypoint. A prepared draft is not an adopted policy or proof
of a completed performance comparison.
