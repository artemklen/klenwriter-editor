# Native reliability dependency inventory

Run `node scripts/reliability/dependency-inventory.mjs` explicitly from the repository. Importing the module has no side effects. It refuses to overwrite prior evidence and writes `artifacts/reliability/dependencies.json` plus exact Cargo stdout/stderr/exit receipts in `artifacts/reliability/dependency-inventory-raw/`.

The standalone `tests/fixtures/reliability-native` workspace is inspected with all features using locked, offline Cargo metadata. The conservative inventory records exact versions, declared SPDX and Rust MSRV, target kinds, features, dependency declarations/roles, manifests, source/lock pins, locally available license texts, and cached registry archives checked against the matching lock checksum. Missing archives/texts are explicit qualifications, not invented evidence or a publication license verdict. No crates are built, tests/probes run, or dependencies fetched.

Separate default root and wasm32-filtered metadata prove `proptest`/`dhat` do not enter the WASM composition root's normal or normal+build closure. The all-features root inventory conservatively includes optional native type generators; it is not a production/browser dependency list. Default normal closures must exclude `ts-rs`/`ts-rs-macros`. Native measurement-only optional `dhat` and native dev `proptest` remain in their standalone workspace.

All production crate sources/manifests, the native fixture sources/tests/literals/lock, toolchain and inventory inputs are pinned before/after metadata collection. Exact original command outputs are retained; this inventory does not establish runtime behavior, compiler compatibility beyond declared metadata, or any result for the separately stopped work.
