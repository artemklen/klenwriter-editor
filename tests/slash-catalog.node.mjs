// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual generated profile metadata versus frozen independent Rust target
// literals. This is discovery evidence, never command availability evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {kwdjSlashCandidates,kwdjSlashTextBlockTypes} from '../packages/kwdj/dist/index.js';

const source=JSON.parse(readFileSync(new URL('../contracts/slash/v1/native-source-oracles.json',import.meta.url),'utf8'));
test('SL-CATALOG01 generated exact nine native targets retain provider order and closed immutable data',()=>{
  const expected=source.nativeCandidates.map(row=>({id:row.candidateId,target:row.target}));
  assert.deepEqual(kwdjSlashCandidates,expected);
  assert.equal(Object.isFrozen(kwdjSlashCandidates),true);
  for(const row of kwdjSlashCandidates){
    assert.equal(Object.isFrozen(row),true);assert.equal(Object.isFrozen(row.target),true);
    assert.deepEqual(Object.keys(row).sort(),['id','target']);
  }
});
test('SL-CATALOG02 generated lexical source types are exactly native paragraph and heading eligibility',()=>{
  assert.deepEqual(kwdjSlashTextBlockTypes,['org.klenwriter.kwdj/paragraph','org.klenwriter.kwdj/heading']);
  assert.equal(Object.isFrozen(kwdjSlashTextBlockTypes),true);
});
