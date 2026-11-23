// SPDX-License-Identifier: MIT OR Apache-2.0
import { destroy, export as exportDocument, mount, subscribe, update } from '@klenwriter/editor';
import { createCommand, loadSdkV2 } from '@klenwriter/editor-sdk';
import { createCalloutEditor, profiles } from './profile.mjs';

const editorElement = document.querySelector('#editor');
const controls = document.querySelector('#controls');
const status = document.querySelector('#status');
const canonical = document.querySelector('#canonical');
const profileSelect = document.querySelector('#profile');
const extensionPanel = document.querySelector('#notes-extension');
const calloutOutput = document.querySelector('#extension-canonical');
const calloutDetails = calloutOutput.parentElement;
const insertCallout = document.querySelector('#insert-callout');
const undoCallout = document.querySelector('#undo-callout');
const encoder = new TextEncoder();
const sdk = loadSdkV2();
let editor;
let calloutEditor;
let currentProfile = profileSelect.value;

function storageKey() {
  return 'klenwriter-vanilla-alpha/' + currentProfile;
}

function responseValue(result, kind) {
  if (result.status !== 'ok' || result.value.kind !== kind) {
    throw new Error(JSON.stringify(result));
  }
  return result.value;
}

async function accepted(ticket, kind) {
  const result = ticket.status === 'queued' ? await ticket.completion : ticket.response ?? ticket;
  return responseValue(result, kind);
}

async function snapshot(mounted = editor) {
  const result = await exportDocument(mounted);
  if (result.status !== 'exported') throw new Error(JSON.stringify(result));
  if (editor === mounted) {
    canonical.textContent = result.canonicalJson;
    canonical.dataset.revision = result.stamp.revision;
  }
  return result.canonicalJson;
}

function showError(error) {
  status.textContent = 'Editor action failed';
  console.error(error);
}

async function closeCalloutEditor() {
  if (calloutEditor) {
    const previous = calloutEditor;
    calloutEditor = undefined;
    await accepted(previous.destroy(), 'destroyed');
  }
  insertCallout.disabled = false;
  undoCallout.disabled = true;
}

async function showCalloutExport() {
  const snapshot = await accepted(calloutEditor.submit({
    kind: 'snapshot', stamp: calloutEditor.capture(), max_bytes: 1_048_576,
  }), 'snapshot');
  await accepted(calloutEditor.submit({
    kind: 'release_snapshot', handle: snapshot.handle,
  }), 'released');
  calloutOutput.textContent = snapshot.canonical_json;
  calloutOutput.dataset.revision = snapshot.stamp.revision;
  calloutDetails.open = true;
}

async function open(profile, input = profiles[profile].initialDocument) {
  const { options, renderers } = profiles[profile];
  await closeCalloutEditor();
  calloutOutput.textContent = '';
  delete calloutOutput.dataset.revision;
  calloutDetails.open = false;
  if (editor) {
    const previous = editor;
    editor = undefined;
    await accepted(destroy(previous).sdk, 'destroyed');
  }
  const mounted = mount({
    element: editorElement,
    editor: { input: encoder.encode(input), loader: () => sdk, options },
    renderers,
  });
  editor = mounted;
  const ready = await mounted.ready;
  if (ready.status !== 'ready') throw new Error(JSON.stringify(ready));
  currentProfile = profile;
  extensionPanel.hidden = profile !== 'notes';

  let pending = false;
  subscribe(mounted, event => {
    if (event.change.kind !== 'document' || pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (editor === mounted) snapshot(mounted).catch(showError);
    });
  });
  await snapshot(mounted);
}

function action(selector, perform, event = 'click') {
  document.querySelector(selector).addEventListener(event, async () => {
    controls.disabled = true;
    try {
      status.textContent = await perform();
    } catch (error) {
      showError(error);
    } finally {
      controls.disabled = false;
    }
  });
}

async function history(direction) {
  await accepted(update(editor, { kind: 'history', stamp: editor.capture(), direction }), 'mutation');
  await snapshot();
  return direction === 'undo' ? 'Undone' : 'Redone';
}

action('#undo', () => history('undo'));
action('#redo', () => history('redo'));
action('#insert-callout', async () => {
  calloutEditor = await createCalloutEditor(encoder.encode(await snapshot()), () => sdk);
  try {
    const ready = await calloutEditor.ready;
    if (ready.status !== 'ok') throw new Error(JSON.stringify(ready));
    const stamp = calloutEditor.capture();
    const { state } = responseValue(calloutEditor.read({ kind: 'state' }), 'state');
    const { node } = responseValue(calloutEditor.read({ kind: 'node', stamp, node: state.root }), 'node');
    await accepted(calloutEditor.submit({
      kind: 'command',
      stamp,
      command: createCommand('org.example.notes/insert-callout', {
        kind: 'recipe',
        arguments: {
          nodes: { doc: node.children[0] },
          values: {
            title: { kind: 'string', value: 'Review' },
            text: { kind: 'string', value: 'Check this note' },
          },
        },
      }),
      history_hint: { kind: 'isolated' },
    }), 'mutation');
    await showCalloutExport();
    insertCallout.disabled = true;
    undoCallout.disabled = false;
    return 'Callout inserted in the example copy';
  } catch (error) {
    await closeCalloutEditor();
    throw error;
  }
});
action('#undo-callout', async () => {
  try {
    await accepted(calloutEditor.submit({
      kind: 'history', stamp: calloutEditor.capture(), direction: 'undo',
    }), 'mutation');
    await showCalloutExport();
    return 'Undid the callout';
  } finally {
    await closeCalloutEditor();
  }
});
action('#profile', async () => {
  const profile = profileSelect.value;
  await open(profile);
  return 'Opened ' + profiles[profile].label;
}, 'change');
action('#save', async () => {
  localStorage.setItem(storageKey(), await snapshot());
  return 'Saved in this browser';
});
action('#reopen', async () => {
  const saved = localStorage.getItem(storageKey());
  if (saved === null) return 'No saved document';
  await open(currentProfile, saved);
  return 'Reopened saved document';
});

try {
  await open(currentProfile);
  status.textContent = 'Editor ready';
  controls.disabled = false;
} catch (error) {
  showError(error);
}
