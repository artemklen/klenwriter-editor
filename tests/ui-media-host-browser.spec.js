// SPDX-License-Identifier: MIT OR Apache-2.0
import { expect, test } from '@playwright/test';

async function run(page, scenario) {
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  const expectedOrigin=new URL(test.info().project.use.baseURL).origin;
  page.on('request', request => {
    if (new URL(request.url()).origin !== expectedOrigin) external.push(request.url());
  });
  await page.goto('/ui');
  const outcome = await page.evaluate(async scenario => {
    const [sdk, dom, kwdjDom, kwdj, packet] = await Promise.all([
      import('@klenwriter/editor-sdk'), import('@klenwriter/editor-dom'),
      import('@klenwriter/editor-kwdj/dom'), import('/packages/kwdj/index.js'),
      fetch('/extensions-packet.json').then(response => response.json()),
    ]);
    const model = await sdk.loadSdkV2();
    const originalId = '41111111-1111-4111-8111-111111111111';
    const pickedId = 'a2222222-2222-4222-8222-222222222222';
    const para = text => ({content:[{text,type:'text'}],type:'paragraph'});
    const source = content => JSON.stringify({content,profile:'prose',schema:'klenwriter.document',schema_version:1});
    const left = para('Before'), caption = para('Caption'), right = para('After');
    const initialMedia = {attrs:{align:'wide',alt:'Original',media_asset_id:originalId}, content:[caption],type:'media_image'};
    const initial = source([left,initialMedia,right]);
    const options = {abi:'editor-sdk/2',build_id:model.manifest.build_id,profile:packet.kwdjProfile,
      admission:'validate',access:'editable',registry_json:packet.kwdjRegistryJson,
      profile_options_json:JSON.stringify({identities:{media:[originalId,pickedId].map(id=>({id,status:'exists'})),references:[]},limits:null})};
    const element=document.createElement('div'), scope=document.createElement('div');
    const done=document.createElement('button'), external=document.createElement('button');
    done.textContent='Picker'; external.textContent='Other control'; scope.append(done);
    document.body.append(element,scope,external);
    const editor=dom.mountEditor({element,editor:{input:new TextEncoder().encode(initial),options,loader:async()=>model},renderers:kwdjDom.kwdjBasicRenderers});
    const ok=reply=>{if(reply.status!=='ok')throw Error(JSON.stringify(reply));return reply.value;};
    const submit=async request=>{
      const result=editor.submit(request.kind==='release_snapshot'?request:{stamp:editor.capture(),...request});
      return ok(result.status==='queued'?await result.completion:result.response);
    };
    const state=()=>ok(editor.read({kind:'state'})).state;
    const read=id=>ok(editor.read({kind:'node',stamp:editor.capture(),node:id})).node;
    const canonical=async()=>{
      const value=await submit({kind:'snapshot',max_bytes:8192});
      await submit({kind:'release_snapshot',handle:value.handle});
      return value.canonical_json;
    };
    const checkpoint=async()=>{
      const selection=window.getSelection();
      return {canonical:await canonical(),state:structuredClone(state()),focus:document.activeElement===element?'editor':document.activeElement===done?'picker':'outside',
        ownedDomCaret:element.contains(selection.focusNode)&&selection.isCollapsed,domCaretText:selection.focusNode?.textContent,domCaretOffset:selection.focusOffset,
        pending:editor.resources().hostRequests.pending};
    };
    const getValues=media=>({id:media.id,caption:media.children,attrs:media.attributes});
    try {
      if((await editor.ready).status!=='ready')throw Error('Mounted KWDJ failed to open');
      const root=read(state().root), original=read(root.children[1]), originalValues=getValues(original);
      const point={kind:'text',node:read(root.children[0]).children[0],offset:2,affinity:'after'};
      const putCaret=async()=>{element.focus();await submit({kind:'set_selection',selection:{anchor:point,focus:point}});};
      await putCaret();
      const before=await checkpoint();
      const events=[]; const unobserve=editor.subscribe(event=>events.push(event.change.kind));
      const start=(target,services)=>{
        const started=kwdjDom.runKwdjMediaPicker(editor.hostRequests,{target,services,focusScope:scope});
        if(started.status!=='started')throw Error(JSON.stringify(started));
        return started;
      };
      const choice={status:'ok',value:{assetId:pickedId}}, available={status:'ok',value:{assetId:pickedId,alt:'New alt\r\nline'}};
      if(scenario==='success'){
        const trace=[]; let pickerSignal;
        const services={pickMedia:async(request,{signal})=>{
          trace.push({picker:request});pickerSignal=signal;done.focus();return choice;
        },mediaMetadata:async(request,{signal})=>{
          trace.push({metadata:request,sameSignal:pickerSignal===signal,aborted:signal.aborted});return available;
        }};
        const first=await start({kind:'insert'},services).completion;
        if(first.status!=='submitted'||first.submission.response?.status!=='ok')throw Error(JSON.stringify(first));
        const firstFocus=await first.focus;
        const inserted=await checkpoint();
        const insertedMedia=read(read(state().root).children[1]);
        const placeholderName=element.querySelector('.editor-media-placeholder')?.getAttribute('aria-label');
        const expectedInsert=source([para('Be'),{attrs:{align:'none',alt:'New alt\nline',media_asset_id:pickedId},type:'media_image'},para('fore'),initialMedia,right]);
        const opened=dom.mountEditor({element:document.body.appendChild(document.createElement('div')),editor:{input:new TextEncoder().encode(inserted.canonical),options,loader:async()=>model},renderers:kwdjDom.kwdjBasicRenderers});
        let reopened;
        try {
          const openReady=await opened.ready;
          const snap=ok(opened.submit({kind:'snapshot',stamp:opened.capture(),max_bytes:8192}).response);
          reopened={ready:openReady.status,canonical:snap.canonical_json};
          ok(opened.submit({kind:'release_snapshot',handle:snap.handle}).response);
        } finally {opened.destroy();}
        await submit({kind:'history',direction:'undo'});
        const undone=await checkpoint();
        const second=await start({kind:'replace',node:original.id,assetId:originalId},services).completion;
        if(second.status!=='submitted'||second.submission.response?.status!=='ok')throw Error(JSON.stringify(second));
        const secondFocus=await second.focus, replaced=await checkpoint();
        const replacedMedia=read(read(state().root).children[1]);
        const expectedReplace=source([left,{...initialMedia,attrs:{align:'wide',alt:'New alt\nline',media_asset_id:pickedId}},right]);
        await submit({kind:'history',direction:'undo'});
        const replacementUndo=await checkpoint();
        unobserve();
        return {before,firstFocus,inserted,insertedMedia:getValues(insertedMedia),expectedInsert,reopened,undone,secondFocus,replaced,
          replacedMedia:getValues(replacedMedia),expectedReplace,replacementUndo,trace,events,originalValues,pickedId,originalId,placeholderName};
      }
      if(scenario==='dismissals'){
        const results=[];
        for(const mode of ['picker_cancel','picker_unavailable','picker_reject','metadata_cancel','metadata_unavailable','metadata_reject','mismatched_id','invalid_accessibility','explicit_cancel','outside_focus']){
          let pickerSignal, metadataCalls=0, resolvePicker;
          const services={pickMedia:async(_request,{signal})=>{
            pickerSignal=signal;done.focus();
            if(mode==='picker_cancel')return {status:'cancelled'};
            if(mode==='picker_unavailable')return {status:'unavailable'};
            if(mode==='picker_reject')throw Error('Picker unavailable');
            if(mode==='explicit_cancel')return new Promise(resolve=>{resolvePicker=resolve;});
            return choice;
          },mediaMetadata:async()=>{
            metadataCalls++;
            if(mode==='metadata_cancel'||mode==='outside_focus'){
              if(mode==='outside_focus')external.focus();
              return {status:'cancelled'};
            }
            if(mode==='metadata_unavailable')return {status:'unavailable'};
            if(mode==='metadata_reject')throw Error('Metadata unavailable');
            if(mode==='mismatched_id')return {status:'ok',value:{assetId:originalId,alt:'Wrong image'}};
            return {status:'ok',value:{assetId:pickedId,alt:'Name',decorative:true}};
          }};
          const pending=start({kind:'insert'},services);
          if(mode==='explicit_cancel'){
            if(!pending.cancel()||pending.cancel())throw Error('Host cancel was not consumed exactly once');
          }
          const outcome=await pending.completion;
          resolvePicker?.(choice);
          await Promise.resolve(); await Promise.resolve();
          results.push({mode,status:outcome.status,aborted:pickerSignal.aborted,metadataCalls,after:await checkpoint()});
        }
        unobserve();return {before,results,events};
      }
      let pickerSignal,resolvePicker,metadataCalls=0;
      const pending=start({kind:'replace',node:original.id,assetId:originalId},{
        pickMedia:(_input,{signal})=>{pickerSignal=signal;done.focus();return new Promise(resolve=>{resolvePicker=resolve;});},
        mediaMetadata:async()=>{metadataCalls++;return available;},
      });
      await submit({kind:'command',command:kwdj.kwdjCommand({kind:'remove',node:original.id}),history_hint:{kind:'isolated'}});
      const whenDeleted=await checkpoint();
      external.focus();
      resolvePicker(choice);
      const retired=await pending.completion;
      await Promise.resolve(); await Promise.resolve();
      const after=await checkpoint();
      unobserve();
      return {before,whenDeleted,after,retired:retired.status,aborted:pickerSignal.aborted,metadataCalls,events,expected:source([left,right])};
    } finally {
      editor.destroy();element.remove();scope.remove();external.remove();
      if(JSON.parse(model.resourceCounts()).sessions!==0)throw Error('Actual WASM Session was not released');
    }
  },scenario);
  await test.info().attach('media-host-checkpoints',{contentType:'application/json',body:JSON.stringify({scenario,errors,external,outcome},null,2)});
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  return outcome;
}

test('OSR-154 media host success inserts, reopens and replaces through one command per request', async ({page}) => {
  const r=await run(page,'success');
  expect(r.firstFocus.status).toBe('restored');
  expect(r.secondFocus.status).toBe('restored');
  for(const row of [r.inserted,r.replaced]){
    expect(row.canonical).toBe(row===r.inserted?r.expectedInsert:r.expectedReplace);
    expect(row.state.history.undo_entries).toBe('1');
    expect(row.focus).toBe('editor');expect(row.ownedDomCaret).toBe(true);expect(row.pending).toBe(0);
  }
  expect(r.reopened).toEqual({ready:'ready',canonical:r.expectedInsert});
  expect(r.insertedMedia.attrs.media_asset_id.value).toBe(r.pickedId);
  expect(r.placeholderName).toBe('New alt\nline');
  expect(r.replacedMedia.attrs.media_asset_id.value).toBe(r.pickedId);
  expect(r.replacedMedia.id).toBe(r.originalValues.id);
  expect(r.replacedMedia.caption).toEqual(r.originalValues.caption);
  expect(r.undone.canonical).toBe(r.before.canonical);
  expect(r.replacementUndo.canonical).toBe(r.before.canonical);
  expect(r.trace).toEqual([{picker:{kind:'insert'}},{metadata:{assetId:r.pickedId},sameSignal:true,aborted:false},
    {picker:{kind:'replace',assetId:r.originalId}},{metadata:{assetId:r.pickedId},sameSignal:true,aborted:false}]);
  expect(r.events.filter(kind=>kind==='document')).toHaveLength(4);
});

test('OSR-154 media host dismissals restore only valid scoped focus without changing the document', async ({page}) => {
  const {before,results,events}=await run(page,'dismissals');
  expect(results.map(row=>row.status)).toEqual(['cancelled','unavailable','failed','cancelled','unavailable','failed','failed','failed','cancelled','cancelled']);
  expect(results.map(row=>row.metadataCalls)).toEqual([0,0,0,1,1,1,1,1,0,1]);
  for(const row of results){
    expect(row.aborted).toBe(true);expect(row.after.pending).toBe(0);
    expect(row.after.state).toEqual(before.state);expect(row.after.canonical).toBe(before.canonical);
    if(row.mode==='outside_focus')expect(row.after.focus).toBe('outside');
    else {
      expect(row.after.focus).toBe('editor');expect(row.after.ownedDomCaret).toBe(true);
      expect(row.after.domCaretText).toBe(before.domCaretText);expect(row.after.domCaretOffset).toBe(before.domCaretOffset);
    }
  }
  expect(events.filter(kind=>kind==='document')).toEqual([]);
});

test('OSR-154 media host drops a picker reply after its target block is deleted', async ({page}) => {
  const r=await run(page,'deleted');
  expect(r.retired).toBe('retired');expect(r.aborted).toBe(true);expect(r.metadataCalls).toBe(0);
  expect(r.whenDeleted.canonical).toBe(r.expected);expect(r.after.canonical).toBe(r.expected);
  expect(r.whenDeleted.state).toEqual(r.after.state);expect(r.after.focus).toBe('outside');expect(r.after.pending).toBe(0);
  expect(r.events.filter(kind=>kind==='document')).toHaveLength(1);
});
