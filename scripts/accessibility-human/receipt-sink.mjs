// SPDX-License-Identifier: MIT OR Apache-2.0
// Data-only, launch-gated localhost sink. Never imports an editor/browser or runs
// a command. A request cannot choose a path, file name, mode, nonce or limit.
import {readFile,mkdir,writeFile,rename,lstat} from 'node:fs/promises';
import {isAbsolute,resolve,dirname,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(ok,why)=>{if(!ok)throw Error(why);};
const CAP=Object.freeze({chunkCount:32,chunkBytes:524288,totalBytes:8388608,depth:32,nodes:200000});
const schema='kwe-a66-human-chunk/1',own=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
function finite(value){let nodes=0;const walk=(v,depth)=>{check(++nodes<=CAP.nodes&&depth<=CAP.depth,'Finite JSON tree');if(v===null||typeof v==='boolean'||typeof v==='string')return;if(typeof v==='number'){check(Number.isFinite(v),'Finite JSON number');return;}if(Array.isArray(v)){for(const item of v)walk(item,depth+1);return;}check(v&&Object.getPrototypeOf(v)===Object.prototype,'Plain JSON object');for(const [key,item]of Object.entries(v)){check(!['__proto__','prototype','constructor'].includes(key),'Closed JSON keys');walk(item,depth+1);}};walk(value,0);}
async function regular(path,max){const stat=await lstat(path);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=max,'Bounded regular source');return readFile(path);}
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value)+'\n');}
export async function createHumanReceiptSink(configurationPath){
  if(!configurationPath)return null;
  check(isAbsolute(configurationPath)&&resolve(configurationPath)===configurationPath,'Explicit absolute sink config');
  const configBytes=await regular(configurationPath,16384),config=JSON.parse(configBytes);finite(config);
  check(own(config,['schema','nonce','out','expectedBuildId','expectedPlanSha256','sourcePins']),'Exact sink configuration fields');check(config.schema==='kwe-a66-human-sink/1','Sink schema');
  check(/^[a-f0-9]{64}$/.test(config.nonce)&&/^sha256:[a-f0-9]{64}$/.test(config.expectedBuildId)&&/^[a-f0-9]{64}$/.test(config.expectedPlanSha256),'Exact source/build/nonce hex');
  check(isAbsolute(config.out)&&resolve(config.out)===config.out&&basename(config.out).startsWith('osr66-human-'),'Explicit fresh owned output');
  check(dirname(config.out)==='/private/tmp'||dirname(config.out)==='/Users/artem/projects/.evidence-archives/editor-wasm/osr-66','Fixed output parent');
  check(Array.isArray(config.sourcePins)&&config.sourcePins.length>=5&&config.sourcePins.length<=32,'Finite root-supplied source pins');
  for(const pin of config.sourcePins)check(own(pin,['path','bytes','sha256'])&&typeof pin.path==='string'&&pin.path.length<=512&&Number.isSafeInteger(pin.bytes)&&pin.bytes>=0&&/^[a-f0-9]{64}$/.test(pin.sha256),'Exact root-supplied pin');
  const parent=await lstat(dirname(config.out));check(parent.isDirectory()&&!parent.isSymbolicLink(),'Regular owned output parent');await mkdir(config.out,{mode:0o700});
  const startedAt=new Date().toISOString(),chunks=[];let total=0,closed=false,serial=Promise.resolve();
  await writeFile(join(config.out,'000-launch.json'),JSON.stringify({status:'WAITING_FOR_HUMAN',startedAt,configurationPath,configurationSha256:sha(configBytes),config,caps:CAP,qualification:'Source/build pins are supplied by root after independent preflight; no browser/OS/input operation from this sink.'},null,2)+'\n',{flag:'wx',mode:0o600});
  async function body(req){req.setTimeout(5000,()=>req.destroy(Error('Finite receipt read timeout')));const parts=[];let bytes=0;for await(const part of req){bytes+=part.length;check(bytes<=CAP.chunkBytes,'Chunk byte cap');parts.push(part);}req.setTimeout(0);return Buffer.concat(parts);}
  async function post(req,res){
    check(!closed&&chunks.length<CAP.chunkCount,'Open finite receipt');check(req.headers.origin==='http://127.0.0.1:4174','Same-origin receipt');check(req.headers['x-a66-human-nonce']===config.nonce,'Exact nonce header');check((req.headers['content-type']??'').split(';')[0]==='application/json','JSON receipt');
    const bytes=await body(req);check(total+bytes.length<=CAP.totalBytes,'Total receipt byte cap');const value=JSON.parse(bytes);finite(value);
    check(own(value,['schema','nonce','ordinal','kind','payload'])&&value.schema===schema&&value.nonce===config.nonce&&value.ordinal===chunks.length,'Exact immutable next chunk');check(['intent','observation','final'].includes(value.kind),'Closed receipt kind');check(chunks.length===0?value.kind==='intent':value.kind!=='intent','Exactly one first intent');
    const name=`${String(chunks.length+1).padStart(3,'0')}-${value.kind}.json`,hash=sha(bytes);await writeFile(join(config.out,name),bytes,{flag:'wx',mode:0o600});chunks.push({ordinal:value.ordinal,kind:value.kind,path:name,bytes:bytes.length,sha256:hash});total+=bytes.length;
    if(value.kind==='final'){
      closed=true;const index={status:'HUMAN_RECEIPT_RECORDED_NOT_INDEPENDENT_VERDICT',startedAt,finishedAt:new Date().toISOString(),configSha256:sha(configBytes),buildId:config.expectedBuildId,planSha256:config.expectedPlanSha256,actualChunks:chunks.length,totalBytes:total,chunks,claimedStatus:value.payload?.status??null,qualification:'Unmodified human/browser payloads; root must validate original machine checks, human observations and actual cleanup. No status promotion.'};
      const encoded=JSON.stringify(index,null,2)+'\n';await writeFile(join(config.out,'index.partial'),encoded,{flag:'wx',mode:0o600});await rename(join(config.out,'index.partial'),join(config.out,'index.json'));
    }
    send(res,201,{status:'recorded',ordinal:value.ordinal,bytes:bytes.length,sha256:hash,closed});
  }
  return Object.freeze({
    configuration:Object.freeze({nonce:config.nonce,expectedBuildId:config.expectedBuildId,expectedPlanSha256:config.expectedPlanSha256,sourcePins:config.sourcePins,caps:CAP,startedAt}),
    async handle(req,res,path){
      if(path!=='/accessibility-human/config'&&path!=='/accessibility-human/receipt')return false;
      if(!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){send(res,403,{status:'refused',reason:'localhost only'});return true;}
      if(path==='/accessibility-human/config'){
        const url=new URL(req.url,'http://127.0.0.1:4174');if(req.method!=='GET'||url.searchParams.size!==1||url.searchParams.get('nonce')!==config.nonce){send(res,404,{status:'not_found'});return true;}send(res,200,this.configuration);return true;
      }
      if(req.method!=='POST'){send(res,405,{status:'refused',reason:'POST only'});return true;}
      // Serialize immutable ordinals. Failed chunks retain all earlier evidence.
      const task=serial.then(()=>post(req,res));serial=task.catch(()=>{});
      try{await task;}catch(error){if(!res.headersSent)send(res,400,{status:'refused',reason:String(error.message)});}return true;
    },
  });
}
