// SPDX-License-Identifier: MIT OR Apache-2.0
// Immutable data integrity and explicit authoring correction, not editor execution.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCompositionContract } from './composition-contract-data.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const data = loadCompositionContract();
const counts = { native: data.native.cases.length, events: data.events.rows.length, dom: data.dom.cases.length,
  installed: data.manifest.counts.installedRows, boundaryRecipes: data.dom.boundaryRecipes.length };
const report = { format: 'composition-frozen-data-check/1', status: 'passed', runtimeExecuted: false,
  noEditorRun: true, scope: 'Node standard-library byte/hash/JSON/literal relations only; no editor import or native/WASM/DOM/browser/candidate/test execution. No formal review or acceptance verdict.',
  counts, errata: data.errata, pins: data.pins };
mkdirSync('artifacts/composition', { recursive: true });
writeFileSync('artifacts/composition/contract-check.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, counts, pins: data.pins.length,
  errata: data.errata.map(e => ({ path: e.path, sha256: e.sha256, status: e.status })), runtimeExecuted: false, noEditorRun: true }));
