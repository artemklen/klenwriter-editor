// SPDX-License-Identifier: MIT OR Apache-2.0
import { kwdjBasicRenderers } from '@klenwriter/editor-kwdj/dom';
import { sdkAbiV2, sdkBuildId } from '@klenwriter/editor-sdk';

import registry from './kwdj-registry.json';

export const renderers = kwdjBasicRenderers;
export const options = {
  abi: sdkAbiV2,
  build_id: sdkBuildId,
  profile: renderers.definition.binding.profile,
  admission: 'validate',
  access: 'editable',
  registry_json: JSON.stringify(registry),
  profile_options_json: JSON.stringify({ identities: { media: [], references: [] }, limits: null }),
};

export const initialDocument = JSON.stringify({
  schema: 'klenwriter.document', schema_version: 1, profile: 'prose',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Vanilla alpha' }] }],
});
