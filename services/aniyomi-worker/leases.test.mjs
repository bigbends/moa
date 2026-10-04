import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PlaybackLeases, ownsListener, RELAY_ORIGIN } from './leases.mjs';
import { createBridgeServer } from './http.mjs';
const delay = ms => new Promise(r => setTimeout(r,ms));
function child() { return { pid: process.pid, generation: 1, holds: 0, retain() { this.holds++; return () => { this.holds--; }; } }; }
async function listening(server) { server.listen(0,'127.0.0.1'); await once(server,'listening'); return `http://127.0.0.1:${server.address().port}`; }
function close(server) { server.closeAllConnections(); return new Promise(resolve=>server.close(resolve)); }

test('relay pins exact child, rewrites only its session, and rejects unrelated localhost paths and sockets', async () => {
  const server = createServer((req,res) => { res.writeHead(req.headers.range ? 206 : 200,{'Content-Type':'video/mp2t'}).end('MEDIA'); });
  const base = await listening(server), worker = child(), leases = new PlaybackLeases();
  try {
    assert.equal(await ownsListener(process.pid,server.address().port),true);
    assert.equal(await ownsListener(process.pid,1),false);
    const r = await leases.create('a',worker,[{url:base+'/session/one/playlist.m3u8',requiresRuntime:true}]);
    assert.equal(worker.holds,1); assert.ok(r.videos[0].url.startsWith(RELAY_ORIGIN));
    const rewritten = leases.playlist(r.lease,'#EXTM3U\n#EXT-X-KEY:URI="key.bin"\nsegment.ts\n',base+'/session/one/list.m3u8');
    assert.ok(!rewritten.includes('127.0.0.1')); assert.equal((rewritten.match(/moa-apk.invalid/g)||[]).length,2);
    for (const path of ['/rpc','/session/two/a','/session/one/../two/a','/session/one/%2e%2e/two/a']) assert.throws(()=>leases.map(r.lease,base+path),/forbidden/);
    assert.throws(()=>leases.map(r.lease,'http://127.0.0.1:1/session/one/a'),/forbidden/);
    const asset = new URL(r.videos[0].url).pathname.split('/').pop();
    const {response} = await leases.stream(r.lease,asset,'bytes=1-2',AbortSignal.timeout(1000));
    assert.equal(response.statusCode,206); for await (const _ of response) {}
    worker.generation++; assert.throws(()=>leases.get(r.lease),/expired/); assert.equal(worker.holds,0);
  } finally { leases.close(); await close(server); }
});
test('failed admission releases retain and abandoned sessions expire', async () => {
  const worker = child(), leases = new PlaybackLeases(()=>{}, {ttlMs:30,owns:async()=>false});
  try {
    await assert.rejects(leases.create('a',worker,[{url:'http://127.0.0.1:1234/session/a/x'}]),/forbidden/); assert.equal(worker.holds,0);
    leases.owns = async()=>true;
    await leases.create('a',worker,[{url:'http://127.0.0.1:1234/session/a/x'}]);
    await delay(80); assert.equal(leases.size,0); assert.equal(worker.holds,0);
  } finally { leases.close(); }
});
test('authenticated HTTP service carries HLS and bytes, disallows unleased extraction and filesystem install', async () => {
  const upstream = createServer((req,res)=>{
    if(req.url.endsWith('.m3u8')) res.writeHead(200,{'Content-Type':'application/vnd.apple.mpegurl'}).end('#EXTM3U\n#EXTINF:5,\na.ts\n');
    else res.writeHead(200,{'Content-Type':'video/mp2t'}).end('BYTES');
  });
  const source = await listening(upstream), worker = child(), leases = new PlaybackLeases();
  const runtime = { leases, status:()=>({ok:true}) }, secret='a'.repeat(40), bridge=createBridgeServer(runtime,secret), base=await listening(bridge);
  const headers={Authorization:`Bearer ${secret}`,'Content-Type':'application/json'};
  try {
    assert.equal((await fetch(base+'/rpc',{method:'POST',body:'{}'})).status,401);
    for(const input of [{method:'videos',packageId:'a'.repeat(64),params:{}},{method:'install',file:'/etc/passwd'}]) assert.equal((await fetch(base+'/rpc',{method:'POST',headers,body:JSON.stringify(input)})).status,502);
    const r=await leases.create('a',worker,[{url:source+'/session/a/list.m3u8'}]);
    const url=base+'/leases'+new URL(r.videos[0].url).pathname;
    const playlist=await (await fetch(url,{headers})).text();
    assert.ok(!playlist.includes(source));
    const segment=playlist.split('\n').find(s=>s.startsWith(RELAY_ORIGIN));
    assert.equal(await (await fetch(base+'/leases'+new URL(segment).pathname,{headers})).text(),'BYTES');
    await fetch(base+'/rpc',{method:'POST',headers,body:JSON.stringify({method:'release',lease:r.lease})});
    assert.equal((await fetch(url,{headers})).status,404);
  } finally { leases.close(); await close(bridge); await close(upstream); }
});
