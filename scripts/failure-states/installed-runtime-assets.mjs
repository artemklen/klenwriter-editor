// SPDX-License-Identifier: MIT OR Apache-2.0
// Data-only producer. The URL graph comes from this recipe and static imports,
// never a browser trace. Run only after the coherent fixture build has closed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import {computeSdkBuildIdentity} from '../generate-sdk-types.mjs';
import {computeFailureRuntimeIdentity} from '../build-failure-runtime.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const bindingPath='artifacts/failure-states/runtime-assets-current.json';
const origin='http://127.0.0.1:4174';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const full=path=>{const value=resolve(root,path);assert(!relative(root,value).startsWith('..')&&!path.startsWith('/'));return value;};
const read=path=>{const stat=lstatSync(full(path));assert(stat.isFile()&&!stat.isSymbolicLink(),`Regular source/artifact: ${path}`);return readFileSync(full(path));};
const json=path=>JSON.parse(read(path).toString('utf8'));
const pin=path=>{const bytes=read(path);return{path,bytes:bytes.length,sha256:sha(bytes)};};

// Frozen selected fixture: each case has four complete fresh documents.
// There are no operation/cleanup fetches, retries, content URLs or blob modules.
export const runtimeAssetRecipe={format:'osr67-ac3-runtime-static-recipe/1',origin,
  documentEpochs:['initial','explicit-recovery','reload-before-disposition','reload-after-disposition'],
  phases:['bootstrap','operation','cleanup'],
  files:[
    ['/failure','spikes/workspace/failure-host.html','document','text/html'],
    ['/style.css','packages/dom/dist/style.css','stylesheet','text/css'],
    ['/failure-host.js','spikes/workspace/failure-host.js','script','text/javascript'],
    ['/failure-runtime/sdk.js','artifacts/failure-states/runtime/sdk.js','script','text/javascript'],
    ['/failure-runtime/editor_wasm.js','artifacts/failure-states/runtime/editor_wasm.js','script','text/javascript'],
    ['/failure-runtime/editor_wasm_bg.wasm','artifacts/failure-states/runtime/editor_wasm_bg.wasm','fetch','application/wasm'],
    ['/failure-contract/options.json','contracts/failure-states/v1/admission/options.template.json','fetch','application/json'],
    ['/failure-contract/healthy.json','contracts/failure-states/v1/admission/healthy.canonical.json','fetch','application/json'],
  ],
  generatedImports:'Only relative static .js imports below the generated runtime/snippets tree; fixed before navigation',
  optionalResponse:{url:'/favicon.ico',method:'GET',status:204,bootstrapCountMin:0,bootstrapCountMax:1},
  observationLimitsFrom:'contracts/failure-states/v1/dom-pipeline.json#shared.observation',
  scope:'Finite source-bound compiled trap/recovery fixture; programmatic host actions, no physical input, production-WASM trap or arbitrary in-commit fault claim'};
const mapPages=['sdk-host.html','dom-host.html','selection.html','clipboard.html','composition.html','ui.html',
  'accessibility-host.html','accessibility-human.html','mounted-corpus.html','typing-host.html'];

function moduleFacts(path,closedHost=false){
  const text=read(path).toString('utf8'),file=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  assert.deepEqual(file.parseDiagnostics,[],`Parse reviewed module: ${path}`);
  const imports=[],dynamic=[],urls=[],fetches=[];
  const walk=node=>{
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier){
      assert(ts.isStringLiteral(node.moduleSpecifier));imports.push(node.moduleSpecifier.text);
    }
    if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)dynamic.push(node.getText(file));
    if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='URL'&&node.arguments?.length===2
      &&ts.isStringLiteral(node.arguments[0])&&node.arguments[1].getText(file)==='import.meta.url')urls.push(node.arguments[0].text);
    if(closedHost&&ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='fetch'){
      assert.equal(node.arguments.length,1,`Closed fixture fetch signature: ${path}`);
      assert(ts.isStringLiteral(node.arguments[0]),`Closed fixture literal fetch: ${path}`);fetches.push(node.arguments[0].text);
    }
    ts.forEachChild(node,walk);
  };
  walk(file);return{path,imports,dynamic,urls,fetches};
}

export function computeRuntimeAssetBinding(){
  const production=json('artifacts/sdk-build-identity.json'),current=computeSdkBuildIdentity();
  assert.equal(production.buildId,current.buildId,'Coherent production build must precede binding');
  assert.deepEqual(production.sourceHashes,current.sourceHashes);
  const build=json('artifacts/failure-states/runtime/build.json');
  assert.equal(build.format,'editor-failure-runtime-build/1');assert.equal(build.status,'passed');
  assert.equal(build.baseBuildId,production.buildId);assert.notEqual(build.buildId,production.buildId);
  const identity=computeFailureRuntimeIdentity(production.buildId);
  assert.equal(build.buildId,identity.buildId);assert.deepEqual(build.fixtureSourceHashes,identity.fixtureSourceHashes);
  assert(build.commands.length>0);for(const command of build.commands){assert.equal(command.exitCode,0);assert.equal(command.signal,null);}
  for(const [path,digest]of Object.entries(build.sourceHashes))assert.equal(pin(path).sha256,digest,`Fixture source unchanged: ${path}`);
  for(const artifact of build.artifacts)assert.deepEqual(pin(artifact.path),artifact,`Fixture artifact unchanged: ${artifact.path}`);
  const host=moduleFacts('spikes/workspace/failure-host.js',true);
  assert.deepEqual(host.imports,['/failure-runtime/sdk.js','/failure-runtime/editor_wasm.js']);assert.deepEqual(host.dynamic,[]);
  assert.deepEqual(host.fetches,['/failure-contract/options.json','/failure-contract/healthy.json']);
  const html=read('spikes/workspace/failure-host.html').toString('utf8');
  assert.deepEqual([...html.matchAll(/\bsrc="([^"]+)"/g)].map(match=>match[1]),['/failure-host.js']);
  assert.deepEqual([...html.matchAll(/\bhref="([^"]+)"/g)].map(match=>match[1]),['/style.css']);
  const sdk=moduleFacts('artifacts/failure-states/runtime/sdk.js');assert.deepEqual(sdk.imports,[]);
  assert.deepEqual(sdk.urls.sort(),['./editor_wasm.js','./editor_wasm_bg.wasm']);
  assert.equal(sdk.dynamic.length,1,'One reviewed default glue import');
  assert.match(sdk.dynamic[0],/^import\([A-Za-z_$][\w$]*\.href\)$/);
  const inputs=json('artifacts/failure-states/runtime/sdk-inputs.json');
  const outputs=Object.values(inputs.outputs);assert.equal(outputs.length,1);assert.deepEqual(outputs[0].imports,[]);
  const records=runtimeAssetRecipe.files.map(([url,path,resourceType,contentType])=>({url,...pin(path),
    method:'GET',resourceType,contentType,status:200,counts:{bootstrap:1,operation:0,cleanup:0}}));
  const moduleGraph=[host,sdk],visited=new Set();
  const visit=path=>{
    if(visited.has(path))return;visited.add(path);const facts=moduleFacts(path);moduleGraph.push(facts);
    assert.deepEqual(facts.dynamic,[],`No dynamic generated module imports: ${path}`);
    for(const specifier of facts.imports){
      assert(specifier.startsWith('./')||specifier.startsWith('../'),'Generated import must be relative');
      const next=relative(root,resolve(dirname(full(path)),specifier)).split('\\').join('/');
      assert(next.startsWith('artifacts/failure-states/runtime/snippets/')&&next.endsWith('.js')&&!next.includes('/../'),
        'Generated dependency stays in the statically registered snippets tree');
      if(!records.some(item=>item.path===next))records.push({url:'/failure-runtime/'+next.slice('artifacts/failure-states/runtime/'.length),
        ...pin(next),method:'GET',resourceType:'script',contentType:'text/javascript',status:200,counts:{bootstrap:1,operation:0,cleanup:0}});
      visit(next);
    }
  };
  visit('artifacts/failure-states/runtime/editor_wasm.js');
  const mapPins=[],hashes=[];
  for(const name of mapPages){
    const path=`spikes/workspace/${name}`,bytes=read(path),maps=[...bytes.toString('utf8').matchAll(/<script type="importmap">([^<]+)<\/script>/g)];
    assert.equal(maps.length,1);mapPins.push(pin(path));hashes.push(`'sha256-${createHash('sha256').update(maps[0][1]).digest('base64')}'`);
  }
  const csp=`default-src 'none'; script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}; style-src 'self'; img-src http://127.0.0.1:4174/favicon.ico; connect-src 'self'; base-uri 'none'; object-src 'none'`;
  const sourcePaths=['scripts/failure-states/installed-runtime-assets.mjs','scripts/failure-states/installed-runtime-observation.mjs',
    'scripts/failure-states/installed-metadata.mjs','scripts/failure-states/installed-chrome.config.mjs',
    'scripts/workspace-server.mjs','scripts/build-failure-runtime.mjs','tests/failure-runtime-browser.spec.js',
    'spikes/workspace/failure-host.js','spikes/workspace/failure-host.html','packages/wasm/src/sdk.ts',
    'contracts/failure-states/v1/dom-pipeline.json','contracts/failure-states/v1/loading-recovery.json','contracts/failure-states/v1/runtime-literals.json'];
  return{format:'osr67-ac3-current-runtime-assets/1',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    recipe:runtimeAssetRecipe,baseBuildId:production.buildId,fixtureBuildId:build.buildId,
    buildReceipt:pin('artifacts/failure-states/runtime/build.json'),productionReceipt:pin('artifacts/sdk-build-identity.json'),
    sourcePins:sourcePaths.map(pin),mapPins,moduleGraph,files:records.sort((a,b)=>a.url.localeCompare(b.url)),
    responseHeaders:{'content-security-policy':csp,'x-content-type-options':'nosniff','cache-control':'no-store'}};
}
export function currentRuntimeAssetBinding(){
  const bound=json(bindingPath),current=computeRuntimeAssetBinding();
  assert.deepEqual(bound,current,'Runtime URL/count/hash policy must be freshly bound before navigation');return bound;
}
export function writeRuntimeAssetBinding(){
  const binding=computeRuntimeAssetBinding();
  if(existsSync(full(bindingPath))){
    assert.deepEqual(json(bindingPath),binding,'Retain the previous binding before materializing changed source/build/HEAD');
    return binding;
  }
  writeFileSync(full(bindingPath),JSON.stringify(binding,null,2)+'\n',{flag:'wx'});return binding;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  assert.equal(process.argv.length,2,'No browser-derived graph input accepted');
  const binding=writeRuntimeAssetBinding();console.log(`Bound ${binding.files.length} source-derived runtime URLs to ${binding.fixtureBuildId}`);
}
