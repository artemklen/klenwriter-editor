// SPDX-License-Identifier: MIT OR Apache-2.0
// Synthetic data/HTTP-message controls only: no human, browser, AT or acceptance claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {createHumanReceiptSink} from '../scripts/accessibility-human/receipt-sink.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const origin='http://127.0.0.1:4174',nonce='a'.repeat(64),build='sha256:'+'b'.repeat(64),plan='c'.repeat(64);
const synthetic={qualification:'SYNTHETIC_NODE_CONTROL_NOT_HUMAN_NOT_AT_NOT_ACCEPTANCE'};
const encode=(ordinal,kind,payload=synthetic)=>Buffer.from(JSON.stringify({schema:'kwe-a66-human-chunk/1',nonce,ordinal,kind,payload}));

async function absent(path){await assert.rejects(fs.lstat(path),{code:'ENOENT'});}
async function files(out){const entries=(await fs.readdir(out)).sort();return Promise.all(entries.map(async path=>({path,bytes:await fs.readFile(join(out,path))})));}
async function unchanged(out,original){const actual=await files(out);assert.deepEqual(actual.map(r=>r.path),original.map(r=>r.path));for(let i=0;i<actual.length;i++)assert.deepEqual(actual[i].bytes,original[i].bytes,'Every previously stored original byte remains exact');}
async function fixture(run){
  // Config and fake pin sources follow the runner's own fresh os.tmpdir(). The
  // sink's closed out contract requires a direct /private/tmp child on macOS.
  // Never use real evidence archives, modify process.env, or fall back/skip.
  const scratch=await fs.mkdtemp(join(tmpdir(),'a66-human-receipt-control-config-'));
  const out=join('/private/tmp','osr66-human-synthetic-controls-'+randomUUID());
  await absent(out);const owned=[out];
  try{
    const sourcePins=[];
    for(let i=0;i<5;i++){const path=join(scratch,`synthetic-pin-${i}.txt`),bytes=Buffer.from(`Synthetic source ${i}; no editor build or owner observation.\n`);await fs.writeFile(path,bytes,{flag:'wx'});sourcePins.push({path,bytes:bytes.length,sha256:sha(bytes)});}
    const config={schema:'kwe-a66-human-sink/1',nonce,out,expectedBuildId:build,expectedPlanSha256:plan,sourcePins};
    const configurationPath=join(scratch,'config.json');
    const writeConfig=async value=>fs.writeFile(configurationPath,JSON.stringify(value));
    await writeConfig(config);
    await run({scratch,out,configurationPath,config,writeConfig,clone:()=>JSON.parse(JSON.stringify(config))});
  }finally{for(const path of owned)await fs.rm(path,{recursive:true,force:true});await fs.rm(scratch,{recursive:true,force:true});}
}
function message({bytes=Buffer.alloc(0),method='POST',url='/accessibility-human/receipt',remote='127.0.0.1',headers={}}={}){
  const req=Readable.from([bytes]);req.method=method;req.url=url;req.socket={remoteAddress:remote};
  req.headers={origin,'x-a66-human-nonce':nonce,'content-type':'application/json',...headers};
  req.timeoutCalls=[];req.setTimeout=function(ms){this.timeoutCalls.push(ms);return this;};
  const res={headersSent:false,status:null,headers:null,bytes:null,writeHead(status,values){assert.equal(this.headersSent,false);this.headersSent=true;this.status=status;this.headers=values;},end(value){assert.equal(this.bytes,null);this.bytes=Buffer.from(value);}};
  return {req,res};
}
async function request(sink,{path='/accessibility-human/receipt',...options}={}){
  const {req,res}=message(options),handled=await sink.handle(req,res,path);
  const value=res.bytes?JSON.parse(res.bytes.toString()):null;
  return {handled,status:res.status,headers:res.headers,value,raw:res.bytes,timeoutCalls:req.timeoutCalls};
}
async function refused(sink,out,original,options,status=400){const result=await request(sink,options);assert.equal(result.handled,true);assert.equal(result.status,status);assert.equal(result.value.status,'refused');await unchanged(out,original);return result;}

// This also covers the actual imported public function's early opt-out without
// relying on an empty directory as a proxy for zero filesystem calls.
test('HR01 null/undefined opt-out performs no filesystem operation', {concurrency:false},async t=>{
  const calls=[];
  for(const name of ['lstat','readFile','mkdir','writeFile','rename'])t.mock.method(fs,name,()=>{calls.push(name);throw Error('Unexpected filesystem access during opt-out');});
  syncBuiltinESMExports();
  try{assert.equal(await createHumanReceiptSink(null),null);assert.equal(await createHumanReceiptSink(undefined),null);assert.deepEqual(calls,[]);}
  finally{t.mock.restoreAll();syncBuiltinESMExports();}
});

const invalidConfig=[
  ['unknown configuration field',c=>({...c,unexpected:true})],
  ['missing plan field',c=>{delete c.expectedPlanSha256;return c;}],
  ['wrong schema',c=>({...c,schema:'synthetic-other-schema'})],
  ['short nonce',c=>({...c,nonce:'a'.repeat(63)})],
  ['wrong build prefix',c=>({...c,expectedBuildId:'digest:'+'b'.repeat(64)})],
  ['short plan',c=>({...c,expectedPlanSha256:'c'.repeat(63)})],
  ['too few pins',c=>({...c,sourcePins:c.sourcePins.slice(0,4)})],
  ['pin has unknown field',c=>{c.sourcePins[0].extra=true;return c;}],
  ['pin has negative byte count',c=>{c.sourcePins[0].bytes=-1;return c;}],
  ['pin has unsafe byte count',c=>{c.sourcePins[0].bytes=Number.MAX_SAFE_INTEGER+1;return c;}],
  ['pin hash is malformed',c=>{c.sourcePins[0].sha256='not-a-hash';return c;}],
  ['nonce has trailing LF',c=>({...c,nonce:nonce+'\n'})],
  ['build has trailing LF',c=>({...c,expectedBuildId:build+'\n'})],
  ['plan has trailing LF',c=>({...c,expectedPlanSha256:plan+'\n'})],
  ['pin hash has trailing LF',c=>{c.sourcePins[0].sha256+='\n';return c;}],
];
test('HR02 invalid config/pin preflight writes no sink directory or receipt',async t=>{
  for(const [name,change]of invalidConfig)await t.test(name,()=>fixture(async f=>{await f.writeConfig(change(f.clone()));await assert.rejects(createHumanReceiptSink(f.configurationPath));await absent(f.out);}));
});
test('HR03 malformed/oversize config refuses before sink data writes',async t=>{
  for(const [name,bytes]of [['malformed JSON',Buffer.from('{')],['larger than16KiB',Buffer.alloc(16385,32)]])await t.test(name,()=>fixture(async f=>{await fs.writeFile(f.configurationPath,bytes);await assert.rejects(createHumanReceiptSink(f.configurationPath));await absent(f.out);}));
});

test('HR04 public config preserves root-supplied binding and closed HTTP boundary',()=>fixture(async f=>{
  const sink=await createHumanReceiptSink(f.configurationPath),launch=(await files(f.out));
  assert.deepEqual(launch.map(r=>r.path),['000-launch.json']);
  const stored=JSON.parse(launch[0].bytes);assert.deepEqual(stored.config,f.config);
  const good=await request(sink,{path:'/accessibility-human/config',method:'GET',url:'/accessibility-human/config?nonce='+nonce});
  assert.equal(good.status,200);assert.equal(good.value.nonce,nonce);assert.equal(good.value.expectedBuildId,build);assert.equal(good.value.expectedPlanSha256,plan);assert.deepEqual(good.value.sourcePins,f.config.sourcePins);
  assert.equal(good.headers['Cache-Control'],'no-store');assert.equal(good.headers['X-Content-Type-Options'],'nosniff');
  for(const query of ['nonce=wrong','nonce='+nonce+'&extra=1','nonce='+nonce+'&nonce='+nonce]){const r=await request(sink,{path:'/accessibility-human/config',method:'GET',url:'/accessibility-human/config?'+query});assert.equal(r.status,404);}
  const remote=await request(sink,{path:'/accessibility-human/config',method:'GET',url:'/accessibility-human/config?nonce='+nonce,remote:'192.0.2.1'});assert.equal(remote.status,403);
  const other=await request(sink,{path:'/not-a-human-route',method:'GET'});assert.equal(other.handled,false);assert.equal(other.raw,null);
  const wrongMethod=await request(sink,{method:'GET'});assert.equal(wrongMethod.status,405);await unchanged(f.out,launch);
}));

test('HR05 original intent is mandatory; wrong delivery identity cannot create a chunk',()=>fixture(async f=>{
  const sink=await createHumanReceiptSink(f.configurationPath),launch=await files(f.out);
  for(const kind of ['observation','final'])await refused(sink,f.out,launch,{bytes:encode(0,kind)});
  for(const headers of [{origin:'http://localhost:4174'},{origin:'https://127.0.0.1:4174'},{'x-a66-human-nonce':'d'.repeat(64)},{'content-type':'text/plain'}])await refused(sink,f.out,launch,{bytes:encode(0,'intent'),headers});
  await refused(sink,f.out,launch,{bytes:encode(0,'intent'),remote:'192.0.2.1'},403);
  const ok=await request(sink,{bytes:encode(0,'intent'),headers:{'content-type':'application/json; charset=utf-8'}});assert.equal(ok.status,201);assert.equal(ok.value.ordinal,0);assert.equal(ok.value.closed,false);assert.deepEqual(ok.timeoutCalls,[5000,0]);
}));

test('HR06 malformed/skipped/duplicate chunks preserve the exact accepted prefix',()=>fixture(async f=>{
  const sink=await createHumanReceiptSink(f.configurationPath);
  // Formatting and decomposed Unicode are deliberately retained as original bytes.
  const first=Buffer.from('{ "schema":"kwe-a66-human-chunk/1", "nonce":"'+nonce+'", "ordinal":0, "kind":"intent", "payload":{"fixture":"SYNTHETIC_NOT_HUMAN","text":"é_日本"} }\r\n');
  const accepted=await request(sink,{bytes:first});assert.equal(accepted.status,201);assert.equal(accepted.value.sha256,sha(first));assert.deepEqual(await fs.readFile(join(f.out,'001-intent.json')),first);
  const prefix=await files(f.out),base={schema:'kwe-a66-human-chunk/1',nonce,ordinal:1,kind:'observation',payload:synthetic};
  const malformed=[Buffer.from('{'),Buffer.from('[]'),Buffer.from(JSON.stringify({...base,nonce:'d'.repeat(64)})),Buffer.from(JSON.stringify({...base,ordinal:0})),Buffer.from(JSON.stringify({...base,ordinal:2})),Buffer.from(JSON.stringify({...base,ordinal:'1'})),Buffer.from(JSON.stringify({...base,kind:'intent'})),Buffer.from(JSON.stringify({...base,kind:'replace'})),Buffer.from(JSON.stringify({...base,extra:true})),Buffer.from('{"schema":"kwe-a66-human-chunk/1","nonce":"'+nonce+'","ordinal":1,"kind":"observation","payload":{"__proto__":{}}}')];
  for(const bytes of malformed)await refused(sink,f.out,prefix,{bytes});
  // A failed serial task does not poison the next original, correctly ordered chunk.
  const next=encode(1,'observation',{...synthetic,wirePrefix:['original-a','original-b']});assert.equal((await request(sink,{bytes:next})).status,201);assert.deepEqual(await fs.readFile(join(f.out,'002-observation.json')),next);assert.deepEqual(await fs.readFile(join(f.out,'001-intent.json')),first);
}));

test('HR07 simultaneous duplicate ordinal is recorded once with first original bytes',()=>fixture(async f=>{
  const sink=await createHumanReceiptSink(f.configurationPath);assert.equal((await request(sink,{bytes:encode(0,'intent')})).status,201);
  const one=encode(1,'observation',{...synthetic,token:'first-original'}),two=encode(1,'observation',{...synthetic,token:'attempted-rewrite'});
  const results=await Promise.all([request(sink,{bytes:one}),request(sink,{bytes:two})]);assert.deepEqual(results.map(r=>r.status),[201,400]);assert.deepEqual(await fs.readFile(join(f.out,'002-observation.json')),one);assert.deepEqual((await files(f.out)).map(r=>r.path),['000-launch.json','001-intent.json','002-observation.json']);
}));

test('HR08 final index binds original byte hashes without promoting synthetic status',()=>fixture(async f=>{
  const sink=await createHumanReceiptSink(f.configurationPath),configurationBytes=await fs.readFile(f.configurationPath);
  const chunks=[encode(0,'intent'),encode(1,'observation',{...synthetic,wirePrefix:['a','b']}),encode(2,'final',{...synthetic,status:'SYNTHETIC_CONTROL_ONLY_NOT_OWNER_RESULT',performer:'synthetic-node-control'})];
  for(const bytes of chunks)assert.equal((await request(sink,{bytes})).status,201);
  const index=JSON.parse(await fs.readFile(join(f.out,'index.json')));assert.equal(index.status,'HUMAN_RECEIPT_RECORDED_NOT_INDEPENDENT_VERDICT');assert.equal(index.claimedStatus,'SYNTHETIC_CONTROL_ONLY_NOT_OWNER_RESULT');assert.equal(index.configSha256,sha(configurationBytes));assert.equal(index.buildId,build);assert.equal(index.planSha256,plan);assert.equal(index.actualChunks,3);assert.equal(index.totalBytes,chunks.reduce((sum,b)=>sum+b.length,0));
  assert.deepEqual(index.chunks,chunks.map((bytes,ordinal)=>({ordinal,kind:['intent','observation','final'][ordinal],path:['001-intent.json','002-observation.json','003-final.json'][ordinal],bytes:bytes.length,sha256:sha(bytes)})));
  await absent(join(f.out,'index.partial'));
  const finalFiles=await files(f.out);
  for(const bytes of [encode(3,'observation'),encode(3,'final'),encode(0,'intent')])await refused(sink,f.out,finalFiles,{bytes});
}));

test('HR09 per-chunk byte cap refuses before overwriting accepted originals',()=>fixture(async f=>{
  const sink=await createHumanReceiptSink(f.configurationPath);assert.equal((await request(sink,{bytes:encode(0,'intent')})).status,201);const prefix=await files(f.out);
  await refused(sink,f.out,prefix,{bytes:Buffer.alloc(524289,32)});
}));
test('HR10 excessive nested data refuses while original prefix stays intact',()=>fixture(async f=>{
  const sink=await createHumanReceiptSink(f.configurationPath);assert.equal((await request(sink,{bytes:encode(0,'intent')})).status,201);const prefix=await files(f.out);let payload={...synthetic};for(let i=0;i<33;i++)payload=[payload];await refused(sink,f.out,prefix,{bytes:encode(1,'observation',payload)});
}));
test('HR11 chunk-count bound refuses the next ordinal without replacing any of32 originals',()=>fixture(async f=>{
  const sink=await createHumanReceiptSink(f.configurationPath);
  for(let ordinal=0;ordinal<32;ordinal++)assert.equal((await request(sink,{bytes:encode(ordinal,ordinal===0?'intent':'observation',{...synthetic,ordinal})})).status,201);
  const prefix=await files(f.out);assert.equal(prefix.length,33);await refused(sink,f.out,prefix,{bytes:encode(32,'final',{...synthetic,status:'SYNTHETIC_NOT_FINALIZED'})});await absent(join(f.out,'index.json'));
}));
test('HR12 total-byte bound is independent of each valid small-enough chunk',()=>fixture(async f=>{
  const sink=await createHumanReceiptSink(f.configurationPath);assert.equal((await request(sink,{bytes:encode(0,'intent')})).status,201);
  for(let ordinal=1;ordinal<=16;ordinal++){const bytes=encode(ordinal,'observation',{...synthetic,padding:'x'.repeat(500000)});assert.ok(bytes.length<524288);assert.equal((await request(sink,{bytes})).status,201);}
  const prefix=await files(f.out),last=encode(17,'observation',{...synthetic,padding:'x'.repeat(500000)});assert.ok(last.length<524288);await refused(sink,f.out,prefix,{bytes:last});await absent(join(f.out,'index.json'));
}));
