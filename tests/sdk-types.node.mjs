// SPDX-License-Identifier: MIT OR Apache-2.0
// Compile the actual generated declarations, including intentional rejected inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('generated SDK declarations and controller surface reject invalid wire types', () => {
  const directory = mkdtempSync(join(tmpdir(), 'editor-sdk-types-'));
  try {
    const sdk = resolve('packages/sdk/dist/index.js').replaceAll('\\', '/');
    const source = `import { createCommand } from ${JSON.stringify(sdk)};
import type { AttributeDto, HistoryHintDto, OpenOptions, SdkRequest, StampDto, EditorController, MutationRequest, CommandDto } from ${JSON.stringify(sdk)};
const stamp: StampDto = {session:'opaque',generation:'1',revision:'18446744073709551615',selection_epoch:'0',history_epoch:'0'};
const number: AttributeDto = {kind:'number',value:'18446744073709551615'};
const hint: HistoryHintDto = {kind:'typing',token:'18446744073709551615',class:'delete_backward'};
const request: SdkRequest = {kind:'command',stamp,command:{id:'custom.command',payload_json:'{}'},history_hint:hint};
const genericCommand: CommandDto = createCommand('org.example.notes/command/insert', {text:'Я 😀'});
// @ts-expect-error command IDs are strings, not rounded counters.
createCommand(1, {});
const options: OpenOptions = {abi:'editor-sdk/1',build_id:'sha256:fixture',profile:{profile_id:'x.y',profile_version:'1.0.0',codec_id:'x.y/json',wire_version:1,extensions:[]},admission:'validate',access:'editable',identities:{media:[],references:[]},limits:null};
declare const editor: EditorController;
editor.read({kind:'node',stamp,node:'opaque'});
editor.query({kind:'query_command',stamp,command:{id:'custom.command',payload_json:'{}'}});
editor.submit(request);
// @ts-expect-error u64 counters must not be JS numbers.
const badStamp: StampDto = {...stamp,revision:9007199254740992};
// @ts-expect-error authored numeric metadata must preserve its lexeme.
const badNumber: AttributeDto = {kind:'number',value:123};
// @ts-expect-error unknown request tag is not a future permissive escape.
const badKind: SdkRequest = {kind:'replace_everything'};
// @ts-expect-error typing hint must carry its exact token and class.
const badHint: HistoryHintDto = {kind:'typing'};
// @ts-expect-error numeric history token would lose exact identity.
const badToken: HistoryHintDto = {kind:'typing',token:1,class:'insert'};
// @ts-expect-error explicit nullable selection is required, not undefined.
const missingSelection: SdkRequest = {kind:'set_selection',stamp};
// @ts-expect-error queries cannot dispatch mutations.
editor.query({kind:'command',stamp,command:{id:'x',payload_json:'{}'},history_hint:{kind:'isolated'}});
// @ts-expect-error protected delivery acknowledgement belongs to the controller.
editor.submit({kind:'acknowledge_events',cursor:'opaque'});
// @ts-expect-error read is not a back door to a model mutation.
editor.read({kind:'barrier',stamp});
// @ts-expect-error selection null and explicit plain marks are distinct from missing fields.
const missingMarks: MutationRequest = {kind:'set_stored_marks',stamp};
// @ts-expect-error ProfileLimitsDto is explicit nullable, not omitted.
const missingLimits: OpenOptions = {abi:'editor-sdk/1',build_id:'x',profile:options.profile,admission:'validate',access:'editable',identities:options.identities};
void [number,options,genericCommand,badStamp,badNumber,badKind,badHint,badToken,missingSelection,missingMarks,missingLimits];
`;
    writeFileSync(join(directory, 'fixture.mts'), source);
    writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: false }, files: ['fixture.mts'] }));
    const result = spawnSync(resolve('node_modules/.bin/tsc'), ['--project', join(directory, 'tsconfig.json'), '--pretty', 'false'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
