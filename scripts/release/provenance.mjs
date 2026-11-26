// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { defaultSdkCargoFeatures } from '../sdk-distribution.mjs';

const digest = (bytes, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(bytes).digest(encoding);
const parse = bytes => JSON.parse(bytes.toString('utf8'));
const packageKey = ({ name, version }) => `${name}@${version}`;
const spdxId = key => `SPDXRef-Package-${digest(key)}`;
const byText = (a, b) => a < b ? -1 : a === b ? 0 : 1;
const archiveLicenses = ['LICENSE-APACHE', 'LICENSE-MIT'];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(byText).map(key => [key, canonical(value[key])]));
  }
  return value;
}

const json = value => JSON.stringify(canonical(value), null, 2) + '\n';

function fileRecord(path, bytes) {
  return { path, bytes: bytes.length, sha256: digest(bytes) };
}

function readArchive(bytes, artifact) {
  const tar = args => execFileSync('tar', args, { input: bytes, maxBuffer: 8 * 1024 * 1024 });
  const members = tar(['-tzf', '-']).toString('utf8').trimEnd().split('\n');
  const prefix = artifact.kind === 'npm' ? 'package/' : `${artifact.name}-${artifact.version}/`;
  const names = new Set(members);
  assert.equal(members.length, names.size, 'Duplicate archive member');
  return name => {
    assert(names.has(prefix + name), `Archive is missing ${name}`);
    return tar(['-xOzf', '-', '--', prefix + name]);
  };
}

function makePackage(id, { name, version, license, purl, checksum, integrity, location, comment }) {
  const pkg = {
    SPDXID: id, name, versionInfo: version, downloadLocation: location ?? 'NOASSERTION',
    filesAnalyzed: false, licenseConcluded: 'NOASSERTION', licenseDeclared: license,
    copyrightText: 'NOASSERTION',
  };
  const checksums = [];
  if (checksum) checksums.push({ algorithm: 'SHA256', checksumValue: checksum });
  if (integrity) {
    assert.match(integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
    checksums.push({ algorithm: 'SHA512', checksumValue: Buffer.from(integrity.slice(7), 'base64').toString('hex') });
  }
  if (checksums.length) pkg.checksums = checksums;
  if (purl) pkg.externalRefs = [{ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: purl }];
  if (comment) pkg.comment = comment;
  return pkg;
}

function newInventory(artifact, license, purl, comment) {
  const root = makePackage(spdxId(`artifact:${artifact.kind}:${packageKey(artifact)}`), {
    ...artifact, license, purl, checksum: artifact.sha256, comment,
  });
  const packages = new Map([[root.SPDXID, root]]);
  const relations = new Map();
  const attach = (from, relationshipType, to, comment) => {
    const relationship = { spdxElementId: from, relationshipType, relatedSpdxElement: to };
    if (comment) relationship.comment = comment;
    relations.set(JSON.stringify(relationship), relationship);
  };
  attach('SPDXRef-DOCUMENT', 'DESCRIBES', root.SPDXID);
  const add = (key, facts) => {
    const id = spdxId(key);
    if (!packages.has(id)) packages.set(id, makePackage(id, facts));
    return id;
  };
  const document = (manifest, repository) => ({
    SPDXID: 'SPDXRef-DOCUMENT', spdxVersion: 'SPDX-2.3', dataLicense: 'CC0-1.0',
    name: `${artifact.kind} ${packageKey(artifact)}`,
    documentNamespace: `${repository}/spdx/${manifest.source.commit}/${artifact.sha256}/${root.SPDXID}`,
    creationInfo: {
      creators: ['Tool: KlenWriter Editor release provenance'],
      created: new Date(Number(manifest.source.sourceDateEpoch) * 1000).toISOString().replace('.000Z', 'Z'),
    },
    packages: [...packages.values()].sort((a, b) => byText(a.SPDXID, b.SPDXID)),
    relationships: [...relations.keys()].sort(byText).map(key => relations.get(key)),
  });
  return { root: root.SPDXID, add, attach, document };
}

function readCargoFacts(sourceRoot, lock) {
  const cargo = args => execFileSync('cargo', args, {
    cwd: sourceRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  const metadata = JSON.parse(cargo(['metadata', '--locked', '--offline', '--all-features', '--format-version=1']));
  const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
  const byKey = new Map(metadata.packages.map(pkg => [packageKey(pkg), pkg]));
  assert.equal(byKey.size, packages.size, 'Cargo name/version identities must be unique');
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  const checksums = new Map();
  for (const block of lock.toString('utf8').split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const field = key => new RegExp(`^${key} = "([^"\\n]+)"$`, 'm').exec(block)?.[1];
    if (field('checksum')) {
      assert.match(field('checksum'), /^[0-9a-f]{64}$/);
      checksums.set(`${field('name')}@${field('version')}`, field('checksum'));
    }
  }
  const component = (inventory, pkg) => {
    const key = packageKey(pkg);
    const checksum = checksums.get(key);
    if (pkg.source) {
      assert.equal(pkg.source, 'registry+https://github.com/rust-lang/crates.io-index');
      assert(checksum, `Missing Cargo.lock checksum for ${key}`);
    }
    assert(pkg.license, `Missing Cargo license for ${key}`);
    return inventory.add(`cargo:${key}`, {
      ...pkg, checksum, purl: `pkg:cargo/${key}`,
      location: pkg.source ? `https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate` : undefined,
    });
  };
  const wasmDependencies = (packageName, edges) => {
    const tree = cargo(['tree', '--locked', '--offline', '--target', 'wasm32-unknown-unknown',
      '-p', packageName, ...defaultSdkCargoFeatures, '-e', edges, '--prefix', 'none', '--format', '{p}']);
    return new Set(tree.trimEnd().split('\n').map(line => {
      const match = /^([\w-]+) v(\S+)(?:\s|$)/.exec(line);
      assert(match, `Unrecognized Cargo tree package: ${line}`);
      const pkg = byKey.get(`${match[1]}@${match[2]}`);
      assert(pkg, `Cargo tree package absent from locked metadata: ${match[1]}`);
      return pkg;
    }));
  };
  return { packages, byKey, nodes, component, wasmDependencies };
}

function addCargoSourceGraph(inventory, facts, artifact) {
  const root = facts.byKey.get(packageKey(artifact));
  assert(root && !root.source, `Missing workspace source crate ${packageKey(artifact)}`);
  const visited = new Set();
  function visit(pkg, parent) {
    if (visited.has(pkg.id)) return;
    visited.add(pkg.id);
    for (const dep of facts.nodes.get(pkg.id).deps) {
      const target = facts.packages.get(dep.pkg);
      if (target === root) continue;
      for (const { kind, target: platform } of dep.dep_kinds) {
        if (kind === 'dev' && pkg !== root) continue;
        const component = facts.component(inventory, target);
        const relation = kind === 'dev' ? 'DEV_DEPENDENCY_OF'
          : kind === 'build' || target.targets.some(entry => entry.kind.includes('proc-macro')) ? 'BUILD_DEPENDENCY_OF'
          : 'DEPENDENCY_OF';
        inventory.attach(component, relation, parent, platform ?? undefined);
        visit(target, component);
      }
    }
  }
  visit(root, inventory.root);
}

function parseWasmNotices(notice, facts) {
  const text = notice.toString('utf8');
  const sections = [...text.matchAll(/^===== ([\w-]+) (\S+) \((.+)\) =====$/gm)];
  const expected = new Set([...facts.packages.values()].filter(pkg => pkg.source));
  const noticed = new Set();
  for (const [index, section] of sections.entries()) {
    const pkg = facts.byKey.get(`${section[1]}@${section[2]}`);
    assert(expected.has(pkg) && !noticed.has(pkg), `Unexpected Rust notice: ${section[0]}`);
    assert.equal(section[3], pkg.license, `Rust notice license differs for ${packageKey(pkg)}`);
    assert.match(text.slice(section.index + section[0].length, sections[index + 1]?.index), /^--- .+ ---$/m);
    noticed.add(pkg);
  }
  assert.deepEqual(noticed, expected, 'WASM notices differ from the all-feature locked workspace inventory');
  return noticed;
}

function addWasmGraph(inventory, wasmRoot, facts, graph) {
  for (const pkg of new Set([...graph.build, ...graph.noticed])) {
    const id = facts.component(inventory, pkg);
    if (pkg.name === graph.sourcePackage) inventory.attach(wasmRoot, 'GENERATED_FROM', id);
    else if (graph.runtime.has(pkg)) inventory.attach(wasmRoot, 'DEPENDS_ON', id, 'Normal dependency in the locked wasm32 build graph, excluding proc macros.');
    else if (graph.build.has(pkg)) inventory.attach(id, 'BUILD_DEPENDENCY_OF', wasmRoot, 'Build input or proc macro in the locked wasm32 build graph.');
    else inventory.attach(wasmRoot, 'OTHER', id, 'Conservative producer NOTICE coverage of the locked all-feature workspace.');
  }
}

function npmPurl(name, version) {
  return `pkg:npm/${name.split('/').map(encodeURIComponent).join('/')}@${version}`;
}

function addNpmGraph(inventory, lock, entry, pkg) {
  const visited = new Set();
  const dependencyFields = [
    ['dependencies', 'DEPENDENCY_OF'],
    ['optionalDependencies', 'OPTIONAL_DEPENDENCY_OF'],
    ['peerDependencies', 'DEPENDENCY_OF'],
  ];
  for (const [field] of dependencyFields) {
    assert.deepEqual(pkg[field] ?? {}, lock[entry.path][field] ?? {}, `${pkg.name}: lock differs for ${field}`);
  }
  assert.deepEqual(pkg.peerDependenciesMeta ?? {}, lock[entry.path].peerDependenciesMeta ?? {});
  function resolveDependency(from, name) {
    for (let path = from; ; path = posix.dirname(path)) {
      const resolved = posix.join(path, 'node_modules', name);
      const dependency = lock[resolved];
      if (dependency) return dependency.link ? dependency.resolved : resolved;
      if (path === '.') return undefined;
    }
  }
  function visit(path, parent) {
    if (visited.has(path)) return;
    visited.add(path);
    const item = lock[path];
    for (const [field, relation] of dependencyFields) {
      for (const [name, requirement] of Object.entries(item[field] ?? {})) {
        const peer = field === 'peerDependencies';
        const optional = field === 'optionalDependencies' || (peer && item.peerDependenciesMeta?.[name]?.optional);
        const targetPath = resolveDependency(path, name);
        if (!targetPath && optional) continue;
        assert(targetPath, `Missing locked npm dependency ${name} from ${path}`);
        const target = lock[targetPath];
        assert(target?.version && target.license, `Missing npm identity/license for ${name}`);
        const id = inventory.add(`npm:${name}@${target.version}`, {
          name, version: target.version, license: target.license, purl: npmPurl(name, target.version),
          location: target.resolved, integrity: target.integrity,
        });
        inventory.attach(id, optional ? 'OPTIONAL_DEPENDENCY_OF' : relation, parent,
          `${peer ? 'Host peer' : 'Registry dependency'} requirement ${requirement}.`);
        visit(targetPath, id);
      }
    }
  }
  visit(entry.path, inventory.root);
}

function parserNotices(read, lock) {
  const asset = path => {
    assert(path.startsWith('packages/kwdj/dist/'));
    return path.slice('packages/kwdj/'.length);
  };
  const info = parse(read('dist/clipboard-parser.manifest.json'));
  assert.equal(info.format, 'klenwriter-clipboard-parser-build/1');
  const related = new Map();
  for (const item of info.runtimePackages) {
    assert(!related.has(item.name), 'Duplicate clipboard parser dependency');
    const dependency = lock[`node_modules/${item.name}`];
    for (const key of ['version', 'license', 'resolved', 'integrity']) assert.equal(item[key], dependency[key]);
    assert.deepEqual(item.dependencies, dependency.dependencies ?? {});
    const path = asset(item.notice);
    const bytes = read(path);
    assert.equal(bytes.length, item.originalLicense.bytes);
    assert.equal(digest(bytes), item.originalLicense.sha256);
    related.set(item.name, { ...item, path, bytes });
  }
  const path = 'dist/clipboard-parser.NOTICE.txt';
  const bytes = read(path);
  const parser = read('dist/clipboard-parser.js');
  for (const [name, content] of [[path, bytes], ['dist/clipboard-parser.js', parser]]) {
    const row = info.artifacts.find(row => row.path === `packages/kwdj/${name}`);
    assert(row && row.bytes === content.length && row.sha256 === digest(content), `Clipboard parser receipt differs for ${name}`);
  }
  for (const item of related.values()) {
    const heading = `=== ${item.name} ${item.version} — ${item.license} ===\n`;
    assert(bytes.includes(Buffer.concat([Buffer.from(heading), item.bytes])), `Missing combined notice for ${item.name}`);
    assert(Object.keys(item.dependencies).every(name => related.has(name)), `Incomplete parser inventory for ${item.name}`);
  }
  assert.deepEqual(new Set(info.graph.runtimePackages), new Set(related.keys()));
  return { related, path, bytes };
}

export function writeReleaseProvenance({ sourceRoot, outputDirectory, manifest, packageMap }) {
  const input = path => readFileSync(resolve(sourceRoot, path));
  const lock = input('Cargo.lock');
  const npmLockBytes = input('package-lock.json');
  const sourceProvenance = input('provenance/source-files.json');
  const npmLock = parse(npmLockBytes).packages;
  const cargo = readCargoFacts(sourceRoot, lock);
  const all = manifest.artifacts.map(artifact => {
    const parts = artifact.path.split('/');
    assert(parts.every(part => part && part !== '.' && part !== '..' && !part.includes('\\')), 'Artifact path must be relative');
    const bytes = readFileSync(resolve(outputDirectory, artifact.path));
    assert.deepEqual(fileRecord(artifact.path, bytes),
      { path: artifact.path, bytes: artifact.bytes, sha256: artifact.sha256 }, `Artifact bytes differ: ${artifact.path}`);
    if (artifact.integrity) assert.equal(`sha512-${digest(bytes, 'sha512', 'base64')}`, artifact.integrity);
    return { artifact, bytes, read: artifact.kind === 'wasm' ? undefined : readArchive(bytes, artifact) };
  }).sort((a, b) => byText(a.artifact.path, b.artifact.path));
  assert.equal(new Set(all.map(row => row.artifact.path)).size, all.length, 'Duplicate artifact path');
  const wasmArchive = all.find(row => row.artifact.kind === 'npm' && row.artifact.name === packageMap.web.wasm.name);
  const wasm = all.find(row => row.artifact.kind === 'wasm');
  assert(wasm && wasmArchive, 'Release must include the standalone WASM and its npm package');
  const wasmPath = 'dist/editor_wasm_bg.wasm';
  assert.equal(wasm.bytes.subarray(0, 8).toString('hex'), '0061736d01000000', 'Invalid WASM header');
  assert.deepEqual(wasm.bytes, wasmArchive.read(wasmPath), 'Standalone WASM differs from its npm package');
  const wasmNoticePath = 'THIRD-PARTY-NOTICES';
  const wasmNotice = wasmArchive.read(wasmNoticePath);
  assert.deepEqual(wasmNotice, input(`${packageMap.web.wasm.path}/${wasmNoticePath}`), 'WASM notices differ from the producer output');
  const sourcePackage = packageMap.rust.wasm.name;
  const wasmGraph = {
    sourcePackage,
    noticed: parseWasmNotices(wasmNotice, cargo),
    runtime: cargo.wasmDependencies(sourcePackage, 'normal,no-proc-macro'),
    build: cargo.wasmDependencies(sourcePackage, 'normal,build'),
  };
  assert([...wasmGraph.runtime].every(pkg => wasmGraph.build.has(pkg)));
  assert([...wasmGraph.build].every(pkg => !pkg.source || wasmGraph.noticed.has(pkg)));

  const files = new Map();
  const subjects = [];
  for (const row of all) {
    const { artifact, read } = row;
    const { kind, name, version } = artifact;
    const cargoEntry = Object.values(packageMap.rust).find(entry => entry.name === name);
    const npmEntry = Object.values(packageMap.web).find(entry => entry.name === name);
    assert(kind === 'crate' && cargoEntry || kind === 'npm' && npmEntry ||
      kind === 'wasm' || kind === 'corpus', `Unknown release artifact: ${kind} ${name}`);
    const purl = kind === 'crate' ? `pkg:cargo/${packageKey(artifact)}`
      : kind === 'npm' ? npmPurl(name, version) : undefined;
    const inventory = newInventory(artifact, packageMap.license, purl,
      'Checksums identify the candidate artifact. Dependency relationships record producer inputs and package requirements.');
    const licenseArchive = kind === 'wasm' ? wasmArchive.read : read;
    const sourceDirectory = kind === 'wasm' ? packageMap.web.wasm.path : kind === 'corpus' ? 'contracts/kwdj/v1'
      : kind === 'crate' ? cargoEntry.path : npmEntry.path;
    const notices = new Map();
    for (const file of [...archiveLicenses, 'NOTICE']) {
      const bytes = licenseArchive(file);
      assert(bytes.length > 0);
      assert.deepEqual(bytes, input(`${sourceDirectory}/${file}`), `${name}: packaged ${file} drift`);
      notices.set(file, bytes);
    }
    if (kind === 'crate' || kind === 'npm') {
      assert.deepEqual(read('SOURCE-PROVENANCE.json'), sourceProvenance);
    }
    if (kind === 'crate') {
      const pkg = read('Cargo.toml').toString('utf8').split(/^\[(?!package\])[\w\s'".-]+\]/m)[0];
      for (const [key, value] of Object.entries({ name, version, license: packageMap.license })) {
        assert.equal(new RegExp(`^${key} = "([^"\\n]+)"$`, 'm').exec(pkg)?.[1], value, `${name}: packaged Cargo ${key}`);
      }
      addCargoSourceGraph(inventory, cargo, artifact);
    } else if (kind === 'npm') {
      const pkg = parse(read('package.json'));
      assert.deepEqual([pkg.name, pkg.version, pkg.license], [name, version, packageMap.license]);
      assert.deepEqual(pkg.bundleDependencies ?? pkg.bundledDependencies ?? [], []);
      assert.deepEqual([npmLock[npmEntry.path].version, npmLock[npmEntry.path].license], [version, packageMap.license]);
      if (name === packageMap.web.kwdj?.name) {
        const parser = parserNotices(read, npmLock);
        for (const item of parser.related.values()) {
          const id = inventory.add(`npm:${packageKey(item)}`, {
            ...item, purl: npmPurl(item.name, item.version), location: item.resolved,
          });
          inventory.attach(inventory.root, 'CONTAINS', id, 'Bundled clipboard parser runtime.');
          notices.set(item.path, item.bytes);
        }
        notices.set(parser.path, parser.bytes);
      }
      addNpmGraph(inventory, npmLock, npmEntry, pkg);
      if (row === wasmArchive) {
        const id = inventory.add(`binary:${wasm.artifact.sha256}`, {
          ...wasm.artifact, license: packageMap.license, checksum: wasm.artifact.sha256,
        });
        inventory.attach(inventory.root, 'CONTAINS', id, wasmPath);
        addWasmGraph(inventory, id, cargo, wasmGraph);
        notices.set(wasmNoticePath, wasmNotice);
      }
    } else if (kind === 'wasm') {
      addWasmGraph(inventory, inventory.root, cargo, wasmGraph);
      notices.set(wasmNoticePath, wasmNotice);
    } else {
      assert.equal(kind, 'corpus');
      const index = parse(read('corpus-package.json'));
      assert.deepEqual([index.package, index.packageVersion], [name, version]);
    }

    const stem = `provenance/${kind}-${posix.basename(artifact.path)}`;
    const sbom = `${stem}.spdx.json`;
    const notice = `${stem}.NOTICE.txt`;
    assert(!files.has(sbom), `Duplicate sidecar path: ${sbom}`);
    files.set(sbom, json(inventory.document(manifest, packageMap.repository)));
    const heading = [`${name} ${version} (${kind})`, `Artifact SHA-256: ${artifact.sha256}`,
      `Source commit: ${manifest.source.commit}`, `Project license: ${packageMap.license}`, ''].join('\n');
    const sections = [...notices.entries()].flatMap(([path, bytes]) =>
      [Buffer.from(`\n===== ${path} =====\n`), bytes, Buffer.from('\n')]);
    files.set(notice, Buffer.concat([Buffer.from(heading), ...sections]));
    subjects.push({
      ...artifact, sbom, notice,
      licenseAndNoticeFiles: [...notices.entries()].map(([path, bytes]) => fileRecord(path, bytes)),
    });
  }

  files.set('provenance/release-provenance.json', json({
    format: 'klenwriter-editor-release-provenance/1',
    manifestFormat: manifest.format,
    version: manifest.version,
    source: manifest.source,
    repository: packageMap.repository,
    tools: manifest.tools,
    packageVersions: manifest.packageVersions,
    editorBuildId: manifest.editorBuildId,
    kwdjProfile: manifest.kwdjProfile,
    inputs: [fileRecord('Cargo.lock', lock), fileRecord('package-lock.json', npmLockBytes),
      fileRecord('package-map.json', input('package-map.json')),
      fileRecord('provenance/source-files.json', sourceProvenance)],
    subjects,
  }));
  mkdirSync(resolve(outputDirectory, 'provenance'), { recursive: true });
  for (const [path, bytes] of files) writeFileSync(resolve(outputDirectory, path), bytes);
  return [...files.keys()].sort(byText);
}
