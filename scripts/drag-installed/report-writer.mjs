// SPDX-License-Identifier: MIT OR Apache-2.0
// Persistence only: this rolling sidecar never grants input or acceptance authority.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';

const MAX_PRELUDE_BYTES=4*1024*1024;

export function createReportWriter({output,report}){
  assert.equal(typeof output,'string');assert.ok(output.length>0);
  assert.ok(report&&typeof report==='object'&&Array.isArray(report.rows));
  const sidecar=output+'.prelude.json';
  let active=null;
  const controlLog=()=>{
    const value=report.controlLog??[];
    assert.ok(Array.isArray(value),'Report control log must be an array');
    return value;
  };
  function save(){
    if(!active){writeFileSync(output,JSON.stringify(report,null,2)+'\n');return;}
    const log=controlLog();
    assert.ok(log.length>=active.controlLogOffset,'Prelude control log cannot shrink');
    const value={format:'osr44-drag-prelude-persistence/1',
      scope:'Current prelude persistence only; never input authority or acceptance',
      aggregatePath:output,expectedHead:report.expectedHead,browser:report.browser,
      caseId:active.row.id,controlLogOffset:active.controlLogOffset,
      row:active.row,controlLog:log.slice(active.controlLogOffset)};
    const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
    assert.ok(bytes.length<=MAX_PRELUDE_BYTES,'Prelude persistence exceeds 4 MiB; no truncation');
    writeFileSync(sidecar,bytes);
  }
  async function prelude(row,operation){
    assert.equal(active,null,'Nested report preludes are forbidden');
    assert.ok(report.rows.includes(row),'Prelude requires the current report row');
    assert.equal(typeof operation,'function');
    active={row,controlLogOffset:controlLog().length};
    try{return await operation();}
    finally{active=null;save();}
  }
  return {save,prelude};
}
