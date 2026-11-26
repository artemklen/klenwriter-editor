// SPDX-License-Identifier: MIT OR Apache-2.0
import { destroy, export as exportDocument, mount } from '@klenwriter/editor';
import '@klenwriter/editor/style.css';
import { kwdjBasicRenderers } from '@klenwriter/editor-kwdj/dom';
import { loadSdkV2, sdkAbiV2, sdkBuildId } from '@klenwriter/editor-sdk';
import registry from './kwdj-registry.json';

const element = document.querySelector('#editor');
const actions = document.querySelector('#actions');
const status = document.querySelector('#status');
const canonical = document.querySelector('#canonical');
const storageKey = 'klenwriter-vanilla-quickstart';
const encoder = new TextEncoder();
const initial = JSON.stringify({
  schema: 'klenwriter.document', schema_version: 1, profile: 'prose',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello, editor.' }] }],
});
let editor;

async function open(input) {
  if (editor) {
    const { sdk } = destroy(editor);
    const closed = sdk.status === 'queued' ? await sdk.completion : sdk.response;
    if (closed.status !== 'ok') throw new Error(JSON.stringify(closed));
  }
  editor = mount({
    element,
    renderers: kwdjBasicRenderers,
    editor: {
      input: encoder.encode(input), loader: () => loadSdkV2(),
      options: {
        abi: sdkAbiV2, build_id: sdkBuildId,
        profile: kwdjBasicRenderers.definition.binding.profile,
        registry_json: JSON.stringify(registry), admission: 'validate', access: 'editable',
        profile_options_json: '{"identities":{"media":[],"references":[]},"limits":null}',
      },
    },
  });
  const ready = await editor.ready;
  if (ready.status !== 'ready') throw new Error(JSON.stringify(ready));
}

async function snapshot() {
  const result = await exportDocument(editor);
  if (result.status !== 'exported') throw new Error(JSON.stringify(result));
  canonical.textContent = result.canonicalJson;
  return result.canonicalJson;
}

function bind(selector, run) {
  document.querySelector(selector).addEventListener('click', async () => {
    actions.disabled = true;
    try {
      status.textContent = await run();
    } catch (error) {
      status.textContent = 'Editor action failed';
      console.error(error);
    } finally {
      actions.disabled = editor.lifecycle !== 'ready';
    }
  });
}

bind('#save', async () => {
  localStorage.setItem(storageKey, await snapshot());
  return 'Saved in this browser';
});
bind('#reopen', async () => {
  const saved = localStorage.getItem(storageKey);
  if (saved === null) return 'No saved document';
  await open(saved);
  await snapshot();
  return 'Reopened saved document';
});

try {
  await open(initial);
  actions.disabled = false;
  status.textContent = 'Editor ready';
} catch (error) {
  status.textContent = 'Could not open editor';
  console.error(error);
}
