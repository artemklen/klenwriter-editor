# Notice — editor-reliability-fuzz (test-only)

This standalone fixture is not built, shipped or distributed as part of any
KlenWriter package. It exists only to execute the local coverage-guided fuzz
lane described in `docs/reliability-fuzz.md`.

Pinned test tooling in this workspace's lock:

- `libfuzzer-sys` 0.4.13 — declared SPDX `(MIT OR Apache-2.0) AND NCSA`
  (rust-fuzz/libfuzzer). The NCSA term covers the bundled libFuzzer runtime
  sources it compiles into the local fuzz executables.
- `cargo-fuzz` 0.13.2 (installed into the repository's gitignored `.tools`)
  — declared SPDX `MIT OR Apache-2.0`.

These declarations mirror the registry metadata recorded in
`evidence/osr-38/tooling-candidates.json`; no independent legal
determination is made here. None of these artifacts enter the production or
browser dependency closure, and no fuzz binary or bundled runtime is
published.
