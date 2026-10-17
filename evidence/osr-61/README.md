# OSR-61 calibration evidence

- `series.json`: immutable raw-file identity manifest; changed, stale or mixed capture files are rejected.
- `webkit-memory-supplement.json`: one isolated fresh WebKit launch with PID registration including launchd-owned XPCs and per-process RSS samples.
- `metadata.json`: environment, release/toolchain information, exact source hashes, deterministic corpus manifests and sampling protocol.
- `{chromium,firefox,webkit}-run-{1,2,3}.json`: independent browser launches with every raw timer sample, adaptive batch, native event, startup phase and sampled process-tree RSS observation.
- `paint-supplement.json`: three fresh Chromium launches with additional observer drain and timestamp attribution of browser input-to-next-paint entries.
- `summary.json`: validated source fingerprints, correctness checks, nearest-rank p50/p95/p99 per launch, run variance, Event Timing coverage and eligible input-to-next-paint measurements.
- `baseline.md`: reviewable results and their limits.
- `pilot/`: preserved fixture failure, timer-quantization experiments and the intentionally interrupted initial Firefox run.

This directory is calibration evidence for M0. It does not establish production editor performance, KWDJ validity, installed-browser release acceptance or physical display latency. See [the protocol](../../docs/m0/performance-protocol.md) for reproduction, rejected candidate budgets and the controlled regression policy.

The raw traces contain synthetic text only. Bundled headless browsers use new temporary contexts; no native user profile or personal UI is captured.

## OSR-28: immutable dependency source

The measured `package-lock.json` is archived verbatim in `sources/package-lock.json`
from M0 commit `8d08f8e1afa15a8e673c8412bc847e1a836be770`. Its SHA-256 must equal
the original sealed metadata source hash. `perf:verify` uses that historical lock
for calibration integrity; the active workspace lock is independently checked by
OSR-28. All other captured sources still verify against their original paths.
No raw samples, metadata hashes, sealed series or derived statistics changed.
This does not claim the historical measurements describe the new workspace.
