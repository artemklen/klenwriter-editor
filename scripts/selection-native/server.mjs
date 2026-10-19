// SPDX-License-Identifier: MIT OR Apache-2.0
// Opt-in installed-browser fixture broker. Ordinary workspace routes stay unchanged.
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {appendFileSync,readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {limits,validCall} from './protocol.mjs';

const root = resolve(fileURLToPath(new URL('../../',import.meta.url))), argv = process.argv.slice(2);
if (argv.length !== 2 || argv[0] !== '--directory' || !argv[1].startsWith('/')) throw new Error('Usage: node scripts/selection-native/server.mjs --directory /absolute/fresh/outside-checkout/directory');
const directory = resolve(argv[1]);
if (directory === root || directory.startsWith(root+'/')) throw new Error('Broker output must be outside checkout');
mkdirSync(directory,{recursive:true});
const actualDirectory=realpathSync(directory),actualRoot=realpathSync(root);
if(actualDirectory===actualRoot||actualDirectory.startsWith(actualRoot+'/'))throw Error('Broker output resolves inside checkout');
const nonce = randomBytes(16).toString('hex'), base = '/selection-native-broker-'+nonce;
const origin = 'http://127.0.0.1:4174', fixtureUrl = origin+'/selection';
const config = {format:'osr40-selection-http-broker/1',nonce,base,origin,fixtureUrl,
  title:'KlenWriter Selection native '+nonce,createdAt:Date.now(),expiresAt:Date.now()+limits.runMs,
  directory,log:resolve(directory,'broker.jsonl'),limits};
const log = config.log;
writeFileSync(log,'',{flag:'wx'});
writeFileSync(resolve(directory,'config.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
let logBytes = 0, trafficBytes = 0, commands = 0, polls = 0, pending = null, ready = null, stopped = false;
function record(kind,value) {
  const line = JSON.stringify({time:new Date().toISOString(),kind,...value})+'\n';
  const size = Buffer.byteLength(line);
  if (logBytes+size > limits.logBytes) { stopped = true; throw new Error('Broker log bound'); }
  appendFileSync(log,line,'utf8'); logBytes += size;
}
function account(size) {
  trafficBytes += size;
  if (trafficBytes > limits.trafficBytes) { stopped = true; throw new Error('Broker combined payload bound'); }
}
function expire() {
  if (pending && !pending.result && Date.now() > pending.deadline) {
    pending.result = {ok:false,error:'Broker command deadline exceeded',mayHaveExecuted:pending.delivered};
    stopped = true; record('deadline',{id:pending.id,delivered:pending.delivered});
  }
  if (Date.now() > config.expiresAt) stopped = true;
}
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');}
function json(res,status,value) {
  const body = JSON.stringify(value); account(Buffer.byteLength(body));
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(body);
}
async function body(req,maximum) {
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared)>maximum)) throw new Error('Body declaration exceeds bound');
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length; account(chunk.length);
    if (bytes > maximum) throw new Error('Body exceeds bound');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const paths = Object.fromEntries(['config','page-client.mjs','protocol.mjs','page/ready','page/poll','page/result','host/submit','host/read','host/ack','host/status'].map(path=>[base+'/'+path,path]));
const original = http.createServer;
http.createServer = function(...args) {
  const at = args.findIndex(value=>typeof value==='function');
  if (at < 0) return Reflect.apply(original,this,args);
  const listener = args[at];
  args[at] = async function(req,res) {
    const route = paths[req.url];
    if (!route) return Reflect.apply(listener,this,[req,res]);
    try {
      if (req.headers.host !== '127.0.0.1:4174') return json(res,403,{error:'Wrong fixture host'});
      if (req.method === 'POST' && req.headers.origin !== origin) return json(res,403,{error:'Wrong fixture origin'});
      expire();
      if (route === 'config' && req.method === 'GET') return json(res,200,config);
      if (['page-client.mjs','protocol.mjs'].includes(route) && req.method === 'GET') {
        const bytes = readFileSync(new URL('./'+route,import.meta.url)); account(bytes.length);
        res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}); res.end(bytes); return;
      }
      if (route === 'host/status' && req.method === 'GET') return json(res,200,{ready,stopped,commands,polls,pending:pending?{id:pending.id,delivered:pending.delivered,done:!!pending.result}:null});
      if (route === 'page/poll' && req.method === 'GET') {
        if (++polls > limits.polls) { stopped = true; return json(res,429,{error:'Poll bound'}); }
        if (stopped) return json(res,410,{error:'Broker stopped'});
        if (pending && !pending.delivered && !pending.result) {
          pending.delivered = true;
          const command = {id:pending.id,method:pending.method,args:pending.args,deadline:pending.deadline};
          record('dispatch',command); return json(res,200,{command});
        }
        return json(res,200,{command:null});
      }
      if (req.method !== 'POST' || !['page/ready','page/result','host/submit','host/read','host/ack'].includes(route)) return json(res,405,{error:'Method not allowed'});
      const value = await body(req,route==='page/result'?limits.resultBytes:limits.commandBytes);
      expire(); // The body await cannot extend a command or run deadline.
      if (!value || Array.isArray(value) || typeof value !== 'object' || value.nonce !== nonce) return json(res,400,{error:'Invalid broker envelope'});
      const keys=route==='host/submit'?['nonce','id','method','args']:route==='page/ready'?['nonce','url','title','userAgent','platform','language']:route==='page/result'?['nonce','id','ok',value.ok?'value':'error']:['nonce','id'];
      if(!exactKeys(value,keys))return json(res,400,{error:'Unknown or missing broker envelope field'});
      record('request',{route,value});
      if (route === 'page/ready') {
        if (ready || stopped || value.url !== fixtureUrl || value.title !== config.title || ['userAgent','platform','language'].some(key=>typeof value[key]!=='string'||value[key].length>1024)) return json(res,409,{error:'Page handshake refused'});
        ready = value; return json(res,200,{accepted:true});
      }
      if (route === 'host/submit') {
        if (stopped || !ready || pending) return json(res,409,{error:'Broker unavailable or another request not acknowledged'});
        if (commands >= limits.commands || !validCall(value.method,value.args) || value.id !== nonce+':'+String(commands+1)) return json(res,400,{error:'Invalid closed call or command bound'});
        commands++; pending = {id:value.id,method:value.method,args:value.args,deadline:Date.now()+limits.commandMs,delivered:false,result:null};
        return json(res,200,{accepted:pending.id,deadline:pending.deadline});
      }
      if (!pending || value.id !== pending.id) return json(res,409,{error:'No matching current request'});
      if (route === 'page/result') {
        if (stopped || !pending.delivered || pending.result || typeof value.ok !== 'boolean' || (value.ok ? !Object.hasOwn(value,'value') : typeof value.error !== 'string')) return json(res,409,{error:'Duplicate, expired or invalid page result'});
        pending.result = value.ok ? {ok:true,value:value.value} : {ok:false,error:value.error.slice(0,2048),mayHaveExecuted:true};
        return json(res,200,{accepted:pending.id});
      }
      if (route === 'host/read') return json(res,200,{id:pending.id,done:!!pending.result,...(pending.result?{result:pending.result}:{})});
      if (!pending.result) return json(res,409,{error:'Cannot acknowledge an incomplete request'});
      record('acknowledged',{id:pending.id,ok:pending.result.ok});
      pending = null; return json(res,200,{acknowledged:value.id});
    } catch (error) {
      stopped = true;
      try { record('protocol-error',{route,error:String(error?.message??error).slice(0,1024)}); } catch {}
      if (!res.headersSent) { res.writeHead(500,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Bounded broker protocol failed'})); }
      else res.end();
    }
  };
  return Reflect.apply(original,this,args);
};
record('started',{config,wrapper:fileURLToPath(import.meta.url)});
console.log(JSON.stringify({fixtureOnly:true,config:resolve(directory,'config.json'),nonce,title:config.title}));
await import('../workspace-server.mjs');
