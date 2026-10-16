import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCorpora } from './corpora.mjs';
const root = resolve(import.meta.dirname, '../..');
export async function startServer() {
  const corpora = createCorpora();
  const byId = new Map(corpora.map(c => [c.manifest.id,c]));
  const server = http.createServer((req,res)=>{
    const path = new URL(req.url,'http://localhost').pathname;
    let body, type;
    if (path==='/') {body=readFileSync(`${root}/spikes/performance/index.html`);type='text/html';}
    else if(path==='/app.mjs'){body=readFileSync(`${root}/spikes/performance/app.mjs`);type='text/javascript';}
    else if(path==='/kernel.wasm'){body=readFileSync(`${root}/spikes/performance/kernel.wasm`);type='application/wasm';}
    else {
      const match=/^\/corpus\/([a-z-]+)\.(json|bin)$/.exec(path);
      const corpus=match&&byId.get(match[1]);
      if(corpus){body=corpus[match[2]==='json'?'json':'wire'];type=match[2]==='json'?'application/json':'application/octet-stream';}
    }
    if(!body){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'content-type':type,'cache-control':'no-store'});res.end(body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return { server, url:`http://127.0.0.1:${server.address().port}`,corpora };
}
