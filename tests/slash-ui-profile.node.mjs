// SPDX-License-Identifier: MIT OR Apache-2.0
// Pure presentation parser boundaries; no mounted editor, DOM, native command or input proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { slashProfile } from '../packages/ui/dist/slash-profile.js';
const command=()=>{throw Error('The parser must never execute host command factories');};
const choice=(id='paragraph')=>({id,label:{ru:'Текст',en:'Text'},keywords:{ru:['текст'],en:['text']},command});
const profile=()=>({textBlockTypes:['paragraph'],choices:[choice()]});
const error=(value,code='ui.invalid_options')=>assert.throws(()=>slashProfile(value),e=>e.code===code);

test('SL-P01 parser owns immutable paired metadata while preserving factory identity/provider order',()=>{
  const input=profile();input.choices.push(choice('heading'));const actual=slashProfile(input);
  assert.deepEqual(actual.choices.map(c=>c.id),['paragraph','heading']);assert.equal(actual.choices[0].command,command);assert.notEqual(actual,input);assert.notEqual(actual.choices,input.choices);
  input.choices[0].label.ru='changed';input.choices[0].keywords.en.push('changed');input.textBlockTypes.push('foreign');
  assert.deepEqual(actual.choices[0].label,{ru:'Текст',en:'Text'});assert.deepEqual(actual.choices[0].keywords.en,['text']);assert.deepEqual(actual.textBlockTypes,['paragraph']);
  for(const value of [actual,actual.choices,actual.textBlockTypes,actual.choices[0],actual.choices[0].label,actual.choices[0].keywords,actual.choices[0].keywords.en])assert(Object.isFrozen(value));
});
test('SL-P02 exact32 choices/types admitted,33 refuses before callbacks',()=>{
  const value={textBlockTypes:Array.from({length:32},(_,i)=>`type${i}`),choices:Array.from({length:32},(_,i)=>choice(`choice${i}`))};assert.equal(slashProfile(value).choices.length,32);
  error({...value,choices:[...value.choices,choice('33')]},'ui.limit');error({...value,textBlockTypes:[...value.textBlockTypes,'type33']},'ui.limit');
  assert.deepEqual(slashProfile({textBlockTypes:[],choices:[]}),{textBlockTypes:[],choices:[]});
});
test('SL-P03 choice/type IDs are distinct and nonempty, bounded128 UTF16 units',()=>{
  for(const key of ['choices','textBlockTypes']){const value=profile();value[key]=key==='choices'?[choice('same'),choice('same')]:['same','same'];error(value);}
  for(const value of ['',null,4]){error({textBlockTypes:[value],choices:[]});error({textBlockTypes:[],choices:[choice(value)]});}
  assert.equal(slashProfile({textBlockTypes:['😀'.repeat(64)],choices:[choice('x'.repeat(128))]}).textBlockTypes[0].length,128);
  error({textBlockTypes:['x'.repeat(129)],choices:[]},'ui.limit');error({textBlockTypes:[],choices:[choice('😀'.repeat(64)+'x')]},'ui.limit');
});
test('SL-P04 paired labels allow256 UTF16 units and reject257, blank/missing/extra locale',()=>{
  const value=profile();value.choices[0].label={ru:'😀'.repeat(128),en:'x'.repeat(256)};assert.equal(slashProfile(value).choices[0].label.ru.length,256);
  value.choices[0].label.en+='x';error(value,'ui.limit');
  for(const label of [{ru:'',en:'Text'},{ru:' \t',en:'Text'},{en:'Text'},{ru:'Текст',en:'Text',de:'Text'}]){const v=profile();v.choices[0].label=label;error(v);}
});
test('SL-P05 keywords allow16 each/64 UTF16 units and reject17/65 or empty scalar value',()=>{
  const value=profile();value.choices[0].keywords={ru:Array(16).fill('😀'.repeat(32)),en:Array(16).fill('x'.repeat(64))};assert.equal(slashProfile(value).choices[0].keywords.ru.length,16);
  value.choices[0].keywords.en.push('17');error(value,'ui.limit');value.choices[0].keywords.en=['x'.repeat(65)];error(value,'ui.limit');
  for(const keywords of [{ru:[''],en:[]},{ru:[1],en:[]},{ru:[],en:[],extra:[]},{ru:[]}]){const v=profile();v.choices[0].keywords=keywords;error(v);}
});
test('SL-P06 closed own-data records reject accessors, symbols, extra/missing fields and foreign prototypes',()=>{
  let reads=0;const accessor={get textBlockTypes(){reads++;return[];},choices:[]};error(accessor);assert.equal(reads,0);
  const extra=profile();extra.extra=true;error(extra);const symbol=profile();symbol[Symbol('extra')]=true;error(symbol);error(Object.assign(Object.create({}),profile()));error({choices:[]});
  const hidden=profile();Object.defineProperty(hidden,'choices',{value:[],enumerable:false});error(hidden);
  const nested=profile();Object.defineProperty(nested.choices[0],'command',{get(){reads++;return command;},enumerable:true});error(nested);assert.equal(reads,0);
});
test('SL-P07 sparse/accessor/extra array members and non-function command are refused without execution',()=>{
  const sparse=profile();sparse.choices=Array(1);error(sparse);const typeSparse=profile();typeSparse.textBlockTypes=Array(1);error(typeSparse);
  const extra=profile();extra.choices.extra=1;error(extra);const keyword=profile();keyword.choices[0].keywords.en=Array(1);error(keyword);
  let reads=0;const accessor=profile();Object.defineProperty(accessor.choices,'0',{get(){reads++;return choice();},enumerable:true});error(accessor);assert.equal(reads,0);
  for(const bad of [null,{},'command']){const value=profile();value.choices[0].command=bad;error(value);}
});
test('SL-P08 every catalog array rejects numeric-looking non-index properties without reading them',()=>{
  const arrays=[v=>v.textBlockTypes,v=>v.choices,v=>v.choices[0].keywords.ru,v=>v.choices[0].keywords.en];
  for(const select of arrays)for(const key of ['4294967295','9007199254740992']){
    let reads=0;const value=profile(),array=select(value),length=array.length;
    Object.defineProperty(array,key,{get(){reads++;throw Error('extra property must not be read');},enumerable:true});
    assert.equal(array.length,length);error(value);assert.equal(reads,0);
  }
});
test('SL-P09 catalog arrays require the ordinary prototype and enumerable own data indices',()=>{
  const arrays=[v=>v.textBlockTypes,v=>v.choices,v=>v.choices[0].keywords.ru,v=>v.choices[0].keywords.en];
  for(const select of arrays){
    for(const prototype of [null,Object.create(Array.prototype)]){const value=profile();Object.setPrototypeOf(select(value),prototype);error(value);}
    const hidden=profile(),array=select(hidden);Object.defineProperty(array,'0',{value:array[0],enumerable:false});error(hidden);
    const frozen=profile();Object.freeze(select(frozen));assert.equal(slashProfile(frozen).choices[0].id,'paragraph');
  }
});
