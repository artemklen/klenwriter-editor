// SPDX-License-Identifier: MIT OR Apache-2.0
// Data-only contract loader. No editor, native, WASM, DOM or browser imports.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'contracts/composition/v1';
const erratumPath = 'contracts/composition/errata/001-d11-outside-heading.json';
const erratumHash = '290a66d8001f18355aeb286f7138be50f7606b9f9699d716c2742f2e6457dd76';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Python sort_keys/ensure_ascii=false/compact UTF8 data digest. These pinned
// replacement records contain only well-formed strings and safe integer numbers.
const codePointOrder = (a, b) => {
  const left = Array.from(a, c => c.codePointAt(0)), right = Array.from(b, c => c.codePointAt(0));
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
};
function compact(value) {
  if (typeof value === 'string') assert(value.isWellFormed(), 'Digest input has lone surrogate');
  if (typeof value === 'number') assert(Number.isSafeInteger(value), 'Pinned digest data uses safe integers');
  if (Array.isArray(value)) return `[${value.map(compact).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort(codePointOrder).map(k => `${JSON.stringify(k)}:${compact(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const dataHash = value => hash(Buffer.from(compact(value), 'utf8'));
const unique = (rows, label) => assert.equal(new Set(rows.map(r => r.id)).size, rows.length, `Unique ${label} IDs`);
function atDocument(document, path) {
  let node = document;
  for (const index of path) { assert(Number.isSafeInteger(index) && index >= 0); node = node.content[index]; assert(node); }
  return node;
}
function atDom(nodes, path) {
  let node = { children: nodes };
  for (const index of path) { assert(Number.isSafeInteger(index) && index >= 0); node = node.children[index]; assert(node); }
  return node;
}
function roleBijection(table, document) {
  const paths = new Set();
  for (const [role, path] of Object.entries(table)) {
    if (role === 'ROOT') { assert.deepEqual(path, { virtual_root: true }); continue; }
    assert(Array.isArray(path)); const key = JSON.stringify(path); assert(!paths.has(key), `Native roles alias ${role}`); paths.add(key);
    assert.equal(typeof atDocument(document, path).type, 'string');
  }
}
function textRelations(domNodes, nativeCase, checkpoint) {
  const document = checkpoint === 'input' ? nativeCase.input.document : nativeCase.after_document;
  const table = checkpoint === 'input' ? nativeCase.input.identity_roles : nativeCase.after_identity_roles;
  const seen = new Set(), pending = [...domNodes];
  while (pending.length) {
    const node = pending.pop();
    assert(node && [1, 3].includes(node.nodeType));
    assert(!seen.has(node.role), `Unique authored DOM object role ${node.role}`); seen.add(node.role);
    if (node.nodeType === 3) {
      assert(node.role.endsWith('_text')); const role = node.role.slice(0, -5);
      assert(table[role], `DOM text has independent native role ${role}`);
      assert.equal(node.data, atDocument(document, table[role]).text, `Exact authored DOM/native text ${role}`);
    } else { assert(Array.isArray(node.children)); pending.push(...node.children); }
  }
}

/** Every call reads and returns fresh data. Originals are never modified on disk.
 * The only resolution is the complete, hard-pinned two-object erratum below.
 */
export function loadCompositionContract() {
  const pins = [], verified = new Map();
  const read = path => {
    assert(typeof path === 'string' && !isAbsolute(path) && !path.includes('\\') && !path.includes('\0'));
    assert(!path.split('/').includes('..'), 'Contract pin escapes repository');
    const absolute = resolve(root, path); assert(!relative(root, absolute).startsWith('..'));
    return readFileSync(absolute);
  };
  const parse = path => JSON.parse(read(path).toString('utf8'));
  const verify = (path, expected) => {
    const bytes = read(path), actual = { path, bytes: bytes.length, sha256: hash(bytes) };
    assert.equal(actual.bytes, expected.bytes, `Frozen bytes ${path}`); assert.equal(actual.sha256, expected.sha256, `Frozen SHA ${path}`);
    if (verified.has(path)) assert.deepEqual(actual, verified.get(path));
    else { verified.set(path, actual); pins.push(actual); }
    return actual;
  };
  verify(`${base}/manifest.json`, { bytes: 6901, sha256: '6f2dd52af470b05c1b1fc263fe4349c421b1e6e3b30c0bfc3a0b67f79c8a747b' });
  const manifest = parse(`${base}/manifest.json`);
  assert.equal(manifest.format, 'editor-composition-contract/1'); assert.equal(manifest.status, 'FROZEN_BEFORE_IMPLEMENTATION');
  assert.equal(manifest.files.length, 32); assert.equal(new Set(manifest.files.map(f => f.path)).size, 32);
  for (const file of manifest.files) verify(`${base}/${file.path}`, file);
  for (const file of manifest.externalAssets) verify(file.path, file);
  for (const file of manifest.legacyContractManifests) verify(file.path, file);
  const old39 = parse('contracts/dom/v1/manifest.json'), old40 = parse('contracts/selection/v1/manifest.json');
  for (const file of old39.files) verify(`contracts/dom/v1/${file.path}`, file);
  for (const file of old40.files) verify(`contracts/selection/v1/${file.path}`, file);
  for (const file of old40.externalAssets) verify(file.path, file);
  verify(old40.legacy39Manifest.path, old40.legacy39Manifest);
  verify(old40.legacy39PublicTypesSnapshot.path, old40.legacy39PublicTypesSnapshot);
  assert.equal(old39.publicTypes.bytes, old40.legacy39PublicTypesSnapshot.bytes);
  assert.equal(old39.publicTypes.sha256, old40.legacy39PublicTypesSnapshot.sha256, 'Historical39 type bytes, not current runtime declaration');

  const native = parse(`${base}/native-oracles.json`), events = parse(`${base}/event-oracles.json`), rawDom = parse(`${base}/dom-oracles.json`);
  assert.equal(native.cases.length, 30); assert.equal(events.rows.length, 40); assert.equal(rawDom.cases.length, 18);
  unique(native.cases, 'native'); unique(events.rows, 'event'); unique(rawDom.cases, 'DOM');
  const nativeById = new Map(native.cases.map(c => [c.id, c]));
  const familyIds = new Set(native.families.map(f => f.id)); assert.equal(familyIds.size, 15);
  for (const c of native.cases) {
    assert(familyIds.has(c.family)); assert.equal(c.input.canonical_json, compact(c.input.document));
    assert.equal(c.after_canonical_json, compact(c.after_document));
    assert.equal(read(`${base}/${c.input_file}`).toString('utf8'), c.input.canonical_json + '\n');
    assert.equal(read(`${base}/${c.expected_file}`).toString('utf8'), c.after_canonical_json + '\n');
    roleBijection(c.input.identity_roles, c.input.document); roleBijection(c.after_identity_roles, c.after_document);
    assert.deepEqual(c.input.identity_roles, native.seeds[c.seed].roles); assert.deepEqual(c.input.document, native.seeds[c.seed].document);
    assert.deepEqual(c.before_state.selection, c.input.selection);
    for (const direction of ['undo', 'redo']) if (c[direction]) {
      assert.equal(c[direction].canonical_json, compact(c[direction].document));
      roleBijection(c[direction].identity_roles, c[direction].document);
    }
    if (c.undo) {
      assert.deepEqual(c.undo.document, c.input.document); assert.deepEqual(c.undo.state.selection, c.input.selection);
      assert.deepEqual(c.redo.document, c.after_document); assert.deepEqual(c.redo.state.selection, c.after_state.selection);
      const f = native.families.find(f => f.id === c.family);
      assert.deepEqual(JSON.parse(c.command.payload_json), { kind: 'insert_text', text: f.replacement });
      assert.deepEqual(c.command, c.query_request.command); assert.deepEqual(c.command, c.execute_request.command);
    }
  }
  for (const id of familyIds) {
    const forward = nativeById.get(`${id}-forward`), reverse = nativeById.get(`${id}-reverse`); assert(forward && reverse);
    assert.deepEqual(forward.input.selection.anchor, reverse.input.selection.focus);
    assert.deepEqual(forward.input.selection.focus, reverse.input.selection.anchor);
    assert.equal(forward.after_canonical_json, reverse.after_canonical_json);
  }

  const erratumBytes = read(erratumPath); assert.equal(hash(erratumBytes), erratumHash, 'Explicit authoring correction hard pin');
  const decision = JSON.parse(erratumBytes.toString('utf8'));
  verify(erratumPath, { bytes: erratumBytes.length, sha256: erratumHash });
  assert.equal(decision.format, 'composition-input-erratum/1'); assert.equal(decision.id, '001-d11-outside-heading');
  assert.equal(decision.status, 'AUTHORING_CORRECTION_NOT_ACCEPTANCE'); assert.equal(decision.unchangedFrozenV1Bytes, true);
  assert.equal(decision.frozenContractCommit, 'fd5439e');
  assert.equal(decision.serialization.digest, 'SHA256 of UTF8 JSON with sort_keys=true, compact separators, ensure_ascii=false; no trailing newline');
  for (const file of decision.originalFiles) verify(file.repositoryPath, file);
  assert.deepEqual(decision.originalSourcePins.dom, rawDom.sourcePins);
  assert.deepEqual(decision.originalSourcePins.native, native.selectedSources);
  assert.deepEqual(decision.originalSourcePins.refineInput, native.refineInput);
  const expectedWhitelist = [
    { target: 'fixtures.D', path: ['before'], operation: 'replace2elementArrayWithOriginalParagraphOnly' },
    { target: 'fixtures.D', path: ['roles'], operation: 'removeOnlyKeys', keys: ['H', 'O_outer', 'O_text'] },
    { target: 'fixtures.D', path: ['outsideAfter'], operation: 'replace', before: 'H', after: null },
    { target: 'cases[id=D11-readable-scalar-EGC-refusal]', path: ['actualFinalDom'], operation: 'replace2elementArrayWithOriginalParagraphOnly' },
    { target: 'cases[id=D11-readable-scalar-EGC-refusal]', path: ['expected', 'restoredAffectedCommittedDom'], operation: 'replace2elementArrayWithOriginalParagraphOnly' },
  ];
  assert.deepEqual(decision.allowedFieldChanges, expectedWhitelist);
  assert.equal(decision.replacements.length, 2);
  const [fixtureChange, caseChange] = decision.replacements;
  assert.deepEqual(fixtureChange.target, { kind: 'fixture', key: 'D' });
  assert.deepEqual(caseChange.target, { kind: 'case', id: 'D11-readable-scalar-EGC-refusal' });
  const originalCase = rawDom.cases.find(c => c.id === caseChange.target.id); assert(originalCase);
  for (const [replacement, original] of [[fixtureChange, rawDom.fixtures.D], [caseChange, originalCase]]) {
    assert.deepEqual(original, replacement.before, 'Exact complete before object');
    assert.equal(dataHash(original), replacement.beforeDataSha256, 'Independent stable data before digest');
    assert.equal(dataHash(replacement.after), replacement.afterDataSha256, 'Independent stable data after digest');
  }
  const firstParagraphOnly = array => {
    assert.equal(array.length, 2); assert.equal(array[0].role, 'P'); assert.equal(array[0].tag, 'p');
    assert.equal(array[1].role, 'H'); assert.equal(array[1].tag, 'h3'); return [structuredClone(array[0])];
  };
  const checkedFixture = structuredClone(fixtureChange.before);
  checkedFixture.before = firstParagraphOnly(checkedFixture.before);
  for (const key of ['H', 'O_outer', 'O_text']) { assert(Object.hasOwn(checkedFixture.roles, key)); delete checkedFixture.roles[key]; }
  assert.equal(checkedFixture.outsideAfter, 'H'); checkedFixture.outsideAfter = null;
  assert.deepEqual(checkedFixture, fixtureChange.after, 'Only the exact three fixture fields may change');
  const checkedCase = structuredClone(caseChange.before);
  checkedCase.actualFinalDom = firstParagraphOnly(checkedCase.actualFinalDom);
  checkedCase.expected.restoredAffectedCommittedDom = firstParagraphOnly(checkedCase.expected.restoredAffectedCommittedDom);
  assert.deepEqual(checkedCase, caseChange.after, 'Only the exact two case fields may change');
  const authority = decision.unchangedNativeAuthority;
  assert.deepEqual(authority.caseIds, ['P11-forward', 'P11-reverse']);
  assert.equal(authority.nativeAliasRetained, 'P11-forward'); assert.equal(authority.nativeResponseCode, 'position.invalid');
  assert.equal(read(`${base}/${authority.inputFile}`).toString('utf8'), compact(authority.document) + '\n');
  assert.equal(read(`${base}/${authority.expectedFile}`).toString('utf8'), authority.expectedCanonicalJson + '\n');
  for (const id of authority.caseIds) {
    const c = nativeById.get(id); assert(c); assert.equal(dataHash(c), authority.nativeCaseRecordDataSha256[id]);
    assert.deepEqual(c.input.document, authority.document); assert.equal(c.input.canonical_json, authority.expectedCanonicalJson);
    assert.equal(c.after_canonical_json, authority.expectedCanonicalJson); assert.equal(c.execute_expected.diagnostic.code, 'position.invalid');
  }
  const dom = structuredClone(rawDom);
  dom.fixtures.D = structuredClone(fixtureChange.after);
  dom.cases[dom.cases.findIndex(c => c.id === caseChange.target.id)] = structuredClone(caseChange.after);
  const independentlyResolved = structuredClone(rawDom); independentlyResolved.fixtures.D = checkedFixture;
  independentlyResolved.cases[independentlyResolved.cases.findIndex(c => c.id === caseChange.target.id)] = checkedCase;
  assert.deepEqual(dom, independentlyResolved, 'Every other raw data object is intact');

  const refs = [];
  function nativeReferences(value, path) {
    if (Array.isArray(value)) { value.forEach((v, i) => nativeReferences(v, `${path}/${i}`)); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'nativeCase' && item !== null) {
        assert(nativeById.has(item), `Declared nativeCase ${path}: ${item}`); refs.push({ path: `${path}/${key}`, nativeCase: item });
        if (value.seed) assert.equal(value.seed, nativeById.get(item).seed, `Native seed ${path}`);
      }
      nativeReferences(item, `${path}/${key}`);
    }
  }
  nativeReferences(events, '/events'); nativeReferences(dom, '/dom');
  for (const row of events.rows) for (const step of row.steps ?? []) if (step.reuse) {
    const prefix = step.reuse.match(/^E\d{2}(?=\b)/)?.[0]; assert(prefix);
    assert(events.rows.some(row => row.id.startsWith(`${prefix}-`)), 'Declared finite event-prefix reuse');
  }
  for (const [seed, fixture] of Object.entries(dom.fixtures)) {
    assert.equal(fixture.nativeInput, `inputs/${seed}.json`);
    const roles = new Set();
    for (const [role, path] of Object.entries(fixture.roles)) {
      assert(!roles.has(JSON.stringify(path))); roles.add(JSON.stringify(path)); assert.equal(atDom(fixture.before, path).role, role);
    }
    const nativeCase = native.cases.find(c => c.seed === seed); assert(nativeCase); textRelations(fixture.before, nativeCase, 'input');
  }
  for (const row of [...dom.cases, ...dom.installedLiteralBranches]) if (row.nativeCase) {
    const c = nativeById.get(row.nativeCase);
    const committed = row.expectedCommittedDom ?? row.expected?.committedDom ?? row.expected?.restoredAffectedCommittedDom;
    if (committed) textRelations(committed, c, 'after');
    const caret = row.nativeCaret ?? row.expected?.finalNativeCaret;
    if (caret) assert.deepEqual(c.after_state.selection, { anchor: { kind: caret.kind, node: caret.role, offset: caret.offsetUtf16, affinity: caret.affinity }, focus: { kind: caret.kind, node: caret.role, offset: caret.offsetUtf16, affinity: caret.affinity } });
  }
  const installedText = read(`${base}/installed-matrix.md`).toString('utf8');
  assert.equal(installedText.split('\n').filter(line => /^\| I0[1-6] /.test(line)).length, 6);
  assert.deepEqual(manifest.counts, { nativeCases: 30, eventPolicyRows: 40, domCases: 18, installedRows: 24, browserLocales: 4, boundaryRecipes: 10 });
  assert.equal(dom.caseCount, 18); assert.equal(events.count, 40); assert.equal(dom.boundaryRecipes.length, 10);
  const errata = [{ path: erratumPath, bytes: erratumBytes.length, sha256: erratumHash,
    status: decision.status, qualification: decision.qualification, replacedTargets: decision.replacements.map(r => r.target),
    declaredDataDigestsVerified: true, originalNativeP11Unchanged: true, nativeReferences: refs,
    originalDomSha256: verified.get(`${base}/dom-oracles.json`).sha256, resolvedDomDataSha256: dataHash(dom), decision }];
  return { manifest, native, events, dom, errata, pins };
}
