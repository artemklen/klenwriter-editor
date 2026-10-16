// Read-only consistency checks for the accepted M0 package, not live Linear/Figma verification.
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const EXPECTED_IDS = Array.from({ length: 48 }, (_, index) => `OSR-${26 + index}`);
const REQUIRED = [
  'LICENSE-MIT', 'LICENSE-APACHE',
  ...['master-plan', 'architecture', 'architecture-flows', 'decision-register', 'delivery-map', 'licensing',
    'editing-host-decision', 'extensions-contract', 'unicode-positions', 'cms-inventory',
    'performance-protocol', 'ux-contract'].map(name => `docs/m0/${name}.md`),
  ...['modules', 'editing', 'async-lifecycle'].map(name => `docs/m0/diagrams/${name}.mmd`),
  'evidence/m0/dependency-graph.json', 'evidence/m0/figjam-manifest.json', 'evidence/m0/figjam-readback.xml',
  'evidence/osr-57/profile-vectors.json',
  'evidence/osr-58/automated/observations.json', 'evidence/osr-58/source-manifest.json',
  'evidence/osr-58/native/continuation/index.json',
  ...['position-vectors', 'operation-vectors', 'reference-report'].map(name => `evidence/osr-59/${name}.json`),
  ...['source-provenance', 'source-tree', 'corpus-stages', 'rights-observations'].map(name => `evidence/osr-60/${name}.json`),
  ...['metadata.json', 'series.json', 'summary.json', 'baseline.md', 'paint-supplement.json',
    'webkit-memory-supplement.json'].map(name => `evidence/osr-61/${name}`),
  ...['chromium', 'firefox', 'webkit'].flatMap(engine => [1, 2, 3].map(run => `evidence/osr-61/${engine}-run-${run}.json`)),
  'evidence/osr-62/figma-manifest.json', 'evidence/osr-62/contrast-check.json',
];

const within = (root, path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep); };
const equalSets = (left, right) => left.size === right.size && [...left].every(value => right.has(value));

// Validate actual edges and the supplied order independently; do not compare with a stored successful output.
export function checkGraph(graph, check) {
  if (!check(Array.isArray(graph.issues), 'graph.issues must be an array')) return null;
  const issues = graph.issues;
  if (!check(issues.every(issue => issue && typeof issue.id === 'string' && Array.isArray(issue.blockedBy)
    && issue.blockedBy.every(id => typeof id === 'string')), 'graph issue/edge shapes')) return null;
  const ids = new Set(issues.map(issue => issue.id));
  check(issues.length === 48 && ids.size === 48, 'graph has 48 unique issue IDs');
  check(equalSets(ids, new Set(EXPECTED_IDS)), 'graph contains exactly OSR-26 through OSR-73');
  const edges = issues.flatMap(issue => issue.blockedBy.map(from => [from, issue.id]));
  check(edges.length === 136, `graph has 136 blocking edges (actual ${edges.length})`);
  check(new Set(edges.map(edge => edge.join('→'))).size === edges.length, 'graph has no duplicate edges');
  check(edges.every(([from, to]) => ids.has(from) && ids.has(to)), 'all edge endpoints exist');
  check(edges.every(([from, to]) => from !== to), 'graph has no self edges');
  const successors = new Map([...ids].map(id => [id, []]));
  const degree = new Map([...ids].map(id => [id, 0]));
  for (const [from, to] of edges) if (ids.has(from) && ids.has(to)) {
    successors.get(from).push(to); degree.set(to, degree.get(to) + 1);
  }
  const ready = [...ids].filter(id => degree.get(id) === 0), visited = [];
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index]; visited.push(id);
    for (const next of successors.get(id)) { degree.set(next, degree.get(next) - 1); if (degree.get(next) === 0) ready.push(next); }
  }
  check(visited.length === ids.size, `graph is acyclic${visited.length === ids.size ? '' : `; unresolved: ${[...ids].filter(id => !visited.includes(id)).join(', ')}`}`);
  const order = graph.topologicalOrder;
  if (check(Array.isArray(order) && order.every(id => typeof id === 'string'), 'topologicalOrder must be an ID array')) {
    check(order.length === ids.size && new Set(order).size === order.length && equalSets(new Set(order), ids), 'topologicalOrder covers every issue exactly once');
    const rank = new Map(order.map((id, index) => [id, index]));
    check(edges.every(([from, to]) => rank.has(from) && rank.has(to) && rank.get(from) < rank.get(to)), 'topologicalOrder places every prerequisite before its dependent');
  }
  const byId = new Map(issues.map(issue => [issue.id, issue]));
  check(issues.filter(issue => /^M0\b/.test(issue.milestone)).every(issue => issue.blockedBy.every(id => /^M0\b/.test(byId.get(id)?.milestone))), 'M0 has no prerequisite in a later milestone');
  return { issues: issues.length, edges: edges.length, ids, byId };
}

// Local Markdown links used by these docs: inline/image links, angle destinations,
// balanced parentheses, reference definitions and quoted HTML href/src. Code is ignored.
// Fragment existence and remote URL access deliberately are not asserted.
export function linkDestinations(markdown) {
  let fence = null;
  const prose = markdown.split('\n').map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null; return ''; }
    return fence ? '' : line;
  }).join('\n').replace(/(`+)[\s\S]*?\1/g, '');
  const destinations = [];
  function destinationAt(start) {
    let index = start; while (/\s/.test(prose[index] ?? '') && index < prose.length) index++;
    if (prose[index] === '<') { const end = prose.indexOf('>', index + 1); return end < 0 ? null : prose.slice(index + 1, end); }
    let depth = 0, value = '';
    for (; index < prose.length; index++) {
      const character = prose[index];
      if (character === '\\' && index + 1 < prose.length) { value += prose.slice(index, index + 2); index++; continue; }
      if ((character === ')' && depth === 0) || /\s/.test(character)) break;
      if (character === '(') depth++;
      if (character === ')') depth--;
      value += character;
    }
    return value;
  }
  for (const match of prose.matchAll(/\]\(/g)) { const destination = destinationAt(match.index + 2); if (destination !== null) destinations.push(destination); }
  for (const match of prose.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*/gm)) { const destination = destinationAt(match.index + match[0].length); if (destination !== null) destinations.push(destination); }
  for (const match of prose.matchAll(/\b(?:href|src)\s*=\s*(["'])(.*?)\1/g)) destinations.push(match[2]);
  return destinations.map(value => value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1'));
}

export function runChecks(root = ROOT) {
  const failures = []; let checks = 0;
  const facts = { requiredFiles: REQUIRED.length, markdownFiles: 0, localLinks: 0, externalLinksSkipped: 0, exportsHashed: 0 };
  const check = (ok, message) => { checks++; if (!ok) failures.push(message); return Boolean(ok); };
  const section = (name, operation) => { try { operation(); } catch (error) { check(false, `${name}: ${error.message}`); } };
  const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const file = (path, label) => {
    const absolute = resolve(root, path);
    if (!check(within(root, absolute), `${label}: path must stay inside repository`)) return false;
    try {
      const stat = statSync(absolute);
      return check(stat.isFile() && stat.size > 0 && within(realpathSync(root), realpathSync(absolute)), `${label}: expected nonempty repository file`);
    } catch { return check(false, `${label}: missing/unreadable file ${relative(root, absolute)}`); }
  };
  for (const path of REQUIRED) file(path, path);
  section('dependency graph', () => {
    const graph = checkGraph(readJson('evidence/m0/dependency-graph.json'), check);
    if (!graph) return;
    facts.graphIssues = graph.issues; facts.graphEdges = graph.edges;
    const rows = readFileSync(resolve(root, 'docs/m0/delivery-map.md'), 'utf8').split('\n')
      .filter(line => /^\|\s*\[OSR-\d+\]\(/.test(line)).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
    const rowIds = rows.map(row => row[0].match(/^\[(OSR-\d+)\]/)[1]);
    check(rows.length === graph.issues && new Set(rowIds).size === rows.length && equalSets(new Set(rowIds), graph.ids), 'delivery table covers every graph issue exactly once');
    for (const [index, row] of rows.entries()) {
      const id = rowIds[index], issue = graph.byId.get(id); if (!issue) continue;
      const dependencies = row[3]?.match(/OSR-\d+/g) ?? [];
      check(row.length === 4 && row[2] === issue.title, `${id}: delivery title matches graph`);
      check(issue.milestone === row[1] || issue.milestone?.startsWith(`${row[1]} — `), `${id}: delivery milestone matches graph`);
      check(dependencies.length === issue.blockedBy.length && equalSets(new Set(dependencies), new Set(issue.blockedBy)), `${id}: delivery dependencies match graph`);
    }
  });
  section('local Markdown links', () => {
    const docs = resolve(root, 'docs/m0');
    for (const name of readdirSync(docs).filter(name => name.endsWith('.md')).sort()) {
      const document = resolve(docs, name); facts.markdownFiles++;
      for (const target of linkDestinations(readFileSync(document, 'utf8'))) {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) { facts.externalLinksSkipped++; continue; }
        const pathPart = target.split(/[?#]/, 1)[0];
        let decoded; try { decoded = decodeURIComponent(pathPart); } catch { check(false, `${name}: malformed URI in local link ${target}`); continue; }
        const path = !decoded ? document : decoded.startsWith('/') ? resolve(root, `.${decoded}`) : resolve(dirname(document), decoded);
        facts.localLinks++; file(path, `${name}: ${target || '(self)'}`);
      }
    }
  });
  for (const [manifestPath, requiredExports] of [
    ['evidence/osr-62/figma-manifest.json', ['ux-contract-overview.png']],
    ['evidence/m0/figjam-manifest.json', ['figjam-modules.png', 'figjam-editing.png', 'figjam-async-lifecycle.png', 'figjam-decisions.png']],
  ]) section(manifestPath, () => {
    const manifest = readJson(manifestPath);
    const exports = manifest.exports ?? (manifest.export ? [manifest.export] : []);
    if (!check(Array.isArray(exports) && exports.length > 0, `${manifestPath}: nonempty exports array or export object`)) return;
    const names = new Set();
    for (const item of exports) {
      if (!check(item && typeof item.path === 'string' && /^[a-f0-9]{64}$/.test(item.sha256), `${manifestPath}: export requires path and lowercase SHA-256`)) continue;
      const path = resolve(root, dirname(manifestPath), item.path), relativePath = relative(root, path);
      check(!names.has(relativePath), `${manifestPath}: unique export ${item.path}`); names.add(relativePath);
      if (file(path, `${manifestPath}: ${item.path}`)) {
        const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
        check(actual === item.sha256, `${relativePath}: SHA-256 matches manifest`); facts.exportsHashed++;
      }
    }
    for (const name of requiredExports) check(names.has(relative(root, resolve(root, dirname(manifestPath), name))), `${manifestPath}: required export ${name} is hashed`);
  });
  return { status: failures.length ? 'FAIL' : 'PASS', checks, failures, facts,
    scope: 'Local M0 artifact consistency only. No network calls, remote access/permissions check, fragment validation, production acceptance or benchmark rerun.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runChecks(); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.failures.length ? 1 : 0;
}
