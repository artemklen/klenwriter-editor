import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
const report = JSON.parse(await readFile('test-results/results.json','utf8'));
const observations = [];
const failures = [];
function visit(s) {
  for (const spec of s.specs ?? []) for (const test of spec.tests ?? []) for (const result of test.results ?? []) {
    if (result.status !== 'passed') failures.push({ title: spec.title, project: test.projectName, status: result.status, errors: result.errors });
    for (const attachment of result.attachments ?? []) if (attachment.name === 'observation') {
      const item = JSON.parse(Buffer.from(attachment.body, 'base64').toString());
      const o = item.observation;
      const condition = { 'shift-forward':o.reachesNextBlock, 'shift-backward':o.reachesPreviousBlock,
        'select-all':o.wholeDocument && o.excludesChrome, 'mouse-cross-block':o.reachesNextBlock,
        'nested-scroll':o.reachesNested && o.includesAtom && o.scrolled, 'clipboard':o.wholeDocumentCopied && o.restored,
        'same-host-focus-return':o.caretRestored }[item.scenario];
      item.requirementStatus = condition === undefined ? 'OBSERVATION' : condition ? 'MET' : 'GAP';
      observations.push(item);
    }
  }
  for (const child of s.suites ?? []) visit(child);
}
visit(report);
const sourceFiles = ['spikes/editing-hosts/index.html','spikes/editing-hosts/app.js','spikes/editing-hosts/style.css','spikes/editing-hosts/server.mjs','tests/editing-hosts.spec.js','playwright.config.js','package-lock.json'];
const hashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file,createHash('sha256').update(await readFile(file)).digest('hex')])));
await mkdir('evidence/osr-58/automated',{recursive:true});
await writeFile('evidence/osr-58/automated/observations.json',JSON.stringify({
  run: { startTime: report.stats.startTime, durationMs: report.stats.duration, harnessExpected:report.stats.expected, unexpected:report.stats.unexpected,
    os:{platform:os.platform(),release:os.release(),arch:os.arch()}, sourceHashes:hashes },
  note:'Harness success means the observation was collected. MET/GAP describes the specific document-level requirement; synthetic controls and AX are not native IME/AT acceptance.', failures, observations
},null,2)+'\n');
console.log(JSON.stringify({observations:observations.length,failures:failures.length,requirements:Object.fromEntries(['MET','GAP','OBSERVATION'].map(status=>[status,observations.filter(x=>x.requirementStatus===status).length]))}));
if (failures.length) process.exitCode = 1;
