// SPDX-License-Identifier: MIT OR Apache-2.0
import { kwdjBasicRenderers } from '@klenwriter/editor-kwdj/dom';
import { sdkAbiV2, sdkBuildId } from '@klenwriter/editor-sdk';
import { notesD0Renderers } from '@example/notes-extension/dom';
import registry from './kwdj-registry.json';
import notesDocument from './notes-document.json';

const descriptor = await fetch(import.meta.resolve('@example/notes-extension/d0.json'));
if (!descriptor.ok) throw new Error('Could not load the Notes D0 registry');

function options(renderers, registryJson, profileOptions) {
  return {
    abi: sdkAbiV2,
    build_id: sdkBuildId,
    profile: renderers.definition.binding.profile,
    admission: 'validate',
    access: 'editable',
    registry_json: registryJson,
    profile_options_json: JSON.stringify(profileOptions),
  };
}

export const profiles = {
  kwdj: {
    label: 'KWDJ',
    renderers: kwdjBasicRenderers,
    options: options(kwdjBasicRenderers, JSON.stringify(registry), {
      identities: { media: [], references: [] }, limits: null,
    }),
    initialDocument: JSON.stringify({
      schema: 'klenwriter.document', schema_version: 1, profile: 'prose',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Vanilla alpha' }] }],
    }),
  },
  notes: {
    label: 'Generic Notes',
    renderers: notesD0Renderers,
    options: options(notesD0Renderers, await descriptor.text(), {
      root_blocks: ['org.example.notes/paragraph'], limits: null,
    }),
    initialDocument: JSON.stringify(notesDocument),
  },
};
