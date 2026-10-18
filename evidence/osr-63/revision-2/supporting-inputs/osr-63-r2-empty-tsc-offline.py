#!/usr/bin/env python3
"""Quiet-log helper guard checks only; no main/Git/network/gate/input modifications."""
import copy,importlib.util,json
from pathlib import Path
from unittest.mock import patch
checks=[]
def blocked(*a,**k):raise AssertionError('No subprocess/Git/network permitted')
def reject(name,fn):
 try:fn()
 except (RuntimeError,KeyError,FileNotFoundError):checks.append({'case':name,'status':'passed','result':'refused'});return
 raise AssertionError('Expected refusal: '+name)
with patch('subprocess.run',blocked),patch('subprocess.check_output',blocked),patch('subprocess.Popen',blocked):
 spec=importlib.util.spec_from_file_location('r2_builder_empty_tsc','/tmp/osr-63-r2-build-local-evidence.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
 for path in b.QUIET_TSC_LOGS:
  assert b.read_supporting(path)==b'';checks.append({'case':'actual-quiet-tsc-receipt:'+path.name,'status':'passed'})
 path=next(iter(b.QUIET_TSC_LOGS));receipt_path=Path(str(path)+'.actual-exit.json');original=b.read;valid=json.loads(original(receipt_path))
 def replace_receipt(value):
  def read(p,*a,**k):
   if Path(p)==receipt_path:
    if value is None:raise FileNotFoundError('Synthetic missing actual receipt')
    return json.dumps(value).encode()
   return original(p,*a,**k)
  return read
 for name,patches in [('wrong-hash',{'rawLogSha256':'0'*64}),('wrong-exit',{'returnCode':1}),('non-tsc',{'argv':['node','other.js']}),('wrong-path',{'rawLog':'/tmp/other.log'}),('wrong-byte-count',{'rawLogBytes':1}),('changed-source',{'productionSourceUnchanged':False})]:
  bad=copy.deepcopy(valid);bad.update(patches);b.read=replace_receipt(bad);reject(name,lambda:b.read_supporting(path))
 b.read=replace_receipt(None);reject('missing-original-receipt',lambda:b.read_supporting(path));b.read=original
 reject('empty-required-source-stays-refused',lambda:b.read(path))
 fake_path=Path('/tmp/osr-63-r2-not-tsc-empty.log')
 with patch.object(Path,'is_file',lambda _:True),patch.object(Path,'is_symlink',lambda _:False),patch.object(Path,'stat',lambda _:type('S',(),{'st_size':0})()):
  reject('arbitrary-empty-supporting-log-refused',lambda:b.read_supporting(fake_path))
 print(json.dumps({'scope':'Pure targeted helper guards; actual existing two quiet tsc receipts read, synthetic negative metadata only. No builder/binder main, product tests/gates, Git/network or input changes.','passed':len(checks),'failed':0,'checks':checks},indent=2))
