// SPDX-License-Identifier: MIT OR Apache-2.0
import { readFileSync } from 'node:fs';
import { corpus } from './codec-fixtures.mjs';
const read = path => readFileSync(path, 'utf8');
const json = path => JSON.parse(read(path));
export function extensionPacket() {
  const notes = 'contracts/notes/v1', base = 'org.klenwriter.kwdj';
  const registryJson = Object.fromEntries(['D0', 'D1'].map(id => [id, read(`examples/notes-extension/${id.toLowerCase()}.json`)]));
  const vectors = json(`${notes}/vectors.json`), extension = json(`${notes}/extension-command/vectors.json`);
  const kwdjProfile = { profile_id: base, profile_version: '1.0.0', codec_id: `${base}/json`, wire_version: 1,
    extensions: [{ id: `${base}/base`, version: '1.0.0' }] };
  const blockTypes = ['paragraph','heading','blockquote','bullet_list','ordered_list','task_list','code_block','scene_break','table','media_image','literary_block','warning','spoiler','disclosure','verse'];
  const kwdjRegistry = { format: 'editor-registry/1', profile: { id: base, version: '1.0.0', codec_id: `${base}/json`, wire_version: 1 },
    selected_extensions: kwdjProfile.extensions, root: { op: 'repeat', item: { op: 'choice', items: blockTypes.map(id => ({ op: 'type', id: `${base}/${id}` })) }, min: 1, max: 50000 }, mark_policy: {}, extensions: [] };
  return { format: 'editor-extensions-public-consumer/1', registryJson,
    registries: Object.fromEntries(Object.entries(registryJson).map(([id, raw]) => [id, JSON.parse(raw)])),
    codec: vectors.cases.map(c => ({ ...c, input: read(`${notes}/${c.input}`), ...(c.expected.canonical ? { canonical: read(`${notes}/${c.expected.canonical}`) } : {}) })),
    commands: json(`${notes}/commands/vectors.json`).cases,
    extension: { ...extension, initial: read(`${notes}/extension-command/${extension.expected.initial}`), after: read(`${notes}/extension-command/${extension.expected.after}`) },
    kwdjProfile, kwdjRegistryJson: JSON.stringify(kwdjRegistry),
    kwdj: corpus().inputs.map(c => {
      const options = JSON.parse(c.options);
      return { ...c, profileOptions: { identities: options.identities, limits: options.limits ? Object.assign(Object.fromEntries([
        'document_bytes','tree_depth','node_count','text_leaf_bytes','table_rows','table_effective_columns','authored_attribute_bytes',
      ].map(key => [key, null])), options.limits) : null } };
    }),
  };
}
