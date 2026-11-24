// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';

const assetId = 'a2222222-2222-4222-8222-222222222222';
const referenceId = '550e8400-e29b-41d4-a716-446655440006';
const mockMediaAlt = 'Sample illustration';
const mockReferenceLabel = 'Sample reference';
const stubLink = 'https://stub.example.test/alpha';
const stubMediaAlt = 'Alternative illustration';
const stubReferenceLabel = 'Alternative reference';

export const alternateEntry = `
import { startAlpha } from './app.mjs';
const calls = [];
window.alphaStubCalls = calls;
const reply = (name, request, signal, value) => {
  if (!(signal instanceof AbortSignal) || signal.aborted) throw new Error('Expected live host service context');
  calls.push({name, request});
  return {status:'ok',value};
};
await startAlpha({
  hostServices:{
    async editLink(request,{signal}) {
      return reply('link',request,signal,{kind:'set',link:{href:${JSON.stringify(stubLink)}}});
    },
    async pickMedia(request,{signal}) {
      return reply('picker',request,signal,{assetId:${JSON.stringify(assetId)}});
    },
    async mediaMetadata(request,{signal}) {
      return reply('media',request,signal,{assetId:${JSON.stringify(assetId)},alt:${JSON.stringify(stubMediaAlt)}});
    },
    async lookupReference(request,{signal}) {
      const result = reply('reference',request,signal,{entityId:${JSON.stringify(referenceId)},label:${JSON.stringify(stubReferenceLabel)}});
      const attempts = window.alphaReferenceAttempts;
      if (!attempts) return result;
      return new Promise((resolve,reject) => {
        attempts.push({signal,resolve,reject});
        if (attempts.length === 1) {
          signal.addEventListener('abort', () => reject(signal.reason), {once:true});
        }
      });
    },
  },
});
`;

const canonical = page => page.locator('#canonical').textContent();
const status = (page, text) => page.getByRole('status').getByText(text, {exact:true}).waitFor();
const revision = page => page.locator('#canonical').getAttribute('data-revision');
async function nextRevision(page, before) {
  await page.waitForFunction(expected => document.querySelector('#canonical').dataset.revision === expected,
    String(BigInt(before)+1n));
}
const button = (page, name) => page.getByRole('button', {name,exact:true});
const editor = page => page.locator('#editor');

async function selectText(page, span = false) {
  await editor(page).focus();
  await page.keyboard.press(span ? 'Home' : 'End');
  if (span) {
    for (const _ of 'Vanilla') await page.keyboard.press('Shift+ArrowRight');
    await page.waitForFunction(() => document.getSelection().toString() === 'Vanilla');
  }
  await editor(page).evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function checkMedia(page, alt) {
  const before = JSON.parse(await canonical(page));
  const beforeRevision = await revision(page);
  await selectText(page);
  await button(page,'Insert media').click();
  await status(page,'Media inserted');
  await nextRevision(page,beforeRevision);
  const saved = await canonical(page);
  assert.deepEqual(JSON.parse(saved), {
    ...before,
    content: [
      ...before.content,
      {type:'media_image',attrs:{align:'none',alt,media_asset_id:assetId}},
      {type:'paragraph',content:[]},
    ],
  });
  assert.equal(await editor(page).getByRole('group',{name:alt,exact:true}).count(),1);
  return saved;
}

async function checkMediaReopen(page, saved, alt) {
  await button(page,'Save').click();
  await status(page,'Saved in this browser');
  await page.reload();
  await status(page,'Editor ready');
  assert.notEqual(await canonical(page), saved);
  await button(page,'Reopen saved').click();
  await status(page,'Reopened saved document');
  assert.equal(await canonical(page), saved);
  assert.equal(await editor(page).getByRole('group',{name:alt,exact:true}).count(),1);
}

async function checkReference(page, label) {
  await button(page,'Open reference sample').click();
  await status(page,label);
  const placeholder=editor(page).locator('span.editor-reference-placeholder');
  assert.equal(await placeholder.textContent(),'Имя');
  assert.equal(await placeholder.getAttribute('href'),null);
  assert.equal(await editor(page).getAttribute('contenteditable'),'false');
  const output=await canonical(page);
  const [[mark]] = JSON.parse(output).content[0].content.map(leaf=>leaf.marks);
  assert.deepEqual(mark,{type:'reference_link',attrs:{reference_entity_id:referenceId}});
  await editor(page).focus();
  await page.keyboard.press('Backspace');
  assert.equal(await placeholder.textContent(),'Имя');
  await button(page,'Save').click();
  await status(page,'Saved in this browser');
  assert.equal(await canonical(page),output);
  await button(page,'Reopen saved').click();
  await status(page,'Reopened saved document');
  assert.equal(await canonical(page),output);
  assert.equal(await placeholder.textContent(),'Имя');
  assert.equal(await editor(page).getAttribute('contenteditable'),'false');
}

async function checkReferenceLookupOwnership(page) {
  const output = await canonical(page);
  const beforeRevision = await revision(page);
  const reference = button(page, 'Open reference sample');
  const controls = page.locator('#controls');
  const errors = [];
  const errorText = 'Current reference lookup failed';
  const recordError = message => {
    if (message.type() === 'error' && /AbortError|Current reference lookup failed/.test(message.text())) {
      errors.push(message.text());
    }
  };
  await reference.evaluate(element => {
    window.alphaReferenceAttempts = [];
    window.alphaReferenceClicks = [];
    element.addEventListener('click', event => window.alphaReferenceClicks.push(event.isTrusted));
  });
  const startLookup = async count => {
    await reference.click();
    await page.waitForFunction(expected => window.alphaReferenceAttempts.length === expected, count);
  };
  const pendingLookup = async (previous, current) => page.evaluate(([previous, current]) => ({
    previousAborted: window.alphaReferenceAttempts[previous].signal.aborted,
    currentAborted: window.alphaReferenceAttempts[current].signal.aborted,
    controlsDisabled: document.querySelector('#controls').disabled,
    status: document.querySelector('#status').textContent,
  }), [previous, current]);
  const assertLocked = async () => {
    assert.equal(await canonical(page), output);
    assert.equal(await revision(page), beforeRevision);
    assert.equal(await editor(page).getAttribute('contenteditable'), 'false');
  };
  const completeLookup = (index, outcome) => page.evaluate(([index, outcome]) => {
    window.alphaReferenceAttempts[index].resolve(outcome);
  }, [index, outcome]);
  const available = label => ({status:'ok', value:{entityId:referenceId,label}});

  page.on('console', recordError);
  try {
    await startLookup(1);
    await startLookup(2);
    assert.deepEqual(await pendingLookup(0, 1), {
      previousAborted:true, currentAborted:false, controlsDisabled:true, status:'Reopened saved document',
    });
    assert.deepEqual(errors, []);
    await assertLocked();
    await completeLookup(1, {status:'unavailable'});
    await status(page, 'Reference metadata unavailable');
    assert.equal(await controls.isDisabled(), false);

    await startLookup(3);
    await startLookup(4);
    await completeLookup(2, available('Stale reference'));
    await page.evaluate(() => new Promise(done => requestAnimationFrame(done)));
    assert.deepEqual(await pendingLookup(2, 3), {
      previousAborted:true, currentAborted:false, controlsDisabled:true, status:'Reference metadata unavailable',
    });
    await assertLocked();
    await completeLookup(3, available('Newest reference'));
    await status(page, 'Newest reference');
    assert.equal(await controls.isDisabled(), false);

    await startLookup(5);
    await page.evaluate(message => window.alphaReferenceAttempts[4].reject(new Error(message)), errorText);
    await status(page, 'Editor action failed');
    assert.equal(await controls.isDisabled(), false);
    assert.equal(errors.length, 1);
    assert.match(errors[0], new RegExp(errorText));
    assert.deepEqual(await page.evaluate(() => window.alphaReferenceClicks), [true,true,true,true,true]);
    await assertLocked();
  } finally {
    page.off('console', recordError);
  }
}

export async function checkMockHostServices(page) {
  const before = await canonical(page), beforeRevision = await revision(page);
  await selectText(page,true);
  await button(page,'Link').click();
  const dialog = page.getByRole('dialog',{name:'Insert link'});
  await dialog.getByRole('textbox',{name:'Link URL'}).fill('data:text/plain,rejected');
  await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await status(page,'Link unavailable');
  await dialog.waitFor({state:'hidden'});
  assert.equal(await canonical(page),before);
  assert.equal(await revision(page),beforeRevision);
  assert.equal(await editor(page).evaluate(element=>document.activeElement===element),true);

  const saved = await checkMedia(page,mockMediaAlt);
  await checkMediaReopen(page,saved,mockMediaAlt);
  await checkReference(page,mockReferenceLabel);
  return {invalidLinkRefusal:'pass',mediaInsertSaveReopen:'pass',referenceLookupAndReadOnly:'pass'};
}

export async function checkAlternateHostServices(page) {
  await status(page,'Editor ready');
  const beforeRevision = await revision(page);
  await selectText(page,true);
  await button(page,'Link').click();
  await status(page,'Link applied');
  await nextRevision(page,beforeRevision);
  const written=JSON.parse(await canonical(page)).content[0].content[0];
  assert.deepEqual(written,{type:'text',text:'Vanilla',marks:[{type:'link',attrs:{href:stubLink}}]});
  const saved = await checkMedia(page,stubMediaAlt);
  assert.deepEqual(await page.evaluate(()=>window.alphaStubCalls),[
    {name:'link',request:{kind:'create'}},
    {name:'picker',request:{kind:'insert'}},
    {name:'media',request:{assetId}},
  ]);
  await checkMediaReopen(page,saved,stubMediaAlt);
  await checkReference(page,stubReferenceLabel);
  assert.deepEqual(await page.evaluate(()=>window.alphaStubCalls),[
    {name:'reference',request:{entityId:referenceId}},
  ]);
  await checkReferenceLookupOwnership(page);
  return {link:'pass',media:'pass',reference:'pass',referenceLookupOwnership:'pass'};
}
