#!/usr/bin/env python3
"""OSR-29: compare exact CMS baseline source against extracted native codec.

Only paths, hashes and closed diagnostic facts enter the report. Corpus remains
in the CMS repository until OSR-30. No private checkout is required by editor CI.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import tempfile

BASELINE = 'a7f8a081b7827dd31097ad6c9104654366ae6e04'
ROOT = pathlib.Path(__file__).resolve().parents[2]

def sha(data):
    return hashlib.sha256(data).hexdigest()

def command(args, **kwargs):
    return subprocess.check_output(args, **kwargs)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cms', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    def source(path):
        return command(['git', '-C', str(args.cms), 'show', f'{BASELINE}:{path}'])
    with tempfile.TemporaryDirectory(prefix='osr29-diff-') as temp:
        temp = pathlib.Path(temp)
        baseline = temp / 'baseline'
        # Reconstruct only the owner-controlled domain crate at the pinned commit.
        files = command(['git', '-C', str(args.cms), 'ls-tree', '-r', '--name-only', BASELINE, 'crates/klenwriter_domain']).decode().splitlines()
        for name in files:
            path = baseline / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(source(name))
        workspace = source('Cargo.toml').decode()
        workspace = re.sub(r'members = \[.*?\]', 'members = ["crates/klenwriter_domain"]', workspace, count=1, flags=re.S)
        (baseline / 'Cargo.toml').write_text(workspace)
        (baseline / 'Cargo.lock').write_bytes(source('Cargo.lock'))
        runner = temp / 'runner'
        (runner / 'src').mkdir(parents=True)
        for name in ['main.rs', 'probe.rs']:
            (runner / 'src' / name).write_bytes((ROOT / 'scripts/extraction-diff' / name).read_bytes())
        manifest = f'''[package]
name = "osr29-differential"
version = "0.0.0"
edition = "2024"
rust-version = "1.89.0"
[workspace]
resolver = "3"
[dependencies]
klenwriter_domain = {{ path = {json.dumps(str(baseline / 'crates/klenwriter_domain'))} }}
editor_kwdj = {{ package = "editor-internal-kwdj", path = {json.dumps(str(ROOT / 'crates/kwdj'))} }}
serde_json = "=1.0.150"
uuid = "=1.23.3"
sha2 = "0.10"
'''
        (runner / 'Cargo.toml').write_text(manifest)
        (runner / 'Cargo.lock').write_bytes(source('Cargo.lock'))
        subprocess.run(['cargo', '+1.89.0', 'build', '--manifest-path', str(runner / 'Cargo.toml')], check=True)
        cases, origins = [], []
        def collect(value, path, file):
            if isinstance(value, dict):
                if all(k in value for k in ['schema', 'schema_version', 'content']):
                    for normalize in [False, True]:
                        for identities in [True, False]:
                            cases.append({'id': len(cases), 'input': value, 'normalize': normalize, 'identities': identities})
                            origins.append({'source': file, 'pointer': path, 'normalize': normalize, 'identities': identities, 'inputSha256': sha(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode())})
                    return
                for key, child in value.items():
                    collect(child, path + '/' + key.replace('~', '~0').replace('/', '~1'), file)
            elif isinstance(value, list):
                for i, child in enumerate(value):
                    collect(child, path + '/' + str(i), file)
        sources = []
        for family in ['positive', 'negative', 'mixed', 'deferred']:
            file = f'contracts/kwdj/v1/fixtures/{family}.json'
            data = source(file)
            sources.append({'path': file, 'sha256': sha(data)})
            collect(json.loads(data), '', file)
        # Separate, safe proof of an inherited defect. u64::MAX overflows before
        # expansion in this debug-only runner; never execute arbitrary huge loops.
        stanza = {'schema': 'klenwriter.document', 'schema_version': 1, 'profile': 'poetry', 'content': [{'type': 'verse', 'content': [{'type': 'verse_line', 'content': [{'type': 'text', 'text': 'a'}]}, {'type': 'stanza_break', 'attrs': {'blank_lines': 2**64-1}}, {'type': 'verse_line', 'content': [{'type': 'text', 'text': 'b'}]}]}]}
        cases.append({'id': len(cases), 'input': stanza})
        origins.append({'synthetic': 'OSR-74 u64::MAX debug overflow reproduction'})
        binary = runner / 'target/debug/osr29-differential'
        result = subprocess.run([str(binary)], input=''.join(json.dumps(c) + '\n' for c in cases), text=True, capture_output=True, check=True, timeout=120)
        results = [json.loads(line) for line in result.stdout.splitlines()]
        assert len(results) == len(cases)
        assert all(r['equal'] for r in results), 'baseline/extraction parity mismatch'
        assert results[-1]['baseline']['projections'] == {'panicked': True}, 'recheck OSR-74 status'
        report = {'schema': 1, 'issue': 'OSR-29', 'baseline': BASELINE, 'toolchain': command(['rustc', '+1.89.0', '--version']).decode().strip(), 'binarySha256': sha(binary.read_bytes()), 'runnerLockSha256': sha((runner / 'Cargo.lock').read_bytes()), 'cmsLockSha256': sha(source('Cargo.lock')), 'editorLockSha256': sha((ROOT / 'Cargo.lock').read_bytes()), 'corpusAuthority': 'CMS; full transfer/conformance deferred to OSR-30', 'sources': sources, 'cases': [{**origin, **outcome} for origin, outcome in zip(origins, results)], 'summary': {'cases': len(results), 'equal': sum(r['equal'] for r in results), 'admitted': sum(r['baseline']['kind'] == 'admitted' for r in results), 'refused': sum(r['baseline']['kind'] == 'refused' for r in results), 'knownPanics': 1, 'knownDefect': 'OSR-74; debug probe only; no production safety claim'}}
        # A combined oracle unifies registry dependencies. Separately verify the
        # real editor lock closure uses the same native semantic versions.
        editor_meta = json.loads(command(['cargo', 'metadata', '--locked', '--format-version=1'], cwd=ROOT))
        packages = {p['id']: p for p in editor_meta['packages']}
        graph = {n['id']: n['dependencies'] for n in editor_meta['resolve']['nodes']}
        profile = next(p for p in packages.values() if p['name'] == 'editor-internal-kwdj')
        closure = set()
        def visit(package):
            if package in closure:
                return
            closure.add(package)
            for dependency in graph[package]:
                visit(dependency)
        visit(profile['id'])
        import tomllib
        baseline_lock = tomllib.loads(source('Cargo.lock').decode())
        baseline_versions = {(p['name'], p['version']) for p in baseline_lock['package']}
        dependencies = sorted((packages[p]['name'], packages[p]['version']) for p in closure if packages[p]['source'])
        assert all(dep in baseline_versions for dep in dependencies), 'native semantic dependency drift'
        report['nativeSemanticDependencies'] = [{'name': n, 'version': v} for n, v in dependencies]
        report['nativeSemanticVersionsMatchBaseline'] = True
        report['extractedSourceSha256'] = {str(p.relative_to(ROOT)): sha(p.read_bytes()) for name in ['core', 'kwdj'] for p in sorted((ROOT / 'crates' / name).rglob('*')) if p.is_file() and p.suffix in ['.rs', '.toml']}
        provenance = json.loads((ROOT / 'provenance/source-files.json').read_bytes())
        assert all(sha(source(f['source'])) == f['sha256'] for f in provenance['files'])
        report['sourceProvenanceVerified'] = True
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
        print(json.dumps(report['summary']))

if __name__ == '__main__':
    main()
