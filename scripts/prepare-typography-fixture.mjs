// SPDX-License-Identifier: MIT OR Apache-2.0
// Pure fixture assembly. Native profile metadata is produced by coherent build.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {computeSdkBuildIdentity} from './generate-sdk-types.mjs';
import {extensionPacket} from '../tests/support/extension-fixtures.mjs';
const built=JSON.parse(readFileSync('artifacts/sdk-build-identity.json'));
assert.equal(computeSdkBuildIdentity().buildId,built.buildId,'Build the current source before typography browser input');
const packet=extensionPacket();
assert.deepEqual(packet.kwdjTypingProfile.extensions,[
  {id:'org.klenwriter.kwdj/base',version:'1.0.0'},
  {id:'org.klenwriter.kwdj/typing-rules',version:'1.0.0'},
]);
mkdirSync('artifacts/extensions',{recursive:true});
writeFileSync('artifacts/extensions/packet.json',JSON.stringify(packet));
console.log('Native-generated typography fixture packet prepared; no runtime test executed');
