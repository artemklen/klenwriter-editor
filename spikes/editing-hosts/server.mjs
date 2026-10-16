import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('./', import.meta.url);
const files = new Map([['/', ['index.html','text/html']], ['/app.js',['app.js','text/javascript']], ['/style.css',['style.css','text/css']]]);
const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const server = http.createServer(async (req,res) => {
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store');
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  if (path === '/manifest.json') {
    const names = ['index.html','app.js','style.css','server.mjs'];
    const hashes = Object.fromEntries(await Promise.all(names.map(async name => [name, createHash('sha256').update(await readFile(new URL(name,root))).digest('hex')])));
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ sourceFingerprint: createHash('sha256').update(JSON.stringify(hashes)).digest('hex'), hashes, csp })); return;
  }
  if (path === '/probe.wasm') {
    res.setHeader('Content-Type','application/wasm');
    res.end(Buffer.from([0,97,115,109,1,0,0,0])); return;
  }
  const file = files.get(path);
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try { res.setHeader('Content-Type',file[1]); res.end(await readFile(new URL(file[0],root))); }
  catch { res.writeHead(500); res.end('Read failed'); }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log('M0 spike: http://127.0.0.1:4173'));
