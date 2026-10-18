# Ordinary reliability check

Use the pinned Node in `.node-version` and Rust1.97.1. Run `npm run build` first
so the actual sealed WASM, generated declarations and packaged SDK match the
current source. Then run `node scripts/reliability/check.mjs`. This is an
additional ordinary correctness/integrity lane alongside the existing
`npm run check` and `npm test`; those commands keep their existing scope.
Importing the checker starts no process and changes no artifact.

The checker regenerates the independently frozen scenario packet, then runs the
model, reducer, comparator and real packaged-SDK harness suites in four isolated
Node processes. It records their actual summaries rather than assuming a test
count. Its native producer explicitly performs pinned locked fetch followed by
locked offline build. The separate fixture then receives fmt, compile-only
all-target/all-feature clippy, ordinary library tests and `limits` tests.

Only two tests from `public_properties` are executed, each with an exact name:
`actual_public_session_frozen_prefixes_shrink` and
`actual_notes_recipe_d1_and_d0_refusal_use_frozen_public_oracle`. Other tests in
that integration target, helper seeds and the stopped exploratory block are not
executed by this entrypoint. Clippy compilation is not reported as execution.

Full ordinary replay follows:256 generated cases per four native contexts plus
all12 literals, saved regressions first and counted separately; the13 native
raw-operation witnesses remain their own category. Packaged SDK replay uses64
generated/context plus12 literals and5 separate boundary/lifecycle supplements.
The final checker summary copies actual replay reports and their observed floor
flags. The shared dependency-inventory helper writes a fresh report and raw
metadata commands under this UUID. It matches exact lock entries and available
crate archives/checksums, retains license/source metadata, and distinguishes
the separate all-feature fixture from normal production and wasm32 browser
graphs. Missing local archives/texts stay explicit; no fallback is fabricated.
The summary copies the helper's actual summary/browser package count and report,
whose commands retain their real exits/signals and raw streams. Calling the JS
helper is not represented as a manufactured process exit.

Every invocation creates a UUID directory under
`artifacts/reliability/check/runs/`. It retains command exit/signal, raw streams,
immutable receipts, metadata and nested native/SDK replay evidence. Stream and
per-lane evidence limits remain explicit; raw checker command streams are
bounded at64MiB aggregate. The latest `check-report.json` points to the immutable
receipt. Fail-fast behavior records the failed stage and lists later stages as
not run. Existing historical replay reports are preserved because new full
replay output is nested in this fresh checker directory.

The before/after source closure is the union of native replay inputs,
performance-harness files, all actual SDK producer source keys and the checker
and executed test inputs. The actual SDK producer/seal and source pairing are
checked before work; stale packaging refuses with the build prerequisite.
No binary/source/lock mismatch is silently relabelled as a passed stage.

This entrypoint makes no real performance, coverage-guided-fuzz, stopped-block,
renderer, final-CI, independent-review or full-AC completion claim. Quiet
reference calibration/comparison and the separately authorized fuzz workflow
retain their own measured protocols and acceptance evidence.
