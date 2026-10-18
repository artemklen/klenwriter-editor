#!/usr/bin/env python3
"""Collect one already-existing OSR-63 iteration1 pull_request CI run.

Only GET/read-only gh operations are implemented. Config iteration must be integer1. Never dispatch/retry/cancel CI,
mutate Git/Linear, or overwrite iteration1 proof. Root supplies the actual frozen
source/base/PR/run in /tmp/osr-63-config.json after local gates pass.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time
import zipfile
import importlib.util

_SDK_SUPPORT_PATH = Path('/tmp/osr-63-collector-sdk.py')

HEX40 = re.compile(r'[0-9a-f]{40}')
HEX64 = re.compile(r'[0-9a-f]{64}')
REPORT_SPECS = {}
LOCAL_PROOF = None
BASE = '62a52bb054b09f0e850762124b53229e2b195d14'
CONTRACT_SHA = '17c4e170d98e34f1ae9ce4c9199c37196360d1d8c240cee4ed883ddce06485bf'
REQUIRED_STEPS = [
    'Run actions/checkout@v4', 'Run actions/setup-node@v4',
    'Run npm install --global npm@11.14.0 --ignore-scripts',
    'Run rustup toolchain install 1.97.1 --profile minimal --component rustfmt,clippy --target wasm32-unknown-unknown',
    'Run cargo install wasm-bindgen-cli --version 0.2.129 --locked --root .tools',
    'Run npm ci --ignore-scripts', 'Run npx playwright install chromium firefox webkit',
    'Run rustup toolchain install 1.89.0 --profile minimal',
    'Run cargo +1.89.0 test --locked -p klenwriter-editor-core -p klenwriter-editor-kwdj',
    'Run npm run check', 'Run npm test', 'Run node scripts/summarize-evidence.mjs',
    'Run actions/upload-artifact@v4',
]
WITNESS_MARKERS = [
    'actual KWDJ command availability and execution match literal expectations on native and WASM',
    'real KWDJ transaction outputs and typed atomic refusals agree on native and compiled WASM',
    'bounded real-profile Session foundation is identical on native and compiled WASM',
    'actual Session history follows independent literals on native and compiled WASM',
]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_bytes())


def load_config(path):
    require(path.is_file() and not path.is_symlink(), 'Actual regular config file required')
    raw = path.read_bytes()
    c = json.loads(raw)
    require(c['issue'] == 'OSR-63' and type(c['iteration']) is int and c['iteration'] == 1, 'Explicit OSR-63/iteration1 config required')
    require(re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', c['repo']), 'Malformed repository')
    for field in ('source', 'base'):
        require(isinstance(c[field], str) and HEX40.fullmatch(c[field]) and c[field] != '0' * 40,
                f'Actual nonzero 40-hex {field} required')
    require(c['source'] != c['base'], 'Frozen source must differ from its base')
    for field in ('pr', 'run', 'workflow_id'):
        require(type(c[field]) is int and c[field] > 0, f'Actual positive {field} required')
    c['root'] = Path(c['root']).resolve()
    require(c['root']==Path('/Users/artem/projects/klenwriter-editor') and str(c.get('path',c['root']))==str(c['root']) and (c['root']/'.git').exists(),'Canonical local repository root/path required')
    require(c['repo']=='artemklen/klenwriter-editor' and c['base']==BASE and c.get('branch')=='osr-63', 'Canonical OSR63 repo/base/branch required')
    require(c.get('issue_uuid')=='5d7912aa-9034-4f06-8ccc-9e739d6b0fe4', 'Exact live issue identity required')
    require(c.get('preparedCI')==c['run'], 'Actual automatic preparedCI/run binding required')
    for key,filename in [('collector_sha256',Path(__file__)),('sdk_support_sha256',_SDK_SUPPORT_PATH)]:
        require(isinstance(c.get(key),str) and HEX64.fullmatch(c[key]) and sha(filename.read_bytes())==c[key], 'Frozen helper hash differs: '+key)
    load_local_validation(c)
    c['config_path'], c['config_sha256'] = str(path.resolve()), sha(raw)
    c['local_command_report'] = Path(c.get('local_command_report', c['root'] / 'artifacts/command-report.json')).resolve()
    c['local_history_report'] = Path(c.get('local_history_report', c['root'] / 'artifacts/history-report.json')).resolve()
    c['local_deltas_report']=Path(c['local_deltas_report']).resolve()
    c['local_sdk_report']=Path(c['local_sdk_report']).resolve()
    c['local_transaction_report'] = Path(c.get('local_transaction_report', c['root'] / 'artifacts/transaction-report.json')).resolve()
    output = Path(c.get('output_dir', '/tmp/osr-63-prepared-ci'))
    require(not output.is_symlink(), 'Output directory cannot be a symlink')
    c['output_dir'] = output.resolve()
    tmp = Path('/tmp').resolve()
    require(c['output_dir'].is_relative_to(tmp), 'Output must remain under /tmp')
    relative = c['output_dir'].relative_to(tmp)
    require(relative.parts and relative.parts[0].startswith('osr-63-'), 'Output must use a distinct osr-63-* directory')
    return c


def load_local_validation(c):
    global LOCAL_PROOF, REPORT_SPECS
    require(isinstance(c.get('local_validation_receipt'),str) and isinstance(c.get('local_validation_sha256'),str),'Actual frozen local-validation receipt path and SHA required')
    path=Path(c['local_validation_receipt'])
    require(path.is_absolute() and path.is_file() and not path.is_symlink(), 'Actual frozen local validation receipt required')
    raw=path.read_bytes()
    require(HEX64.fullmatch(c['local_validation_sha256']) and sha(raw)==c['local_validation_sha256'], 'Frozen local validation receipt hash differs')
    proof=json.loads(raw)
    require(proof['issue']=='OSR-63' and type(proof['iteration']) is int and proof['iteration']==1 and proof['status']=='passed', 'Actual local success required')
    for key in ('source','base','repo'):
        require(proof[key]==c[key], 'Local validation binding differs: '+key)
    require(proof.get('pr') is None or proof['pr']==c['pr'],'External binding belongs to another actual PR')
    verify_tested_source_closure(c,proof)
    require(proof['contract']=={'path':'evidence/osr-63/execution-contract.md','sha256':CONTRACT_SHA}, 'Actual accepted contract pin required')
    floors=proof['gateFloors']
    require(set(floors)=={'rustPassed','msrvPassed','workspaceBrowserPassed','m0BrowserPassed'} and all(type(v) is int and v>0 for v in floors.values()), 'Actual final local full-check count floors required')
    require(isinstance(proof['requiredRustMarkers'],list) and proof['requiredRustMarkers'] and all(isinstance(x,str) and x for x in proof['requiredRustMarkers']), 'Actual final private/kernel pass markers required')
    require(isinstance(proof['requiredWitnessMarkers'],list) and len(proof['requiredWitnessMarkers'])>=6 and all(isinstance(x,str) and x for x in proof['requiredWitnessMarkers']), 'Actual command/transaction/session/history/deltas/SDK witness markers required')
    require(isinstance(proof['requiredSteps'],list) and len(proof['requiredSteps'])==len(set(proof['requiredSteps'])) and all(isinstance(x,str) and x for x in proof['requiredSteps']),'Actual unique required workflow step names required')
    require(set(REQUIRED_STEPS)<=set(proof['requiredSteps']), 'Final required steps must retain full workflow gates')
    logs=proof['rawLogs']
    require(logs and isinstance(logs,list), 'Actual full local raw logs required')
    for row in logs:
        log=Path(row['path'])
        require(log.is_absolute() and log.is_file() and not log.is_symlink() and log.stat().st_size==row['bytes']>0 and sha(log.read_bytes())==row['sha256'], 'Frozen raw local log differs')
    specs=proof['reports']
    require(set(specs)=={'command','transaction','history','deltas','sdk'}, 'Exactly five actual native/WASM structured report scopes required')
    for label,spec in specs.items():
        require(Path(spec['path']).resolve()==Path(c['local_'+label+'_report']).resolve(), 'Actual local report path differs')
        raw_report=Path(spec['path']).read_bytes()
        require(HEX64.fullmatch(spec['sha256']) and sha(raw_report)==spec['sha256'], 'Actual frozen report bytes differ')
        require(spec['sourcePaths'] and len(spec['sourcePaths'])==len(set(spec['sourcePaths'])), 'Actual nonempty unique source hash scope required')
        for name in spec['sourcePaths']:
            validate_hash_path(name,'0'*64)
            require(not name.endswith('.wasm'), 'Binary must be separate from source scope')
        require(spec['binary']==f'artifacts/{dict(command="commands",transaction="transactions",history="history",deltas="deltas",sdk="sdk")[label]}/probe_bg.wasm', 'Unexpected native/WASM witness binary path')
    require({'evidence/osr-37/execution-contract.md','crates/engine/src/tree.rs','crates/engine/src/tree_impact.rs','crates/engine/src/events.rs','crates/kwdj/src/candidate_cache.rs'}<=set(specs['deltas']['sourcePaths']),'Deltas report must bind actual37 contract/kernel/cache/event sources')
    checks=specs['deltas']['semanticChecks']
    require(isinstance(checks,list) and checks and all(set(x)=={'pointer','value'} and isinstance(x['pointer'],str) and x['pointer'].startswith('/') for x in checks), 'Actual final deltas semantic/schema checks required')
    verify_local_logs(proof)
    validate_sdk_binding(proof)
    verify_sdk_lane_logs(local_log_text(next(row['path'] for row in logs if row['role']=='workspace_check')),proof)
    LOCAL_PROOF,REPORT_SPECS=proof,specs
    HISTORY_COUNTS['history_source_hashes']=len(specs['history']['sourcePaths'])
    return proof


def verify_tested_source_closure(c,proof):
    version=proof['versionedReceipt']
    require(version['path']=='evidence/osr-63/local-verification.json' and HEX64.fullmatch(version['sha256']),'Actual versioned local-verification receipt pin required')
    closure=proof['sourceClosure']
    require(isinstance(closure,dict) and closure and version['path'] not in closure,'Actual noncircular tested source closure required')
    def git_blob(path):
        validate_hash_path(path,'0'*64)
        return subprocess.check_output(['git','show',f'{c["source"]}:{path}'],cwd=c['root'],stderr=subprocess.PIPE)
    raw=git_blob(version['path'])
    require(sha(raw)==version['sha256'],'Actual final Git versioned verification blob differs')
    receipt=json.loads(raw)
    require(receipt['issue']=='OSR-63' and receipt['base']==c['base'] and receipt['status']=='passed','Actual precommit tested source receipt required')
    for field in ('sdkLanes','sdkBrowserCases','sdkCleanConsumerReport'):
        require(proof[field]==receipt['bindingInputs'][field], 'SDK evidence differs from committed receipt: '+field)
    require(receipt['source_closure']==closure,'External binding must preserve exact precommit tested source closure')
    for label,spec in proof['reports'].items():
        require(receipt['reports'][label]['sha256']==spec['sha256'],'External report pin differs from actual committed verification receipt: '+label)
    require(closure.get('evidence/osr-63/execution-contract.md')==CONTRACT_SHA,'Tested Git closure differs from actual accepted contract')
    for name,digest in closure.items():
        validate_hash_path(name,digest)
        require(sha(git_blob(name))==digest,'Final source differs from actually tested uncommitted closure: '+name)
    for spec in proof['reports'].values():
        require(set(spec['sourcePaths'])<=set(closure),'All reported source files must belong to the actual tested closure')


def local_log_text(path):
    path=Path(path)
    if path.suffix=='.gz':
        import gzip
        with gzip.open(path,'rb') as stream:payload=stream.read(128*1024*1024+1)
    else:payload=path.read_bytes()
    require(len(payload)<=128*1024*1024,'Actual local raw log exceeds bounded decode cap')
    return payload.decode('utf-8-sig')


def verify_local_logs(proof):
    # Final floors must be backed by the actual complete successful local logs,
    # not predicted counters. The root supplies their existing raw command exits.
    rows=proof['rawLogs']
    by_role={}
    for row in rows:
        require(type(row['exit_code']) is int and row['exit_code']==0 and isinstance(row['command'],str) and row['command'],'Actual local command/exit required')
        require(row['role'] not in by_role,'Local log roles must be unique')
        by_role[row['role']]=local_log_text(row['path'])
    require({'workspace_check','msrv','m0'}<=set(by_role),'Actual complete local workspace/MSRV/M0 raw logs required')
    check=by_role['workspace_check']
    require('> cargo fmt --all --check' in check and '> node --test tests/canonical.node.mjs' in check,'Full local workspace section boundaries absent')
    rust=check.split('> cargo fmt --all --check',1)[1].split('> node --test tests/canonical.node.mjs',1)[0]
    def rust_count(text):
        matches=re.findall(r'test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out;',text)
        require(matches and all(all(int(n)==0 for n in row[1:]) for row in matches),'Actual local full unfiltered Rust summaries required')
        return sum(int(row[0]) for row in matches)
    def browser_count(text):
        matches=re.findall(r'^\s*(\d+) passed \([^\n]+\)\s*$',text,re.MULTILINE)
        require(len(matches)==1,'Actual local complete browser summary required')
        return int(matches[0])
    actual={'rustPassed':rust_count(rust),'msrvPassed':rust_count(by_role['msrv']),'workspaceBrowserPassed':browser_count(check),'m0BrowserPassed':browser_count(by_role['m0'])}
    require(actual==proof['gateFloors'],'Local full-check floors differ from actual original raw summaries')
    for marker in proof['requiredRustMarkers']:
        require(marker in rust,'Actual local private/kernel marker absent: '+marker)
    require(set(WITNESS_MARKERS)<=set(proof['requiredWitnessMarkers']),'Inherited native/WASM pass markers may not be dropped')
    for marker in proof['requiredWitnessMarkers']:
        require(witness_pass(check,marker),'Actual local native/WASM pass marker absent: '+marker)


def frozen_config():
    return load_config(Path('/tmp/osr-63-config.json'))


def verify_deltas(report):
    spec=REPORT_SPECS.get('deltas')
    require(spec is not None,'Actual frozen deltas report source scope required')
    require(report['format']=='klenwriter-editor-deltas-report/1' and report['nativeWasmEqual'] is True and report['portable']['status']=='passed','Actual deltas native/WASM schema/pass required')
    require(set(report['sourceHashes'])==set(spec['sourcePaths']),'Deltas source-only scope differs from actual frozen binding')
    for name,digest in report['sourceHashes'].items():validate_hash_path(name,digest)
    artifacts={'artifacts/deltas/probe_bg.wasm','artifacts/deltas/probe.js','target/debug/examples/delta_native','artifacts/deltas/native-observer.json','artifacts/deltas/wasm-observer.json'}
    require(set(report['artifactHashes'])==artifacts,'Actual deltas artifact hash scope differs')
    for name,digest in report['artifactHashes'].items():validate_hash_path(name,digest)
    literals=report['portable']['literals'];series=report['portable']['series']
    require(literals['status']==series['status']=='passed' and literals['same_literal_and_full_authoritative_results'] is True and literals['literal_total']==len(literals['cases'])>0 and series['case_total']==len(series['cases'])>0,'Deltas literal/cohort/series proof absent')
    require(all(row['status']=='passed' for row in literals['cases']+series['cases']),'Deltas literal/series failed')
    for row in literals['cases']:
        if row['id']=='D12':
            require(all(row[k] is True for k in ('failed_remount_preserves_all_facets','stale_generation_refused','terminal_closed_and_poisoned')),'Actual lifecycle literal guard absent')
        else:require(row['ordinary_codec_hooks']==0,'Ordinary literal used snapshot codecs')
    require(all(row['ordinary_codec_hooks']==0 for row in series['cases']),'Ordinary series used snapshot codecs')
    phases={'structure','header','preflight','normalization','serialization','static_validation','identity','cache_reuse','cache_update','impact','event','export','full_fallback'}
    for key in ('nativeDiagnostics','wasmDiagnostics'):
        rows=report[key]['series']
        require(rows and len(rows)<=series['case_total'],'Actual target-local trace series missing')
        for row in rows:
            trace=row['trace'];require(set(trace['phases'])==phases,'Target-local phase accounting scope differs')
            require(all(type(trace['logical_work'][k]) is int and trace['logical_work'][k]>=0 for k in ('units','bytes')),'Invalid target-local work usage')
            require(all(type(counter[k]) is int and counter[k]>=0 for counter in trace['phases'].values() for k in ('visits','bytes')),'Invalid target-local phase usage')
            require(trace['phases']['full_fallback']['visits']==trace['phases']['export']['visits']==0,'Ordinary deltas unexpectedly used full fallback/export')
    supplement=report['nativeOnlySupplement']
    require(supplement['path']=='crates/wasm/tests/delta_equivalence.rs' and 'not executed/claimed by this shared observer' in supplement['execution'],'Native-only supplement must not claim shared WASM execution')
    for check in spec['semanticChecks']:
        value=report
        for component in check['pointer'].split('/')[1:]:
            component=component.replace('~1','/').replace('~0','~')
            value=value[int(component)] if isinstance(value,list) else value[component]
        require(type(value) is type(check['value']) and value==check['value'],'Actual frozen deltas semantic field differs: '+check['pointer'])


def witness_pass(text,marker):
    if marker.startswith(('DELTAS native/WASM PASS: ', 'SDK native/WASM PASS: ')):
        return re.search(r'^'+re.escape(marker)+r'\s*$',text,re.MULTILINE) is not None
    return re.search(r'^\s*(?:✔|ok\s+\d+\s+-)\s*'+re.escape(marker)+r'(?:\s*\(|\s*$)',text,re.MULTILINE) is not None


def report_source_count(label):
    require(label in REPORT_SPECS,'Frozen report scope not loaded')
    return len(REPORT_SPECS[label]['sourcePaths'])


def verify_gate_counts(gates):
    require(LOCAL_PROOF is not None,'Actual frozen local validation receipt required')
    require(all(type(gates[k]) is int and gates[k]>=v for k,v in LOCAL_PROOF['gateFloors'].items()) and gates['m0Summary']['failures']==0, 'Actual CI gate counts below final local full-check floors')


def verify_prepared_binding(config,receipt):
    frozen=frozen_config()
    for key in ('issue','iteration','repo','source','base','pr','run','workflow_id'):
        require(receipt[key]==frozen[key], 'Prepared exact frozen binding differs: '+key)
    require(receipt['config_sha256']==frozen['config_sha256'] and receipt['local_validation_sha256']==config['local_validation_sha256'], 'Prepared/local/config proof hash differs')
    require(receipt['portable_deltas_observations_equal'] is True and receipt['matched_deltas_source_file_hashes']==report_source_count('deltas'), 'Actual fourth deltas native/WASM/source proof required')
    require(receipt['portable_sdk_observations_equal'] is True and receipt['matched_sdk_source_file_hashes']==report_source_count('sdk'), 'Actual fifth SDK native/WASM/source proof required')
    require(receipt['portable_history_observations_equal'] is True and receipt['matched_history_source_file_hashes']==report_source_count('history'), 'Actual history source proof required')
    verify_gate_counts(receipt['actual_log_gates'])


def gh(c, *args):
    return subprocess.check_output(['gh', *args], cwd=c['root'], timeout=50, stderr=subprocess.PIPE)


def api(c, path):
    return json.loads(gh(c, 'api', '--method', 'GET', f'repos/{c["repo"]}/{path}'))


def save(c, name, value, *, progress=False):
    path = c['output_dir'] / name
    require(path.resolve().is_relative_to(c['output_dir']), 'Output path escaped iteration1 directory')
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(value, ensure_ascii=False, indent=2).encode() + b'\n'
    if path.exists() and not progress:
        require(path.read_bytes() == raw, f'Immutable iteration1 proof already differs: {path}')
        return str(path)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + '.', suffix='.partial', delete=False) as stream:
        stream.write(raw)
        temporary = Path(stream.name)
    temporary.chmod(0o600)
    temporary.replace(path)
    return str(path)


def verify_report(d):
    require(d['status'] == 'passed' and d['nativeWasmEqual'] is True, 'Commands did not pass on both targets')
    require(d['literal_total'] == d['literal_passed'] == len(d['literal_cases']) == 24, 'Literal24 mismatch')
    for case in d['literal_cases']:
        require(case['status'] == 'passed' and case['query_repetitions'] == 4, 'Literal pass/query count missing')
        require(all(case[k] is True for k in ('full_query_execute_equal', 'query_preserves_all_facets', 'work_bounded', 'literal_caret_matches')),
                'Literal facet/query/work proof missing')
        require(case['ordinary_snapshot_codec_calls'] == 0, 'Literal ordinary hooks were called')
        require(isinstance(case['canonical_json'], str), 'Canonical JSON must remain an exact string')
    require('18446744073709551615' in d['literal_cases'][23]['canonical_json'], 'Exact u64 literal absent')
    g = d['generated']
    require((g['status'], g['enter_cases'], g['interior_refusals'], g['snapshot_codec_calls']) == ('passed', 64, 4, 0), 'Generated64/4 mismatch')
    require(g['query_execute_equal'] is True, 'Generated query/execute proof absent')
    structural = d['structural']
    require(structural['status'] == 'passed' and structural['group_total'] == len(structural['groups']) == 8, 'Structural8 mismatch')
    require(all(group['status'] == 'passed' for group in structural['groups']), 'Structural group failed')
    maps = [group for group in structural['groups'] if group.get('id') == 'normalization_position_maps']
    require(len(maps) == 1 and maps[0]['case_total'] == len(maps[0]['cases']) == 6, 'iteration1 normalization-map6 regression missing')
    require(all(case['status'] == 'passed' for case in maps[0]['cases']), 'iteration1 normalization-map regression failed')
    require(d['inline']['status'] == 'passed' and len(d['inline']['groups']) == 8, 'Inline8 mismatch')
    require(all(group['status'] == 'passed' for group in d['inline']['groups'].values()), 'Inline group failed')
    future = d['future_typing']
    require(future['status'] == 'passed' and future['state_only_toggles'] == future['typing_commits'] == 2,
            'Future typing2/2 missing')
    require(future['actual_journal_mark_before_after'] is True and future['ordinary_snapshot_codec_calls'] == 0, 'Typing history/hooks proof missing')
    hashes = d['sourceHashes']
    hash_scope(d, None, 'artifacts/commands/probe_bg.wasm')
    require('crates/engine/src/mapping.rs' in hashes, 'Repaired mapper source not bound')
    require({name for name in hashes if name.endswith('.wasm')} == {'artifacts/commands/probe_bg.wasm'}, 'Unexpected binary hash scope')
    return maps[0]


HISTORY_COUNTS = {'kwdj_literals': 29, 'adr_seeds': 16, 'adr_direct': 15, 'adr_embedding': 1,
                  'hp_only_bindings': 2, 'supplement_groups': 3, 'lifecycle_cases': 3,
                  'identity_fact_cases': 2, 'unicode_pairs': 8, 'property_sequences': 32,
                  'property_apply': 255, 'property_undo': 255, 'property_redo': 255,
                  'property_checkpoints': 797, 'recurrence_cycles': 512,
                  'recurrence_publications': 1536, 'history_source_hashes': None  # Set only from the actual final frozen report scope.
}


def validate_hash_path(name, digest):
    from pathlib import PurePosixPath
    path = PurePosixPath(name)
    require(isinstance(name, str) and not path.is_absolute() and '..' not in path.parts
            and str(path) == name and bool(path.parts), 'Unsafe report source path')
    require(isinstance(digest, str) and HEX64.fullmatch(digest), f'Invalid report hash: {name}')


def hash_scope(report, total, binary):
    hashes = report['sourceHashes']
    spec=next((spec for spec in REPORT_SPECS.values() if spec['binary']==binary),None)
    require(spec is not None, 'Actual frozen report scope required before validation')
    require(isinstance(hashes,dict) and set(hashes)==set(spec['sourcePaths'])|{binary}, 'Report differs from actual frozen source/binary scope')
    for name, digest in hashes.items():
        validate_hash_path(name, digest)
    require({p for p in hashes if p.endswith('.wasm')} == {binary}, 'Unexpected binary hash scope')


def verify_transaction(d):
    hash_scope(d, 30, 'artifacts/transactions/probe_bg.wasm')
    require(d['nativeWasmEqual'] is True and len(d['groups']) == 5, 'Transaction5 did not pass both targets')
    require(all(g['status'] == 'passed' for g in d['groups'].values()), 'Transaction group failed')
    refusals = d['groups']['atomic_refusals']['cases']
    require(len(refusals) == 11 and all(c['canonical_and_state_preserved'] is True and c['identity_map'] is True for c in refusals), 'Transaction11 atomic refusals absent')
    regression = d['groups']['attributes_marks_spans']['repeated_metadata']
    expected = {'commits': 512, 'canonical_bytes': 159, 'work_cap_bytes': 32768,
                'journal_entry_limit': 1, 'history_action_limit': 1, 'event_record_limit': 1,
                'allocation_warmup_commits': 2, 'steady_commits': 510,
                'canonical_restored': True, 'all_changed': True,
                'steady_work_and_retained_bytes_stable': True, 'identities_preserved': True}
    require(regression == expected, 'Transaction512/2warmup/510steady/1map/1action recurrence differs')


def verify_history(d):
    hash_scope(d, 64, 'artifacts/history/probe_bg.wasm')
    require(d['status'] == 'passed' and d['nativeWasmEqual'] is True, 'History native/WASM proof missing')
    adr = d['generic_adr']
    require(adr['status'] == 'passed' and adr['seed_total'] == adr['seed_passed'] == len(adr['cases']) == 16
            and adr['direct'] == 15 and adr['declared_structural_embeddings'] == 1, 'ADR16/15direct/1embedding mismatch')
    require(sum(c['physical_embedding'] is True for c in adr['cases']) == 1, 'ADR physical embedding count differs')
    for c in adr['cases']:
        require(c['status'] == 'passed' and c['exact_document_selection_marks_ids'] is True
                and c['query_execute_work_equal'] is True and c['ordinary_snapshot_codec_calls'] == 0,
                'ADR history literal/identity/query proof missing')
    kwdj = d['kwdj']
    require(kwdj['status'] == 'passed' and kwdj['literal_total'] == kwdj['literal_passed'] == len(kwdj['cases']) == 29, 'KWDJ29 mismatch')
    require({c['id'] for c in kwdj['cases']} == {f'H{i:02}' for i in range(1, 31) if i != 23}, 'KWDJ case IDs differ')
    for c in kwdj['cases']:
        require(c['status'] == 'passed' and c['ordinary_snapshot_codec_calls'] == 0
                and all(c[k] is True for k in ('query_execute_work_equal', 'query_preserves_all_facets', 'exact_historical_id_sets')),
                'KWDJ literal purity/identity proof missing')
        require(c['checkpoints'] and all(isinstance(p['document'], str) and re.fullmatch(r'\d+', p['revision']) for p in c['checkpoints']), 'History exact canonical/revision strings missing')
    hp = d['hp_only']
    require(hp['status'] == 'passed' and len(hp['variants']) == 2, 'HP-only2 missing')
    require([v['rewritten_saved_none_to_empty_refused'] for v in hp['variants']] == [False, True], 'HP honest/rewrite variants differ')
    require(all(v['status'] == 'passed' and v['implements_command_provider'] is False and v['ordinary_snapshot_codec_calls'] == 0 for v in hp['variants']), 'HP-only no-CP/hooks proof missing')
    groups = d['supplements']['groups']
    require(d['supplements']['status'] == 'passed' and len(groups) == 3 and all(g['status'] == 'passed' for g in groups), 'History supplement3 mismatch')
    groups = {g['id']: g for g in groups}
    require(set(groups) == {'member_cap_seal_start', 'history_epoch_boundary', 'whole_group_low_budget_retry'}, 'Supplement IDs differ')
    cap = groups['member_cap_seal_start']
    require(cap['host_member_cap'] == 2 and cap['commits'] == 3 and cap['replays'] == 4
            and cap['historical_ids_restored'] is True and cap['identical_typed_selection_navigation_is_noop'] is True, 'Member cap/noop guard missing')
    epoch = groups['history_epoch_boundary']
    require(epoch['stale_history_only_reason'] == 'session.stale_history_epoch'
            and epoch['all_facets_preserved_on_refusal'] is True and epoch['query_execute_work_equal'] is True, 'Independent history epoch refusal missing')
    budget = groups['whole_group_low_budget_retry']
    require(budget['members'] == 3 and budget['work_bytes'] == 0 and budget['atomic_refusal'] is True
            and budget['sufficient_budget_retry'] is True and 'separate engine' in budget['scope'], 'Shared zero-budget scope/retry missing')
    life = d['lifecycle']
    require(life['status'] == 'passed' and life['case_total'] == len(life['cases']) == 3
            and [c['reason'] for c in life['cases']] == ['session.closed', 'session.poisoned', 'session.read_only']
            and all(c['status'] == 'passed' for c in life['cases']) and life['ordinary_snapshot_codec_calls'] == 0, 'Actual lifecycle3 missing')
    facts = d['identity_facts']
    require(facts['status'] == 'passed' and facts['case_total'] == len(facts['cases']) == 2
            and {c['reason'] for c in facts['cases']} == {'kwdj.reference_identity_unresolved', 'kwdj.identity_resolution_failed'}, 'Actual KWDJ identity facts2 missing')
    for c in facts['cases']:
        require(c['status'] == 'passed' and c['directions'] == ['undo', 'redo'] and c['refused_attempts'] == 2
                and c['ordinary_snapshot_codec_calls'] == 0
                and all(c[k] is True for k in ('same_captured_requests_retry', 'typed_errors_and_work_equal', 'current_resolver_rechecked', 'all_committed_facets_preserved', 'retained_stacks_preserved', 'exact_historical_records_ids_selection_marks')), 'Current-facts same-request retry proof missing')
    pairs = d['generated_unicode']
    require(pairs['status'] == 'passed' and pairs['case_total'] == len(pairs['cases']) == 8 and pairs['replays'] == 32
            and all(c['status'] == 'passed' and c['final_revision'] == '6' for c in pairs['cases']) and pairs['ordinary_snapshot_codec_calls'] == 0, 'Unicode8/32 restoration missing')
    require(any('\u00a0' in c['first'] + c['second'] for c in pairs['cases'])
            and any('e\u0301' in c['first'] for c in pairs['cases']), 'Exact NBSP/decomposed literals missing')
    prop = d['property_generated']
    require(prop['status'] == 'passed' and prop['sequence_total'] == len(prop['cases']) == 32
            and prop['apply_actions'] == prop['undo_actions'] == prop['redo_actions'] == 255
            and prop['independent_checkpoint_total'] == 797 and prop['minimum_steps'] == 6 and prop['maximum_steps'] == 10
            and prop['ordinary_snapshot_codec_calls'] == 0, 'Generated32/255x3/797 mismatch')
    require({c['seed'] for c in prop['cases']} == set(range(1, 33)), 'Generated seed set differs')
    for c in prop['cases']:
        require(c['status'] == 'passed' and 6 <= c['steps'] <= 10 and c['undo_actions'] == c['redo_actions'] == c['steps']
                and c['ordinary_snapshot_codec_calls'] == 0
                and all(c[k] is True for k in ('query_execute_equal', 'query_preserves_all_facets', 'exact_historical_records_ids_selection')), 'Generated query/identity restoration missing')
    recur = d['recurrence']
    require(recur['status'] == 'passed' and recur['cycles'] == 512 and recur['document_publications'] == 1536
            and recur['final_revision'] == '1536' and recur['warmup_cycles'] == 2 and recur['steady_cycles'] == 510
            and recur['action_cap'] == recur['chronological_map_cap'] == recur['event_record_cap'] == 1 and recur['work_byte_cap'] == 32768
            and recur['ordinary_snapshot_codec_calls'] == 0
            and all(recur[k] is True for k in ('all_historical_ids_stable', 'query_execute_work_equal', 'steady_phase_work_and_retention_equal')), 'History512/1536 phase-specific stability proof missing')
    private = d['private_engine_cases']
    require(len(private) == 1 and private[0]['id'] == 'H23' and 'Separate engine private' in private[0]['scope']
            and 'never claimed as public native/WASM' in private[0]['scope'], 'H23 private counter separation missing')


def compare_report(c, local, ci, selected_root, label):
    if label=='deltas':return compare_deltas(c,local,ci,selected_root)
    if label=='sdk':return compare_sdk(c,local,ci,selected_root)
    require(set(ci['sourceHashes']) == set(local['sourceHashes']), f'{label} local/CI hash scope differs')
    sources, differences = [], []
    for name, actual in ci['sourceHashes'].items():
        validate_hash_path(name, actual)
        if name.endswith('.wasm'):
            payload = (selected_root / name).read_bytes()
            require(payload.startswith(b'\x00asm') and sha(payload) == actual, f'{label} downloaded WASM differs from report')
            if actual != local['sourceHashes'][name]:
                differences.append({'path': name, 'local': local['sourceHashes'][name], 'ci': actual,
                                    'scope': 'Cross-host compiler binary hashes may differ; portable observations compared separately.'})
        else:
            raw = subprocess.check_output(['git', 'show', f'{c["source"]}:{name}'], cwd=c['root'], stderr=subprocess.PIPE)
            require(sha(raw) == actual == local['sourceHashes'][name], f'{label} CI/local/frozen Git source differs: {name}')
            sources.append({'path': name, 'sha256': actual})
    portable = lambda report: {k: v for k, v in report.items() if k != 'sourceHashes'}
    require(portable(local) == portable(ci), f'{label} portable local/CI JSON differs')
    return {'source_hashes': sources, 'matched_source_hashes': len(sources),
            'binary_differences': differences, 'portable_local_ci_observations_equal': True}


def compare_deltas(c,local,ci,selected_root):
    verify_deltas(local);verify_deltas(ci)
    require(set(local['sourceHashes'])==set(ci['sourceHashes']),'Deltas local/CI source scope differs')
    sources=[]
    for name,actual in ci['sourceHashes'].items():
        raw=subprocess.check_output(['git','show',f'{c["source"]}:{name}'],cwd=c['root'],stderr=subprocess.PIPE)
        require(sha(raw)==actual==local['sourceHashes'][name],'Deltas source differs from frozen Git: '+name)
        sources.append({'path':name,'sha256':actual})
    require(ci['portable']==local['portable'],'Exact portable deltas local/CI observations differ')
    differences=[];verified=[];reported=[]
    for name,digest in ci['artifactHashes'].items():
        if name.startswith('artifacts/'):
            payload=(selected_root/name).read_bytes()
            require(sha(payload)==digest,'Downloaded actual deltas artifact differs: '+name)
            if name.endswith('.wasm'):require(payload.startswith(b'\x00asm'),'Actual deltas WASM magic absent')
            verified.append({'path':name,'sha256':digest,'bytes':len(payload)})
        else:
            reported.append({'path':name,'sha256':digest,'scope':'CI native executable digest is reported by the source-bound observer; executable is not uploaded/downloaded in the original browser artifact.'})
        if local['artifactHashes'][name]!=digest:
            differences.append({'path':name,'local':local['artifactHashes'][name],'ci':digest,'scope':'Target-local artifact/compiler/diagnostic hashes may differ; portable observations compared exactly.'})
    for prefix,key in [('native','nativeDiagnostics'),('wasm','wasmDiagnostics')]:
        raw=read_json(selected_root/f'artifacts/deltas/{prefix}-observer.json')
        require(raw['portable']==ci['portable'] and raw['diagnostics']==ci[key],'Downloaded actual target observation differs from report')
    return {'source_hashes':sources,'matched_source_hashes':len(sources),'binary_differences':[row for row in differences if row['path'].endswith('.wasm') or row['path']=='target/debug/examples/delta_native'],'artifact_differences':differences,'portable_local_ci_observations_equal':True,'portable_comparison_scope':'Exact deltas.portable only; generatedAt, native/wasm diagnostics and artifact hashes remain target-local raw evidence.','verified_downloaded_artifacts':verified,'reported_only_artifacts':reported}


def validate_artifact(c, artifact):
    from datetime import datetime, timezone
    fields = {'id', 'node_id', 'name', 'size_in_bytes', 'url', 'archive_download_url', 'expired',
              'digest', 'created_at', 'updated_at', 'expires_at', 'workflow_run'}
    require(set(artifact) == fields, 'Artifact metadata differs from original GitHub artifact schema')
    require(type(artifact['id']) is int and artifact['id'] > 0 and type(artifact['size_in_bytes']) is int
            and 0 < artifact['size_in_bytes'] <= 512 * 1024 * 1024 and artifact['expired'] is False, 'Artifact id/size/expiry flags invalid')
    require(artifact['name'] == 'browser-observations' and isinstance(artifact['node_id'], str) and bool(artifact['node_id']), 'Artifact identity/name missing')
    base = f'https://api.github.com/repos/{c["repo"]}/actions/artifacts/{artifact["id"]}'
    require(artifact['url'] == base and artifact['archive_download_url'] == base + '/zip', 'Artifact URLs differ from original metadata')
    require(isinstance(artifact['digest'], str) and re.fullmatch(r'sha256:[0-9a-f]{64}', artifact['digest']), 'Actual server SHA256 artifact digest required')
    dates = [datetime.fromisoformat(artifact[k].replace('Z', '+00:00')) for k in ('created_at', 'updated_at', 'expires_at')]
    require(all(d.tzinfo is not None for d in dates) and dates[0] <= dates[1] < dates[2]
            and dates[2] > datetime.now(timezone.utc), 'Actual artifact timestamps/expiry invalid')
    workflow = artifact['workflow_run']
    require(set(workflow) == {'id', 'repository_id', 'head_repository_id', 'head_branch', 'head_sha'}, 'Artifact workflow metadata schema differs')
    require(workflow['id'] == c['run'] and workflow['head_sha'] == c['source']
            and type(workflow['repository_id']) is int and workflow['repository_id'] > 0
            and workflow['head_repository_id'] == workflow['repository_id']
            and isinstance(workflow['head_branch'], str) and workflow['head_branch'], 'Artifact provenance differs from exact run/source/repo')


def local_evidence(c):
    for label in ('command','transaction','history','deltas','sdk'):
        require(sha(Path(c['local_'+label+'_report']).read_bytes())==REPORT_SPECS[label]['sha256'],'Local report changed after frozen receipt validation: '+label)
    command = read_json(c['local_command_report'])
    transaction = read_json(c['local_transaction_report'])
    history = read_json(c['local_history_report'])
    deltas=read_json(c['local_deltas_report'])
    verify_deltas(deltas)
    verify_report(command)
    verify_transaction(transaction)
    verify_history(history)
    for label, report in [('command',command),('transaction',transaction),('history',history),('deltas',deltas)]:
        for name, expected in report['sourceHashes'].items():
            validate_hash_path(name, expected)
            if name.endswith('.wasm'):
                raw = (c['root'] / name).read_bytes()
                require(raw.startswith(b'\x00asm'),'Local witness is not compiled WASM')
            else:
                raw = subprocess.check_output(['git', 'show', f'{c["source"]}:{name}'], cwd=c['root'], stderr=subprocess.PIPE)
            require(sha(raw) == expected, f'Local {label} report differs from frozen source/binary: {name}')
    for name,digest in deltas['artifactHashes'].items():
        payload=(c['root']/name).read_bytes()
        require(sha(payload)==digest,'Actual local deltas target artifact differs: '+name)
    sdk=read_json(c['local_sdk_report'])
    verify_sdk(sdk)
    for name,digest in sdk['sourceHashes'].items():
        payload=subprocess.check_output(['git','show',f'{c["source"]}:{name}'],cwd=c['root'],stderr=subprocess.PIPE)
        require(sha(payload)==digest,'Local SDK source differs from frozen Git: '+name)
    verify_sdk_bundle(c,sdk,c['root'])
    return command, transaction, history, deltas, sdk

def validate_run(c, run):
    require((run['id'], run['head_sha'], run['event'], run['run_attempt'], run['workflow_id']) ==
            (c['run'], c['source'], 'pull_request', 1, c['workflow_id']), 'Exact prepared run/source/event/attempt/workflow mismatch')
    linked = [pr for pr in run['pull_requests'] if pr['number'] == c['pr']]
    require(len(linked) == 1 and linked[0]['head']['sha'] == c['source'] and linked[0]['base']['sha'] == c['base'],
            'Run is not associated with the configured exact PR/source/base')


def step_log(log, name):
    lines = []
    for line in log.splitlines():
        parts = line.split('\t', 2)
        if len(parts) == 3 and parts[1] == name:
            lines.append(re.sub(r'^\ufeff?\d{4}-\d\d-\d\dT\S+Z\s?', '', parts[2]))
    require(bool(lines), f'Full step log missing: {name}')
    return '\n'.join(lines)


def log_gates(log):
    check = step_log(log, 'Run npm run check')
    require('> cargo fmt --all --check' in check and '> node --test tests/canonical.node.mjs' in check, 'Rust section boundaries absent')
    rust = check.split('> cargo fmt --all --check', 1)[1].split('> node --test tests/canonical.node.mjs', 1)[0]
    rows = re.findall(r'test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out;', rust)
    require(rows and all(all(int(n) == 0 for n in row[1:]) for row in rows), 'Rust summary failed/filtered/ignored/missing')
    count = sum(int(row[0]) for row in rows)
    require(count>=LOCAL_PROOF['gateFloors']['rustPassed'], f'Rust passes below final local floor: {count}')
    msrv_text = step_log(log, 'Run cargo +1.89.0 test --locked -p klenwriter-editor-core -p klenwriter-editor-kwdj')
    msrv_rows = re.findall(r'test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out;', msrv_text)
    require(msrv_rows and all(all(int(n) == 0 for n in row[1:]) for row in msrv_rows), 'MSRV summary failed/filtered/ignored/missing')
    msrv_count = sum(int(row[0]) for row in msrv_rows)
    require(msrv_count>=LOCAL_PROOF['gateFloors']['msrvPassed'], f'MSRV passes below final local floor: {msrv_count}')
    for marker in LOCAL_PROOF['requiredRustMarkers']:
        require(marker in rust, f'iteration1 actual kernel pass marker absent: {marker}')
    summaries = lambda text: re.findall(r'^\s*(\d+) passed \([^\n]+\)\s*$', text, re.MULTILINE)
    browser=summaries(check)
    require(len(browser)==1 and int(browser[0])>=LOCAL_PROOF['gateFloors']['workspaceBrowserPassed'], 'Actual full workspace browser summary below local floor')
    m0=summaries(step_log(log,'Run npm test'))
    require(len(m0)==1 and int(m0[0])>=LOCAL_PROOF['gateFloors']['m0BrowserPassed'],'Actual M0 browser summary below local floor')
    summary = []
    for line in step_log(log, 'Run node scripts/summarize-evidence.mjs').splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and 'observations' in value and 'failures' in value:
            summary.append(value)
    require(len(summary) == 1 and summary[0]['observations'] == int(m0[0]) and summary[0]['failures'] == 0, 'Actual M0 summary102/0 absent')
    sdk_lanes=verify_sdk_lane_logs(check,LOCAL_PROOF)
    for marker in LOCAL_PROOF['requiredWitnessMarkers']:
        require(witness_pass(check,marker),
                f'Actual witness pass marker absent: {marker}')
    checkout = step_log(log, 'Run actions/checkout@v4').splitlines()
    found = []
    for index, line in enumerate(checkout):
        if 'git log -1 --format=%H' in line:
            for following in checkout[index + 1:index + 5]:
                match = re.search(r'\b([0-9a-f]{40})\s*$', following)
                if match:
                    found.append(match.group(1))
                    break
    require(len(found) == 1, f'Actual checkout SHA ambiguous: {found}')
    return {'rustPassed': count, 'msrvPassed': msrv_count, 'rustSummaryGroups': len(rows), 'workspaceBrowserPassed': int(browser[0]),
            'm0BrowserPassed': int(m0[0]), 'm0Summary': summary[0], 'actualCheckout': found[0],
            'sdkNodeLanes':sdk_lanes,'inheritedKernelMarkers': True, 'nativeWasmWitnessMarkers': LOCAL_PROOF['requiredWitnessMarkers']}


def raw_log(c, name):
    target = c['output_dir'] / name
    require(not target.exists(), f'Full log already exists; preserve it: {target}')
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=target.name + '.', suffix='.partial', delete=False) as stream:
        temporary = Path(stream.name)
        subprocess.run(['gh', 'run', 'view', str(c['run']), '--repo', c['repo'], '--attempt', '1', '--log'],
                       cwd=c['root'], stdout=stream, stderr=subprocess.PIPE, check=True, timeout=60)
    temporary.chmod(0o600)
    temporary.replace(target)
    return target


def download(c, artifact):
    expected_url = f'https://api.github.com/repos/{c["repo"]}/actions/artifacts/{artifact["id"]}/zip'
    require(artifact['archive_download_url'] == expected_url, 'Unexpected artifact archive URL')
    token = gh(c, 'auth', 'token').decode().strip()
    require(re.fullmatch(r'[A-Za-z0-9_.-]+', token), 'Unexpected credential encoding')
    config = f'url = "{expected_url}"\nheader = "Authorization: Bearer {token}"\nheader = "Accept: application/vnd.github+json"\n'
    target = c['output_dir'] / 'browser-observations.zip'
    require(not target.exists(), f'Archive already exists; preserve it: {target}')
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=target.name + '.', suffix='.partial', delete=False) as stream:
        temporary = Path(stream.name)
    response = subprocess.run(['curl', '--config', '-', '--location', '--fail', '--silent', '--show-error',
                               '--max-time', '240', '--output', str(temporary),
                               '--write-out', '{"http_code":%{http_code},"downloaded_bytes":%{size_download}}'],
                              input=config, text=True, capture_output=True)
    require(response.returncode == 0, f'Artifact download failed (curl exit{response.returncode}); partial retained')
    meta = json.loads(response.stdout)
    require(meta['http_code'] == 200 and temporary.stat().st_size == meta['downloaded_bytes'] == artifact['size_in_bytes'],
            'Artifact HTTP/download/metadata size differs')
    raw = temporary.read_bytes()
    require(not artifact.get('digest') or artifact['digest'] == 'sha256:' + sha(raw), 'Server ZIP digest differs')
    temporary.chmod(0o600)
    temporary.replace(target)
    return target, meta, sha(raw)


def collect(c, local, local_transaction, local_history, local_deltas, local_sdk):
    require(not (c['output_dir'] / 'receipt.json').exists(), 'Completed iteration1 receipt already exists; do not overwrite it')
    run = api(c, f'actions/runs/{c["run"]}')
    validate_run(c, run)
    require(run['status'] == 'completed' and run['conclusion'] == 'success', 'Run is not completed success')
    pr = api(c, f'pulls/{c["pr"]}')
    require(pr['head']['sha'] == c['source'] and pr['base']['sha'] == c['base'] and pr['base']['repo']['full_name'] == c['repo'],
            'Actual PR source/base/repository mismatch')
    jobs = api(c, f'actions/runs/{c["run"]}/attempts/1/jobs?per_page=100')
    require(jobs['total_count'] == len(jobs['jobs']) == 1, 'Expected exactly one completed job')
    job = jobs['jobs'][0]
    require(job['status'] == 'completed' and job['conclusion'] == 'success', 'Job failed')
    require(all(step['status'] == 'completed' and step['conclusion'] == 'success' for step in job['steps']), 'A job step did not succeed')
    for step in job['steps']:
        require(step.get('started_at') and step.get('completed_at'), 'A successful step lacks actual execution timestamps')
    for name in LOCAL_PROOF['requiredSteps']:
        require(len([s for s in job['steps'] if s['name'] == name]) == 1, f'Required step absent/duplicate: {name}')
    c['output_dir'].mkdir(parents=True, exist_ok=True)
    run_path, jobs_path = save(c, 'run.json', run), save(c, 'jobs.json', jobs)
    save(c, 'config-used.json', {k: str(v) if isinstance(v, Path) else v for k, v in c.items()})
    log_path = raw_log(c, 'full.log')
    raw = log_path.read_bytes()
    require(len(raw) > 100_000, 'Full CI log unexpectedly short')
    gates = log_gates(raw.decode('utf-8-sig'))
    checkout, source = api(c, f'git/commits/{gates["actualCheckout"]}'), api(c, f'git/commits/{c["source"]}')
    require([p['sha'] for p in checkout['parents']] == [c['base'], c['source']], 'Synthetic checkout parents differ')
    require(checkout['tree']['sha'] == source['tree']['sha'], 'Synthetic checkout/source tree mismatch')
    save(c, 'checkout-proof.json', {'actualCheckout': gates['actualCheckout'], 'parents': [c['base'], c['source']],
                                 'sourceTree': source['tree']['sha'], 'checkoutTree': checkout['tree']['sha'], 'treeEqual': True})
    artifacts = api(c, f'actions/runs/{c["run"]}/artifacts?per_page=100')
    require(artifacts['total_count'] == len(artifacts['artifacts']), 'Artifact pagination not exhausted')
    artifact_path = save(c, 'artifacts.json', artifacts)
    matches = [a for a in artifacts['artifacts'] if a['name'] == 'browser-observations' and not a['expired']]
    require(len(matches) == 1 and matches[0]['workflow_run']['head_sha'] == c['source'], 'Exact live browser artifact absent')
    artifact = matches[0]
    validate_artifact(c, artifact)
    require(artifact['workflow_run']['repository_id'] == run['repository']['id'] and artifact['workflow_run']['head_branch'] == run['head_branch'], 'Artifact repository/branch differs from actual run')
    require(artifact['size_in_bytes'] <= 512 * 1024 * 1024, 'Unexpectedly large artifact archive')
    archive, download_meta, archive_hash = download(c, artifact)
    required = {'artifacts/command-report.json', 'artifacts/commands/probe_bg.wasm', 'artifacts/commands/probe.js',
                'artifacts/history-report.json', 'artifacts/history/probe_bg.wasm', 'artifacts/history/probe.js',
                'artifacts/transaction-report.json', 'artifacts/session-foundation-report.json',
                'artifacts/corpus-stage-report.json', 'artifacts/corpus-extension-report.json', 'artifacts/corpus-hardening-report.json',
                'artifacts/corpus-invalid-fields-report.json', 'artifacts/corpus-projection-refusal.json',
                'artifacts/dependencies.json', 'artifacts/browser.json', 'test-results/results.json',
                'artifacts/transactions/probe_bg.wasm', 'artifacts/transactions/probe.js'}
    required.update(SDK_REQUIRED_FILES)
    required.update({'artifacts/deltas-report.json','artifacts/deltas/probe_bg.wasm','artifacts/deltas/probe.js','artifacts/deltas/native-observer.json','artifacts/deltas/wasm-observer.json'})
    optional = {'artifacts/canonical-v1-report.json', 'artifacts/codec-v1-report.json',
                'artifacts/session-foundation/probe_bg.wasm', 'artifacts/session-foundation/probe.js'}
    selected_root, selected = c['output_dir'] / 'selected', []
    with zipfile.ZipFile(archive) as z:
        infos, names = z.infolist(), z.namelist()
        require(len(infos) <= 50_000 and len(names) == len(set(names)), 'ZIP entries excessive/duplicate')
        require(sum(i.file_size for i in infos) <= 1024 * 1024 * 1024, 'ZIP unpacked size excessive')
        require(z.testzip() is None, 'ZIP CRC failed')
        required.update(sdk_tarball_paths(json.loads(z.read('artifacts/package-inventory.json'))))
        require(required <= set(names), f'Required selected ZIP paths missing: {sorted(required - set(names))}')
        for name in sorted(required | (optional & set(names))):
            require(z.getinfo(name).file_size <= 16 * 1024 * 1024, 'Selected entry unexpectedly large')
            target = selected_root / name
            require(target.resolve().is_relative_to(selected_root.resolve()), 'Selected ZIP path escaped')
            require(not target.exists(), f'Selected iteration1 proof already exists: {target}')
            target.parent.mkdir(parents=True, exist_ok=True)
            payload = z.read(name)
            target.write_bytes(payload)
            target.chmod(0o600)
            selected.append({'path': str(target), 'bytes': len(payload), 'sha256': sha(payload)})
    ci = read_json(selected_root / 'artifacts/command-report.json')
    maps = verify_report(ci)
    require(set(ci['sourceHashes']) == set(local['sourceHashes']), 'Local/CI source hash scope differs')
    source_hashes, binaries = [], []
    for name, expected in local['sourceHashes'].items():
        actual = ci['sourceHashes'][name]
        if name.endswith('.wasm'):
            payload=(selected_root/name).read_bytes()
            require(payload.startswith(b'\x00asm') and sha(payload)==actual,'Actual downloaded command WASM/hash differs')
            if expected != actual:
                binaries.append({'path': name, 'local': expected, 'ci': actual})
        else:
            require(actual == expected, f'CI/frozen-source hash mismatch: {name}')
            source_hashes.append({'path': name, 'sha256': actual})
    require(len(source_hashes)==report_source_count('command'),'Actual command source scope differs')
    portable = lambda d: {k: v for k, v in d.items() if k != 'sourceHashes'}
    require(portable(ci) == portable(local), 'Portable command observations differ from local iteration1 receipt')
    transaction = read_json(selected_root / 'artifacts/transaction-report.json')
    verify_transaction(transaction)
    transaction_comparison = compare_report(c, local_transaction, transaction, selected_root, 'transaction')
    regression = transaction['groups']['attributes_marks_spans']['repeated_metadata']
    history = read_json(selected_root / 'artifacts/history-report.json')
    verify_history(history)
    history_comparison = compare_report(c, local_history, history, selected_root, 'history')
    deltas=read_json(selected_root/'artifacts/deltas-report.json')
    verify_deltas(deltas)
    deltas_comparison=compare_report(c,local_deltas,deltas,selected_root,'deltas')
    sdk=read_json(selected_root/'artifacts/sdk-report.json')
    verify_sdk(sdk)
    sdk_comparison=compare_sdk(c,local_sdk,sdk,selected_root)
    sdk_bundle=sdk_comparison['bundle']
    browser = read_json(selected_root / 'artifacts/browser.json')
    sdk_browser=verify_sdk_browser(browser,LOCAL_PROOF)
    m0 = read_json(selected_root / 'test-results/results.json')
    session = read_json(selected_root / 'artifacts/session-foundation-report.json')
    require(browser['stats']['unexpected'] == m0['stats']['unexpected'] == 0 and session['nativeWasmEqual'] is True,
            'Browser/session regression proof failed')
    ci_path = selected_root / 'artifacts/command-report.json'
    receipt = {'issue': 'OSR-63', 'iteration': 1, 'repo': c['repo'], 'run': c['run'], 'run_url': run['html_url'],
               'source': c['source'], 'base': c['base'], 'pr': c['pr'], 'workflow_id': c['workflow_id'],
               'attempt': 1, 'event': 'pull_request', 'conclusion': 'success',
               'config': c['config_path'], 'config_sha256': c['config_sha256'],
               'collector': str(Path(__file__).resolve()), 'collector_sha256': sha(Path(__file__).read_bytes()),
               'sdkSupport':str(_SDK_SUPPORT_PATH.resolve()),'sdkSupportSha256':sha(_SDK_SUPPORT_PATH.read_bytes()),
               'run_metadata': run_path, 'jobs_metadata': jobs_path, 'job_id': job['id'], 'required_steps': LOCAL_PROOF['requiredSteps'],
               'log': str(log_path), 'log_bytes': len(raw), 'log_sha256': sha(raw), 'actual_log_gates': gates,
               'checkout_sha': gates['actualCheckout'], 'checkout_parents': [c['base'], c['source']],
               'source_tree': source['tree']['sha'], 'synthetic_tree_equal': True,
               'artifact_metadata': artifact_path, 'artifact_id': artifact['id'], 'artifact_expiry': artifact['expires_at'],
               'archive': str(archive), 'archive_bytes': archive.stat().st_size, 'archive_sha256': archive_hash,
               'archive_server_digest': artifact.get('digest'), 'download': download_meta, 'zip_crc': 'pass', 'zip_entries': len(infos),
               'selected_directory': str(selected_root), 'selected': selected, 'source_hashes': source_hashes,
               'matched_history_source_file_hashes': history_comparison['matched_source_hashes'],
               'total_history_report_hashes': report_source_count('history')+1,
               'portable_history_observations_equal': history_comparison['portable_local_ci_observations_equal'],
               'matched_command_source_file_hashes': report_source_count('command'), 'total_command_report_hashes': report_source_count('command')+1, 'binary_differences': binaries,
               'portable_command_observations_equal': True, 'literal_cases': 24, 'generated_enter': 64,
               'generated_interior_refusals': 4, 'structural_groups': 8, 'inline_groups': 8,
               'normalization_position_map_cases': maps['case_total'], 'normalization_position_maps': maps,
               'transaction_groups': 5, 'typed_atomic_refusals': 11, 'inherited_transaction_groups_equal': True,
               'repeated_metadata': regression, 'transaction_comparison': transaction_comparison,
               'history_comparison': history_comparison, 'deltas_comparison':deltas_comparison,
               'sdk_comparison':sdk_comparison,'sdk_bundle':sdk_bundle,'sdk_browser':sdk_browser,'portable_sdk_observations_equal':True,'matched_sdk_source_file_hashes':sdk_comparison['matched_source_hashes'],
               'portable_deltas_observations_equal':True,'matched_deltas_source_file_hashes':deltas_comparison['matched_source_hashes'],
               'local_validation_receipt':str(c['local_validation_receipt']),'local_validation_sha256':c['local_validation_sha256'], 'history_semantic_counts': HISTORY_COUNTS,
               'local_history_report': str(c['local_history_report']),
               'ci_history_report': str(selected_root / 'artifacts/history-report.json'),
               'local_history_report_sha256': sha(c['local_history_report'].read_bytes()),
               'ci_history_report_sha256': sha((selected_root / 'artifacts/history-report.json').read_bytes()), 'local_report': str(c['local_command_report']), 'ci_report': str(ci_path),
               'local_report_sha256': sha(c['local_command_report'].read_bytes()), 'ci_report_sha256': sha(ci_path.read_bytes()),
               'claim': 'One exact-source OSR63 iteration1 prepared CI success and portable local/CI semantics; no review/merge/post-merge verdict is inferred.'}
    require(sha(Path(__file__).read_bytes())==c['collector_sha256'] and sha(_SDK_SUPPORT_PATH.read_bytes())==c['sdk_support_sha256'],'Frozen collector/support helper changed during collection')
    require(sha(Path(c['config_path']).read_bytes())==c['config_sha256'] and sha(Path(c['local_validation_receipt']).read_bytes())==c['local_validation_sha256'],'Frozen config/local binding changed during collection')
    output = save(c, 'receipt.json', receipt)
    print(json.dumps({'receipt': output, 'run': c['run'], 'source': c['source'], 'artifact_id': artifact['id'],
                      'matched_history_source_hashes': report_source_count('history'), 'history_report_hashes': report_source_count('history')+1, 'structural_groups': 8,
                      'normalization_position_map_cases': 6, 'rust_passed': gates['rustPassed'],
                      'binary_differences': {'command': binaries, 'transaction': transaction_comparison['binary_differences'], 'history': history_comparison['binary_differences']}}, indent=2), flush=True)


def watch(c, local, local_transaction, local_history, local_deltas, local_sdk, timeout):
    deadline, previous = time.monotonic() + timeout, None
    while time.monotonic() < deadline:
        try:
            run = api(c, f'actions/runs/{c["run"]}')
            validate_run(c, run)
            jobs = api(c, f'actions/runs/{c["run"]}/attempts/1/jobs?per_page=100')
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            marker = type(error).__name__
            if marker != previous:
                print(f'Read-only metadata request failed: {marker}; bounded retry, no CI action', flush=True)
            previous = marker
            time.sleep(20)
            continue
        active = [step['name'] for job in jobs['jobs'] for step in job['steps'] if step['status'] == 'in_progress']
        save(c, 'watch-current.json', {'run': run, 'jobs': jobs}, progress=True)
        marker = (run['status'], run['conclusion'], tuple(active))
        if marker != previous:
            print(json.dumps({'run': c['run'], 'status': run['status'], 'conclusion': run['conclusion'], 'active': active}), flush=True)
        previous = marker
        if run['status'] == 'completed':
            if run['conclusion'] != 'success':
                save(c, 'failed-run.json', run)
                save(c, 'failed-jobs.json', jobs)
                path = raw_log(c, 'failed-full.log')
                raise RuntimeError(f'Prepared iteration1 CI failed; complete raw log preserved at {path}; no retry was triggered')
            collect(c, local, local_transaction, local_history, local_deltas, local_sdk)
            return
        time.sleep(20)
    raise TimeoutError('Bounded iteration1 read-only watch expired; no CI/Git/Linear mutation was performed')


def main(*, watch_mode=False):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path('/tmp/osr-63-config.json'))
    parser.add_argument('--timeout-seconds', type=int, default=1800)
    args = parser.parse_args()
    require(60 <= args.timeout_seconds <= 7200, 'Timeout must be60..7200 seconds')
    c = load_config(args.config)
    # Validate all local frozen-source evidence before network or output writes.
    local, transaction, history, deltas, sdk = local_evidence(c)
    if watch_mode:
        watch(c, local, transaction, history, deltas, sdk, args.timeout_seconds)
    else:
        collect(c, local, transaction, history, deltas, sdk)


_sdk_spec=importlib.util.spec_from_file_location('osr63_collector_sdk',_SDK_SUPPORT_PATH)
_sdk_module=importlib.util.module_from_spec(_sdk_spec)
_sdk_spec.loader.exec_module(_sdk_module)
_sdk_module.install(globals())

if __name__ == '__main__':
    main()
