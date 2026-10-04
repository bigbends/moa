import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Runtime } from './runtime.mjs';
import { createBridgeServer } from './http.mjs';

test('authenticated package removal awaits state writers and preserves another package playback',async()=>{
  const root=await mkdtemp(join(tmpdir(),'apk-remove-rpc-'));
  const metadata={pkg:'test.package',entry:'test.Entry',code:12,version:'14.12',signers:['a'.repeat(64)]};
  const tools={drainState:async directory=>{if(directory){await new Promise(r=>setTimeout(r,5));await writeFile(join(directory,'evicted-writer'),'state').catch(e=>{if(e.code!=='ENOENT')throw e;});}},fingerprint:'fixture',inspect:async()=>metadata,convert:async(_,jar)=>writeFile(jar,'jar'),worker:(_jar,_metadata,directory)=>{
    const worker={pid:12345,generation:1,closed:false,retain:()=>()=>{},close(){this.closed=true;this.pid=undefined;},
      async dispose(){this.close();await new Promise(r=>setTimeout(r,5));await writeFile(join(directory,'last-write'),'state');},
      async request(method){return method==='describe'?[{id:'1',name:'Fixture',lang:'ko'}]:[{url:'http://127.0.0.1:123/session/fixture/playlist.m3u8'}];}};
    return worker;
  }};
  const runtime=await new Runtime(root,tools).open();runtime.leases.owns=async()=>true;
  const secret='test-secret-'.repeat(4),server=createBridgeServer(runtime,secret);
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}/rpc`;
  const rpc=(body,authorized=true)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:`Bearer ${secret}`}:{})},body:JSON.stringify(body)});
  try {
    const a=await runtime.install(Buffer.from('fixture-apk'),'https://a.test/index.json',metadata);
    const b=await runtime.install(Buffer.from('fixture-apk'),'https://b.test/index.json',metadata);
    const x=await runtime.invoke(a.id,'videos',{},undefined,true),y=await runtime.invoke(b.id,'videos',{},undefined,true);
    const otherWorker=runtime.leases.get(y.lease).worker;
    assert.equal((await rpc({method:'remove',packageId:a.id},false)).status,401);
    const removed=await rpc({method:'remove',packageId:a.id});assert.equal(removed.status,200);assert.equal((await removed.json()).result.removed,true);
    assert.throws(()=>runtime.store.record(a.id),/not_installed/);assert.throws(()=>runtime.leases.get(x.lease),/expired/);
    await assert.rejects(access(runtime.store.paths(a).state),/ENOENT/);
    assert.equal(runtime.leases.get(y.lease).worker,otherWorker);assert.equal(otherWorker.closed,false);
    assert.equal((await (await rpc({method:'remove',packageId:a.id})).json()).result.removed,false);
    assert.equal((await (await rpc({method:'remove',packageId:'../../state'})).json()).error,'apk_request_invalid');
    runtime.leases.release(y.lease);
    assert.equal((await runtime.install(Buffer.from('fixture-apk'),'https://a.test/index.json',metadata)).id,a.id);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));await runtime.close();await rm(root,{recursive:true,force:true});}
});
