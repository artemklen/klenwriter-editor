// SPDX-License-Identifier: MIT OR Apache-2.0
// Frozen before runtime capture. Numbers are measurement policy, not product SLA.
export const PROTOCOL = Object.freeze({
  format: 'editor-reliability-performance/1',
  minimumRuns: 5,
  minimumSamples: 200,
  maximumBaselineCV: 0.10,
  relativeFloor: 0.20,
  baselineCVMultiplier: 3,
  minimumTimerTicksAtP95: 100,
  maximumZeroFraction: 0.01,
  quantile: 'nearest-rank-ceil(p*n)-1',
  cv: 'sample-standard-deviation-of-run-p95 / mean-run-p95',
  confirmation: 'second-independent-batch-with-same-frozen-inputs',
  processScalars: 'at least five independent launches, one genuine peak/RSS scalar per launch; median/range/sampleCV, no per-process fake200 or p99',
  memory: 'capacity / allocator-live-and-whole-process-peak / logical / sampled-rss are distinct',
});

export const EXISTING_FLOORS = Object.freeze({ export_ns: 200_000, startup_ns: 5_000_000, rss_bytes: 32 * 1024 * 1024 });

// These independently authored distributions and classifications precede the
// runtime producers. Constant samples deliberately make their quantiles obvious.
export const SYNTHETIC_ORACLES = Object.freeze([
  { id: 'stable', baseline: [100, 100, 100, 100, 100], candidate: [110, 110, 110, 110, 110], floor: 5, expected: 'PASS' },
  { id: 'below-absolute', baseline: [100, 100, 100, 100, 100], candidate: [130, 130, 130, 130, 130], floor: 40, expected: 'PASS' },
  { id: 'both-thresholds', baseline: [100, 100, 100, 100, 100], candidate: [140, 140, 140, 140, 140], floor: 5, expected: 'NEEDS_CONFIRMATION' },
  { id: 'strict-threshold', baseline: [100, 100, 100, 100, 100], candidate: [120, 120, 120, 120, 120], floor: 5, expected: 'PASS' },
  { id: 'noisy-baseline', baseline: [50, 150, 50, 150, 100], candidate: [200, 200, 200, 200, 200], floor: 5, expected: 'INCONCLUSIVE' },
]);
