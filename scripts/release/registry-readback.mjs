// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const npmRegistry = 'https://registry.npmjs.org';
const cratesRegistry = 'https://crates.io';
const cratesIndex = 'https://index.crates.io';
const cratesStorage = 'https://static.crates.io';

function registryError(code, message, response, cause) {
  return Object.assign(new Error(message, { cause }), {
    code,
    ...(response ? { statusCode: response.status, retryAfter: response.headers.get('retry-after') } : {}),
  });
}

async function fetchPublic(url, accept) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept,
        'accept-encoding': 'identity',
        'cache-control': 'no-cache',
        'user-agent': 'KlenWriter-release-readback/1.0',
      },
    });
  } catch (cause) {
    throw registryError('REGISTRY_UNAVAILABLE', 'Public registry GET failed for ' + url, undefined, cause);
  }
  if (response.redirected || (response.status >= 300 && response.status < 400) ||
      (response.url && new URL(response.url).href !== new URL(url).href)) {
    throw registryError('REGISTRY_REDIRECT', 'Unexpected registry redirect for ' + url, response);
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw registryError('REGISTRY_UNAVAILABLE', 'Registry returned HTTP ' + response.status + ' for ' + url, response);
  }
  return response;
}

async function publicJson(url) {
  const response = await fetchPublic(url, 'application/json');
  return response === null ? null : response.json();
}

function matchVisibility(first, second, name) {
  if (Boolean(first) !== Boolean(second)) {
    throw registryError('REGISTRY_PROPAGATION', 'Registry metadata sources disagree about availability for ' + name);
  }
  return Boolean(first);
}

async function verifyDownload(url, artifact) {
  const response = await fetchPublic(url, 'application/octet-stream');
  if (response === null) {
    throw registryError('REGISTRY_PROPAGATION', 'Registry metadata exists but the archive is unavailable for ' + artifact.name);
  }
  assert(response.body, 'Registry download has no body');
  const sha256 = createHash('sha256');
  const sha512 = artifact.kind === 'npm' ? createHash('sha512') : null;
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    assert(bytes <= artifact.bytes, 'Registry archive exceeds the accepted size for ' + artifact.name);
    sha256.update(chunk);
    sha512?.update(chunk);
  }
  assert.equal(bytes, artifact.bytes, 'Registry archive size differs for ' + artifact.name);
  assert.equal(sha256.digest('hex'), artifact.sha256, 'Registry archive checksum differs for ' + artifact.name);
  if (sha512) assert.equal('sha512-' + sha512.digest('base64'), artifact.integrity,
    'Registry archive integrity differs for ' + artifact.name);
}

async function readNpm(artifact) {
  const { name, version, integrity } = artifact;
  const packageUrl = npmRegistry + '/' + encodeURIComponent(name).replace(/^%40/, '@');
  const metadataUrl = packageUrl + '/' + encodeURIComponent(version);
  const packageLink = 'https://www.npmjs.com/package/' + name + '/v/' + version;
  const [exact, packument] = await Promise.all([publicJson(metadataUrl), publicJson(packageUrl)]);
  if (packument !== null) {
    assert.equal(packument.name, name, 'Unexpected npm package name');
    assert(packument.versions && typeof packument.versions === 'object', 'Missing versions in npm metadata');
  }
  const listed = packument?.versions[version];
  const links = { package: packageLink, metadata: metadataUrl };
  for (const metadata of [exact, listed]) {
    if (metadata == null) continue;
    assert.equal(metadata.name, name, 'Unexpected npm package name');
    assert.equal(metadata.version, version, 'Unexpected npm package version');
    assert.equal(metadata.dist?.integrity, integrity, 'npm integrity differs for ' + name);
  }
  if (!matchVisibility(exact, listed, name)) return { status: 'absent', links };
  assert(exact.dist.tarball === listed.dist.tarball, 'npm metadata disagrees about the archive URL for ' + name);
  assert(URL.canParse(exact.dist.tarball), 'Invalid npm archive URL for ' + name);
  const canonical = new URL(exact.dist.tarball);
  const basename = name.split('/').at(-1);
  assert(canonical.origin === npmRegistry && !canonical.username && !canonical.password && !canonical.search &&
    !canonical.hash && decodeURIComponent(canonical.pathname) === '/' + name + '/-/' + basename + '-' + version + '.tgz',
    'Unexpected npm archive URL for ' + name);
  await verifyDownload(canonical.href, artifact);
  return {
    status: 'verified', bytes: artifact.bytes, sha256: artifact.sha256, integrity,
    deprecated: exact.deprecated ?? listed.deprecated ?? null,
    distTags: packument['dist-tags'] ?? {},
    links: { ...links, archive: canonical.href, packageMetadata: packageUrl },
  };
}

function indexPath(name) {
  if (name.length === 1) return '1/' + name;
  if (name.length === 2) return '2/' + name;
  if (name.length === 3) return '3/' + name[0] + '/' + name;
  return name.slice(0, 2) + '/' + name.slice(2, 4) + '/' + name;
}

async function readCrate(artifact) {
  const { name, version, sha256 } = artifact;
  const metadataUrl = cratesRegistry + '/api/v1/crates/' + name + '/' + encodeURIComponent(version);
  const indexUrl = cratesIndex + '/' + indexPath(name);
  const archive = cratesStorage + '/crates/' + name + '/' + name + '-' + encodeURIComponent(version) + '.crate';
  const packageLink = cratesRegistry + '/crates/' + name + '/' + encodeURIComponent(version);
  const links = { package: packageLink, metadata: metadataUrl, index: indexUrl };
  const [metadata, sparse] = await Promise.all([publicJson(metadataUrl), fetchPublic(indexUrl, 'text/plain')]);
  const rows = sparse === null ? [] : (await sparse.text()).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  assert(rows.every(row => row.name === name), 'Unexpected crate name in the sparse index');
  const versions = rows.filter(row => row.vers === version);
  assert(versions.length <= 1, 'Duplicate crate version in the sparse index');
  if (metadata !== null) {
    assert.equal(metadata.version?.crate, name, 'Unexpected crates.io package name');
    assert.equal(metadata.version.num, version, 'Unexpected crates.io package version');
    assert.equal(metadata.version.checksum, sha256, 'crates.io metadata checksum differs for ' + name);
    assert.equal(typeof metadata.version.yanked, 'boolean', 'Missing crates.io yanked state');
  }
  if (versions.length > 0) {
    assert.equal(versions[0].cksum, sha256, 'Sparse index checksum differs for ' + name);
    assert.equal(typeof versions[0].yanked, 'boolean', 'Missing sparse index yanked state');
  }
  if (!matchVisibility(metadata, versions[0], name)) return { status: 'absent', links };
  if (metadata.version.yanked !== versions[0].yanked) {
    throw registryError('REGISTRY_PROPAGATION', 'Registry metadata sources disagree about yanked state for ' + name);
  }
  await verifyDownload(archive, artifact);
  return { status: 'verified', bytes: artifact.bytes, sha256, yanked: versions[0].yanked, links: { ...links, archive } };
}

/** Check the published version and exact archive bytes through public registry endpoints. */
export async function readRegistryArtifact(artifact) {
  const { name, kind, version, bytes, sha256, integrity } = artifact;
  assert(kind === 'npm' || kind === 'crate', 'Unsupported registry artifact kind');
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  assert(Number.isSafeInteger(bytes) && bytes > 0, 'Invalid registry artifact size');
  assert.match(sha256, /^[a-f0-9]{64}$/);
  if (kind === 'npm') {
    assert.match(name, /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);
    assert.match(integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  } else {
    assert.match(name, /^[a-z0-9][a-z0-9_-]*$/);
  }
  const record = kind === 'npm' ? await readNpm(artifact) : await readCrate(artifact);
  return { name, kind, version, ...record };
}
