// SPDX-License-Identifier: MIT OR Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('selection read types: additive SDK2/mounted overloads preserve narrow legacy reads and command tickets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'selection-sdk-types-'));
  try {
    const sdk = resolve('packages/sdk/dist/index.js'), dom = resolve('packages/dom/dist/index.js');
    const source = `import type { EditorController, EditorControllerV2, ReadRequestV2, Response, ResponseV2, StampDto, MutationRequestV2, Submission } from ${JSON.stringify(sdk)};
import type { MountedEditor, DomRefusal, SelectionBookmark } from ${JSON.stringify(dom)};
declare const legacy:EditorController, editor:EditorControllerV2, mounted:MountedEditor, stamp:StampDto;
declare const anyRead:ReadRequestV2;
const acceptsLegacy=(value:Response)=>value;
acceptsLegacy(editor.read({kind:'state'}));
const pure:ResponseV2=editor.read({kind:'selection_text',stamp,max_bytes:1048576});
const union:ResponseV2=editor.read(anyRead);
const mountedLegacy:Response|DomRefusal=mounted.read({kind:'state'});
const mountedNew:ResponseV2|DomRefusal=mounted.read({kind:'selection_text',stamp,max_bytes:0});
const ticket:Submission=editor.submit({kind:'set_selection',stamp,selection:null});
// @ts-expect-error ABI1 has no selection_text request.
legacy.read({kind:'selection_text',stamp,max_bytes:0});
// @ts-expect-error Pure selection read cannot enter SDK2 mutation queue.
editor.submit({kind:'selection_text',stamp,max_bytes:0});
// @ts-expect-error Pure selection read is excluded from the generated mutation union.
const mutation:MutationRequestV2={kind:'selection_text',stamp,max_bytes:0};
// @ts-expect-error Even ABI2 read results are never native mutation tickets.
const fabricated:Submission=pure;
const captured=mounted.selection.captureBookmark();
if(captured.status==='captured'){
 const b:SelectionBookmark=captured.bookmark;
 mounted.selection.restoreBookmark(b,{policy:'mapped',focus:false});
 mounted.selection.releaseBookmark(b);
}
void [pure,union,mountedLegacy,mountedNew,ticket,mutation,fabricated];
`;
    writeFileSync(join(directory, 'fixture.mts'), source);
    writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: false }, files: ['fixture.mts'] }));
    const result = spawnSync(resolve('node_modules/.bin/tsc'), ['--project', join(directory, 'tsconfig.json'), '--pretty', 'false'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
