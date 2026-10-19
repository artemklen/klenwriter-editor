// SPDX-License-Identifier: MIT OR Apache-2.0
// Deterministic committed seed corpus for the four coverage-guided families.
// Regenerating never silently replaces retained bytes: an existing seed file
// with different content refuses. Importing this module writes nothing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contexts, makeScenario, registryFor } from './scenarios.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const seedsRoot = resolve(root, 'tests/fixtures/fuzz-native/seeds');
const FUZZ_BUILD_ID = 'osr38-native-fuzz-fixture';
const DEEP_STATEFUL = [0, 3, 1, 2, 4, 5, 6, 7];
const NBSP_STATEFUL = [16, 3, 1, 2, 4, 5, 6, 7];
const hash = value => createHash('sha256').update(value).digest('hex');

function scenario(context, initialText) {
  return makeScenario({ id: `R38-fuzz-seed-${context}`, context, initialText,
    edits: [{ from: 1, to: 1, inserted: 'A' }] });
}

/** Each entry: [family, slug, bytes]. Context framing byte precedes payloads. */
export function seedFiles() {
  const files = [];
  for (const [lane, context] of contexts.entries()) {
    const scenarioTexts = ['ab', 'L é😀R'];
    for (const [index, text] of scenarioTexts.entries()) {
      const built = scenario(context, text);
      files.push(['admission_options', `${lane}-${index}-${context}`, Buffer.concat([Buffer.from([lane]), Buffer.from(built.input_json, 'utf8')])]);
    }
    const built = scenario(context, 'ab');
    const options = { abi: 'editor-sdk/2', build_id: FUZZ_BUILD_ID, profile: built.profile, admission: 'validate',
      access: 'editable', registry_json: built.registry_json, profile_options_json: built.profile_options_json };
    const envelope = { input_json: built.input_json, options_json: JSON.stringify(options),
      requests: ['{"kind":"state"}', '{"kind":"catalog"}', '{"kind":"destroy"}', '{"kind":"state","unknown":true}'] };
    files.push(['bridge_lifecycle_facts_stale_tokens', `${lane}-${context}`, Buffer.concat([Buffer.from([lane]), Buffer.from(JSON.stringify(envelope), 'utf8')])]);
    for (const [index, opcodes] of [DEEP_STATEFUL, NBSP_STATEFUL].entries()) {
      files.push(['positions_maps_state_history_events', `${lane}-${index}-${context}`, Buffer.concat([Buffer.from([lane]), Buffer.from(opcodes)])]);
    }
  }
  // TypedList refusal anchors and descriptor sources for the bare compiler.
  files.push(['admission_options', 'refusal-kwdj-malformed', Buffer.from([0, ...Buffer.from('{', 'utf8')])]);
  files.push(['admission_options', 'refusal-notes-empty', Buffer.from([2])]);
  // The bare `editor_registry::compile_json` admits no invented trusted
  // mandatory registration, so profile-format descriptors that select a base
  // extension registered by their profile layer are honest typed-refusal
  // anchors. Successful compilation is anchored by an independently authored
  // self-contained descriptor with selected ⊆ registered extensions.
  files.push(['registry_grammar_attrs_recipes', 'self-contained', Buffer.from(JSON.stringify(selfContainedRegistry()), 'utf8')]);
  files.push(['registry_grammar_attrs_recipes', 'kwdj-base', Buffer.from(registryFor('kwdj-prose'), 'utf8')]);
  files.push(['registry_grammar_attrs_recipes', 'notes-d0', readFileSync(resolve(root, 'examples/notes-extension/d0.json'))]);
  files.push(['registry_grammar_attrs_recipes', 'notes-d1', readFileSync(resolve(root, 'examples/notes-extension/d1.json'))]);
  files.push(['registry_grammar_attrs_recipes', 'malformed', Buffer.from('{', 'utf8')]);
  return files;
}

/** Minimal independently authored descriptor the closed compiler must admit. */
function selfContainedRegistry() {
  const prefix = 'org.example.fuzz';
  return { format: 'editor-registry/1',
    profile: { id: prefix, version: '1.0.0', codec_id: `${prefix}/json`, wire_version: 1 },
    selected_extensions: [{ id: `${prefix}/base`, version: '1.0.0' }],
    root: { op: 'repeat', item: { op: 'type', id: `${prefix}/paragraph` }, min: 1, max: 64 },
    mark_policy: {},
    extensions: [{ id: `${prefix}/base`, version: '1.0.0', dependencies: [],
      nodes: [
        { id: `${prefix}/paragraph`, primitive: 'text_block', attrs: {},
          children: { op: 'repeat', item: { op: 'type', id: `${prefix}/text` }, min: 1, max: 4096 }, marks: [] },
        { id: `${prefix}/text`, primitive: 'text', attrs: {}, children: { op: 'empty' }, marks: [] },
      ],
      marks: [], commands: [] }] };
}

export function writeSeeds(directory = seedsRoot) {
  const manifest = {};
  let totalBytes = 0;
  for (const [family, slug, bytes] of seedFiles()) {
    assert(Buffer.byteLength(bytes) <= 16384, `seed exceeds fuzz input bound: ${family}/${slug}`);
    const familyDirectory = resolve(directory, family);
    mkdirSync(familyDirectory, { recursive: true });
    const path = resolve(familyDirectory, `${slug}.seed`);
    if (existsSync(path)) assert.deepEqual(readFileSync(path), bytes, `retained seed differs; regenerate consciously: ${path}`);
    else writeFileSync(path, bytes, { flag: 'wx', mode: 0o644 });
    const entry = { path: `${family}/${slug}.seed`, bytes: bytes.length, sha256: hash(bytes) };
    (manifest[family] ??= []).push(entry);
    totalBytes += bytes.length;
  }
  // No stray retained seeds: every existing file must be part of the manifest.
  const expected = Object.values(manifest).flat().map(entry => entry.path).sort();
  const existing = readdirSync(directory, { recursive: true })
    .filter(name => name.toString().endsWith('.seed'))
    .map(name => name.toString()).sort();
  assert.deepEqual(existing, expected, 'retained seed set differs from the deterministic generator');
  const seal = { format: 'editor-reliability-fuzz-seeds/1', generator: 'scripts/reliability/fuzz-seeds.mjs',
    families: Object.fromEntries(Object.entries(manifest).map(([family, entries]) => [family, entries.length])),
    seeds: Object.values(manifest).flat().length, totalBytes,
    qualification: 'Committed deterministic seeds anchor admission/refusal, descriptor compilation, deep stateful opcodes and the public bridge envelope for every context. They are inputs, not observed runtime outcomes.' };
  const path = resolve(directory, 'manifest.json');
  const bytes = Buffer.from(JSON.stringify({ ...seal, files: manifest }, null, 2) + '\n');
  if (existsSync(path)) assert.deepEqual(readFileSync(path), bytes, 'seed manifest differs; regenerate consciously');
  else writeFileSync(path, bytes, { flag: 'wx', mode: 0o644 });
  return seal;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(writeSeeds()));
}
