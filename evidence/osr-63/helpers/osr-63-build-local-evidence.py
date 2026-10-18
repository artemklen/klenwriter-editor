#!/usr/bin/env python3
"""Preserve completed actual OSR-63 local gates; no gates/network on import.

Root supplies completed actual receipts in --config. main is deliberately a
separate, explicit write step. It never tests, commits, creates CI or reviews.
The during-Rust broader snapshot is labelled honestly, not as pre-start proof.
"""
import argparse
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess
import zlib

ROOT = Path('/Users/artem/projects/klenwriter-editor')
BASE = '62a52bb054b09f0e850762124b53229e2b195d14'
CONTRACT = 'evidence/osr-63/execution-contract.md'
CONTRACT_SHA = '17c4e170d98e34f1ae9ce4c9199c37196360d1d8c240cee4ed883ddce06485bf'
RECEIPT = 'evidence/osr-63/local-verification.json'
EVIDENCE_INPUTS = {CONTRACT, 'evidence/osr-37/execution-contract.md', 'evidence/osr-36/execution-contract.md', 'evidence/osr-59/operation-vectors.json', 'evidence/osr-59/position-vectors.json'}
EXCLUDED = {'artifacts', 'target', 'node_modules', '.tools', '.git', 'test-results', 'playwright-report'}
LABELS = {'command':'commands', 'transaction':'transactions', 'history':'history', 'deltas':'deltas', 'sdk':'sdk'}
COLLECTOR = Path('/tmp/osr-63-collect-prepared.py')
SDK_SUPPORT = Path('/tmp/osr-63-collector-sdk.py')
HEX64 = re.compile(r'[0-9a-f]{64}')
RUST = re.compile(r'^test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out;', re.M)
EXPECTED_ARGV = {'workspace_check':['npm','run','check'], 'msrv':['cargo','+1.89.0','test','--locked','-p','klenwriter-editor-core','-p','klenwriter-editor-kwdj'], 'm0':['npm','test'], 'm0_summary':['node','scripts/summarize-evidence.mjs']}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def optional_native_stderr(path):
    """Only known observer stderr byte-containers may legitimately be empty."""
    paths=set()
    for directory in LABELS.values():
        paths.update({ROOT/f'artifacts/{directory}/native.stderr.log', ROOT/f'evidence/osr-63/witness-inputs/{directory}/native.stderr.log'})
    paths.add(ROOT/'evidence/osr-63/sdk-inputs/sdk/native.stderr.log')
    return Path(path) in paths


def read(path, cap=128*1024*1024):
    require(isinstance(path,(str,Path)),'Actual non-null input path required')
    path=Path(path)
    require(path.is_file() and not path.is_symlink() and 0<=path.stat().st_size<=cap and (path.stat().st_size>0 or optional_native_stderr(path)), 'Missing/unsafe/empty/oversize input: '+str(path))
    return path.read_bytes()


def decode(raw):
    def pairs(items):
        result={}
        for key,value in items:
            require(key not in result,'Duplicate JSON key: '+key)
            result[key]=value
        return result
    return json.loads(raw.decode('utf-8-sig'),object_pairs_hook=pairs)


def json_bytes(value):
    return (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode()


def relative(name):
    require(isinstance(name,str),'Repository path must be text')
    p=PurePosixPath(name)
    require(p.parts and not p.is_absolute() and '..' not in p.parts and str(p)==name,'Unsafe relative path: '+name)
    return p


def git(root,*args):
    return subprocess.check_output(['git',*args],cwd=root,stderr=subprocess.PIPE)


def proof(path,raw=None):
    raw=read(path) if raw is None else raw
    return {'path':str(Path(path)),'bytes':len(raw),'sha256':sha(raw),'crc32':f'{zlib.crc32(raw)&0xffffffff:08x}'}


def capture_source_closure(root=ROOT, source=None):
    root=Path(root).resolve()
    argv=('ls-tree','-r','--name-only','-z',source) if source else ('ls-files','-z','--cached','--others','--exclude-standard')
    names=git(root,*argv).decode().split('\0'); result={}
    for name in sorted(set(filter(None,names))):
        p=relative(name)
        if p.parts[0] in EXCLUDED or (p.parts[0]=='evidence' and name not in EVIDENCE_INPUTS):
            continue
        path=root/name
        require(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(root),'Unsafe source: '+name)
        raw=read(path)
        if source:
            require(raw==git(root,'show',source+':'+name),'Live source differs from Git: '+name)
        result[name]=sha(raw)
    require(EVIDENCE_INPUTS<=set(result) and result.get(CONTRACT)==CONTRACT_SHA,'Accepted normative inputs changed/missing')
    return result


def verify_hashes(hashes,closure=None):
    require(isinstance(hashes,dict) and hashes,'Nonempty exact hash scope required')
    for name,digest in hashes.items():
        relative(name)
        require(isinstance(digest,str) and HEX64.fullmatch(digest) and sha(read(ROOT/name))==digest,'Hash differs: '+name)
        if closure is not None and not name.startswith(('artifacts/','target/')):
            require(closure.get(name)==digest,'Reported source absent/different in tested closure: '+name)


def rust_counts(text):
    rows=RUST.findall(text)
    require(rows and 'test result: FAILED' not in text and all(all(int(n)==0 for n in row[1:]) for row in rows),'Incomplete/failed/filtered Rust log')
    return {'passedIncludingDoctests':sum(int(row[0]) for row in rows),'testResultBlocks':len(rows)}


def browser_count(text):
    rows=re.findall(r'^\s*(\d+) passed \([^\n]+\)\s*$',text,re.M)
    require(len(rows)==1 and not re.search(r'^\s*\d+ (failed|skipped|interrupted|did not run)',text,re.M),'Incomplete/nonpassing browser log')
    return int(rows[0])


def load_collector(expected):
    for path,key in ((COLLECTOR,'collectorSha256'),(SDK_SUPPORT,'sdkSupportSha256')):
        require(HEX64.fullmatch(expected[key]) and sha(read(path))==expected[key],'Helper pin changed: '+str(path))
    spec=importlib.util.spec_from_file_location('osr63_collector_local',COLLECTOR)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def actual_gate(role,path,closure,msrv_equivalence=None):
    receipt_raw=read(path);r=decode(receipt_raw)
    require(r['issue']=='OSR-63' and r['returnCode']==0 and r['status']=='passed' and r['argv']==EXPECTED_ARGV[role] and Path(r['cwd']).resolve()==ROOT,'Wrong/nonpassing actual gate receipt: '+role)
    require(r['productionSourceUnchanged'] is True and r['sourceBefore']==r['sourceAfter'] and r['startedAt'] and r['completedAt'],'Actual gate source/timing mismatch: '+role)
    raw=read(r['rawLog']);require(len(raw)==r['rawLogBytes'] and sha(raw)==r['rawLogSha256'],'Actual raw capture differs: '+role)
    hashes=r['sourceBefore']['sourceHashes']
    if role=='msrv':
        eq_raw=read(msrv_equivalence);eq=decode(eq_raw)
        require(eq['issue']=='OSR-63' and eq['gate']=='msrv' and Path(eq['actualReceipt']).resolve()==Path(path).resolve() and eq['actualReceiptSha256']==sha(receipt_raw),'MSRV equivalence is not bound to actual receipt')
        wanted={name:d for name,d in hashes.items() if name in {'Cargo.toml','Cargo.lock','rust-toolchain.toml'} or name.startswith(('crates/core/','crates/kwdj/'))}
        require(eq['targetSourceHashes']==wanted and wanted,'MSRV target closure incomplete')
        verify_hashes(wanted,closure)
    elif role=='workspace_check':
        verify_hashes(hashes,closure)
    row={'role':role,'command':shlex.join(r['argv']),'path':r['rawLog'],'bytes':len(raw),'sha256':sha(raw),'exit_code':r['returnCode'],'runner_readback':str(path),'runner_readback_sha256':sha(receipt_raw),'productionBuildId':r['sourceBefore']['buildId']}
    if role in {'m0','m0_summary'}:
        row['sourceScope']='M0 harness/source subset verified separately from saved observation and original broad snapshot; SDK-only changes are outside this gate.'
    return row,raw,receipt_raw


def derive_sdk_lanes(full,collector):
    sdk_files=collector._sdk_module.SDK_FILES;lanes=[]
    for match in re.finditer(r'^> ([^\n]*node --test[^\n]*)$',full,re.M):
        command=match[1];files=[name for name in shlex.split(command) if name in sdk_files]
        if not files:
            continue
        index=len(collector._sdk_module.node_summaries(full[:match.start()]))
        summaries=collector._sdk_module.node_summaries(full)
        require(index<len(summaries),'SDK summary absent')
        markers=[]
        for name in files:
            titles=re.findall(r"(?:test|it)\(\s*'([^'\n]+)'",read(ROOT/name).decode())
            actual=[title for title in titles if collector.witness_pass(full,title)]
            require(actual,'No source-bound positive title for '+name)
            markers.append(actual[0])
        lanes.append({'files':files,'commandMarker':command,'summaryIndex':index,'passed':summaries[index]['pass'],'successMarkers':markers})
    require(lanes,'No actual SDK invocations')
    return lanes


def semantic_checks(report,pointers):
    def get(path):
        value=report
        for key in path[1:].split('/'):
            key=key.replace('~1','/').replace('~0','~')
            value=value[int(key)] if isinstance(value,list) else value[key]
        return value
    return [{'pointer':p,'value':get(p)} for p in pointers]


def check_reports(closure,collector):
    reports={};actual={}
    for label in ('session-foundation',*LABELS):
        path=ROOT/f'artifacts/{label}-report.json';raw=read(path);r=decode(raw)
        require(r.get('nativeWasmEqual') is True,'Native/WASM comparison absent: '+label)
        verify_hashes(r['sourceHashes'],closure)
        if r.get('artifactHashes'):
            verify_hashes(r['artifactHashes'])
        row={'path':str(path),'sha256':sha(raw),'original':proof(path,raw),'sourcePaths':sorted(n for n in r['sourceHashes'] if not n.startswith(('artifacts/','target/'))),'sourceHashCount':len(r['sourceHashes']),'sourceHashes':r['sourceHashes'],'artifactHashes':r.get('artifactHashes',{}),'nativeWasmEqual':True}
        if label in LABELS:
            row['binary']=f'artifacts/{LABELS[label]}/probe_bg.wasm';binary=read(ROOT/row['binary'])
            require(binary.startswith(b'\0asm') and r['sourceHashes'].get(row['binary'],r.get('artifactHashes',{}).get(row['binary']))==sha(binary),'Actual compiled WASM unbound: '+label)
        reports[label]=row;actual[label]=(r,raw)
    reports['deltas']['semanticChecks']=semantic_checks(actual['deltas'][0],['/portable/status','/portable/literals/literal_total','/portable/literals/same_literal_and_full_authoritative_results','/portable/literals/equivalence_cohorts','/portable/series/case_total'])
    reports['sdk']['semanticChecks']=semantic_checks(actual['sdk'][0],['/portable/status','/portable/commands/literal_total','/portable/commands/catalog_total','/portable/commands/history_replays','/portable/identity_facts/same_captured_request_retries_after_facts_recover','/portable/metadata_dtos/exact_u64_attribute'])
    collector.REPORT_SPECS={label:{k:reports[label][k] for k in ('path','sha256','sourcePaths','binary','semanticChecks') if k in reports[label]} for label in LABELS}
    collector.verify_report(actual['command'][0]);collector.verify_transaction(actual['transaction'][0]);collector.verify_history(actual['history'][0]);collector.verify_deltas(actual['deltas'][0]);collector.verify_sdk(actual['sdk'][0])
    return reports,actual


def verify_live_sdk_bundle(collector,report,closure,local_proof):
    """Same bundle validator, with explicit live-source authority before commit.

    Only two source-read adapters are replaced for this one call. No Git/source
    claim is invented: every byte is pinned by tested closure. Binder reruns the
    unmodified source adapter against the actual committed Git objects.
    """
    sdk=collector._sdk_module;old_blob,old_paths=sdk.git_blob,sdk.sdk_source_paths
    def live_blob(c,name):
        relative(name);raw=read(ROOT/name)
        require(closure.get(name)==sha(raw),'SDK bundle source outside tested closure: '+name)
        return raw
    names=set(closure)
    fixed={'Cargo.toml','Cargo.lock','rust-toolchain.toml','package.json','package-lock.json','package-map.json','tsconfig.base.json','tsconfig.json','scripts/generate-sdk-types.mjs','scripts/build-workspace.mjs','scripts/dependency-notices.mjs','scripts/package-identity.mjs','scripts/seal-sdk-wasm.mjs','provenance/licenses/ts-rs-12.0.1-MIT.txt','provenance/licenses/sdk-generator-license-sources.json','crates/wasm/examples/sdk_types.rs','crates/wasm/examples/sdk_manifest.rs'}
    for crate in ('core','engine','kwdj','wasm'):
        fixed.add(f'crates/{crate}/Cargo.toml');fixed.update(n for n in names if n.startswith(f'crates/{crate}/src/') and n.endswith('.rs'))
    for package in ('wasm','sdk','kwdj'):
        fixed.update({f'packages/{package}/package.json',f'packages/{package}/tsconfig.json'})
        fixed.update(n for n in names if n.startswith(f'packages/{package}/src/') and n.endswith(('.ts','.js')) and n not in {'packages/wasm/src/sdk-types.ts','packages/wasm/src/sdk-build-id.ts'})
    sdk.git_blob=live_blob;sdk.sdk_source_paths=lambda c:sorted(fixed);collector.LOCAL_PROOF=local_proof
    try:
        result=collector.verify_sdk_bundle({'root':ROOT,'source':None},report,ROOT)
    finally:
        sdk.git_blob, sdk.sdk_source_paths=old_blob,old_paths
    result['sourceAuthority']='Exact tested live-source closure before commit; binder repeats all package/build checks against final Git objects.'
    return result


def frozen58():
    names=filter(None,git(ROOT,'ls-tree','-r','--name-only','-z',BASE,'--','evidence/osr-58/').decode().split('\0'));hashes={}
    for name in names:
        raw=git(ROOT,'show',BASE+':'+name)
        require(read(ROOT/name)==raw,'Frozen OSR58 changed: '+name);hashes[name]=sha(raw)
    require(len(hashes)==75 and hashes.get('evidence/osr-58/automated/observations.json')=='d26e6d92decfc48e7663b6489ea2cef7f5a6ec4bbfd683b59acd34768fa4f79a','Frozen75 authority differs')
    return {'base':BASE,'byteExactToBase':True,'trackedFileCount':len(hashes),'trackedFiles':hashes}


def gzip_bytes(raw):
    packed=gzip.compress(raw,compresslevel=9,mtime=0)
    require(gzip.decompress(packed)==raw,'Gzip roundtrip differs')
    return packed


def ungzip(raw):
    import io
    with gzip.GzipFile(fileobj=io.BytesIO(raw),mode='rb') as stream:
        value=stream.read(128*1024*1024+1)
    require(len(value)<=128*1024*1024,'Expanded complete log exceeds cap')
    return value


def supporting_inputs(config,successful_paths):
    """Preserve explicit known histories plus their referenced63 /tmp inputs.

    No return code is inferred from a log. Existing nested metadata remains raw;
    absent original receipt is explicitly absent, never reconstructed.
    """
    pending=list(config['supportingInputs']);seen={};unavailable=[]
    while pending:
        path=Path(pending.pop(0))
        require(path.is_absolute() and path.resolve().parent==Path('/tmp').resolve() and path.name.startswith('osr-63-'),'Supporting input must be63 /tmp regular file')
        key=str(path.resolve())
        if key in seen or key in successful_paths:
            continue
        raw=read(path);seen[key]=(path,raw)
        if path.suffix=='.json':
            value=decode(raw)
            def refs(v):
                if isinstance(v,dict):
                    for x in v.values(): refs(x)
                elif isinstance(v,list):
                    for x in v: refs(x)
                elif isinstance(v,str) and v.startswith(('/tmp/osr-63-','/private/tmp/osr-63-')):
                    p=Path(v)
                    if p.parent.resolve()==Path('/tmp').resolve() and p.suffix in {'.log','.json','.txt'}:
                        if p.is_file() and not p.is_symlink(): pending.append(str(p))
                        else: unavailable.append(v)
            refs(value)
    require(seen,'Known failed/focused raw inputs must be retained')
    return sorted(seen.values(),key=lambda x:x[0].name),sorted(set(unavailable))


def build_evidence(config):
    require(config['issue']=='OSR-63' and config['base']==BASE,'Wrong actual builder config')
    require(git(ROOT,'rev-parse','HEAD').decode().strip()==BASE and git(ROOT,'branch','--show-current').decode().strip()=='osr-63','Precommit builder requires osr-63 on exact base')
    snapshot_raw=read(config['sourceSnapshot']);snapshot=decode(snapshot_raw);closure=capture_source_closure()
    require(snapshot['issue']=='OSR-63' and snapshot['base']==BASE and snapshot['sourceHashes']==closure,'Captured final source closure changed')
    collector=load_collector(config);rows={role:actual_gate(role,config['gates'][role],closure,config['msrvEquivalence']) for role in EXPECTED_ARGV}
    full=rows['workspace_check'][1].decode('utf-8-sig')
    require(full.count('> cargo fmt --all --check')==1 and full.count('> node --test tests/canonical.node.mjs')==1,'Full Rust section boundaries absent')
    rust=full.split('> cargo fmt --all --check',1)[1].split('> node --test tests/canonical.node.mjs',1)[0]
    rust_result=rust_counts(rust);msrv_result=rust_counts(rows['msrv'][1].decode('utf-8-sig'))
    package=decode(read(ROOT/'package.json'));require('> '+package['scripts']['check'] in full,'Actual complete current npm check chain absent')
    for script in re.findall(r'npm run ([A-Za-z0-9:_-]+)',package['scripts']['check']):
        require(re.search(r'^> klenwriter-editor-workspace@[^\s]+ '+re.escape(script)+r'\s*$',full,re.M),'Current npm check subcommand absent: '+script)
    floors={'rustPassed':rust_result['passedIncludingDoctests'],'msrvPassed':msrv_result['passedIncludingDoctests'],'workspaceBrowserPassed':browser_count(full),'m0BrowserPassed':browser_count(rows['m0'][1].decode('utf-8-sig'))}
    reports,actual=check_reports(closure,collector)
    markers=list(collector.WITNESS_MARKERS)
    for pattern in (r'^DELTAS native/WASM PASS: .*$',r'^SDK native/WASM PASS: .*$'):
        found=re.findall(pattern,full,re.M);require(len(found)==1,'Unique final native/WASM standalone marker required');markers.append(found[0])
    require(all(collector.witness_pass(full,m) for m in markers),'Actual witness positive pass missing')
    rust_markers=[line.strip() for line in rust.splitlines() if line.startswith('test ') and line.endswith(' ... ok') and any(p in line for p in ('sdk::tests::','identity::tests::','command_tests::'))]
    require(rust_markers,'Actual new kernel/private Rust pass markers absent')
    lanes=derive_sdk_lanes(full,collector);consumer_path=ROOT/'artifacts/sdk-clean-consumer-report.json'
    browser_cases=[{'project':p,'file':'tests/sdk-workspace-browser.spec.js','title':collector._sdk_module.SDK_TITLE} for p in ('chromium','firefox','webkit')]
    inputs={'contract':{'path':CONTRACT,'sha256':CONTRACT_SHA},'requiredSteps':collector.REQUIRED_STEPS,'requiredRustMarkers':rust_markers,'requiredWitnessMarkers':markers,'rawLogs':[r[0] for r in rows.values()],'sdkLanes':lanes,'sdkCleanConsumerReport':{'path':str(consumer_path),'sha256':sha(read(consumer_path))},'sdkBrowserCases':browser_cases}
    portable_proof={**inputs,'sourceClosure':closure,'gateFloors':floors,'reports':collector.REPORT_SPECS}
    collector.validate_sdk_binding(portable_proof);collector.verify_sdk_lane_logs(full,portable_proof);collector.verify_sdk_browser(decode(read(ROOT/'artifacts/browser.json')),portable_proof)
    sdk_bundle=verify_live_sdk_bundle(collector,actual['sdk'][0],closure,portable_proof)
    require(rows['workspace_check'][0]['productionBuildId']==sdk_bundle['buildId'],'Final actual build/report/runner identity mismatch')
    m0_raw=read(config['m0Observations']);m0=decode(m0_raw)
    require(len(m0['observations'])==floors['m0BrowserPassed'] and m0['failures']==[] and m0['run']['unexpected']==0,'Fresh M0 observations incomplete/failed')
    verify_hashes(m0['run']['sourceHashes'],closure)
    old_snapshot_raw=read(config['m0SourceSnapshot']);old_snapshot=decode(old_snapshot_raw)
    require(old_snapshot['issue']=='OSR-63' and old_snapshot['base']==BASE,'Wrong actual M0 broad snapshot')
    m0_scope={**m0['run']['sourceHashes'],**{name:old_snapshot['sourceHashes'][name] for name in ('package.json','.node-version','scripts/summarize-evidence.mjs')}}
    verify_hashes(m0_scope,closure)
    for role in ('m0','m0_summary'):
        actual_before=decode(rows[role][2])['sourceBefore']['sourceHashes']
        require(all(actual_before[name]==digest for name,digest in m0_scope.items() if name in actual_before),'M0 actual production subset differs from scoped source')
    msrv_broad={name:digest for name,digest in old_snapshot['sourceHashes'].items() if name.startswith(('crates/core/','crates/kwdj/','contracts/kwdj/v1/')) or name in {'Cargo.toml','Cargo.lock','rust-toolchain.toml','evidence/osr-59/position-vectors.json'}}
    expected_msrv_broad={name for name in closure if name.startswith(('crates/core/','crates/kwdj/','contracts/kwdj/v1/')) or name in {'Cargo.toml','Cargo.lock','rust-toolchain.toml','evidence/osr-59/position-vectors.json'}}
    require(set(msrv_broad)==expected_msrv_broad,'Supplemental MSRV integration-test/fixture scope changed')
    verify_hashes(msrv_broad,closure)
    statuses={s:sum(o['requirementStatus']==s for o in m0['observations']) for s in ('MET','GAP','OBSERVATION')}
    summaries=[]
    for line in rows['m0_summary'][1].decode('utf-8-sig').splitlines():
        try: value=decode(line.encode())
        except (ValueError,UnicodeError): continue
        if isinstance(value,dict) and 'observations' in value and 'failures' in value: summaries.append(value)
    require(summaries==[{'observations':floors['m0BrowserPassed'],'failures':0,'requirements':statuses}],'M0 summary differs from actual observations')
    frozen=frozen58();out=ROOT/'evidence/osr-63';writes={};archives={}
    restoration_raw=read(config['frozenRestorationReceipt']);restoration=decode(restoration_raw)
    require(restoration['issue']=='OSR-63' and restoration['count']==75 and {x['path']:x['sha256'] for x in restoration['frozen58RestoredFiles']}==frozen['trackedFiles'],'Actual frozen75 restoration receipt differs')
    require(restoration['savedNewObservations']['sha256']==sha(m0_raw) and restoration['savedNewObservations']['bytes']==len(m0_raw),'Restoration discarded/differs from actual new observations')
    def add(path,raw,packed=False):
        destination=out/path;payload=gzip_bytes(raw) if packed else raw
        require(destination not in writes or writes[destination]==payload,'Archive filename collision')
        writes[destination]=payload;return proof(destination,payload)
    logs={}
    for role,(row,raw,exit_raw) in rows.items():
        archive=add('logs/'+Path(row['path']).name+'.gz',raw,True)
        exit_archive=add('runner-readbacks/'+Path(row['runner_readback']).name,exit_raw)
        logs[role]={'original':proof(row['path'],raw),'archive':archive,'exitReceiptArchive':exit_archive,'exit_code':0,'command':row['command']}
    for label,(_,raw) in actual.items(): reports[label]['archive']=add(label+'-report.json',raw)
    success_paths={str(Path(r[0]['path']).resolve()) for r in rows.values()}|{str(Path(r[0]['runner_readback']).resolve()) for r in rows.values()}
    supports,unavailable=supporting_inputs(config,success_paths)
    for path,raw in supports:
        archives[path.name]={'original':proof(path,raw),'archive':add('supporting-inputs/'+path.name+('.gz' if path.suffix=='.log' else ''),raw,path.suffix=='.log'),'scope':'Historical focused/failed raw bytes; exact original qualifiers and any original exit evidence remain unchanged. Not promoted to final tested-source pass.'}
    sdk_paths=set(collector.SDK_REQUIRED_FILES)|set(collector.sdk_tarball_paths(decode(read(ROOT/'artifacts/package-inventory.json'))))
    sdk_artifacts={}
    for name in sorted(sdk_paths):
        raw=read(ROOT/name);sdk_artifacts[name]={'original':proof(ROOT/name,raw),'archive':add('sdk-inputs/'+name.removeprefix('artifacts/'),raw)}
    # Also keep each lane's complete raw observation/probe and compiled binary.
    for label,directory in LABELS.items():
        for path in sorted((ROOT/'artifacts'/directory).iterdir()):
            if path.is_file() and not path.is_symlink():
                name=path.relative_to(ROOT).as_posix()
                if name not in sdk_artifacts:
                    raw=read(path);sdk_artifacts[name]={'original':proof(path,raw),'archive':add('witness-inputs/'+name.removeprefix('artifacts/'),raw)}
    m0_archive=add('automated/observations.json.gz',m0_raw,True)
    snapshot_archive=add('source-snapshot.json',snapshot_raw)
    eq_raw=read(config['msrvEquivalence']);eq_archive=add('msrv-source-equivalence.json',eq_raw)
    m0_source_archive=add('m0-source-snapshot.json',old_snapshot_raw)
    restoration_archive=add('frozen58-restoration.json',restoration_raw)
    for helper in (Path(__file__),Path('/tmp/osr-63-bind-local-validation.py'),COLLECTOR,SDK_SUPPORT): add('helpers/'+helper.name,read(helper))
    receipt={'issue':'OSR-63','format':'local-verification/1','status':'passed','base':BASE,'scope':'Completed actual local gates only on the exact tested uncommitted closure. CI, independent review, commit SHA, PR, merge and acceptance are separate facts.','source_closure':closure,'sourceSnapshot':{'original':proof(config['sourceSnapshot'],snapshot_raw),'archive':snapshot_archive,'capturedAt':snapshot['capturedAt'],'scope':snapshot['scope']},'builder':proof(Path(__file__)),'collector':proof(COLLECTOR),'sdkSupport':proof(SDK_SUPPORT),'gateFloors':floors,'commands':[r[0] for r in rows.values()],'logs':logs,'reports':reports,'bindingInputs':inputs,'rust':rust_result,'msrv':{**msrv_result,'equivalenceOriginal':proof(config['msrvEquivalence'],eq_raw),'equivalenceArchive':eq_archive,'scope':decode(eq_raw)['scope']},'sdkBundle':sdk_bundle,'sdkArtifacts':sdk_artifacts,'supportingInputs':archives,'unavailableReferencedHistoricalInputs':unavailable,'m0Observations':{'original':proof(config['m0Observations'],m0_raw),'archive':m0_archive,'summary':summaries[0],'scope':'New harness observations; MET/GAP/OBSERVATION retained honestly; frozen OSR58 original restored separately.'},'frozen58Restored':frozen,'knownLimits':['Controller-only fake-bridge tests are labelled separately from actual packaged Session integration.','The clean consumer proves cargo/rustc ENOENT in the explicit child PATH, not global absence of Rust.','No renderer, IME/AT completion, latency SLA, fuzz expansion or benchmark claim is made by OSR63.','Historical focused receipts retain their own source identity and failed exits; final full workspace receipt is authoritative for this closure.','Broader closure was captured during Rust tests before JS/WASM/build; actual production sources are separately pinned before and after each gate.']}
    receipt['m0SourceEquivalence']={'sourceHashes':m0_scope,'originalSnapshot':proof(config['m0SourceSnapshot'],old_snapshot_raw),'archive':m0_source_archive,'scope':'Actual saved M0 seven-file harness closure plus unchanged package.json, .node-version and summarizer from original captured broad closure; SDK-only callback retention fix is outside this gate. No claim that historical full SDK identity is current.'}
    receipt['msrv']['broaderSourceEquivalence']={'sourceHashes':msrv_broad,'snapshotArchive':m0_source_archive,'scope':'Core/KWDJ entire subtree, integration tests, fixtures, examples, complete contracts/kwdj/v1 corpus and embedded position literals are byte-exact between the broad snapshot captured during the earlier full Rust run and final tested closure. This supplements actual MSRV production before/after pins; the broad snapshot was captured after MSRV, and is not described as a pre-MSRV full-test snapshot.'}
    receipt['frozen58RestorationReceipt']={'original':proof(config['frozenRestorationReceipt'],restoration_raw),'archive':restoration_archive}
    receipt['sourceSnapshot']['scope']=snapshot['scope']
    receipt['knownLimits'][-1]='The exact final broader closure snapshot retains its actual capture time/scope. Actual production sources are additionally pinned before/after each gate; unaffected MSRV/M0 scopes have explicit source-equivalence proof.'
    writes[ROOT/RECEIPT]=json_bytes(receipt)
    require(capture_source_closure()==closure,'Source changed during proof preparation')
    return receipt,writes


def publish(writes):
    out=ROOT/'evidence/osr-63'
    require(out.resolve()==out and not out.is_symlink(),'Canonical evidence directory required')
    for path,raw in writes.items():
        require(path.resolve().is_relative_to(out.resolve()) and not path.is_symlink(),'Unsafe evidence destination')
        require(not path.exists() or read(path)==raw,'Refusing overwrite of differing evidence: '+str(path))
    for path,raw in writes.items():
        path.parent.mkdir(parents=True,exist_ok=True)
        if not path.exists():
            with path.open('xb') as handle: handle.write(raw)
            os.chmod(path,0o600)
        require(read(path)==raw,'Evidence readback differs')


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',type=Path,default=Path('/tmp/osr-63-local-evidence-config.json'));args=p.parse_args(argv)
    config=decode(read(args.config));receipt,writes=build_evidence(config);publish(writes)
    print(json.dumps({'issue':'OSR-63','status':'passed','receipt':proof(ROOT/RECEIPT),'sourceClosureFiles':len(receipt['source_closure']),'gateFloors':receipt['gateFloors'],'sdkBuildId':receipt['sdkBundle']['buildId'],'sdkLanes':receipt['bindingInputs']['sdkLanes'],'preservedFiles':len(writes)}))


if __name__=='__main__':
    main()
