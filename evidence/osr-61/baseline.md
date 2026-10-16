# OSR-61 measured M0 calibration

Status: **informational feasibility calibration; production latency, memory and bundle acceptance remain NOT_IMPLEMENTED.**

Reproduction and interpretation: [performance protocol](../../docs/m0/performance-protocol.md). Raw samples, exact sources, corpora and environment: [metadata](metadata.json), [machine summary](summary.json).

The series contains 9 independent browser launches and 63 corpus-runs. Every corpus passed exact raw-byte roundtrip before/after edit pairs and 33 controlled native DOM insertions with exactly 33 added UTF-16 units. All 30 retained key/input samples are trusted; the timing distributions exclude three warmups.

Machine: Apple M5 Max, 18 physical cores, 36GiB RAM; ProductName:		macOS; ProductVersion:		27.0.1; BuildVersion:		26A434. Node v26.12.0, Playwright 1.64.1, Rust release build described in metadata. Shared workstation load/power/thermal state was not controlled.

Calibration kernel: 29716 bytes, 12852 bytes gzip; app harness 8800 bytes. This is not an SDK/bundle estimate.

## DOM and native typing observations

Each cell is median run-p95 in milliseconds with the range of the three run-p95s in brackets. These native DOM keys do not enter the WASM kernel. The second-rAF endpoint is a rendering-opportunity proxy, not physical paint.

| Engine | Corpus | Full DOM build + forced layout | Native key → second rAF |
| --- | --- | ---: | ---: |
| chromium | long-paragraph | 244.800 [233.600–254.700] | 231.500 [228.100–237.000] |
| chromium | many-small-blocks | 35.600 [32.200–37.200] | 33.000 [32.900–33.700] |
| chromium | deep-tree | 0.400 [0.400–0.400] | 33.100 [32.900–33.300] |
| chromium | lists | 53.400 [52.000–56.200] | 33.100 [32.800–33.300] |
| chromium | table-grid | 55.600 [55.200–58.900] | 100.600 [96.800–106.700] |
| chromium | near-node-limit | 108.900 [107.800–109.300] | 54.500 [48.800–56.200] |
| chromium | near-byte-limit | 1749.700 [1742.200–1885.300] | 415.500 [411.400–421.100] |
| firefox | long-paragraph | 8.000 [8.000–10.000] | 12.000 [9.000–13.000] |
| firefox | many-small-blocks | 57.000 [52.000–58.000] | 9.000 [9.000–9.000] |
| firefox | deep-tree | 1.000 [1.000–1.000] | 9.000 [9.000–10.000] |
| firefox | lists | 63.000 [43.000–63.000] | 9.000 [9.000–9.000] |
| firefox | table-grid | 68.000 [68.000–72.000] | 17.000 [16.000–18.000] |
| firefox | near-node-limit | 146.000 [140.000–153.000] | 18.000 [17.000–27.000] |
| firefox | near-byte-limit | 66.000 [65.000–76.000] | 13.000 [13.000–13.000] |
| webkit | long-paragraph | 6.000 [6.000–8.000] | 34.000 [33.000–34.000] |
| webkit | many-small-blocks | 44.000 [43.000–44.000] | 33.000 [33.000–33.000] |
| webkit | deep-tree | 1.000 [1.000–1.000] | 33.000 [33.000–33.000] |
| webkit | lists | 71.000 [69.000–75.000] | 33.000 [33.000–33.000] |
| webkit | table-grid | 126.000 [124.000–133.000] | 48.000 [47.000–49.000] |
| webkit | near-node-limit | 266.000 [262.000–288.000] | 65.000 [53.000–73.000] |
| webkit | near-byte-limit | 5105.000 [5034.000–5169.000] | 33.000 [33.000–34.000] |

## Browser input-to-next-paint evidence

Event Timing is a separate browser-owned timing lane. It starts at event creation, includes input delay/processing and ends at the next rendering update/paint; this differs from the handler-to-second-rAF proxy and does not measure physical display latency. Entries are thresholded (requested 16ms) and quantized to 8ms. Only runs with all 33 unique ordered keydown entries can exclude the first three warmups and report unconditional 30-sample quantiles. Missing coverage is UNKNOWN, not 0. Observed subsets including warmups remain in summary.json for diagnosis.

| Engine | Corpus | Keydown entries per run /33 | Eligible runs | Next-paint p95 per eligible run ms | Matching proxy p95 ms |
| --- | --- | --- | ---: | --- | --- |
| chromium | long-paragraph | 33, 32, 32 | 1/3 | 240 | 231.500 |
| chromium | many-small-blocks | 31, 22, 33 | 1/3 | 24 | 33.700 |
| chromium | deep-tree | 22, 22, 22 | 0/3 | UNKNOWN | not paired |
| chromium | lists | 33, 22, 22 | 1/3 | 24 | 33.300 |
| chromium | table-grid | 32, 32, 33 | 1/3 | 104 | 96.800 |
| chromium | near-node-limit | 33, 32, 32 | 1/3 | 56 | 54.500 |
| chromium | near-byte-limit | 32, 32, 32 | 0/3 | UNKNOWN | not paired |
| firefox | long-paragraph | 0, 0, 0 | 0/3 | UNKNOWN | not paired |
| firefox | many-small-blocks | 0, 0, 0 | 0/3 | UNKNOWN | not paired |
| firefox | deep-tree | 0, 0, 0 | 0/3 | UNKNOWN | not paired |
| firefox | lists | 0, 0, 0 | 0/3 | UNKNOWN | not paired |
| firefox | table-grid | 0, 0, 0 | 0/3 | UNKNOWN | not paired |
| firefox | near-node-limit | 0, 0, 0 | 0/3 | UNKNOWN | not paired |
| firefox | near-byte-limit | 0, 0, 0 | 0/3 | UNKNOWN | not paired |
| webkit | long-paragraph | 22, 20, 21 | 0/3 | UNKNOWN | not paired |
| webkit | many-small-blocks | 22, 33, 22 | 1/3 | 16 | 33.000 |
| webkit | deep-tree | 22, 33, 26 | 1/3 | 16 | 33.000 |
| webkit | lists | 21, 22, 32 | 0/3 | UNKNOWN | not paired |
| webkit | table-grid | 33, 33, 33 | 3/3 | 24, 24, 24 | 48.000, 49.000, 47.000 |
| webkit | near-node-limit | 33, 33, 33 | 3/3 | 24, 24, 24 | 65.000, 73.000, 53.000 |
| webkit | near-byte-limit | 22, 32, 30 | 0/3 | UNKNOWN | not paired |

### Supplemental observer drain and timestamp attribution

The main series sometimes read Event Timing before the final entry was delivered. The separate Chromium series waits three frames plus 200ms after the final key, then matches each keydown entry to its handler timestamp within the entry processing interval (±1ms timer allowance). This drain is outside all latency measurements. It uses three fresh browser launches and the same corpus/renderer, with no preceding primitive benchmark. Its figures are paired with its own proxy samples, not substituted into the main series.

| Corpus | Matched measured keys /30 per run | Next-paint p50 median [range] ms | Next-paint p95 median [range] ms | Next-paint p99 median [range] ms | Proxy p95 per run ms |
| --- | --- | ---: | ---: | ---: | --- |
| long-paragraph | 30, 30, 30 | 184.000 [184.000–184.000] | 232.000 [232.000–240.000] | 248.000 [240.000–248.000] | 228.600, 232.100, 223.900 |
| many-small-blocks | 30, 30, 30 | 24.000 [24.000–24.000] | 24.000 [24.000–24.000] | 24.000 [24.000–24.000] | 33.700, 33.300, 33.200 |
| deep-tree | 30, 30, 30 | 16.000 [16.000–16.000] | 16.000 [16.000–24.000] | 16.000 [16.000–24.000] | 32.800, 33.000, 32.900 |
| lists | 30, 30, 30 | 24.000 [24.000–24.000] | 24.000 [24.000–24.000] | 24.000 [24.000–24.000] | 33.000, 33.200, 33.200 |
| table-grid | 30, 30, 30 | 104.000 [104.000–104.000] | 104.000 [104.000–112.000] | 112.000 [104.000–112.000] | 102.300, 106.500, 102.600 |
| near-node-limit | 30, 30, 30 | 40.000 [32.000–40.000] | 40.000 [40.000–40.000] | 40.000 [40.000–40.000] | 39.000, 42.900, 41.200 |
| near-byte-limit | 30, 30, 30 | 352.000 [344.000–352.000] | 424.000 [416.000–488.000] | 520.000 [464.000–520.000] | 411.500, 476.400, 413.400 |

21/21 supplemental corpus-runs have complete 30-key next-paint coverage. All source entries, handler timestamps, matches, warmup classification and unpaired entries are retained in [paint-supplement.json](paint-supplement.json). Unsupported engines and threshold-censored fast cases retain an explicit instrumentation limit.

## Primitive measurements

Each number is the median of the three run-p95s in milliseconds **per amortized operation**, after adaptive ≥5ms calibration batches. This is a distribution of batch throughput, not the tail of individual interactive operations. Raw batches and timer observations are retained. JS loop/crossing cost is included where applicable; no overhead is subtracted.

| Engine | Corpus | String insert+remove pair | Raw export | WASM→JS payload copy | Scalar call |
| --- | --- | ---: | ---: | ---: | ---: |
| chromium | long-paragraph | 0.002734 | 0.002979 | 0.010059 | 0.000002 |
| chromium | many-small-blocks | 0.000009 | 0.044531 | 0.019922 | 0.000003 |
| chromium | deep-tree | 0.000011 | 0.000065 | 0.000323 | 0.000003 |
| chromium | lists | 0.000009 | 0.032031 | 0.016406 | 0.000003 |
| chromium | table-grid | 0.000005 | 0.076563 | 0.012402 | 0.000003 |
| chromium | near-node-limit | 0.000002 | 0.087500 | 0.025781 | 0.000003 |
| chromium | near-byte-limit | 0.002783 | 0.026953 | 0.125000 | 0.000003 |
| firefox | long-paragraph | 0.002930 | 0.003418 | 0.011719 | 0.000003 |
| firefox | many-small-blocks | 0.000013 | 0.070313 | 0.023438 | 0.000003 |
| firefox | deep-tree | 0.000013 | 0.000153 | 0.000519 | 0.000003 |
| firefox | lists | 0.000013 | 0.062500 | 0.019531 | 0.000003 |
| firefox | table-grid | 0.000009 | 0.156250 | 0.015625 | 0.000003 |
| firefox | near-node-limit | 0.000004 | 0.218750 | 0.031250 | 0.000003 |
| firefox | near-byte-limit | 0.002930 | 0.027344 | 0.156250 | 0.000003 |
| webkit | long-paragraph | 0.002930 | 0.002930 | 0.003906 | 0.000002 |
| webkit | many-small-blocks | 0.000006 | 0.027344 | 0.006836 | 0.000002 |
| webkit | deep-tree | 0.000009 | 0.000053 | 0.000061 | 0.000002 |
| webkit | lists | 0.000006 | 0.023438 | 0.006836 | 0.000002 |
| webkit | table-grid | 0.000006 | 0.070313 | 0.004395 | 0.000002 |
| webkit | near-node-limit | 0.000002 | 0.078125 | 0.008789 | 0.000002 |
| webkit | near-byte-limit | 0.002930 | 0.027344 | 0.031250 | 0.000002 |

## Startup and memory

Startup has three observations per engine and does not justify a tail SLA. Fetch is loopback, with warm OS caches. Memory is a long-lived-session high-water workload including adaptive copy-allocation bursts; RSS includes runner/server, counts shared mappings repeatedly and can miss peaks between samples. WASM bytes are reserved linear-memory capacity, not live payload.

| Engine (version) | Launch ms median [range] | WASM instantiate ms median [range] | WASM capacity max MiB | Process-tree RSS sample max MiB | Largest RSS sampling gap ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| chromium (156.0.8078.4) | 74.361 [64.632–78.370] | 0.300 [0.300–0.300] | 9.81 | 7123.9 | 172 |
| firefox (157.0) | 318.177 [317.282–353.648] | 1.000 [1.000–2.000] | 9.81 | 2267.8 | 116 |
| webkit (27.2) | 152.986 [150.839–240.075] | 1.000 [0.000–2.000] | 9.81 | 315.8 | 171 |

The main WebKit descendant-tree RSS omits macOS XPCs reparented to launchd and is explicitly incomplete. A separate fresh WebKit launch registered 4 new PIDs from the exact Playwright bundle after confirming none existed beforehand. This observed a sampled summed RSS maximum of 746.1MiB, with maximum 102ms between samples. This separate load+33-key memory lane excludes adaptive allocation bursts and repeated 20× rebuilds, so it does not replace the main-workload sum. Registration, per-process samples and per-corpus maxima are retained in [webkit-memory-supplement.json](webkit-memory-supplement.json). Existing/system Safari processes are excluded. This is still sampled summed RSS, not unique physical memory or a guaranteed transient peak.

## Variance, conclusions and limits

The machine-readable summary retains p50/p95/p99 for every run plus launch-to-launch variation. 17 of 147 metric/corpus/engine run-p95 groups have CV >10%; these groups are inconclusive for a regression gate under this protocol. 5 DOM groups also have a run whose p50 is below ten observed timer steps; these short unbatched intervals remain quantization-sensitive. 0 measured primitive batches have zero elapsed time; 0 groups failed to reach the calibration target. The limited 20 render and 30 input samples make p99 the observed maximum, not a confident rare-tail estimate.

The larger mixed RU/EN + emoji/combining fixtures expose DOM/layout and native input pressure separately from small raw String/serialization costs. No ASCII-only/Cyrillic-only control isolates size from shaping cost, so the result applies to these exact generated fixtures. They justify retaining large-document measurements in future implementation work; they do not by themselves establish that a worker, rope or virtualization improves the complete editor. No alternative is benchmarked here. Selection, Find, composition and offscreen correctness remain mandatory gates for any such change.

The draft <1ms core, <50ms export and 400KB gzip goals are not adopted from this kernel. Production normalization, transactions/history, extension validation, DOM patching, codecs, actual SDK payloads, real installed Chrome/Safari, physical paint and attributable allocator peaks remain unmeasured. The approved architecture keeps synchronous main-thread WASM after async init, String initially and the full-DOM baseline pending representative comparisons.

Pilot failures and quantization findings are preserved in [pilot evidence](pilot/README.md). Source fingerprint verification passed when this report was generated.
