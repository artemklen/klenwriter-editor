// SPDX-License-Identifier: MIT OR Apache-2.0
/** Closed, escaped clipboard HTML serialization. Unsupported semantics are refused, never flattened. */
import {isSafeClipboardUrl} from './clipboard-decode.js';
import type {ClipboardProfileBinding,ClipboardUrlPolicy} from './clipboard-types.js';
const FORMAT='org.klenwriter.kwdj/clipboard-fragment/1';
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:unknown,required:readonly string[],optional:readonly string[]=[]):v is Record<string,unknown>=>object(v)
  &&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>0;
function scalar(v:unknown,max=524288):v is string {
  if(typeof v!=='string'||v.length>max||v.includes('\u0000'))return false;
  for(let i=0;i<v.length;i++){const c=v.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=v.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}return true;
}
function sameBinding(v:unknown,p:ClipboardProfileBinding):boolean{return closed(v,['profile_id','profile_version','codec_id','wire_version'])
  &&v.profile_id===p.profile_id&&v.profile_version===p.profile_version&&v.codec_id===p.codec_id&&v.wire_version===p.wire_version;}
/** Bound syntax nesting before JSON.parse allocation; this does not validate native semantics. */
export function readClipboardFragment(json:unknown):unknown {
  if(typeof json!=='string'||json.length>2097152)throw Error('clipboard.invalid_input');
  let depth=0,values=0,quoted=false,escape=false;
  for(const c of json){if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;}
    else if(c==='"'){quoted=true;values++;}else if(c==='{'||c==='['){depth++;values++;}else if(c==='}'||c===']')depth--;else if(c===',')values++;
    if(depth>96||depth<0||values>131072)throw Error('clipboard.invalid_input');}
  return JSON.parse(json);
}
/** No DOM, CSS, fetch, internal-MIME payload, metadata or raw source HTML is emitted. */
export function serializeClipboardHtml(json:string,binding:ClipboardProfileBinding,policy:ClipboardUrlPolicy):string|null {
  try {
    const value=readClipboardFragment(json);
    if(!closed(value,['format_id','source_profile','mode','kind','content','open_start','open_end'])||value.format_id!==FORMAT||!sameBinding(value.source_profile,binding)
      ||value.mode!=='prose'||!['inline','blocks'].includes(value.kind as string)||typeof value.open_start!=='boolean'||typeof value.open_end!=='boolean'
      ||value.kind==='inline'&&(value.open_start||value.open_end)||!Array.isArray(value.content)||!value.content.length)return null;
    // External HTML cannot preserve partial-heading edge semantics: the decoder
    // infers open paragraph edges only. Refuse rather than turn an open heading
    // into closed blocks; fully selected/closed headings remain representable.
    if(value.open_start&&(!object(value.content[0])||value.content[0].type!=='paragraph')
      ||value.open_end&&(!object(value.content.at(-1))||(value.content.at(-1) as Record<string,unknown>).type!=='paragraph'))return null;
    const chunks:string[]=[];let units=0,nodes=0;
    const append=(s:string):void=>{if(s.length>2097152-units)throw Error('clipboard.limit');units+=s.length;chunks.push(s);};
    const escaped=(s:string):void=>{let start=0;for(let i=0;i<s.length;i++){const c=s[i],entity=c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':c==='"'?'&quot;':c==="'"?'&#39;':c==='\r'?'&#13;':null;
      if(entity){append(s.slice(start,i));append(entity);start=i+1;}}append(s.slice(start));};
    type Parent='inline'|'blocks'|'list'|'table'|'row';
    const children=(v:unknown,parent:Parent,depth:number,nonempty=false):void=>{if(!Array.isArray(v)||v.length>8192||nonempty&&v.length===0)throw Error('clipboard.invalid_input');for(const n of v)node(n,parent,depth);};
    const wrap=(tag:string,body:()=>void):void=>{append('<'+tag+'>');body();append('</'+tag+'>');};
    const markTags:Readonly<Record<string,string>>={strong:'strong',emphasis:'em',strike:'s',code:'code',subscript:'sub',superscript:'sup'};
    function marked(text:string,marks:unknown):void {
      if(marks===undefined){escaped(text);return;}if(!Array.isArray(marks)||marks.length>7)throw Error('clipboard.invalid_input');
      const seen=new Set<string>(),closes:string[]=[];
      for(const m of marks){if(!object(m)||typeof m.type!=='string'||seen.has(m.type))throw Error('clipboard.invalid_input');seen.add(m.type);
        if(m.type==='link'){
          if(!closed(m,['type','attrs'])||!closed(m.attrs,['href'],['title'])||typeof m.attrs.href!=='string'||!isSafeClipboardUrl(m.attrs.href,policy)
            ||m.attrs.title!==undefined&&!scalar(m.attrs.title))throw Error('clipboard.invalid_input');
          append('<a href="');escaped(m.attrs.href);append('"');if(m.attrs.title!==undefined){append(' title="');escaped(m.attrs.title);append('"');}append('>');closes.push('</a>');
        }else {if(!closed(m,['type'])||!Object.hasOwn(markTags,m.type))throw Error('clipboard.unsupported_semantics');const tag=markTags[m.type]!;append('<'+tag+'>');closes.push('</'+tag+'>');}
      }
      if(seen.has('subscript')&&seen.has('superscript')||seen.has('code')&&[...seen].some(m=>m!=='code'&&m!=='link'))throw Error('clipboard.unsupported_semantics');
      escaped(text);for(let i=closes.length-1;i>=0;i--)append(closes[i]!);
    }
    function node(v:unknown,parent:Parent,depth:number):void {
      if(++nodes>8192||depth>64||!object(v)||typeof v.type!=='string')throw Error('clipboard.limit');const type=v.type;
      if(type==='text'){if(parent!=='inline'||!closed(v,['type','text'],['marks'])||!scalar(v.text)||v.text.length===0)throw Error('clipboard.invalid_input');marked(v.text,v.marks);return;}
      if(type==='hard_break'){if(parent!=='inline'||!closed(v,['type']))throw Error('clipboard.invalid_input');append('<br>');return;}
      if(parent==='inline')throw Error('clipboard.unsupported_semantics');
      if(type==='paragraph'||type==='heading'){
        if(parent!=='blocks'||!closed(v,['type','content'],['attrs']))throw Error('clipboard.invalid_input');let tag='p';
        if(type==='heading'){if(!closed(v.attrs,['level'])||!integer(v.attrs.level)||v.attrs.level>6)throw Error('clipboard.unsupported_semantics');tag='h'+v.attrs.level;}
        else if(v.attrs!==undefined&&!closed(v.attrs,[]))throw Error('clipboard.unsupported_semantics');
        wrap(tag,()=>children(v.content,'inline',depth+1));return;
      }
      if(type==='blockquote'){if(parent!=='blocks'||!closed(v,['type','content']))throw Error('clipboard.invalid_input');wrap('blockquote',()=>children(v.content,'blocks',depth+1,true));return;}
      if(type==='bullet_list'||type==='ordered_list'){
        if(parent!=='blocks'||!closed(v,['type','content'],type==='ordered_list'?['attrs']:[]))throw Error('clipboard.invalid_input');let tag=type==='bullet_list'?'ul':'ol';
        if(type==='ordered_list'&&v.attrs!==undefined){if(!closed(v.attrs,['start'])||!integer(v.attrs.start))throw Error('clipboard.invalid_input');tag+=' start="'+v.attrs.start+'"';}
        append('<'+tag+'>');children(v.content,'list',depth+1,true);append(type==='bullet_list'?'</ul>':'</ol>');return;
      }
      if(type==='list_item'){if(parent!=='list'||!closed(v,['type','content']))throw Error('clipboard.invalid_input');wrap('li',()=>children(v.content,'blocks',depth+1,true));return;}
      if(type==='table'){if(parent!=='blocks'||!closed(v,['type','content']))throw Error('clipboard.invalid_input');wrap('table',()=>children(v.content,'table',depth+1,true));return;}
      if(type==='table_row'){if(parent!=='table'||!closed(v,['type','content']))throw Error('clipboard.invalid_input');wrap('tr',()=>children(v.content,'row',depth+1,true));return;}
      if(type==='table_cell'||type==='table_header'){
        if(parent!=='row'||!closed(v,['type','content'],['attrs']))throw Error('clipboard.invalid_input');const tag=type==='table_cell'?'td':'th';append('<'+tag);
        if(v.attrs!==undefined){if(!closed(v.attrs,[],['colspan','rowspan']))throw Error('clipboard.unsupported_semantics');for(const name of['colspan','rowspan'])if(Object.hasOwn(v.attrs,name)){if(!integer(v.attrs[name]))throw Error('clipboard.invalid_input');append(' '+name+'="'+v.attrs[name]+'"');}}
        append('>');children(v.content,'blocks',depth+1,true);append('</'+tag+'>');return;
      }
      // In particular, never flatten verse/code/media/reference or styled/token semantics.
      throw Error('clipboard.unsupported_semantics');
    }
    children(value.content,value.kind==='inline'?'inline':'blocks',1);return chunks.join('');
  }catch{return null;}
}
