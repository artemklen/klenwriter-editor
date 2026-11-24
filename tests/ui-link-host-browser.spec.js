// SPDX-License-Identifier: MIT OR Apache-2.0
import { expect, test } from '@playwright/test';

async function run(page, scenario) {
  const errors = [], external = [];
  const origin = new URL(test.info().project.use.baseURL).origin;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).origin !== origin) external.push(request.url()); });
  await page.goto('/ui');
  const result = await page.evaluate(async scenario => {
    const [sdk, dom, profile, kwdj, packet] = await Promise.all([
      import('@klenwriter/editor-sdk'), import('@klenwriter/editor-dom'), import('@klenwriter/editor-kwdj/dom'),
      import('@klenwriter/editor-kwdj'), fetch('/extensions-packet.json').then(response => response.json()),
    ]);
    const module = await sdk.loadSdkV2();
    const schema = content => JSON.stringify({content,profile:'prose',schema:'klenwriter.document',schema_version:1});
    const text = (text, marks) => marks ? {marks,text,type:'text'} : {text,type:'text'};
    const para = content => ({content,type:'paragraph'});
    const link = (href, title) => ({attrs:title === undefined ? {href} : {href,title},type:'link'});
    const source = schema([para([text('Docs suffix')])]);
    const options = {abi:'editor-sdk/2',build_id:module.manifest.build_id,profile:packet.kwdjProfile,
      admission:'validate',access:'editable',registry_json:packet.kwdjRegistryJson,
      profile_options_json:JSON.stringify({identities:{media:[],references:[]},limits:null})};
    const element = document.createElement('div'), scope = document.createElement('section');
    const button = document.createElement('button'), other = document.createElement('button');
    scope.setAttribute('role','dialog');
    scope.setAttribute('aria-modal','true');
    scope.setAttribute('aria-label','Insert link');
    button.textContent='Apply'; other.textContent='Continue'; scope.append(button);
    document.body.append(element,scope,other);
    let onRefusal;
    const mount = (element,input=source) => dom.mountEditor({element,renderers:profile.kwdjBasicRenderers,
      editor:{input:new TextEncoder().encode(input),options,loader:async()=>module},onRefusal:failure=>onRefusal?.(failure)});
    const editor = mount(element);
    const ok = response => { if (response.status !== 'ok') throw Error(JSON.stringify(response)); return response.value; };
    const completed = async result => result.status==='queued' ? result.completion : result.response ?? result;
    const submit = async request => ok(await completed(editor.submit({stamp:editor.capture(),...request})));
    const state = () => ok(editor.read({kind:'state'})).state;
    const read = id => ok(editor.read({kind:'node',stamp:editor.capture(),node:id})).node;
    const canonical = async target => {
      const value=ok(await completed(target.submit({kind:'snapshot',stamp:target.capture(),max_bytes:8192})));
      ok(await completed(target.submit({kind:'release_snapshot',handle:value.handle})));
      return value.canonical_json;
    };
    const checkpoint = async () => {
      const bytes = await canonical(editor), browser = document.getSelection();
      const active = document.activeElement;
      return {canonical:bytes,state:structuredClone(state()),selected:browser.toString(),
        offsets:[browser.anchorOffset,browser.focusOffset],focus:active===element?'editor':active===button?'dialog':'outside',
        domLink:element.querySelector('a')?.getAttribute('href') ?? null,pending:editor.resources().hostRequests.pending};
    };
    try {
      if ((await editor.ready).status!=='ready') throw Error('Mounted KWDJ failed to open');
      const leaf = read(read(state().root).children[0]).children[0];
      const point = offset => ({kind:'text',node:leaf,offset,affinity:'after'});
      element.focus();
      await submit({kind:'set_selection',selection:{anchor:point(4),focus:point(0)}});
      const before = await checkpoint(), events = [];
      const unsubscribe = editor.subscribe(event=>events.push(event.change.kind));
      const observed = [];
      const start = (request,reply) => {
        const run = profile.runKwdjLinkDialog(editor.hostRequests,{request,focusScope:scope,services:{
          editLink(input,{signal}) { observed.push({input,signal});button.focus();return reply(); },
        }});
        if (run.status!=='started') throw Error(JSON.stringify(run));
        return run;
      };
      const run = async (request,reply) => {
        const value = await start(request,async()=>reply).completion;
        if(value.status!=='submitted')return {outcome:value,focus:null};
        return {outcome:{status:value.status,response:await completed(value.submission)},focus:await value.focus};
      };
      const set = (href,title) => ({status:'ok',value:{kind:'set',link:title===undefined?{href}:{href,title}}});
      const create = {kind:'create'};
      if(scenario==='success') {
        const original = '/guide?view=short#toc', changed = 'https://example.test/docs?lang=ru#intro';
        const add = await run(create,set(original));
        const created = await checkpoint();
        const edit = {kind:'edit',current:{href:original}};
        const change = await run(edit,set(changed,'First\r\nsecond'));
        const edited = await checkpoint();
        const reopenedElement = document.body.appendChild(document.createElement('div'));
        const reopened = mount(reopenedElement,edited.canonical);
        let reopenedBytes;
        try {
          if((await reopened.ready).status!=='ready')throw Error('Link document failed to reopen');
          reopenedBytes=await canonical(reopened);
        } finally {reopened.destroy();reopenedElement.remove();}
        const remove = await run({kind:'edit',current:{href:changed,title:'First\nsecond'}},{status:'ok',value:{kind:'remove'}});
        const removed = await checkpoint();
        await submit({kind:'history',direction:'undo'});
        const undone = await checkpoint();
        unsubscribe();
        return {before,add,change,remove,created,edited,removed,undone,reopenedBytes,events,
          seen:observed.map(({input,signal})=>({input,aborted:signal.aborted})),original,changed,
          expectedCreate:schema([para([text('Docs',[link(original)]),text(' suffix')])]),
          expectedEdit:schema([para([text('Docs',[link(changed,'First\nsecond')]),text(' suffix')])])};
      }
      if(scenario==='refusal') {
        const cancel = await run(create,{status:'cancelled'});
        const afterCancel = await checkpoint();
        const invalid = await run(create,set('/a/../b'));
        const afterInvalid = await checkpoint();
        const gate = await run(create,set('javascript:void(0)'));
        const afterGate = await checkpoint();
        const outside = await start(create,async()=>{other.focus();return set('/a/../b');}).completion;
        const afterOutside = await checkpoint();
        unsubscribe();
        return {before,cancel,afterCancel,invalid,afterInvalid,gate,afterGate,afterOutside,outside:await outside.focus,events};
      }
      if(scenario==='reentrant') {
        let publication;
        onRefusal = failure => {
          if(failure.diagnostic.code!=='dom.command_unsupported') return;
          onRefusal=undefined;
          publication=editor.submit({kind:'command',stamp:editor.capture(),
            command:kwdj.kwdjCommand({kind:'insert_text',text:'Foreign'}),history_hint:{kind:'isolated'}});
        };
        const refusal = await run(create,set('javascript:void(0)'));
        const after = await checkpoint();
        unsubscribe();
        return {refusal,after,events,publication:await completed(publication)};
      }
      let finish;
      const pending = start(create,()=>new Promise(resolve=>{finish=resolve;}));
      const moved={anchor:point(6),focus:point(6)};
      await submit({kind:'set_selection',selection:moved});
      other.focus();
      const whenMoved = await checkpoint();
      finish(set('/ignored'));
      const retired = await pending.completion;
      await Promise.resolve();await Promise.resolve();
      const after = await checkpoint();
      unsubscribe();
      return {before,whenMoved,after,retired:retired.status,aborted:observed[0].signal.aborted,events};
    } finally {
      editor.destroy();element.remove();scope.remove();other.remove();
      if(JSON.parse(module.resourceCounts()).sessions!==0)throw Error('Actual WASM Session was not released');
    }
  },scenario);
  await test.info().attach('link-host-checkpoints',{contentType:'application/json',body:JSON.stringify({scenario,errors,external,result},null,2)});
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  return result;
}

test('OSR-155 link host creates, edits and removes the actual selected link with exact reopen and Undo', async ({page}) => {
  const r=await run(page,'success');
  expect(r.created.canonical).toBe(r.expectedCreate);
  expect(r.edited.canonical).toBe(r.expectedEdit);
  expect(r.reopenedBytes).toBe(r.expectedEdit);
  expect(r.removed.canonical).toBe(r.before.canonical);
  expect(r.undone.canonical).toBe(r.expectedEdit);
  expect([r.created.domLink,r.edited.domLink,r.removed.domLink]).toEqual([r.original,r.changed,null]);
  for(const step of [r.add,r.change,r.remove]){
    expect(step.outcome.response.status).toBe('ok');
    expect(step.outcome.response.value.effect).toBe('changed');
    expect(step.focus.status).toBe('restored');
  }
  for(const [index,row] of [r.created,r.edited,r.removed].entries()){
    expect(row.state.stamp.revision).toBe(String(index+1));
    expect(row.state.history.undo_entries).toBe(String(index+1));
    expect(row.focus).toBe('editor');expect(row.selected).toBe('Docs');expect(row.pending).toBe(0);
  }
  expect(r.seen).toEqual([{input:{kind:'create'},aborted:false},{input:{kind:'edit',current:{href:r.original}},aborted:false},
    {input:{kind:'edit',current:{href:r.changed,title:'First\nsecond'}},aborted:false}]);
  expect(r.events.filter(kind=>kind==='document')).toHaveLength(4);
});

test('OSR-155 link host restores directed focus after native URL refusal, presentation refusal or cancel', async ({page}) => {
  const r=await run(page,'refusal');
  expect(r.cancel.outcome.status).toBe('cancelled');
  expect(r.invalid.outcome.response.diagnostic.code).toBe('kwdj.unsafe_url');
  expect(r.invalid.focus.status).toBe('restored');
  expect(r.gate.outcome.status).toBe('dom_refused');
  expect(r.gate.outcome.diagnostic.code).toBe('dom.command_unsupported');
  for(const row of [r.afterCancel,r.afterInvalid,r.afterGate])expect(row).toEqual(r.before);
  expect(r.afterOutside.canonical).toBe(r.before.canonical);
  expect(r.afterOutside.state).toEqual(r.before.state);
  expect(r.afterOutside.focus).toBe('outside');
  expect(r.outside.status).toBe('not_restored');
  expect(r.events).toEqual([]);
});

test('OSR-155 late host dialog completion cannot retarget current selection or steal focus', async ({page}) => {
  const r=await run(page,'retargeted');
  expect(r.retired).toBe('retired');expect(r.aborted).toBe(true);
  expect(r.after).toEqual(r.whenMoved);
  expect(r.after.canonical).toBe(r.before.canonical);
  expect(r.after.focus).toBe('outside');expect(r.after.pending).toBe(0);
  expect(r.after.state.selection.focus.offset).toBe(6);
  expect(r.events.filter(kind=>kind==='document')).toEqual([]);
});

test('OSR-155 a synchronous foreign publication while reporting refusal cannot restore the old focus', async ({page}) => {
  const r=await run(page,'reentrant');
  expect(r.refusal.outcome.diagnostic.code).toBe('dom.command_unsupported');
  expect(r.publication.status).toBe('ok');
  expect(r.after.state.stamp.revision).toBe('1');
  expect(r.after.canonical).toContain('Foreign suffix');
  expect(r.after.focus).toBe('dialog');expect(r.after.pending).toBe(0);
  expect(r.events.filter(kind=>kind==='document')).toHaveLength(1);
});
