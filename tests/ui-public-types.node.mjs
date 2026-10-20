// SPDX-License-Identifier: MIT OR Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('actual additive DOM/UI declarations satisfy the pre-candidate public contract',()=>{
  const directory=mkdtempSync(join(tmpdir(),'editor-ui-types-'));
  try{
    writeFileSync(join(directory,'package.json'),'{"type":"module"}\n');
    const source=`
import type * as ActualUi from ${JSON.stringify(resolve('packages/ui/dist/index.js'))};
import type * as ExpectedUi from ${JSON.stringify(resolve('contracts/ui/v1/ui-api.js'))};
import type * as ActualDom from ${JSON.stringify(resolve('packages/dom/dist/index.js'))};
import type * as ExpectedDom from ${JSON.stringify(resolve('contracts/ui/v1/mounted-api-additions.js'))};
type Assert<T extends true> = T;
type Compatible<A,B> = A extends B ? true : false;
type UI = Assert<Compatible<ActualUi.EditorUi,ExpectedUi.EditorUi>>;
// Independent declarations intentionally have distinct nominal unique-symbol
// brands. Check descriptors/signatures without equating authority identities.
type HostAction = Assert<Compatible<Omit<ActualUi.UiHostAction,'__uiHostAction'>,Omit<ExpectedUi.UiHostAction,'__uiHostAction'>>>;
type HostDescriptor = Assert<Compatible<Omit<ActualDom.MountedHostRequest,'__mountedHostRequest'>,Omit<ExpectedDom.MountedHostRequest,'__mountedHostRequest'>>>;
type HostKeys = Assert<Compatible<keyof ActualDom.MountedHostRequests,keyof ExpectedDom.MountedHostRequests>>;
type CompleteResult = Assert<Compatible<ReturnType<ActualDom.MountedHostRequests['complete']>,ReturnType<ExpectedDom.MountedHostRequests['complete']>>>;
type CompleteCommand = Assert<Compatible<Parameters<ActualDom.MountedHostRequests['complete']>[1],Parameters<ExpectedDom.MountedHostRequests['complete']>[1]>>;
type CaptureOptions = Assert<Compatible<Parameters<ActualDom.MountedHostRequests['capture']>,Parameters<ExpectedDom.MountedHostRequests['capture']>>>;
type Geometry = Assert<Compatible<ActualDom.MountedGeometry,ExpectedDom.MountedGeometry>>;
declare const ui:ActualUi.EditorUi;
declare const editor:ActualDom.MountedEditor;
editor.geometry.read({kind:'selection',stamp:editor.capture()!});
editor.hostRequests.capture();
// @ts-expect-error A copied descriptor cannot fabricate mounted authority.
editor.hostRequests.release({stamp:editor.capture()!,context:editor.context()!});
ui.setLocale('ru');ui.refresh();
// @ts-expect-error Locale is closed.
ui.setLocale('xx');
// @ts-expect-error UI does not expose a raw native session.
ui.session.call('{}');
// @ts-expect-error Arbitrary HTML is not a command API.
ui.insertHtml('<p>fake</p>');
// @ts-expect-error Geometry returns data, never a DOM action capability.
editor.geometry.read({kind:'block',node:'n',stamp:editor.capture()!}).element.focus();
`;
    const program=join(directory,'consumer.ts');writeFileSync(program,source);
    const result=spawnSync(process.execPath,['node_modules/typescript/bin/tsc','--ignoreConfig','--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',program],{encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
