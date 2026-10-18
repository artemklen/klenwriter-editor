// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled JS-only ownership/negotiation fixture, never native Session proof.
import { sdkBuildId } from '../../packages/wasm/dist/index.js';
import { fakeModule } from './sdk-fake.mjs';

export const v2Profile = { profile_id: 'org.example.fixture', profile_version: '1.0.0',
  codec_id: 'org.example.fixture/json', wire_version: 1,
  extensions: [{ id: 'org.example.fixture/base', version: '1.0.0' }] };
export const v2Options = () => ({ abi: 'editor-sdk/2', build_id: sdkBuildId,
  profile: structuredClone(v2Profile), admission: 'validate', access: 'editable',
  registry_json: '{"literal":18446744073709551615,"decimal":1.00000000000000001}',
  profile_options_json: '{"root_blocks":["org.example.fixture/paragraph"],"limits":null}' });
export function fakeV2Module(hooks = {}) {
  const fixture = fakeModule(hooks);
  const Base = fixture.module.Session;
  class Session extends Base {
    context() {
      if (hooks.context) return hooks.context(this);
      return JSON.stringify({ build_id: sdkBuildId, profile: this.options.profile,
        registry_digest: 'a'.repeat(64), capability_digest: 'b'.repeat(64) });
    }
  }
  fixture.module = { Session, resourceCounts: fixture.module.resourceCounts,
    manifest: { abi: 'editor-sdk/2', build_id: sdkBuildId, registry_format: 'editor-registry/1',
      profiles: [{ profile_id: v2Profile.profile_id, profile_version: v2Profile.profile_version,
        codec_id: v2Profile.codec_id, wire_version: v2Profile.wire_version,
        compiled_extensions: structuredClone(v2Profile.extensions) }] } };
  return fixture;
}
