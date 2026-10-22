// SPDX-License-Identifier: MIT OR Apache-2.0
/** Optional concrete clipboard codec. Native read/query/dispatch/freshness remain with the mounted owner. */
import {createCommand} from '@klenwriter/editor-sdk';
import type {ClipboardCodec,ClipboardDecodeOutcome} from '@klenwriter/editor-dom';
import {decodeClipboard} from './clipboard-decode.js';
import {serializeClipboardHtml} from './clipboard-html.js';
import type {ClipboardProfileBinding,ClipboardUrlPolicy} from './clipboard-types.js';
export {decodeClipboard,isSafeClipboardUrl,clipboardDecodeLimits} from './clipboard-decode.js';
export type * from './clipboard-types.js';
const CONTEXT='org.klenwriter.kwdj/clipboard-context/1',FRAGMENT='org.klenwriter.kwdj/clipboard-fragment/1';
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:unknown,names:readonly string[]):v is Record<string,unknown>=>object(v)&&Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));
const refuse=(code='clipboard.invalid_input'):ClipboardDecodeOutcome=>Object.freeze({status:'refused',diagnostics:Object.freeze([code])});
function profile(value:unknown):ClipboardProfileBinding|null {
  if(!object(value)||!object(value.profile))return null;const p=value.profile;
  if(p.profile_id!=='org.klenwriter.kwdj'||p.profile_version!=='1.0.0'||p.codec_id!=='org.klenwriter.kwdj/json'||p.wire_version!==1)return null;
  return Object.freeze({profile_id:p.profile_id,profile_version:p.profile_version,codec_id:p.codec_id,wire_version:p.wire_version});
}
function ownPolicy(value:ClipboardUrlPolicy):ClipboardUrlPolicy {
  // Closed configuration is validated without importing the lazy parser or invoking host callbacks.
  if(!object(value)||Object.keys(value).some(k=>!['allow_origin_relative','allowed_schemes','allowed_origins'].includes(k))
    ||typeof value.allow_origin_relative!=='boolean'||!Array.isArray(value.allowed_schemes)||value.allowed_schemes.length>2
    ||value.allowed_schemes.some(s=>s!=='http'&&s!=='https')||new Set(value.allowed_schemes).size!==value.allowed_schemes.length)throw TypeError('clipboard.invalid_url_policy');
  if(value.allowed_origins!==undefined){if(!Array.isArray(value.allowed_origins)||value.allowed_origins.length>32)throw TypeError('clipboard.invalid_url_policy');
    for(const origin of value.allowed_origins){if(typeof origin!=='string'||origin.length>2048)throw TypeError('clipboard.invalid_url_policy');const u=new URL(origin);if(u.origin!==origin||!['http:','https:'].includes(u.protocol))throw TypeError('clipboard.invalid_url_policy');}}
  return Object.freeze({allow_origin_relative:value.allow_origin_relative,allowed_schemes:Object.freeze([...value.allowed_schemes]),
    ...(value.allowed_origins===undefined?{}:{allowed_origins:Object.freeze([...value.allowed_origins])})});
}
export function kwdjClipboardCodec(urlPolicy:ClipboardUrlPolicy):ClipboardCodec {
  const policy=ownPolicy(urlPolicy);
  return Object.freeze({contextFormat:CONTEXT,fragmentFormat:FRAGMENT,
    async decode({capture,nativeContext,sessionContext}:Parameters<ClipboardCodec['decode']>[0]):Promise<ClipboardDecodeOutcome>{
      try {
        const binding=profile(sessionContext);if(!binding||nativeContext.formatId!==CONTEXT||typeof nativeContext.json!=='string'||nativeContext.json.length>4096)return refuse('clipboard.invalid_context');
        const context:unknown=JSON.parse(nativeContext.json);
        if(!closed(context,['mode','insertion_context','allowed_fragment_kinds'])||!['prose','poetry'].includes(context.mode as string)
          ||!['root','prose_block','verse'].includes(context.insertion_context as string)||!Array.isArray(context.allowed_fragment_kinds)||context.allowed_fragment_kinds.length>3
          ||!context.allowed_fragment_kinds.length||context.allowed_fragment_kinds.some(k=>k!=='inline'&&k!=='blocks')||new Set(context.allowed_fragment_kinds).size!==context.allowed_fragment_kinds.length)return refuse('clipboard.invalid_context');
        if(capture.format!=='clipboard-capture/1'||capture.metadata.status!=='complete')return refuse();
        if(capture.metadata.internalFragment!=='not_observed')return refuse('clipboard.unsupported_semantics');
        if(capture.status==='refused')return refuse(capture.reason==='no_selected_format'?'clipboard.empty_payload':'clipboard.invalid_input');
        const result=await decodeClipboard({source_profile:binding,mode:context.mode,insertion_context:context.insertion_context,media:capture.metadata.media,
          plain:{status:capture.representations['text/plain'].status,text:capture.representations['text/plain'].text},
          html:{status:capture.representations['text/html'].status,text:capture.representations['text/html'].text},url_policy:policy});
        if(result.status==='refused')return result;
        if(!context.allowed_fragment_kinds.includes(result.fragment.kind))return refuse('clipboard.invalid_context');
        const fragment_json=JSON.stringify(result.fragment);if(fragment_json.length>2097152)return refuse();
        const command=Object.freeze(createCommand('org.klenwriter.kwdj/command/insert-fragment',{kind:'insert_fragment',fragment_json}));
        return Object.freeze({status:'candidate',command,diagnostics:result.diagnostics});
      }catch{return refuse();}
    },
    encode({fragment,sessionContext}:Parameters<NonNullable<ClipboardCodec['encode']>>[0]){
      try{const binding=profile(sessionContext);if(!binding||fragment.formatId!==FRAGMENT)return Object.freeze({status:'refused' as const});
        const html=serializeClipboardHtml(fragment.json,binding,policy);return html===null?Object.freeze({status:'refused' as const}):Object.freeze({status:'encoded' as const,html});
      }catch{return Object.freeze({status:'refused' as const});}
    },
  });
}
