#!/usr/bin/env python3
"""Bind completed, committed OSR63 local proof to exact clean HEAD.

Import is pure. No gates/CI/network/review/commit/merge is implemented. main
writes one immutable /tmp record only after committed source/archive validation.
"""
import argparse
import gzip
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

BUILDER=Path('/tmp/osr-63-build-local-evidence.py')


def load_builder():
    spec=importlib.util.spec_from_file_location('osr63_evidence_builder',BUILDER)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    return m


def build_binding(template,pr=None):
    b=load_builder();root=b.ROOT
    b.require(b.git(root,'status','--porcelain=v1','--untracked-files=all')==b'','Committed clean checkout required')
    b.require(b.git(root,'branch','--show-current').decode().strip()=='osr-63','Actual osr-63 branch required')
    source=b.git(root,'rev-parse','HEAD^{commit}').decode().strip()
    b.require(re.fullmatch('[0-9a-f]{40}',source) and source!=b.BASE and source!='0'*40,'Actual non-base source required')
    result=subprocess.run(['git','merge-base','--is-ancestor',b.BASE,source],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    b.require(result.returncode==0,'Source must descend from frozen base')
    b.require(pr is None or type(pr) is int and pr>0,'Optional actual PR must be positive')
    b.require(template['issue']=='OSR-63' and type(template['iteration']) is int and template['iteration']==1 and template['repo']=='artemklen/klenwriter-editor' and template['base']==b.BASE,'Wrong frozen external template')
    def blob(name):
        b.relative(name);raw=b.git(root,'show',source+':'+name)
        b.require(b.read(root/name)==raw,'Live committed proof differs: '+name)
        return raw
    receipt_raw=blob(b.RECEIPT);receipt=b.decode(receipt_raw)
    b.require(receipt['issue']=='OSR-63' and receipt['base']==b.BASE and receipt['status']=='passed','Actual successful committed receipt required')
    closure=receipt['source_closure']
    b.require(b.RECEIPT not in closure and b.capture_source_closure(root,source)==closure,'Final committed source differs from complete tested closure')
    b.require(b.sha(b.read(BUILDER))==receipt['builder']['sha256'],'Builder changed after versioned receipt')
    helper=b.load_collector({'collectorSha256':receipt['collector']['sha256'],'sdkSupportSha256':receipt['sdkSupport']['sha256']})
    archive_root=root/'evidence/osr-63'
    def archive_raw(proof):
        path=Path(proof['path'])
        b.require(path.is_absolute() and path.resolve().is_relative_to(archive_root.resolve()),'Expected canonical committed63 proof path')
        raw=blob(path.relative_to(root).as_posix())
        b.require(len(raw)==proof['bytes'] and b.sha(raw)==proof['sha256'],'Committed archive pin differs: '+str(path))
        if 'crc32' in proof:
            b.require(b.proof(path,raw)['crc32']==proof['crc32'],'Committed archive CRC differs')
        return raw
    archive_count=0
    def verify_archives(value):
        nonlocal archive_count
        if isinstance(value,dict):
            if isinstance(value.get('archive'),dict):
                raw=archive_raw(value['archive']);archive_count+=1
                if isinstance(value.get('original'),dict):
                    original=value['original'];plain=b.ungzip(raw) if value['archive']['path'].endswith('.gz') else raw
                    b.require(len(plain)==original['bytes'] and b.sha(plain)==original['sha256'],'Archive differs from recorded original raw capture')
            if isinstance(value.get('exitReceiptArchive'),dict):
                archive_raw(value['exitReceiptArchive']);archive_count+=1
            if isinstance(value.get('equivalenceArchive'),dict):
                archive_raw(value['equivalenceArchive']);archive_count+=1
            for key,item in value.items():
                if key not in {'archive','exitReceiptArchive','equivalenceArchive'}:verify_archives(item)
        elif isinstance(value,list):
            for item in value:verify_archives(item)
    verify_archives(receipt)
    for name in ('osr-63-build-local-evidence.py','osr-63-bind-local-validation.py','osr-63-collect-prepared.py','osr-63-collector-sdk.py'):
        b.require(blob('evidence/osr-63/helpers/'+name)==b.read(Path('/tmp')/name),'Archived helper differs from actual pinned helper: '+name)
    rows=[]
    for original in receipt['bindingInputs']['rawLogs']:
        role=original['role'];row=dict(original)
        archived=receipt['logs'][role]
        raw=b.ungzip(archive_raw(archived['archive']))
        b.require(len(raw)==row['bytes'] and b.sha(raw)==row['sha256'],'Raw archive differs from actual gate capture')
        actual=b.decode(archive_raw(archived['exitReceiptArchive']))
        b.require(actual['returnCode']==row['exit_code']==0 and actual['status']=='passed' and actual['argv']==b.EXPECTED_ARGV[role] and actual['productionSourceUnchanged'] is True and actual['sourceBefore']==actual['sourceAfter'],'Actual gate exit/source proof differs')
        b.require(actual['rawLogBytes']==len(raw) and actual['rawLogSha256']==b.sha(raw) and actual['rawLog']==row['path'],'Actual gate raw pin differs')
        if Path(row['path']).is_file():
            b.require(b.read(row['path'])==raw,'Existing original raw capture changed')
        else:
            row.update(path=archived['archive']['path'],bytes=archived['archive']['bytes'],sha256=archived['archive']['sha256'],originalRawCapture=original)
        rows.append(row)
    reports={}
    for label,directory in b.LABELS.items():
        row=receipt['reports'][label];raw=archive_raw(row['archive'])
        b.require(b.read(row['path'])==raw and b.sha(raw)==row['sha256'],'Actual report differs from committed bytes: '+label)
        r=b.decode(raw);b.verify_hashes(r['sourceHashes'],closure)
        if r.get('artifactHashes'):b.verify_hashes(r['artifactHashes'])
        source_paths=sorted(n for n in r['sourceHashes'] if not n.startswith(('artifacts/','target/')))
        b.require(source_paths==row['sourcePaths'] and row['binary']==f'artifacts/{directory}/probe_bg.wasm','Actual source/binary report scope differs')
        reports[label]={k:row[k] for k in ('path','sha256','sourcePaths','binary','semanticChecks') if k in row}
    inputs=receipt['bindingInputs']
    binding=dict(template)
    binding.update(issue='OSR-63',iteration=1,repo='artemklen/klenwriter-editor',source=source,base=b.BASE,pr=pr,status='passed',contract=inputs['contract'],gateFloors=receipt['gateFloors'],requiredSteps=inputs['requiredSteps'],requiredRustMarkers=inputs['requiredRustMarkers'],requiredWitnessMarkers=inputs['requiredWitnessMarkers'],rawLogs=rows,reports=reports,versionedReceipt={'path':b.RECEIPT,'sha256':b.sha(receipt_raw)},sourceClosure=closure,sdkLanes=inputs['sdkLanes'],sdkCleanConsumerReport=inputs['sdkCleanConsumerReport'],sdkBrowserCases=inputs['sdkBrowserCases'])
    helper.LOCAL_PROOF=binding;helper.REPORT_SPECS=reports
    helper.verify_tested_source_closure({'root':root,'source':source,'base':b.BASE},binding)
    helper.verify_local_logs(binding);helper.validate_sdk_binding(binding)
    full=helper.local_log_text(next(r['path'] for r in rows if r['role']=='workspace_check'))
    helper.verify_sdk_lane_logs(full,binding)
    helper.verify_report(b.decode(b.read(reports['command']['path'])));helper.verify_transaction(b.decode(b.read(reports['transaction']['path'])));helper.verify_history(b.decode(b.read(reports['history']['path'])));helper.verify_deltas(b.decode(b.read(reports['deltas']['path'])));helper.verify_sdk(b.decode(b.read(reports['sdk']['path'])))
    sdk=helper.verify_sdk_bundle({'root':root,'source':source},b.decode(b.read(reports['sdk']['path'])),root)
    b.require(sdk['buildId']==receipt['sdkBundle']['buildId'],'Committed SDK source-derived build identity differs from local proof')
    b.require(b.frozen58()==receipt['frozen58Restored'],'Frozen75 proof differs')
    binding.update(scope='Postcommit external binding of completed actual local gates only; no CI, independent review, merge or Done claim.',knownLimits=receipt['knownLimits'],versionedReceiptGitBlob=b.git(root,'rev-parse',source+':'+b.RECEIPT).decode().strip(),preservedArchiveCount=archive_count,sdkCommittedBundle=sdk)
    b.require(b.git(root,'rev-parse','HEAD^{commit}').decode().strip()==source and b.git(root,'status','--porcelain=v1','--untracked-files=all')==b'','Checkout changed during binding')
    return binding


def main(argv=None):
    b=load_builder();p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--template',type=Path,default=Path('/tmp/osr-63-local-validation.template.json'));p.add_argument('--output',type=Path,default=Path('/tmp/osr-63-local-validation-binding.json'));p.add_argument('--pr',type=int,default=None);args=p.parse_args(argv)
    binding=build_binding(b.decode(b.read(args.template)),args.pr);raw=b.json_bytes(binding);out=args.output
    b.require(out.is_absolute() and out.parent.resolve()==Path('/tmp').resolve() and out.name.startswith('osr-63-') and not out.is_symlink(),'Binding must be canonical new63 /tmp file')
    b.require(not out.exists() or b.read(out)==raw,'Refusing overwrite of different external binding')
    if not out.exists():
        with out.open('xb') as handle:handle.write(raw)
        os.chmod(out,0o600)
    b.require(b.read(out)==raw,'External binding readback differs')
    print(json.dumps({'issue':'OSR-63','status':'passed','source':binding['source'],'pr':binding['pr'],'path':str(out),'bytes':len(raw),'sha256':b.sha(raw),'sourceClosureFiles':len(binding['sourceClosure']),'gateFloors':binding['gateFloors'],'reports':list(binding['reports'])}))


if __name__=='__main__':
    main()
