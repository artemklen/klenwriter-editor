// SPDX-License-Identifier: MIT OR Apache-2.0
import { destroy, export as exportDocument, mount, subscribe, update } from '@klenwriter/editor';
import { createCommand, loadSdkV2 } from '@klenwriter/editor-sdk';
import { createCalloutEditor, profiles } from './profile.mjs';
import { runKwdjLinkDialog, runKwdjMediaPicker } from '@klenwriter/editor-kwdj/dom';
import { createMockHostServices, referenceEntityId } from './host-services.mjs';
import referenceDocument from './reference-document.json';

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
const linkDialog = document.querySelector('#link-dialog');
const hostControls = document.querySelector('#host-controls');
const linkButton = document.querySelector('#edit-link');
const mediaButton = document.querySelector('#insert-media');
const kwdjUi = {
  slots: {
    toolbar: document.querySelector('#editor-toolbar'),
    gutter: document.querySelector('#editor-gutter'),
    entry: document.querySelector('#editor-entry'),
  },
  profile: () => ({ toolbar: [], insertions: [], blockActions: [], moves: () => [] }),
};
const encoder = new TextEncoder();
const sdk = loadSdkV2();
let editor;
let calloutEditor;
let currentProfile = profileSelect.value;
let hostServices;
let referenceOpen = false;
let referenceLookup;
let activeAction;

function storageKey() {
  return 'klenwriter-vanilla-alpha/' + currentProfile + (referenceOpen ? '/reference' : '');
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

async function open(profile, input = profiles[profile].initialDocument, { reference = false } = {}) {
  const { options, renderers } = profiles[profile];
  referenceLookup?.abort();
  referenceLookup = undefined;
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
    editor: {
      input: encoder.encode(input), loader: () => sdk,
      options: reference ? { ...options,access:'read_only' } : options,
    },
    renderers,
    ui: profile === 'kwdj' ? kwdjUi : undefined,
  });
  editor = mounted;
  const ready = await mounted.ready;
  if (ready.status !== 'ready') throw new Error(JSON.stringify(ready));
  if (mounted.uiReady) {
    const ui = await mounted.uiReady;
    if (ui.status !== 'ready') throw new Error(JSON.stringify(ui));
  }
  currentProfile = profile;
  referenceOpen = reference;
  extensionPanel.hidden = profile !== 'notes';
  hostControls.hidden = profile !== 'kwdj';
  linkButton.disabled = mediaButton.disabled = reference;
  document.querySelector('#undo').disabled = document.querySelector('#redo').disabled = reference;

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
    const token = Symbol();
    activeAction = token;
    controls.disabled = true;
    try {
      const message = await perform();
      if (activeAction === token && message !== undefined) status.textContent = message;
    } catch (error) {
      if (activeAction === token) showError(error);
    } finally {
      if (activeAction === token) {
        activeAction = undefined;
        controls.disabled = false;
      }
    }
  });
}

async function history(direction) {
  await accepted(update(editor, { kind: 'history', stamp: editor.capture(), direction }), 'mutation');
  await snapshot();
  return direction === 'undo' ? 'Undone' : 'Redone';
}

async function hostResult(owner, started, label, applied) {
  if (started.status !== 'started') return label + ' unavailable';
  const outcome = await started.completion;
  if (editor !== owner) return undefined;
  if (outcome.status === 'submitted') {
    const submission = outcome.submission;
    const response = submission.status === 'queued' ? await submission.completion : submission.response;
    await outcome.focus;
    if (editor !== owner) return undefined;
    return response.status === 'ok' ? applied : label + ' unavailable';
  }
  return label + (outcome.status === 'cancelled' ? ' cancelled' : ' unavailable');
}

for (const button of [linkButton, mediaButton]) {
  // Keep the current editor selection through the pointer's focus default.
  button.addEventListener('pointerdown', event => {
    if (event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey) event.preventDefault();
  });
}

action('#edit-link', async () => {
  if (!linkDialog.hidden) return undefined;
  const owner = editor;
  try {
    return await hostResult(owner, runKwdjLinkDialog(owner.hostRequests, {
      request: {kind:'create'}, services:hostServices, focusScope:linkDialog,
    }), 'Link', 'Link applied');
  } finally {
    linkDialog.hidden = true;
  }
});

action('#insert-media', async () => {
  const owner = editor;
  const started = runKwdjMediaPicker(owner.hostRequests, {
    target: {kind:'insert'}, services:hostServices, focusScope:hostControls,
  });
  if (started.status === 'started') mediaButton.focus({preventScroll:true});
  return hostResult(owner, started, 'Media', 'Media inserted');
});

action('#open-reference', async () => {
  await open('kwdj', JSON.stringify(referenceDocument), {reference:true});
  const owner = editor, lookup = new AbortController();
  referenceLookup = lookup;
  try {
    const reply = await hostServices.lookupReference?.({entityId:referenceEntityId}, {signal:lookup.signal});
    if (editor !== owner || lookup.signal.aborted) return undefined;
    return reply?.status === 'ok' && reply.value.entityId === referenceEntityId
      ? reply.value.label ?? 'Reference loaded' : 'Reference metadata unavailable';
  } finally {
    if (referenceLookup === lookup) referenceLookup = undefined;
  }
});

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
  await open(currentProfile, saved, {reference:referenceOpen});
  return 'Reopened saved document';
});

/** @param {{ hostServices?: import('@klenwriter/editor-sdk').HostServices }} [options] */
export async function startAlpha({ hostServices: services = createMockHostServices(linkDialog) } = {}) {
  hostServices = services;
  try {
    await open(currentProfile);
    status.textContent = 'Editor ready';
    controls.disabled = false;
  } catch (error) {
    showError(error);
  }
}
