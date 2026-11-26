// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alphaVersion } from './vanilla-alpha/pack.mjs';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const sources = [
  'docs/quickstart-vanilla.md',
  'docs/quickstart-rust.md',
  'docs/quickstart-angular.md',
  'docs/extension-tutorial.md',
  'docs/support.md',
  'docs/corpus-contributor.md',
  'docs/roadmap.md',
  'docs/versioning.md',
  'docs/migrate-to-1.0.md',
  'docs/support-policy.md',
  'docs/release-rollback.md',
  'docs/release-candidate.md',
  'CHANGELOG.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'examples/vanilla-alpha/README.md',
];
const inputs = new Set(['scripts/build-public-docs.mjs', 'scripts/vanilla-alpha/pack.mjs']);
const pageSet = new Set(sources);
const sha256 = content => createHash('sha256').update(content).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const head = git(['rev-parse', 'HEAD']).trim();
const privatePath = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.git|\.tools|artifacts|node_modules|private(?:[-_]fixtures?)?|fixtures?[-_]private)(?:\/|$)/i;
const credential = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_|github_pat_|glpat-|lin_api_|npm_|sk-(?:proj-)?)[A-Za-z0-9_-]{20,}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b(?:Authorization\s*:\s*Bearer\s+|(?:password|api[_-]?key|(?:access[_-]?)?token|(?:client[_-]?)?secret)\s*[:=]\s*["']?)[A-Za-z0-9_.~+/-]{8,}/i;

function repositoryPath(path) {
  assert(path && !isAbsolute(path) && !privatePath.test(path), 'Public docs reference a private path');
  const absolute = resolve(root, path);
  const repoPath = relative(root, absolute);
  assert(repoPath === path && !repoPath.startsWith('../') && repoPath !== '..', 'Docs path leaves the repository');
  assert(realpathSync(absolute) === absolute, 'Public docs require real repository entries');
  inputs.add(repoPath);
  return absolute;
}

function read(repoPath) {
  return readFileSync(repositoryPath(repoPath), 'utf8');
}

const json = path => JSON.parse(read(path));
const identity = json('package-map.json');
const repository = new URL(identity.repository);
assert(repository.origin === 'https://github.com' && /^\/[\w.-]+\/[\w.-]+$/.test(repository.pathname),
  'Package map must name the public GitHub repository');

function checkPublicUrl(raw, page) {
  assert(URL.canParse(raw), page + ' contains a malformed URL');
  const url = new URL(raw);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  assert(!url.username && !url.password, page + ' contains credentials in a URL');
  assert(!privatePath.test(decodeURIComponent(url.pathname)), page + ' contains a private or unsupported URL');
  // The quickstarts intentionally open the local editor served by their own commands.
  if (['localhost', '127.0.0.1', '[::1]'].includes(host) && url.protocol === 'http:') return;
  assert(url.protocol === 'https:' &&
    host.includes('.') &&
    !/(?:^|\.)(?:linear\.app|aklen\.me|thestand\.tech|internal|local|lan|localhost)$/.test(host) &&
    !/^(?:0|10|127|169\.254|172\.(?:1[6-9]|2\d|3[01])|192\.168)\./.test(host), page + ' contains a private or unsupported URL');
}

function checkPublicText(text, page) {
  assert(!credential.test(text), page + ' contains credential-like material');
  assert(!/\b(?:file|ssh):\/\/|(?:^|[\s("'`])(?:\/home\/|\/Users\/|[A-Za-z]:\\Users\\)|(?:^|[/\s])(?:private[-_]fixtures?|fixtures?[-_]private|fixtures?\/private)(?=$|[/\s])/im.test(text),
    page + ' contains a private path or fixture');
  for (const match of text.matchAll(/\bhttps?:\/\/(?:\[[\da-f:.]+\])?[^\s<>"'`)\]]*/gi)) {
    checkPublicUrl(match[0].replace(/[.,;]+$/, ''), page);
  }
}

const mask = text => text.replace(/[^\r\n]/g, ' ');

function withoutFences(text) {
  let fence;
  return text.split('\n').map(line => {
    const mark = /^ {0,3}(```+|~~~+)(.*)$/.exec(line);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = undefined;
      return mask(line);
    }
    if (!mark) return line;
    fence = mark[1];
    return mask(line);
  }).join('\n');
}

function markup(text) {
  return withoutFences(text).replace(/(`+)[^\n]*?\1/g, mask);
}

const inlineLink = /(?<!\\)\]\([ \t]*(?:<([^>\r\n]+)>|([^\s<>()]+(?:\([^()\r\n]*\)[^\s<>()]*)*))/gd;
const definedLink = /^ {0,3}\[(?!\^)[^\]\r\n]+\]:[ \t]*(?:<([^>\r\n]+)>|([^\s<>]+))/gmd;
const htmlLink = /<(?:a|img)\b[^>]*?\b(?:href|src)\s*=\s*(?:"([^"]+)"|'([^']+)')/gid;

function headings(content) {
  const text = withoutFences(content);
  const anchors = new Set(Array.from(text.matchAll(/<a\b[^>]*\b(?:name|id)\s*=\s*["']([^"']+)["']/g), match => match[1]));
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    const atx = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t\r]*$/.exec(line);
    const title = atx?.[1] ?? (/^ {0,3}[=-]+[ \t\r]*$/.test(line) ? lines[index - 1]?.trim() : '');
    if (!title) continue;
    const slug = title.toLowerCase().replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '').replace(/[ \t]/g, '-');
    let anchor = slug;
    for (let suffix = 1; anchors.has(anchor); suffix++) anchor = slug + '-' + suffix;
    anchors.add(anchor);
  }
  return anchors;
}

const anchorCache = new Map();
function checkAnchor(path, anchor) {
  if (extname(path).toLowerCase() === '.md') {
    if (!anchorCache.has(path)) anchorCache.set(path, headings(read(path)));
    assert(anchorCache.get(path).has(anchor), 'Missing heading anchor in ' + path + ': #' + anchor);
    return;
  }
  const line = /^L([1-9]\d*)(?:-L([1-9]\d*))?$/.exec(anchor);
  assert(line, 'Unsupported anchor in ' + path);
  const start = Number(line[1]);
  const end = Number(line[2] ?? line[1]);
  assert(end >= start && end <= read(path).split('\n').length, 'Missing line anchor in ' + path);
}

function resolveLink(page, destination) {
  assert(!destination.startsWith('//'), page + ' contains a protocol-relative link');
  if (/^https?:\/\//i.test(destination)) {
    checkPublicUrl(destination, page);
    return;
  }
  assert(!/^[\w+.-]+:/.test(destination), page + ' contains an unsupported link scheme');
  const [location, hash] = destination.split(/#(.*)/s);
  const [rawPath, query] = location.split(/\?(.*)/s);
  assert(!rawPath.startsWith('/') && !rawPath.includes('\\'), page + ' contains a link outside the repository');
  const path = rawPath ? relative(root, resolve(root, dirname(page), decodeURIComponent(rawPath))) : page;
  const absolute = repositoryPath(path);
  const directory = statSync(absolute).isDirectory();
  if (hash) {
    assert(!directory, page + ' contains an anchor on a directory link');
    checkAnchor(path, decodeURIComponent(hash));
  }
  const rewrite = !pageSet.has(path);
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const mode = directory ? 'tree' : 'blob';
  const suffix = (query ? '?' + query : '') + (hash ? '#' + hash : '');
  return { path, anchor: hash ? decodeURIComponent(hash) : null, href: rewrite
    ? repository.href + '/' + mode + '/' + head + '/' + encoded + suffix
    : destination };
}

function assemble(page, content) {
  checkPublicText(content, page);
  const checked = [];
  const replacements = [];
  const visible = markup(content);
  for (const pattern of [inlineLink, definedLink, htmlLink]) {
    for (const match of visible.matchAll(pattern)) {
      const [start, end] = match.indices[1] ?? match.indices[2];
      const target = content.slice(start, end);
      const result = resolveLink(page, target);
      if (!result) continue;
      checked.push({ target, ...result });
      if (result.href !== target) replacements.push({ start, end, href: result.href });
    }
  }
  let bundle = content;
  for (const { start, end, href } of replacements.sort((a, b) => b.start - a.start)) {
    bundle = bundle.slice(0, start) + href + bundle.slice(end);
  }
  return { bundle, checked };
}

function requireVersion(page, version) {
  const token = '`' + version + '`';
  assert(read(page).includes(token), page + ' must state the example version ' + version);
}

function webEvidence(path, roles, version, page) {
  const dependencies = json(path).dependencies;
  const declared = Object.keys(dependencies).filter(name => name.startsWith('@klenwriter/editor')).sort();
  const packages = roles.map(role => identity.web[role].name);
  assert.deepEqual(declared, packages.toSorted(), path + ' has a different editor package closure');
  requireVersion(page, version);
  const archives = packages.map(name => {
    const archive = name.slice(1).replace('/', '-') + '-' + version + '.tgz';
    assert.equal(dependencies[name], 'file:./vendor/' + archive, path + ' has an incorrect version for ' + name);
    return { name, version };
  });
  return { manifest: path, version, packages: archives };
}

function versions() {
  const candidate = identity.versions.packageSemver;
  const bootstrap = identity.versions.previewBootstrapSemver;
  const rustManifest = 'examples/native-quickstart/Cargo.toml';
  const native = read(rustManifest);
  const rustNames = ['core', 'engine', 'kwdj'].map(role => identity.rust[role].name);
  const nativePins = new Map(Array.from(native.matchAll(/^(klenwriter-editor-[\w-]+)\s*=\s*"=([^"]+)"$/gm),
    match => [match[1], match[2]]));
  assert.deepEqual([...nativePins.keys()].sort(), rustNames.toSorted(), rustManifest + ' has a different editor crate set');
  for (const name of rustNames) assert.equal(nativePins.get(name), candidate, rustManifest + ' version mismatch for ' + name);
  requireVersion('docs/quickstart-rust.md', candidate);
  requireVersion('docs/extension-tutorial.md', candidate);
  requireVersion('docs/support.md', candidate);
  requireVersion('docs/support.md', bootstrap);
  requireVersion('docs/support.md', alphaVersion);
  const angular = 'examples/angular-quickstart/package.json';
  const angularManifest = json(angular);
  const angularDependencies = { ...angularManifest.dependencies, ...angularManifest.devDependencies };
  assert.equal(angularDependencies['@angular/core'], identity.versions.angularPeer);
  for (const [name, version] of Object.entries(angularDependencies).filter(([name]) => name.startsWith('@angular/'))) {
    assert.equal(version, identity.versions.angularPeer, angular + ' has a mismatched pin for ' + name);
  }
  requireVersion('docs/quickstart-angular.md', identity.versions.angularPeer);
  const vanillaRoles = ['vanilla', 'dom', 'kwdj', 'sdk', 'ui', 'wasm'];
  return {
    packageMap: 'package-map.json',
    candidate,
    bootstrap,
    vanilla: webEvidence('examples/vanilla-quickstart/package.json', vanillaRoles, candidate,
      'docs/quickstart-vanilla.md'),
    playground: webEvidence('examples/vanilla-alpha/package.json', vanillaRoles, alphaVersion,
      'examples/vanilla-alpha/README.md'),
    angular: { angularVersion: identity.versions.angularPeer,
      ...webEvidence(angular, ['angular', 'dom', 'kwdj', 'sdk', 'wasm'], candidate, 'docs/quickstart-angular.md') },
    rust: { manifest: rustManifest, version: candidate, packages: rustNames.map(name => ({ name, version: candidate })) },
  };
}

const pages = sources.map(path => {
  const content = read(path);
  const { bundle, checked } = assemble(path, content);
  return { path, bundle, sourceSha256: sha256(content), sha256: sha256(bundle), localLinks: checked };
});
const versionEvidence = versions();
const tracked = git(['ls-tree', '-r', '--name-only', '-z', head]).split('\0');
const requested = [...inputs].sort();
const matchesHead = requested.every(path => tracked.includes(path) ||
  tracked.some(file => file.startsWith(path + '/'))) &&
  !git(['diff', '--name-only', '--no-renames', '-z', head, '--', ...requested]);
if (process.env.GITHUB_ACTIONS === 'true') assert(matchesHead, 'Public documentation inputs differ from HEAD');
const manifest = {
  schemaVersion: 1,
  headSha: head,
  checkedSha: matchesHead ? head : null,
  versions: versionEvidence,
  pages: pages.map(({ bundle, ...page }) => page),
};

const artifacts = join(root, 'artifacts');
mkdirSync(artifacts, { recursive: true });
assert(realpathSync(artifacts) === artifacts, 'Artifacts directory must be inside the repository');
const output = join(artifacts, 'public-docs');
const stage = mkdtempSync(join(artifacts, '.public-docs-'));
try {
  for (const { path, bundle } of pages) {
    const destination = join(stage, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bundle);
  }
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  rmSync(output, { recursive: true, force: true });
  renameSync(stage, output);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
console.log('Assembled ' + pages.length + ' public documentation pages in artifacts/public-docs' +
  (matchesHead ? ' for ' + head : ' from the working tree at ' + head));
