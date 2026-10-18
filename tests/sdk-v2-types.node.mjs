// SPDX-License-Identifier: MIT OR Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('generated V2 declarations stay separate and narrow controller requests without widening legacy options', () => {
  const directory = mkdtempSync(join(tmpdir(), 'editor-sdk-v2-types-'));
  try {
    const sdk = resolve('packages/sdk/dist/index.js').replaceAll('\\', '/');
    const source = `import { createEditor, loadSdkV2 } from ${JSON.stringify(sdk)};
import type { CreateEditorOptions, OpenOptions, OpenOptionsV2, SessionContextV2, BridgeRequest, StampDto, LoadedSdkV1, LoadedSdkV2 } from ${JSON.stringify(sdk)};
interface LegacyHostOptions extends CreateEditorOptions { hostLabel:string }
const profile={profile_id:'org.example.notes',profile_version:'1.0.0',codec_id:'org.example.notes/json',wire_version:1,extensions:[]};
const options:OpenOptionsV2={abi:'editor-sdk/2',build_id:'sha256:fixture',profile,admission:'validate',access:'editable',registry_json:'{"bound":18446744073709551615}',profile_options_json:'{"root_blocks":[],"limits":null}'};
const context:SessionContextV2={build_id:options.build_id,profile,registry_digest:'a'.repeat(64),capability_digest:'b'.repeat(64)};
const stamp:StampDto={session:'opaque',generation:'1',revision:'18446744073709551615',selection_epoch:'0',history_epoch:'0'};
const request:BridgeRequest={kind:'command',stamp,command:{id:'org.example.notes/command/set-title',payload_json:'{"title":"Я 😀"}'},history_hint:{kind:'isolated'}};
declare const module:LoadedSdkV2;
const editor=createEditor({input:new Uint8Array(),options,loader:async()=>module});
editor.submit(request);editor.context();editor.query({kind:'query_history',stamp,direction:'undo'});
// @ts-expect-error V2 common dispatcher has no profile-specific identity facts operation.
editor.submit({kind:'update_facts',stamp,identities:{media:[],references:[]}});
// @ts-expect-error Raw registry bytes must remain an opaque JSON string, never a JS numeric object.
const parsedRegistry:OpenOptionsV2={...options,registry_json:{bound:9007199254740992}};
// @ts-expect-error V2 requires explicit raw profile options.
const missing:OpenOptionsV2={abi:'editor-sdk/2',build_id:'x',profile,admission:'validate',access:'editable',registry_json:'{}'};
// @ts-expect-error Digests are exact strings, not rounded counters.
const badContext:SessionContextV2={...context,registry_digest:123};
// @ts-expect-error V2 does not silently widen legacy closed OpenOptions.
const widenedLegacy:OpenOptions={abi:'editor-sdk/1',build_id:'x',profile,admission:'validate',access:'editable',identities:{media:[],references:[]},limits:null,registry_json:'{}'};
// @ts-expect-error This operation is absent from authoritative common BridgeRequest.
const facts:BridgeRequest={kind:'update_facts',stamp,identities:{media:[],references:[]}};
declare const legacy:LoadedSdkV1;
// @ts-expect-error An injected V1-only loader is not a V2 capability.
createEditor({input:new Uint8Array(),options,loader:async()=>legacy});
// @ts-expect-error Precompiled modules have no verifiable original sealed bytes.
loadSdkV2({wasm:{} as WebAssembly.Module});
void [parsedRegistry,missing,badContext,widenedLegacy,facts];
`;
    writeFileSync(join(directory, 'fixture.mts'), source);
    writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: false }, files: ['fixture.mts'] }));
    const result = spawnSync(resolve('node_modules/.bin/tsc'), ['--project', join(directory, 'tsconfig.json'), '--pretty', 'false'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
