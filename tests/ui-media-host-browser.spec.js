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
    const galleryId = 'b3333333-3333-4333-8333-333333333333';
    const para = text => ({content:[{text,type:'text'}],type:'paragraph'});
    const profile = scenario === 'rich-poetry' ? 'poetry' : 'prose';
    const richGallery = scenario === 'rich-prose' || scenario === 'rich-poetry';
    const source = content => JSON.stringify({content,profile,schema:'klenwriter.document',schema_version:1});
    const left = profile === 'poetry' ? {content:[
      {attrs:{indent:3},content:[{text:'First verse line',type:'text'}],type:'verse_line'},
      {attrs:{blank_lines:2},type:'stanza_break'},
      {content:[{text:'Second verse line',type:'text'}],type:'verse_line'},
    ],type:'verse'} : para('Before');
    const caption = para('Caption'), right = para('After');
    const initialMedia = {attrs:{align:'wide',alt:'Original',media_asset_id:originalId}, content:[caption],type:'media_image'};
    const initial = source([left,initialMedia,right]);
    const liveFacts = scenario === 'live-facts' || richGallery;
    const options = {abi:'editor-sdk/2',build_id:model.manifest.build_id,profile:packet.kwdjProfile,
      admission:'validate',access:'editable',registry_json:packet.kwdjRegistryJson,
      profile_options_json:JSON.stringify({identities:{media:(liveFacts?[originalId]:[originalId,pickedId]).map(id=>({id,status:'exists'})),references:[]},limits:null})};
    const element=document.createElement('div'), scope=document.createElement('div');
    const done=document.createElement('button'), external=document.createElement('button');
    done.textContent='Picker'; external.textContent='Other control'; scope.append(done);
    document.body.append(element,scope,external);
    let approval = null;
    const authorizeMediaIdentity = ({assetId}, {signal}) => {
      const allowed = approval?.assetId === assetId && approval.signal === signal && !signal.aborted;
      approval = null;
      return allowed;
    };
    const editor=dom.mountEditor({element,editor:{input:new TextEncoder().encode(initial),options,loader:async()=>model},renderers:kwdjDom.kwdjBasicRenderers,
      ...(liveFacts?{authorizeMediaIdentity}:{})});
    const ok=reply=>{if(reply.status!=='ok')throw Error(JSON.stringify(reply));return reply.value;};
    const submit=async request=>{
      const result=editor.submit(request.kind==='release_snapshot'?request:{stamp:editor.capture(),...request});
      return ok(result.status==='queued'?await result.completion:result.response);
    };
    const state=()=>ok(editor.read({kind:'state'})).state;
    const read=id=>ok(editor.read({kind:'node',stamp:editor.capture(),node:id})).node;
    const canonical=async()=>{
      const value=await submit({kind:'snapshot',max_bytes:richGallery ? 32768 : 8192});
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
      const firstBlock=read(root.children[0]);
      const firstTextBlock=profile==='poetry'?read(firstBlock.children[0]):firstBlock;
      const point={kind:'text',node:firstTextBlock.children[0],offset:2,affinity:'after'};
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
      if (richGallery) {
        const longCaption = `Primary caption: ${'x'.repeat(8193)}`;
        const allowedMedia = new Map([
          [pickedId, {assetId:pickedId, alt:'Manuscript', align:'wide', caption:longCaption}],
          [galleryId, {assetId:galleryId, decorative:true, align:'center', caption:'Gallery caption'}],
        ]);
        const insertAfter = async (node, assetId) => {
          const pending = start({kind:'insert', placement:{kind:'after_root_block',node}}, {
            pickMedia:async()=>{done.focus();return {status:'ok',value:{assetId}};},
            mediaMetadata:async({assetId},{signal})=>{
              const value = allowedMedia.get(assetId);
              if (!value) return {status:'unavailable'};
              approval = {assetId,signal};
              return {status:'ok',value};
            },
          });
          const result = await pending.completion;
          if (result.status !== 'submitted') throw Error(JSON.stringify(result));
          const receipt = result.submission.status === 'completed' ? result.submission.response : await result.submission.completion;
          ok(receipt);
          const focus = await result.focus;
          const selection = window.getSelection();
          return {
            ...await checkpoint(),
            focusResult:focus.status,
            domCaretOnRoot:selection.anchorNode===element && selection.focusNode===element,
            rootChildren:read(state().root).children,
            eventCount:events.length,
          };
        };
        const inserted = await insertAfter(firstBlock.id, pickedId);
        const gallery = await insertAfter(inserted.rootChildren[1], galleryId);
        unobserve();
        const firstImage = {attrs:{align:'wide',alt:'Manuscript',media_asset_id:pickedId},
          content:[para(longCaption)],type:'media_image'};
        const secondImage = {attrs:{align:'center',decorative:true,media_asset_id:galleryId},
          content:[para('Gallery caption')],type:'media_image'};
        return {inserted,gallery,root,events,expectedInsert:source([left,firstImage,initialMedia,right]),
          expectedGallery:source([left,firstImage,secondImage,initialMedia,right])};
      }
      if (liveFacts) {
        await submit({kind:'command',command:kwdj.kwdjCommand({kind:'insert_text',text:'X'}),history_hint:{kind:'isolated'}});
        events.length=0;
        const held=await submit({kind:'snapshot',max_bytes:8192});
        const originalStamp=editor.capture(), originalContext=editor.context();
        const pending=start({kind:'insert'}, {
          pickMedia:async()=>{done.focus();return choice;},
          mediaMetadata:async({assetId},{signal})=>{approval={assetId,signal};return available;},
        });
        const result=await pending.completion;
        if(result.status!=='submitted'||result.submission.response?.status!=='ok')throw Error(JSON.stringify(result));
        const focus=await result.focus;
        const inserted=await checkpoint();
        const sameContext=JSON.stringify(originalContext)===JSON.stringify(editor.context());
        const heldCount=editor.nativeResources().snapshot_handles;
        await submit({kind:'release_snapshot',handle:held.handle});
        const releasedCount=editor.nativeResources().snapshot_handles;
        await submit({kind:'history',direction:'undo'});
        const undone=await canonical();
        await submit({kind:'history',direction:'redo'});
        const redone=await canonical();
        const replaced=await editor.replace(new TextEncoder().encode(redone));
        const afterReplace=await canonical();
        unobserve();
        return {focus,originalStamp,inserted,sameContext,heldCount,releasedCount,undone,redone,afterReplace,
          prior:held.canonical_json,replaced,events,hostRequests:editor.resources().hostRequests.pending,
          expected:source([para('BeX'),{attrs:{align:'none',alt:'New alt\nline',media_asset_id:pickedId},type:'media_image'},para('fore'),initialMedia,right])};
      }
      if(scenario==='resolve-cancel'||scenario==='resolve-remove'){
        let resolvePicker,metadataCalls=0,pickerSignal;
        const pending=start({kind:'replace',node:original.id,assetId:originalId},{
          pickMedia:(_request,{signal})=>{
            pickerSignal=signal;done.focus();
            return new Promise(resolve=>{resolvePicker=resolve;});
          },
          mediaMetadata:()=>{
            metadataCalls++;
            return Promise.resolve(available);
          },
        });
        // Resolve and revoke in one JS turn so the picker reaction runs before the deferred abort.
        resolvePicker(choice);
        const cancelled=scenario==='resolve-cancel';
        if(cancelled){if(!pending.cancel())throw Error('Cancellation did not consume the live request');}
        else await submit({kind:'command',command:kwdj.kwdjCommand({kind:'remove',node:original.id}),history_hint:{kind:'isolated'}});
        const result=await pending.completion;
        await Promise.resolve();
        unobserve();
        return {before,after:await checkpoint(),status:result.status,metadataCalls,
          aborted:pickerSignal.aborted,events,expected:cancelled?initial:source([left,right])};
      }
      if(scenario==='unresolved-identity'){
        const unknown='c3333333-3333-4333-8333-333333333333';
        const pending=start({kind:'insert'},{
          pickMedia:async()=>{done.focus();return {status:'ok',value:{assetId:unknown}};},
          mediaMetadata:async()=>({status:'ok',value:{assetId:unknown,alt:'An image no longer available'}}),
        });
        const result=await pending.completion;
        const response=result.status==='submitted'?(result.submission.status==='completed'
          ?result.submission.response:await result.submission.completion):null;
        const focus=result.status==='submitted'?await result.focus:null;
        unobserve();
        return {before,after:await checkpoint(),status:result.status,response,focus,events};
      }
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

test('a verified late media identity preserves pre-existing history and snapshot handles and admits replace preflight', async ({page}) => {
  const result=await run(page,'live-facts');
  expect(result.focus.status).toBe('restored');
  expect(result.inserted.canonical).toBe(result.expected);
  expect(result.inserted.state.stamp.session).toBe(result.originalStamp.session);
  expect(result.inserted.state.stamp.generation).toBe(result.originalStamp.generation);
  expect(result.inserted.state.stamp.revision).toBe('2');
  expect(result.inserted.state.history.undo_entries).toBe('2');
  expect(result.sameContext).toBe(true);
  expect(result.heldCount).toBe(1);
  expect(result.releasedCount).toBe(0);
  expect(result.undone).toBe(result.prior);
  expect(result.redone).toBe(result.expected);
  expect(result.replaced.response.status).toBe('ok');
  expect(result.afterReplace).toBe(result.expected);
  expect(result.events).toEqual(['document','document','document']);
  expect(result.hostRequests).toBe(0);
});

for (const profile of ['prose','poetry']) {
  test(`OSR-292 inserts rich media after the whole ${profile} block and continues the gallery from the restored caret`, async ({page}) => {
    const {inserted,gallery,root,events,expectedInsert,expectedGallery}=await run(page,`rich-${profile}`);
    expect(inserted.canonical).toBe(expectedInsert);
    expect(gallery.canonical).toBe(expectedGallery);
    expect(inserted.rootChildren[0]).toBe(root.children[0]);
    expect(gallery.rootChildren.slice(0,2)).toEqual(inserted.rootChildren.slice(0,2));
    const expectCaret = (checkpoint, index, commands) => {
      const gap = {kind:'child',parent:root.id,index,affinity:'after'};
      expect(checkpoint.state.selection).toEqual({anchor:gap,focus:gap});
      expect(checkpoint).toMatchObject({focus:'editor',focusResult:'restored',ownedDomCaret:true,
        domCaretOnRoot:true,domCaretOffset:index,eventCount:commands,pending:0});
      expect(checkpoint.state.history.undo_entries).toBe(String(commands));
    };
    expectCaret(inserted, 2, 1);
    expectCaret(gallery, 3, 2);
    expect(events).toEqual(['document','document']);
  });
}

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

for (const [scenario,name,status,documentEvents] of [
  ['resolve-cancel','cancellation','cancelled',0],
  ['resolve-remove','target removal','retired',1],
]) {
  test('OSR-154 media host skips metadata after same-turn '+name,async({page})=>{
    const out=await run(page,scenario);
    expect(out.after.canonical).toBe(out.expected);
    expect(out.after.pending).toBe(0);
    expect(out.aborted).toBe(true);
    expect(out.status).toBe(status);
    expect(out.metadataCalls).toBe(0);
    expect(out.events.filter(kind=>kind==='document')).toHaveLength(documentEvents);
  });
}

test('OSR-154 media host restores the owned caret after native identity refusal',async({page})=>{
  const out=await run(page,'unresolved-identity');
  expect(out.response).toMatchObject({status:'refused',diagnostic:{
    code:'kwdj.identity_resolution_failed',path:'/content/1/attrs/media_asset_id',may_have_committed:false,
  }});
  expect(out.after.canonical).toBe(out.before.canonical);
  expect(out.after.state).toEqual(out.before.state);
  expect(out.after.pending).toBe(0);
  expect(out.events.filter(kind=>kind==='document')).toEqual([]);
  expect(out.focus).toEqual({status:'restored',failure:null});
  expect(out.after).toMatchObject({focus:'editor',ownedDomCaret:true,
    domCaretText:out.before.domCaretText,domCaretOffset:out.before.domCaretOffset});
});
