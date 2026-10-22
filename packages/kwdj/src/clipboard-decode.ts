// SPDX-License-Identifier: MIT OR Apache-2.0
/** Optional TS allowlist adapter: no live DOM, native execution, Markdown parser or admission claim. */
import {clipboardDiagnosticOrder} from './clipboard-types.js';
import type {ClipboardCandidateMark as Mark, ClipboardCandidateNode as Node, ClipboardDecodeInput as Input,
  ClipboardDecodeResult as Result, ClipboardDiagnostic as Diagnostic, ClipboardHtmlNode as Html,
  ClipboardUrlPolicy as Policy} from './clipboard-types.js';
export type * from './clipboard-types.js';
export const clipboardDecodeLimits = Object.freeze({sourceUtf16:524288,aggregateUtf16:1048576,nodes:8192,depth:128,attributes:16384});
const HTML_NS='http://www.w3.org/1999/xhtml';
const blocks=new Set(['h1','h2','h3','h4','h5','h6','p','blockquote','ul','ol','table']);
const wrappers=new Set(['div','section','article']);
const inlineWrappers=new Set(['span','font','u','abbr','time']);
const active=new Set(['script','iframe','object','embed','applet','form','input','button','textarea','select','base','link','meta','template']);
const unsupported=new Set(['ruby','rt','rp','math','svg','mi','mo','mn','mrow','annotation','semantics','foreign-object','video','audio','canvas','details','summary','dialog']);
const markTypes:Readonly<Record<string,string>>=Object.freeze({strong:'strong',b:'strong',em:'emphasis',i:'emphasis',s:'strike',del:'strike',strike:'strike',code:'code',sub:'subscript',sup:'superscript'});
const markOrder=['code','strong','emphasis','strike','subscript','superscript','link'];
class Limit extends Error {}
class Invalid extends Error {}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function scalar(value:string):boolean {
  for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=value.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}return true;
}
function text(value:unknown,max:number=clipboardDecodeLimits.sourceUtf16):value is string{return typeof value==='string'&&value.length<=max&&scalar(value);}
function keys(v:Record<string,unknown>,names:readonly string[]):boolean{return Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));}
function policyValid(v:unknown):v is Policy {
  if(!object(v)||typeof v.allow_origin_relative!=='boolean'||!Array.isArray(v.allowed_schemes)||v.allowed_schemes.length>2
    ||v.allowed_schemes.some(s=>s!=='http'&&s!=='https')||new Set(v.allowed_schemes).size!==v.allowed_schemes.length
    ||Object.keys(v).some(k=>!['allow_origin_relative','allowed_schemes','allowed_origins'].includes(k)))return false;
  if(v.allowed_origins!==undefined){if(!Array.isArray(v.allowed_origins)||v.allowed_origins.length>32)return false;
    for(const origin of v.allowed_origins){if(!text(origin,2048))return false;try{const u=new URL(origin);if(u.origin!==origin||!['http:','https:'].includes(u.protocol))return false;}catch{return false;}}}return true;
}
/** Own the small data-only input before the optional parser import yields. Accessors are not input data. */
function snapshotInput(value:unknown):unknown {
  const record=(v:unknown,names:readonly string[],optional:readonly string[]=[]):Record<string,unknown>=>{
    if(!object(v))throw new Invalid();const actual=Reflect.ownKeys(v);if(actual.length<names.length||actual.length>names.length+optional.length)throw new Invalid();
    const out:Record<string,unknown>={};for(const key of actual){if(typeof key!=='string'||!names.includes(key)&&!optional.includes(key))throw new Invalid();
      const descriptor=Object.getOwnPropertyDescriptor(v,key);if(!descriptor||!('value'in descriptor))throw new Invalid();out[key]=descriptor.value;}
    if(!names.every(key=>Object.hasOwn(out,key)))throw new Invalid();return out;
  };
  const array=(v:unknown,max:number):unknown[]=>{if(!Array.isArray(v)||v.length>max)throw new Invalid();const out:unknown[]=[];
    for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!('value'in d))throw new Invalid();out.push(d.value);}return out;};
  const out=record(value,['source_profile','mode','insertion_context','media','plain','html','url_policy']);
  out.source_profile=record(out.source_profile,['profile_id','profile_version','codec_id','wire_version']);
  out.plain=record(out.plain,['status','text']);out.html=record(out.html,['status','text']);
  const policy=record(out.url_policy,['allow_origin_relative','allowed_schemes'],['allowed_origins']);policy.allowed_schemes=array(policy.allowed_schemes,2);
  if(Object.hasOwn(policy,'allowed_origins'))policy.allowed_origins=array(policy.allowed_origins,32);out.url_policy=policy;return out;
}
function inputValid(v:unknown):v is Input {
  if(!object(v)||!keys(v,['source_profile','mode','insertion_context','media','plain','html','url_policy']))return false;
  const p=v.source_profile;
  if(!object(p)||!keys(p,['profile_id','profile_version','codec_id','wire_version'])||!text(p.profile_id,256)||p.profile_id.length===0
    ||!text(p.profile_version,256)||p.profile_version.length===0||!text(p.codec_id,256)||p.codec_id.length===0
    ||!Number.isSafeInteger(p.wire_version)||(p.wire_version as number)<0||(p.wire_version as number)>0xffff_ffff)return false;
  if(!['prose','poetry'].includes(v.mode as string)||!['root','prose_block','verse'].includes(v.insertion_context as string)
    ||!['present','not_observed','unknown'].includes(v.media as string)||!policyValid(v.url_policy))return false;
  let total=0;
  for(const value of[v.plain,v.html]){if(!object(value)||!keys(value,['status','text']))return false;
    if(value.status==='complete_local'){if(!text(value.text))return false;total+=value.text.length;}
    else if(!['unavailable','oversize_not_retained','unread_due_limit','read_failed'].includes(value.status as string)||value.text!==null)return false;
  }return total<=clipboardDecodeLimits.aggregateUtf16;
}
/** Deliberately conservative subset of Rust validate_url; preserve the original accepted URL bytes. */
export function isSafeClipboardUrl(value:string,policy:Policy):boolean {
  if(!text(value)||!policyValid(policy)||/[\u0000-\u0020\u007f-\u009f\\]/.test(value))return false;
  let path:string;
  if(value.startsWith('/')){if(!policy.allow_origin_relative||value.startsWith('//'))return false;path=value.split(/[?#]/,1)[0]!;}
  else {if(!/^https?:\/\//i.test(value))return false;let u:URL;try{u=new URL(value);}catch{return false;}
    if(!policy.allowed_schemes.includes(u.protocol.slice(0,-1) as 'http'|'https')||!u.hostname||u.username||u.password)return false;
    // A literal authority '@' also excludes an empty user-info field that URL normalizes away.
    const suffix=value.slice(value.indexOf('://')+3),end=suffix.search(/[/?#]/),authority=end<0?suffix:suffix.slice(0,end);
    if(authority.includes('@')||(policy.allowed_origins!==undefined&&!policy.allowed_origins.includes(u.origin)))return false;
    const match=/^[^:]+:\/\/[^/?#]*(\/[^?#]*)?/.exec(value);path=match?.[1]??'/';
  }
  return !path.split('/').some(segment=>{const dots=segment.replace(/%2e/gi,'.');return dots==='.'||dots==='..';});
}
const diagnostics=(codes:Iterable<Diagnostic>):readonly Diagnostic[]=>{const s=new Set(codes);return Object.freeze(clipboardDiagnosticOrder.filter(c=>s.has(c)));};
const fail=(...codes:Diagnostic[]):Result=>Object.freeze({status:'refused',diagnostics:diagnostics(codes)});
function freezeNode(node:Node):Node {if(node.attrs)Object.freeze(node.attrs);if(node.marks){for(const m of node.marks){if(m.attrs)Object.freeze(m.attrs);Object.freeze(m);}Object.freeze(node.marks);}if(node.content){for(const n of node.content)freezeNode(n);Object.freeze(node.content);}return Object.freeze(node);}
class Work {
  nodes=0;steps=0;
  node(type:string,fields:Omit<Node,'type'>={}):Node {if(++this.nodes>clipboardDecodeLimits.nodes)throw new Limit();return{type,...fields};}
  visit(depth:number):void {if(depth>clipboardDecodeLimits.depth||++this.steps>clipboardDecodeLimits.nodes*4)throw new Limit();}
}
const nonempty=(n:Html):boolean=>n.kind==='element'||n.kind==='text'&&n.value.trim().length!==0;
function plainBlocks(value:string,mode:Input['mode'],work:Work):Node[] {
  const normalized=value.replace(/\r\n?/g,'\n');
  // Stream bounded groups/lines; no source-sized split array before the output-node checks.
  const lines=(group:string,visit:(line:string,index:number)=>void):void=>{
    let start=0,index=0;for(;;){const end=group.indexOf('\n',start);visit(group.slice(start,end<0?group.length:end),index++);if(end<0)break;start=end+1;}
  };
  if(mode==='prose'){
    const out:Node[]=[],boundary=/\n{2,}/g;let start=0;
    const paragraph=(end:number):void=>{if(end===start)return;const content:Node[]=[];
      lines(normalized.slice(start,end),(line,i)=>{if(i)content.push(work.node('hard_break'));if(line)content.push(work.node('text',{text:line}));});
      out.push(work.node('paragraph',{content}));};
    for(let match;(match=boundary.exec(normalized))!==null;){paragraph(match.index);start=boundary.lastIndex;}
    paragraph(normalized.length);return out;
  }
  const content:Node[]=[];let blanks=0;
  lines(normalized,line=>{if(line.length===0){blanks++;return;}if(blanks&&content.length)content.push(work.node('stanza_break',{attrs:{blank_lines:blanks}}));blanks=0;
    content.push(work.node('verse_line',{content:[work.node('text',{text:line})]}));});
  return content.length?[work.node('verse',{content})]:[];
}
interface Rich {readonly content:Node[];readonly codes:Set<Diagnostic>;readonly failed:boolean;readonly media:boolean;}
function richBlocks(nodes:readonly Html[],policy:Policy,work:Work):Rich {
  const codes=new Set<Diagnostic>();let failed=false,metadata=false,media=false;
  const ignoredMetadata=new Set<Html>();
  const reject=():void=>{failed=true;codes.add('clipboard.unsupported_semantics');};
  const attrs=(n:Extract<Html,{kind:'element'}>):Map<string,string>=>new Map(n.attributes.filter(a=>a.namespace===null&&a.prefix===null).map(a=>[a.name,a.value]));
  if(nodes.length>clipboardDecodeLimits.nodes)throw new Limit();
  const stack=nodes.map(node=>({node,depth:1}));let count=0,attributes=0,discovered=nodes.length;
  // Complete bounded pre-scan must observe media even when an earlier sibling is already unsupported.
  while(stack.length){const {node:n,depth}=stack.pop()!;if(++count>clipboardDecodeLimits.nodes||depth>clipboardDecodeLimits.depth)throw new Limit();
    if(n.kind==='text'||n.kind==='comment'){if(!text(n.value))throw new Invalid();continue;}if(n.kind==='doctype')continue;
    if(n.kind!=='element'||!text(n.tagName,128)||!Array.isArray(n.attributes)||!Array.isArray(n.children))throw new Invalid();
    attributes+=n.attributes.length;if(attributes>clipboardDecodeLimits.attributes||n.children.length>clipboardDecodeLimits.nodes)throw new Limit();
    // Browser clipboard serialization may add this inert root declaration. It
    // remains metered and scanned; other metadata retains the active refusal.
    const declaration=n.attributes[0];
    const inertUtf8=depth===1&&n.namespaceURI===HTML_NS&&n.tagName==='meta'&&n.children.length===0&&n.attributes.length===1
      &&declaration!.name==='charset'&&declaration!.namespace===null&&declaration!.prefix===null&&declaration!.value.length===5&&/^utf-8$/i.test(declaration!.value);
    if(inertUtf8){metadata=true;ignoredMetadata.add(n);}
    if(n.namespaceURI!==HTML_NS||unsupported.has(n.tagName))reject();if(active.has(n.tagName)&&!inertUtf8)failed=true;
    for(const a of n.attributes){if(!text(a.name,128)||!text(a.value))throw new Invalid();
      if(/^on/i.test(a.name))failed=true;
      else if(a.namespace!==null||a.prefix!==null||!(n.tagName==='a'&&['href','title'].includes(a.name)||n.tagName==='ol'&&a.name==='start'||['td','th'].includes(n.tagName)&&['colspan','rowspan'].includes(a.name)))metadata=true;}
    const a=attrs(n);
    if(n.tagName==='img'){media=true;failed=true;codes.add('clipboard.media_item_forbidden');if(/^[\u0000-\u0020]*https?:/i.test(a.get('src')??''))codes.add('clipboard.remote_image_forbidden');}
    if(n.tagName==='a'&&a.has('href')&&!isSafeClipboardUrl(a.get('href')!,policy)){failed=true;codes.add('clipboard.unsafe_url_rejected');}
    discovered+=n.children.length;if(discovered>clipboardDecodeLimits.nodes)throw new Limit();
    for(const child of n.children)stack.push({node:child,depth:depth+1});
  }
  if(failed)return{content:[],codes,failed,media};
  function inline(children:readonly Html[],marks:readonly Mark[]=[],depth=1):Node[]{
    const out:Node[]=[];
    const pushText=(value:string):void=>{if(!value)return;const sorted=[...marks].sort((a,b)=>markOrder.indexOf(a.type)-markOrder.indexOf(b.type));
      out.push(work.node('text',{text:value,...(sorted.length?{marks:sorted.map(m=>({...m,...(m.attrs?{attrs:{...m.attrs}}:{})}))}:{})}));};
    for(const n of children){work.visit(depth);if(n.kind==='comment'||n.kind==='doctype')continue;if(n.kind==='text'){pushText(n.value);continue;}if(n.kind!=='element'){reject();break;}
      if(n.tagName==='br'){out.push(work.node('hard_break'));continue;}
      const mark=Object.hasOwn(markTypes,n.tagName)?markTypes[n.tagName]:undefined;if(mark){
        if(marks.some(m=>m.type===mark)){out.push(...inline(n.children,marks,depth+1));continue;}
        if(marks.length>=markOrder.length||mark==='code'&&marks.some(m=>m.type!=='link')||mark!=='link'&&marks.some(m=>m.type==='code')
          ||mark==='subscript'&&marks.some(m=>m.type==='superscript')||mark==='superscript'&&marks.some(m=>m.type==='subscript')){reject();break;}
        out.push(...inline(n.children,[...marks,{type:mark}],depth+1));continue;}
      if(n.tagName==='a'){const a=attrs(n),href=a.get('href');if(href===undefined){out.push(...inline(n.children,marks,depth+1));continue;}
        if(marks.some(m=>m.type==='link')){reject();break;}const title=a.get('title'),link:Mark={type:'link',attrs:{href,...(title?{title}:{})}};out.push(...inline(n.children,[...marks,link],depth+1));continue;}
      if(inlineWrappers.has(n.tagName)){out.push(...inline(n.children,marks,depth+1));continue;}reject();break;
    }return out;
  }
  function flow(children:readonly Html[],depth=1):Node[]{const out:Node[]=[],run:Html[]=[];
    const flush=():void=>{if(run.some(nonempty)){const content=inline(run,[],depth);if(content.length)out.push(work.node('paragraph',{content}));}run.length=0;};
    for(const n of children){work.visit(depth);if(n.kind==='comment'||n.kind==='doctype'||ignoredMetadata.has(n))continue;
      if(n.kind==='element'&&(blocks.has(n.tagName)||wrappers.has(n.tagName))){flush();if(failed)break;
        if(wrappers.has(n.tagName))out.push(...flow(n.children,depth+1));else{const block=convert(n,depth);if(block)out.push(block);}
      }else run.push(n);
      if(failed)break;
    }if(!failed)flush();return out;
  }
  function mixed(n:Extract<Html,{kind:'element'}>,depth:number):Node[]{return n.children.some(c=>c.kind==='element'&&(blocks.has(c.tagName)||wrappers.has(c.tagName)))?flow(n.children,depth):[work.node('paragraph',{content:inline(n.children,[],depth)})];}
  function integer(value:string|undefined):number|undefined {if(value===undefined)return undefined;if(!/^\s*\+?[0-9]+\s*$/.test(value)){reject();return undefined;}const n=Number(value);if(!Number.isSafeInteger(n)||n<1){reject();return undefined;}return n;}
  function convert(n:Extract<Html,{kind:'element'}>,depth:number):Node|null {
    work.visit(depth);const tag=n.tagName,a=attrs(n);
    if(tag==='p'||/^h[1-6]$/.test(tag))return work.node(tag==='p'?'paragraph':'heading',{...(tag==='p'?{}:{attrs:{level:Number(tag[1])}}),content:inline(n.children,[],depth+1)});
    if(tag==='blockquote')return work.node('blockquote',{content:mixed(n,depth+1)});
    if(tag==='ul'||tag==='ol'){const content:Node[]=[];for(const c of n.children){if(!nonempty(c))continue;if(c.kind!=='element'||c.tagName!=='li'){reject();break;}content.push(work.node('list_item',{content:mixed(c,depth+1)}));}
      const start=tag==='ol'?integer(a.get('start')):undefined;return work.node(tag==='ul'?'bullet_list':'ordered_list',{...(start!==undefined&&start!==1?{attrs:{start}}:{}),content});}
    if(tag==='table'){const rows:Node[]=[];
      const section=(children:readonly Html[],d:number):void=>{for(const row of children){work.visit(d);if(!nonempty(row))continue;if(row.kind!=='element'){reject();return;}
        if(['tbody','thead','tfoot'].includes(row.tagName)){section(row.children,d+1);continue;}if(row.tagName!=='tr'){reject();return;}
        const cells:Node[]=[];for(const cell of row.children){work.visit(d+1);if(!nonempty(cell))continue;if(cell.kind!=='element'||!['td','th'].includes(cell.tagName)){reject();return;}
          const a=attrs(cell),colspan=integer(a.get('colspan')),rowspan=integer(a.get('rowspan')),attributes:Record<string,number>={};if(colspan!==undefined&&colspan!==1)attributes.colspan=colspan;if(rowspan!==undefined&&rowspan!==1)attributes.rowspan=rowspan;
          cells.push(work.node(cell.tagName==='td'?'table_cell':'table_header',{...(Object.keys(attributes).length?{attrs:attributes}:{}),content:mixed(cell,d+2)}));}
        rows.push(work.node('table_row',{content:cells}));}};
      section(n.children,depth+1);if(rows.length===0)reject();return work.node('table',{content:rows});}
    reject();return null;
  }
  const content=flow(nodes);if(!failed&&metadata)codes.add('clipboard.editor_metadata_ignored');return{content,codes,failed,media};
}
function candidate(input:Input,content:Node[],codes:Iterable<Diagnostic>):Result {
  if(!content.length)return fail('clipboard.empty_payload',...codes);
  let kind:'inline'|'blocks'='blocks',open_start=false,open_end=false;
  if(input.insertion_context==='prose_block'){
    if(content.length===1&&content[0]!.type==='paragraph'){kind='inline';content=[...content[0]!.content!];}
    else {open_start=content[0]!.type==='paragraph';open_end=content.at(-1)!.type==='paragraph';}
  }
  if(!content.length)return fail('clipboard.empty_payload',...codes);
  for(const n of content)freezeNode(n);Object.freeze(content);
  const fragment=Object.freeze({format_id:'org.klenwriter.kwdj/clipboard-fragment/1' as const,source_profile:Object.freeze({...input.source_profile}),mode:input.mode,kind,content,open_start,open_end});
  return Object.freeze({status:'candidate',fragment,diagnostics:diagnostics(codes)});
}
/** Rich conversion is lazy; parser/limit failures never authorize an independent-text fallback. */
export async function decodeClipboard(value:unknown):Promise<Result>{
  try {
    const input=snapshotInput(value);if(!inputValid(input))return fail('clipboard.invalid_input');
    if(input.media==='unknown')return fail('clipboard.invalid_input');
    if(input.mode==='prose'&&input.insertion_context==='verse'||input.mode==='poetry'&&input.insertion_context==='prose_block')return fail('clipboard.invalid_context');
    if([input.plain,input.html].some(r=>r.status!=='complete_local'&&r.status!=='unavailable'))return fail('clipboard.invalid_input');
    if(input.html.status==='unavailable'){
      if(input.media==='present')return fail('clipboard.media_item_forbidden');if(input.plain.status!=='complete_local')return fail('clipboard.empty_payload');
      return candidate(input,plainBlocks(input.plain.text!,input.mode,new Work()),[]);
    }
    const {parseClipboardHtml}=await import('./clipboard-parser.js');
    const parsed=await parseClipboardHtml(input.html.text!);
    if(parsed.status!=='parsed')return fail('clipboard.invalid_input',...(input.media==='present'?['clipboard.media_item_forbidden' as const]:[]));
    const rich=richBlocks(parsed.nodes,input.url_policy,new Work());
    if(input.media==='present'||rich.media)return fail(...[...rich.codes].filter(c=>c==='clipboard.media_item_forbidden'||c==='clipboard.remote_image_forbidden'),'clipboard.media_item_forbidden');
    if(!rich.failed&&input.mode==='prose')return candidate(input,rich.content,rich.codes);
    const causal=[...rich.codes].filter(c=>c==='clipboard.unsupported_semantics'||c==='clipboard.unsafe_url_rejected');
    if(!causal.length)causal.push('clipboard.unsupported_semantics');
    if(input.plain.status==='complete_local')return candidate(input,plainBlocks(input.plain.text!,input.mode,new Work()),['clipboard.rich_branch_rejected','clipboard.plain_fallback_used',...causal]);
    return fail(...causal);
  }catch {return fail('clipboard.invalid_input');}
}
