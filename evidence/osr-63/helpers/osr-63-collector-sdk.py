#!/usr/bin/env python3
"""SDK-specific pure validators. No network, processes or outputs on import.

Installed into the NEW63 collector only. Git reads happen only when explicit
source/bundle verification is called after actual frozen configuration exists.
"""
import base64
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import tarfile

E = None
SDK_FILES = {
 'tests/sdk-controller.node.mjs','tests/sdk-loader.node.mjs','tests/sdk-types.node.mjs',
 'tests/sdk-integration.node.mjs','tests/sdk-clean-consumer.node.mjs',
}
SDK_TITLE = 'packaged headless SDK runs real Session lifecycle and releases resources under strict CSP'
SDK_COPIES = {
 'packages/wasm/dist/editor_wasm.js':'artifacts/sdk-distribution/editor_wasm.js',
 'packages/wasm/dist/editor_wasm_bg.wasm':'artifacts/sdk-distribution/editor_wasm_bg.wasm',
}
SDK_ARTIFACTS = {
 'artifacts/sdk/probe.js','artifacts/sdk/probe_bg.wasm','target/debug/examples/sdk_native',
 'artifacts/sdk/native-observer.json','artifacts/sdk/wasm-observer.json',
 'artifacts/sdk-wasm-seal.json','artifacts/sdk-native-manifest.json',
 *SDK_COPIES.keys(),*SDK_COPIES.values(),
}
SDK_REQUIRED_FILES = {
 'artifacts/sdk-report.json','artifacts/sdk/probe.js','artifacts/sdk/probe_bg.wasm',
 'artifacts/sdk/native-observer.json','artifacts/sdk/wasm-observer.json','artifacts/sdk/native.stderr.log',
 'artifacts/sdk-build-identity.json','artifacts/sdk-native-manifest.json','artifacts/sdk-wasm-seal.json',
 'artifacts/sdk-generator-dependencies.json','artifacts/sdk-clean-consumer-report.json',
 'artifacts/package-inventory.json','artifacts/sdk-distribution/sdk-types.d.ts','artifacts/sdk-distribution/sdk-build-id.js','artifacts/sdk-distribution/sdk-native-manifest.json',*SDK_COPIES.values(),
}
PACKAGE_NAMES = {'wasm':'@klenwriter/editor-wasm','sdk':'@klenwriter/editor-sdk','kwdj':'@klenwriter/editor-kwdj'}
HEX64 = re.compile(r'[0-9a-f]{64}')


def need(value, message):
 if not value: raise RuntimeError(message)


def sha(raw): return hashlib.sha256(raw).hexdigest()


def strict_json(raw):
 def pairs(rows):
  result={}
  for key,value in rows:
   need(key not in result,'Duplicate SDK JSON key: '+key)
   result[key]=value
  return result
 return json.loads(raw,object_pairs_hook=pairs)


def path_ok(name):
 need(isinstance(name,str),'SDK artifact/source path must be text')
 p=PurePosixPath(name)
 need(p.parts and not p.is_absolute() and '..' not in p.parts and str(p)==name,'Unsafe SDK path: '+name)
 return p


def pointer(value,path):
 need(isinstance(path,str) and path.startswith('/'),'Semantic JSON pointer required')
 for key in path[1:].split('/'):
  key=key.replace('~1','/').replace('~0','~')
  value=value[int(key)] if isinstance(value,list) else value[key]
 return value


def node_summaries(text):
 rows=[];current=None
 for key,value in re.findall(r'^\s*(?:#|ℹ)\s+(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$',text,re.M):
  if key=='tests':
   if current is not None: rows.append(current)
   current={}
  need(current is not None and key not in current,'Ambiguous/incomplete Node summary')
  current[key]=int(value)
 if current is not None: rows.append(current)
 for row in rows:
  need(set(row)=={'tests','pass','fail','cancelled','skipped','todo'},'Incomplete actual Node summary')
 return rows


def validate_sdk_binding(proof):
 lanes=proof['sdkLanes'];need(isinstance(lanes,list) and lanes,'Actual SDK Node invocation records required')
 files=[];indices=[]
 for lane in lanes:
  need(set(lane)=={'files','commandMarker','summaryIndex','passed','successMarkers'},'Unexpected SDK lane binding schema')
  need(lane['files'] and len(lane['files'])==len(set(lane['files'])) and set(lane['files'])<=SDK_FILES,'SDK lane file scope differs')
  need(type(lane['summaryIndex']) is int and lane['summaryIndex']>=0 and type(lane['passed']) is int and lane['passed']>0,'Actual SDK TAP index/count required')
  need(isinstance(lane['commandMarker'],str) and 'node --test' in lane['commandMarker'] and all(name in lane['commandMarker'] for name in lane['files']),'SDK command must name each tested file')
  markers=lane['successMarkers'];need(isinstance(markers,list) and len(markers)>=len(lane['files']) and len(markers)==len(set(markers)) and all(isinstance(m,str) and m for m in markers),'Actual successful SDK test titles required')
  files.extend(lane['files']);indices.append(lane['summaryIndex'])
 need(set(files)==SDK_FILES and len(files)==len(set(files)) and len(indices)==len(set(indices)),'Every SDK Node sublane must be covered exactly once')
 need(SDK_FILES<=set(proof['sourceClosure']),'SDK lane sources absent from tested Git closure')
 spec=proof['sdkCleanConsumerReport'];need(set(spec)=={'path','sha256'} and HEX64.fullmatch(spec['sha256']),'Actual clean-consumer report pin required')
 p=Path(spec['path']);need(p.resolve()==Path('/Users/artem/projects/klenwriter-editor/artifacts/sdk-clean-consumer-report.json').resolve() and p.is_absolute() and p.is_file() and not p.is_symlink() and sha(p.read_bytes())==spec['sha256'],'Frozen local clean consumer report changed')
 cases=proof['sdkBrowserCases']
 expected={(p,'tests/sdk-workspace-browser.spec.js',SDK_TITLE) for p in ('chromium','firefox','webkit')}
 need(isinstance(cases,list) and len(cases)==3 and all(set(c)=={'project','file','title'} for c in cases),'Three actual SDK CSP case bindings required')
 need({(c['project'],c['file'],c['title']) for c in cases}==expected,'Exact SDK CSP title/projects required')
 need('tests/sdk-workspace-browser.spec.js' in proof['sourceClosure'],'CSP source absent from tested Git closure')
 need(any(m.startswith('DELTAS native/WASM PASS: ') for m in proof['requiredWitnessMarkers']) and any(m.startswith('SDK native/WASM PASS: ') for m in proof['requiredWitnessMarkers']),'Actual DELTAS and SDK standalone witness markers required')
 checks=proof['reports']['sdk']['semanticChecks']
 need(isinstance(checks,list) and checks and all(set(c)=={'pointer','value'} and c['pointer'].startswith('/portable/') for c in checks),'Actual final SDK portable semantic checks required')
 mandatory={'evidence/osr-63/execution-contract.md','crates/wasm/src/sdk.rs','crates/wasm/src/sdk_wire.rs','crates/wasm/src/sdk_convert.rs','scripts/test-sdk.mjs','scripts/seal-sdk-wasm.mjs','scripts/generate-sdk-types.mjs','scripts/build-workspace.mjs','contracts/sdk/v1/vectors.json','crates/wasm/examples/support/sdk_observer.rs'}
 need(mandatory<=set(proof['reports']['sdk']['sourcePaths']),'SDK report lacks actual implementation/build/literal inputs')


def verify_sdk_lane_logs(text,proof):
 summaries=node_summaries(text);out=[]
 for lane in proof['sdkLanes']:
  need(lane['commandMarker'] in text,'SDK invocation command missing from full log: '+lane['commandMarker'])
  index=lane['summaryIndex'];need(index<len(summaries),'SDK actual TAP summary index absent')
  row=summaries[index]
  need(row['tests']==row['pass']==lane['passed'] and all(row[k]==0 for k in ('fail','cancelled','skipped','todo')),'SDK Node lane failed/skipped/filtered or differs from actual frozen count')
  for marker in lane['successMarkers']:
   need(E['witness_pass'](text,marker),'SDK successful test marker absent: '+marker)
  out.append({'files':lane['files'],'summaryIndex':index,'actual':row,'successMarkers':lane['successMarkers']})
 return out


def verify_sdk_browser(browser,proof):
 stats=browser['stats'];need(stats['unexpected']==stats['flaky']==stats['skipped']==0,'Workspace browser failures/flakiness/skips')
 need(stats['expected']==proof['gateFloors']['workspaceBrowserPassed'],'Workspace browser structured count differs from actual frozen floor')
 found=[]
 def walk(suites):
  for suite in suites:
   for spec in suite.get('specs',[]):
    if PurePosixPath(spec.get('file','')).name=='sdk-workspace-browser.spec.js':
     need(spec['title']==SDK_TITLE and spec['ok'] is True,'SDK CSP spec changed/failed')
     for test in spec['tests']:
      need(test['expectedStatus']=='passed' and test['status']=='expected' and len(test['results'])==1,'SDK CSP test skipped/flaky/retried')
      result=test['results'][0]
      need(result['status']=='passed' and result['retry']==0 and not result.get('errors'),'SDK CSP project did not pass once')
      found.append((test['projectName'],'tests/sdk-workspace-browser.spec.js',spec['title']))
   walk(suite.get('suites',[]))
 walk(browser['suites'])
 expected=[(c['project'],c['file'],c['title']) for c in proof['sdkBrowserCases']]
 need(len(found)==3 and sorted(found)==sorted(expected),'Three SDK project tests were not actually executed')
 return [{'project':p,'file':f,'title':t,'status':'passed','attempts':1} for p,f,t in sorted(found)]


def verify_sdk(report):
 spec=E['REPORT_SPECS'].get('sdk');need(spec is not None,'Actual frozen SDK report scope required')
 need(report['format']=='klenwriter-editor-sdk-report/1' and report['nativeWasmEqual'] is True and report['portable']['status']=='passed','Actual SDK native/WASM pass/schema required')
 need(re.fullmatch(r'sha256:[0-9a-f]{64}',report['buildId']) is not None,'Actual source-derived SDK build identity required')
 need(set(report['sourceHashes'])==set(spec['sourcePaths']),'Exact SDK source-only scope differs')
 for name,digest in report['sourceHashes'].items():E['validate_hash_path'](name,digest)
 need(set(report['artifactHashes'])==SDK_ARTIFACTS,'SDK exact artifact scope differs from producer')
 for name,digest in report['artifactHashes'].items():E['validate_hash_path'](name,digest)
 p=report['portable'];need(p['format']=='klenwriter-sdk-observer/1' and p['abi']=='editor-sdk/1','SDK portable ABI/schema differs')
 for group in ('opening','commands','stale','state_events','snapshots_resources','identity_facts','metadata_dtos','mapping_provenance'):
  need(p[group]['status']=='passed','SDK portable group failed: '+group)
 need(p['commands']['literal_total']==len(p['commands']['rows'])>0 and p['commands']['catalog_total']>0,'SDK command literal/catalog proof absent')
 need(all(row['query_pure'] is True and row['exact_historical_ids'] is True for row in p['commands']['rows']),'SDK query/history proof absent')
 need(p['opening']['mismatch_before_document_decode'] is True and p['opening']['tightened_profile_limits_preserved'] is True and p['opening']['max_u64_request_cannot_raise_leaf_ceiling'] is True,'SDK exact negotiation/limits proof absent')
 need(p['stale']['failed_remount_atomic'] is True and p['stale']['successful_remount_invalidates_generation_nodes_snapshots'] is True,'SDK remount/generation proof absent')
 need(p['identity_facts']['saved_marks_selection_and_ids_restore_exactly'] is True and p['identity_facts']['same_captured_request_retries_after_facts_recover'] is True,'SDK mutable facts/history boundary proof absent')
 need(p['metadata_dtos']['exact_u64_attribute']=='18446744073709551615' and p['metadata_dtos']['null_attribute_transport_preserved_before_profile_refusal'] is True,'SDK exact u64/null proof absent')
 for check in spec['semanticChecks']:
  actual=pointer(report,check['pointer']);need(type(actual) is type(check['value']) and actual==check['value'],'Frozen SDK semantic field differs: '+check['pointer'])
 need(re.search(r'\b[ns]1:\d+:\d+',json.dumps(p)) is None,'Portable SDK report leaked process-local opaque identities')


def git_blob(c,path):
 path_ok(path)
 return E['subprocess'].check_output(['git','show',c['source']+':'+path],cwd=c['root'],stderr=E['subprocess'].PIPE)


def sdk_source_paths(c):
 paths=set(['Cargo.toml','Cargo.lock','rust-toolchain.toml','package.json','package-lock.json','package-map.json','tsconfig.base.json','tsconfig.json','scripts/generate-sdk-types.mjs','scripts/build-workspace.mjs','scripts/dependency-notices.mjs','scripts/package-identity.mjs','scripts/seal-sdk-wasm.mjs','provenance/licenses/ts-rs-12.0.1-MIT.txt','provenance/licenses/sdk-generator-license-sources.json','crates/wasm/examples/sdk_types.rs','crates/wasm/examples/sdk_manifest.rs'])
 names=E['subprocess'].check_output(['git','ls-tree','-r','--name-only','-z',c['source']],cwd=c['root']).decode().split('\0')
 excluded={'packages/wasm/src/sdk-types.ts','packages/wasm/src/sdk-build-id.ts'}
 for crate in ('core','engine','kwdj','wasm'):
  paths.add(f'crates/{crate}/Cargo.toml')
  paths.update(n for n in names if n.startswith(f'crates/{crate}/src/') and n.endswith('.rs'))
 for package in ('wasm','sdk','kwdj'):
  paths.update({f'packages/{package}/package.json',f'packages/{package}/tsconfig.json'})
  paths.update(n for n in names if n.startswith(f'packages/{package}/src/') and n.endswith(('.ts','.js')) and n not in excluded)
 return sorted(paths)


def verify_build_identity(c,report,build):
 need(build['format']=='klenwriter-editor-sdk-build/1' and set(build['exclusions'])=={'packages/wasm/src/sdk-types.ts','packages/wasm/src/sdk-build-id.ts'},'SDK build identity format/cycle exclusions differ')
 paths=sdk_source_paths(c);need(set(paths)==set(build['sourceHashes']),'SDK production build closure differs from exact frozen source')
 h=hashlib.sha256(b'klenwriter-editor-sdk-source/1\0')
 for name in paths:
  raw=git_blob(c,name);need(sha(raw)==build['sourceHashes'][name]==report['sourceHashes'].get(name),'SDK production input hash differs from frozen Git: '+name)
  h.update(name.encode()+b'\0'+str(len(raw)).encode()+b'\0'+raw)
 identity='sha256:'+h.hexdigest();need(identity==build['buildId']==report['buildId'],'SDK actual source-derived build identity differs')
 return identity


def wasm_seal(raw):
 need(len(raw)<=64*1024*1024 and raw[:8]==b'\0asm\x01\0\0\0','Invalid/oversize packaged WASM')
 def number(at,end):
  value=0;start=at
  for n in range(5):
   need(at<end,'Truncated WASM length');byte=raw[at];at+=1;value+=(byte&127)<<(7*n)
   need(value<=0xffffffff,'WASM length overflow')
   if byte<128:
    need(at-start==max(1,(value.bit_length()+6)//7),'Noncanonical WASM length');return value,at
  raise RuntimeError('Overlong WASM length')
 offset=8;found=[]
 while offset<len(raw):
  start=offset;kind=raw[offset];offset+=1;need(kind<=13,'Unknown WASM section')
  length,offset=number(offset,len(raw));end=offset+length;need(end<=len(raw),'Truncated WASM section')
  if kind==0:
   length,at=number(offset,end);need(length<=65536 and at+length<=end,'Invalid custom section name')
   name=raw[at:at+length].decode('utf8');data=raw[at+length:end]
   if name=='klenwriter.editor.sdk/1':found.append((start,end,strict_json(data)))
  offset=end
 need(offset==len(raw) and len(found)==1,'One complete SDK custom seal required')
 start,end,metadata=found[0];need(end==len(raw),'Producer SDK seal must be last section')
 need(set(metadata)=={'format','abi','build_id','wasm_bytes','wasm_sha256'},'SDK custom seal schema differs')
 prefix=raw[:start]
 need(metadata['format']=='klenwriter-editor-sdk-wasm/1' and metadata['abi']=='editor-sdk/1' and type(metadata['wasm_bytes']) is int and metadata['wasm_bytes']==len(prefix) and metadata['wasm_sha256']==sha(prefix),'SDK custom seal pre-section byte hash differs')
 return metadata


def sdk_tarball_paths(inventory):
 need(isinstance(inventory,list),'Actual packed inventory required');result=set()
 for name in PACKAGE_NAMES.values():
  rows=[p for p in inventory if p['name']==name];need(len(rows)==1,'One actual packed inventory row required: '+name)
  filename=rows[0]['filename'];need(isinstance(filename,str) and PurePosixPath(filename).name==filename and filename.endswith('.tgz'),'Unsafe SDK tarball filename')
  result.add('artifacts/packages/'+filename)
 return result


def tar_files(raw):
 need(0<len(raw)<=64*1024*1024,'SDK tarball exceeds byte cap')
 result={};seen=set();total=0
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:
  members=archive.getmembers();need(len(members)<=50000,'SDK tarball member cap exceeded')
  for member in members:
   p=path_ok(member.name);need(p.parts[0]=='package' and not member.issym() and not member.islnk(),'Unsafe SDK tarball entry')
   need(member.name not in seen,'Duplicate SDK tarball entry');seen.add(member.name)
   if member.isdir():continue
   need(member.isfile() and member.size<=64*1024*1024,'Unsupported/oversize SDK tarball member')
   total+=member.size;need(total<=256*1024*1024,'SDK tarball expanded size cap')
   payload=archive.extractfile(member).read();need(len(payload)==member.size,'SDK tarball truncated member')
   result[member.name]=payload
 return result


def verify_clean_consumer(c,root,build_id,artifacts):
 report=E['read_json'](root/'artifacts/sdk-clean-consumer-report.json');inventory=E['read_json'](root/'artifacts/package-inventory.json')
 need(report['format']=='klenwriter-editor-sdk-clean-consumer/1' and report['status']=='passed','Actual packed consumer pass required')
 need(report['install']['exitCode']==report['execution']['exitCode']==0 and report['install']['offline'] is True and report['install']['ignoreScripts'] is True and report['execution']['pathContainsNoExecutables'] is True,'Actual clean-consumer install/execution qualifiers differ')
 r=report['report'];need(r['status']=='passed' and r['build_id']==build_id and r['missingTools']=={'cargo':'ENOENT','rustc':'ENOENT'} and r['cwdOutsideCheckout'] is True and r['hooksDisabled'] is True,'Clean-consumer result/current build/no-tool scope differs')
 need(type(r['cycles']) is int and r['cycles']>0 and r['late_callbacks_refused']==2*r['cycles']+1 and r['events_observed']>0,'Actual clean consumer lifecycle coverage absent')
 need(r['native_baseline']==r['native_final']=={'sessions':0,'snapshot_handles':0,'snapshot_bytes':'0','protected_cursors':0},'Actual clean-consumer native resources did not return baseline')
 need(all(r[k] is True for k in ('actual_commands_history_reads_exports_acknowledgements','exact_space_nbsp','failed_and_successful_remount','destroyed_before_late_load','retained_snapshot_listener_request_cleanup','ordinary_queries_emit_zero_events')),'Actual clean-consumer scenario assertion missing')
 need(r['wasmSha256']==artifacts['packages/wasm/dist/editor_wasm_bg.wasm'],'Clean consumer used a different packaged WASM')
 source=git_blob(c,'spikes/workspace/sdk-scenario.js');need(report['scenarioSha256']==sha(source),'Clean-consumer scenario differs from frozen Git')
 entries={};proof=[]
 for role,name in PACKAGE_NAMES.items():
  row=next(p for p in inventory if p['name']==name);raw=(root/'artifacts/packages'/row['filename']).read_bytes()
  need(row['integrity']=='sha512-'+base64.b64encode(hashlib.sha512(raw).digest()).decode(),'Packed tarball integrity differs')
  if row.get('shasum'):need(hashlib.sha1(raw).hexdigest()==row['shasum'],'Packed tarball SHA1 differs')
  declared=[p for p in report['tarballs'] if p['role']==role];need(len(declared)==1,'Clean-consumer tarball role missing/duplicate')
  item=declared[0];need(item['name']==name and PurePosixPath(item['path']).name==row['filename'] and item['bytes']==len(raw) and item['sha256']==sha(raw),'Clean-consumer actual tarball bytes differ')
  contents=tar_files(raw);entries[name]=contents
  package=json.loads(contents['package/package.json']);need(package['name']==name,'Tarball package identity differs')
  need(contents['package/package.json']==git_blob(c,f'packages/{role}/package.json'),'Packed package manifest differs from source')
  need(not set(package.get('scripts',{}))&{'preinstall','install','postinstall','prepare'},'Consumer build/install hook unexpectedly present')
  proof.append({'role':role,'name':name,'archive':'artifacts/packages/'+row['filename'],'bytes':len(raw),'sha256':sha(raw),'integrity':row['integrity']})
 need(len(report['tarballs'])==3,'Exactly three actual clean-consumer packages required')
 installed=report['installedArtifactHashes'];expected=set()
 for name,contents in entries.items():
  for path in contents:
   if path.startswith('package/dist/'):expected.add((name,path[len('package/'):]))
 need(len(installed)==len(expected) and {(r['package'],r['file']) for r in installed}==expected,'Installed artifact scope incomplete/duplicate')
 for row in installed:
  raw=entries[row['package']]['package/'+row['file']];need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'Installed asset differs from actual tarball')
 for name in ('sdk-types.d.ts','sdk-build-id.js'):
  need((root/'artifacts/sdk-distribution'/name).read_bytes()==entries[PACKAGE_NAMES['wasm']]['package/dist/'+name],'Uploaded generated SDK declaration/identity differs from tested tarball: '+name)
 for original in SDK_COPIES:
  relative=original[len('packages/wasm/'):];need(sha(entries[PACKAGE_NAMES['wasm']]['package/'+relative])==artifacts[original],'Actual uploaded tarball runtime differs from SDK report/distribution')
 return {'tarballs':proof,'installedArtifacts':len(installed),'sourceBoundScenario':report['scenarioSha256'],'scope':'Actual external child PATH ENOENT for cargo/rustc; not globally uninstalled tools.'}


def verify_sdk_bundle(c,report,root):
 root=Path(root);build=E['read_json'](root/'artifacts/sdk-build-identity.json');identity=verify_build_identity(c,report,build)
 native=E['read_json'](root/'artifacts/sdk-native-manifest.json')
 expected={'abi':'editor-sdk/1','build_id':identity,'profiles':[{'profile_id':'org.klenwriter.kwdj','profile_version':'1.0.0','codec_id':'org.klenwriter.kwdj/json','wire_version':1,'extensions':[{'id':'org.klenwriter.kwdj/base','version':'1.0.0'}]}]}
 need(native==expected,'Actual native compiled manifest differs from exact compiled offer/build')
 need((root/'artifacts/sdk-distribution/sdk-native-manifest.json').read_bytes()==(root/'artifacts/sdk-native-manifest.json').read_bytes(),'Uploaded native manifest copy differs')
 hashes=report['artifactHashes'];verified=[];reported=[]
 for name,digest in hashes.items():
  if name=='target/debug/examples/sdk_native' and root!=c['root']:
   reported.append({'path':name,'sha256':digest,'scope':'CI-reported native executable digest; original upload excludes target/.'});continue
  actual_path=SDK_COPIES.get(name,name) if root!=c['root'] else name
  raw=(root/actual_path).read_bytes();need(sha(raw)==digest,'Actual SDK artifact hash differs: '+name)
  if name.endswith('.wasm'):need(raw.startswith(b'\0asm'),'SDK compiled artifact WASM magic absent')
  verified.append({'path':actual_path,'reportedPath':name,'sha256':digest,'bytes':len(raw)})
 for original,copy in SDK_COPIES.items():need(hashes[original]==hashes[copy],'SDK uploaded copy differs from original packaged bytes')
 for label in ('native','wasm'):
  raw=E['read_json'](root/f'artifacts/sdk/{label}-observer.json');need(raw==report['portable'],'Actual SDK '+label+' observation differs from exact portable report')
 module=(root/SDK_COPIES['packages/wasm/dist/editor_wasm_bg.wasm']).read_bytes();seal=wasm_seal(module)
 metadata=E['read_json'](root/'artifacts/sdk-wasm-seal.json')
 need(seal['build_id']==identity and all(metadata[k]==v for k,v in seal.items()) and metadata['section']=='klenwriter.editor.sdk/1' and metadata['sealed_bytes']==len(module) and metadata['sealed_sha256']==sha(module),'Actual packaged SDK seal/manifest/hash differs')
 generator=E['read_json'](root/'artifacts/sdk-generator-dependencies.json')
 need(generator['format']=='klenwriter-editor-sdk-generator-dependencies/1' and generator['generator']=='ts-rs@12.0.1' and generator['generatorExcludedFromWasmRuntime'] is True,'Pinned native-only generation evidence missing')
 graph=generator['wasmRuntimeGraph'];need(sha(graph.encode())==generator['wasmRuntimeGraphSha256'] and re.search(r'^(?:ts-rs|ts-rs-macros|termcolor) v',graph,re.M) is None,'Native generator entered runtime graph or graph hash differs')
 deps=generator['dependencies'];need(deps and all(d['license'] for d in deps) and len({(d['name'],d['version']) for d in deps})==len(deps),'Actual generator dependency/license rows incomplete')
 need(any(d['name']=='ts-rs' and d['version']=='12.0.1' and d['license']=='MIT' for d in deps),'Actual pinned generator MIT license missing')
 vectors=strict_json(git_blob(c,'contracts/sdk/v1/vectors.json'));rows=vectors['command_vectors'];portable=report['portable']
 need(portable['commands']['literal_total']==len(rows) and portable['commands']['catalog_total']==len({r['command_id'] for r in rows}) and portable['commands']['history_replays']==2*sum(r['expected_effect']=='changed' for r in rows),'SDK report command coverage differs from authored vector authority')
 need(portable['snapshots_resources']['snapshot_cap']==vectors['resource_expectations']['max_snapshot_handles'] and portable['snapshots_resources']['repeated_cycles']==vectors['resource_expectations']['repeated_cycles'],'SDK resource coverage differs from literal authority')
 browser=verify_sdk_browser(E['read_json'](root/'artifacts/browser.json'),E['LOCAL_PROOF'])
 consumer=verify_clean_consumer(c,root,identity,hashes)
 return {'buildId':identity,'productionSourceFiles':len(build['sourceHashes']),'verifiedArtifacts':verified,'reportedOnlyArtifacts':reported,'seal':seal,'generatorDependencyCount':len(deps),'consumer':consumer,'sdkBrowserCases':browser}


def compare_sdk(c,local,ci,selected_root):
 verify_sdk(local);verify_sdk(ci)
 need(local['buildId']==ci['buildId'] and local['portable']==ci['portable'],'Exact SDK portable semantics/source build identity differ across local/CI')
 sources=[]
 for name,digest in ci['sourceHashes'].items():
  need(sha(git_blob(c,name))==digest==local['sourceHashes'][name],'SDK source differs from frozen Git/local: '+name)
  sources.append({'path':name,'sha256':digest})
 bundle=verify_sdk_bundle(c,ci,selected_root)
 differences=[{'path':name,'local':local['artifactHashes'][name],'ci':digest,'scope':'Target-local compiler/artifact bytes retained; exact portable semantics compared.'} for name,digest in ci['artifactHashes'].items() if digest!=local['artifactHashes'][name]]
 return {'source_hashes':sources,'matched_source_hashes':len(sources),'portable_local_ci_observations_equal':True,'portableComparisonScope':'Exact .portable and source-derived buildId; generatedAt and target-local artifact hashes remain raw evidence.','artifact_differences':differences,'binary_differences':[d for d in differences if d['path'].endswith('.wasm') or d['path'].startswith('target/')],'bundle':bundle}


def install(namespace):
 global E
 E=namespace
 for name in ('SDK_REQUIRED_FILES','validate_sdk_binding','verify_sdk_lane_logs','verify_sdk_browser','verify_sdk','verify_sdk_bundle','compare_sdk','sdk_tarball_paths'):
  namespace[name]=globals()[name]
