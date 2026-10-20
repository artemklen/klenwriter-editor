// SPDX-License-Identifier: MIT OR Apache-2.0
// Independent fixed search vectors from the pre-candidate contract. No DOM,
// native editor or browser/input claim. Built optional UI implementation only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {foldSearch,filterChoiceIds} from '../packages/ui/dist/slash-search.js';

const read=name=>JSON.parse(readFileSync(new URL(`../contracts/slash/v1/${name}`,import.meta.url),'utf8'));
const oracle=read('lexical-key-oracles.json'),strings=read('strings.json');
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const choices=freeze(strings.choices.map(row=>({id:oracle.catalog.idPrefix+row.id,label:structuredClone(row.label),keywords:structuredClone(row.keywords)})));
for(const [index,row]of oracle.folding.entries())test(`SL-FOLD${index+1} exact fixed Unicode case mapping`,()=>{
  assert.equal(foldSearch(row.input),row.expected);
});
for(const [id,query,locale,expected]of oracle.search)test(`SL-${id} exact ${locale} substring result and provider order`,()=>{
  const before=structuredClone(choices),wanted=expected.map(suffix=>oracle.catalog.idPrefix+suffix);
  const actual=filterChoiceIds(choices,query,locale);
  assert.deepEqual(actual,wanted,'Frozen literal candidates, no fuzzy/accent/locale sorting');
  assert.deepEqual(choices,before,'Search never mutates provider metadata');
});
