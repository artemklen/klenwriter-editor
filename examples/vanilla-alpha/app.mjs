// SPDX-License-Identifier: MIT OR Apache-2.0
import { destroy, export as exportDocument, mount, subscribe, update } from '@klenwriter/editor';
import { loadSdkV2 } from '@klenwriter/editor-sdk';
import { initialDocument, options, renderers } from './profile.mjs';

const editorElement = document.querySelector('#editor');
const controls = document.querySelector('#controls');
const status = document.querySelector('#status');
const canonical = document.querySelector('#canonical');
const storageKey = 'klenwriter-vanilla-alpha/kwdj';
const encoder = new TextEncoder();
const sdk = loadSdkV2();
let editor;

async function accepted(ticket, kind) {
  const result = ticket.status === 'queued' ? await ticket.completion : ticket.response;
  if (result?.status !== 'ok' || result.value.kind !== kind) {
    throw new Error(JSON.stringify(result ?? ticket));
  }
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

async function open(input) {
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

function action(button, perform) {
  document.querySelector(button).addEventListener('click', async () => {
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
action('#save', async () => {
  localStorage.setItem(storageKey, await snapshot());
  return 'Saved in this browser';
});
action('#reopen', async () => {
  const saved = localStorage.getItem(storageKey);
  if (saved === null) return 'No saved document';
  await open(saved);
  return 'Reopened saved document';
});

try {
  await open(initialDocument);
  status.textContent = 'Editor ready';
  controls.disabled = false;
} catch (error) {
  showError(error);
}
