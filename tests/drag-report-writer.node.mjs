// SPDX-License-Identifier: MIT OR Apache-2.0
// Filesystem persistence controls only; no browser, helper, host probe or input.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createReportWriter} from '../scripts/drag-installed/report-writer.mjs';

const json=value=>JSON.stringify(value,null,2)+'\n';
function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'drag-report-writer-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const output=join(directory,'safari.json');
  const row={id:'I44-N02-ru',family:'N02',locale:'ru',status:'NOT_RUN',actions:[],checkpoints:[],
    prepared:{baseline:{nativeTrace:{enabled:true,overflow:false,calls:[]}}}};
  const report={format:'editor-drag-installed/1',browser:'safari',expectedHead:'a'.repeat(40),
    status:'NOT_RUN',rows:[{id:'I44-N01-en',status:'PASS',nativeTrace:{calls:['retained prior evidence']}},row],
    setup:[{action:'existing preparation',receipt:'complete'}],controlLog:[{kind:'prior receipt',raw:'retained bytes'}],
    separateBoundaries:{composition:'UNOBSERVED'},restoration:null};
  return {output,sidecar:output+'.prelude.json',report,row,writer:createReportWriter({output,report})};
}

test('D44-W01 ordinary saves retain every aggregate field and do not create a prelude sidecar',t=>{
  const f=fixture(t);f.writer.save();
  assert.equal(readFileSync(f.output,'utf8'),json(f.report));
  assert.equal(existsSync(f.sidecar),false);
  f.report.extra={complete:['unrelated','original','fields']};f.writer.save();
  assert.equal(readFileSync(f.output,'utf8'),json(f.report));
});

test('D44-W02 prelude saves visit only the full current row and new control receipts',async t=>{
  const f=fixture(t);let priorVisits=0;
  f.report.rows[0].nativeTrace.calls=[{toJSON(){priorVisits++;return {raw:'complete prior native call'};}}];
  f.report.controlLog[0]={toJSON(){priorVisits++;return {raw:'complete prior control receipt'};}};
  f.report.unrelated={toJSON(){priorVisits++;return {raw:'complete unrelated evidence'};}};
  f.writer.save();const aggregateBefore=readFileSync(f.output,'utf8');priorVisits=0;
  const returned={original:'operation result'};
  const actual=await f.writer.prelude(f.row,async()=>{
    f.row.status='attempted';f.row.actions.push({action:'hover-source',status:'attempted'});
    f.report.controlLog.push({kind:'original-window-binding',raw:'full binding receipt'});f.writer.save();
    assert.equal(priorVisits,0,'Historical or unrelated evidence was serialized in the freshness scope');
    assert.equal(readFileSync(f.output,'utf8'),aggregateBefore,'Prior aggregate changed in the freshness scope');
    const first=JSON.parse(readFileSync(f.sidecar,'utf8'));
    assert.equal(first.format,'osr44-drag-prelude-persistence/1');
    assert.equal(first.scope,'Current prelude persistence only; never input authority or acceptance');
    assert.equal(first.aggregatePath,f.output);assert.equal(first.expectedHead,'a'.repeat(40));
    assert.equal(first.browser,'safari');assert.equal(first.caseId,'I44-N02-ru');assert.equal(first.controlLogOffset,1);
    assert.deepEqual(first.row,f.row);
    assert.deepEqual(first.controlLog,[{kind:'original-window-binding',raw:'full binding receipt'}]);
    f.row.actions[0].status='completed';f.row.actions[0].platform={raw:'complete original phase reply'};
    f.row.checkpoints.push({label:'current complete checkpoint',nativeTrace:{calls:['current full call']}});
    f.report.controlLog.push({kind:'sender-response',raw:'original full sender frame'});f.writer.save();
    assert.equal(priorVisits,0);
    const second=JSON.parse(readFileSync(f.sidecar,'utf8'));
    assert.deepEqual(second.row,f.row);assert.deepEqual(second.controlLog,[
      {kind:'original-window-binding',raw:'full binding receipt'},
      {kind:'sender-response',raw:'original full sender frame'}]);
    assert.equal(readFileSync(f.output,'utf8'),aggregateBefore);
    return returned;
  });
  assert.equal(actual,returned);assert.equal(priorVisits,3,'Complete aggregate was not flushed once on scope exit');
  assert.equal(readFileSync(f.output,'utf8'),json(f.report));
});

test('D44-W03 an operation failure still flushes the complete aggregate and clears prelude mode',async t=>{
  const f=fixture(t),original=Error('Controlled original phase refusal');f.writer.save();
  await assert.rejects(f.writer.prelude(f.row,async()=>{
    f.row.status='FAILED';f.row.error={message:original.message,execution:null};
    f.report.controlLog.push({kind:'physical-action-failure',request:null});f.writer.save();
    f.report.failureOutsideRow={original:'additional full retained evidence'};
    throw original;
  }),error=>error===original);
  assert.equal(readFileSync(f.output,'utf8'),json(f.report));
  const sidecarBefore=readFileSync(f.sidecar,'utf8');
  f.report.restoration={status:'RESTORED',readbacks:['full original receipt']};f.writer.save();
  assert.equal(readFileSync(f.output,'utf8'),json(f.report));
  assert.equal(readFileSync(f.sidecar,'utf8'),sidecarBefore);
});

test('D44-W04 a nested scope refuses while preserving the active outer persistence scope',async t=>{
  const f=fixture(t);f.writer.save();const aggregateBefore=readFileSync(f.output,'utf8');
  await f.writer.prelude(f.row,async()=>{
    await assert.rejects(f.writer.prelude(f.row,async()=>assert.fail('Nested operation must not run')),/Nested/);
    f.row.actions.push({action:'move-start',status:'completed'});
    f.report.controlLog.push({kind:'original receipt after nested refusal'});f.writer.save();
    assert.equal(readFileSync(f.output,'utf8'),aggregateBefore);
    assert.deepEqual(JSON.parse(readFileSync(f.sidecar,'utf8')).row,f.row);
  });
  assert.equal(readFileSync(f.output,'utf8'),json(f.report));
});

test('D44-W05 a UTF-8 sidecar overflow rejects without replacing prior evidence and still flushes all fields',async t=>{
  const f=fixture(t);f.writer.save();let sidecarBefore;
  await assert.rejects(f.writer.prelude(f.row,async()=>{
    f.row.actions.push({action:'hover-source',status:'completed'});f.writer.save();
    sidecarBefore=readFileSync(f.sidecar,'utf8');
    f.row.originalPayload='я'.repeat(2*1024*1024);
    assert.ok(JSON.stringify(f.row).length<4*1024*1024,'Fixture must distinguish UTF-8 bytes from character count');
    f.writer.save();
  }),/exceeds 4 MiB/);
  assert.equal(readFileSync(f.sidecar,'utf8'),sidecarBefore,'Overflow replaced or truncated the prior complete sidecar');
  assert.equal(readFileSync(f.output,'utf8'),json(f.report),'Overflow skipped the complete finally flush');
  assert.equal(JSON.parse(readFileSync(f.output,'utf8')).rows[1].originalPayload,f.row.originalPayload);
  f.report.status='FAILED';f.writer.save();
  assert.equal(readFileSync(f.output,'utf8'),json(f.report));
  assert.equal(readFileSync(f.sidecar,'utf8'),sidecarBefore);
});

test('D44-W06 a Safari report without a Chrome control log retains its complete current row',async t=>{
  const f=fixture(t);delete f.report.controlLog;f.writer.save();
  await f.writer.prelude(f.row,async()=>{
    f.row.actions.push({action:'hover-source',status:'completed',dom:[{isTrusted:true,buttons:0}]});f.writer.save();
    const saved=JSON.parse(readFileSync(f.sidecar,'utf8'));
    assert.equal(saved.controlLogOffset,0);assert.deepEqual(saved.controlLog,[]);assert.deepEqual(saved.row,f.row);
  });
  assert.equal(readFileSync(f.output,'utf8'),json(f.report));
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(f.output,'utf8')),'controlLog'),false);
});
