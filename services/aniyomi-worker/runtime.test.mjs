import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from './runtime.mjs';
const delay = ms => new Promise(r => setTimeout(r, ms));
test('scheduler has two lanes, serializes one package, and prioritizes playback over waiting lists', async () => {
  const runtime = new Runtime('/unused', {}, { limit: 2 }); const order = []; let active = 0, max = 0;
  const job = (key, priority, name, ms) => runtime.schedule(key, priority, async () => { order.push(name); max = Math.max(max, ++active); await delay(ms); --active; return name; });
  const results = await Promise.all([job('a',1,'a1',40),job('b',1,'b1',40),job('a',1,'list',5),job('a',0,'video',5),job('c',1,'c1',5)]);
  assert.equal(results.length,5); assert.equal(max,2); assert.ok(order.indexOf('video') < order.indexOf('list')); await runtime.close();
});
test('installation is a barrier; converter and describe cannot race extension preferences', async () => {
  const runtime = new Runtime('/unused', {}); const order = [];
  const a = runtime.schedule('a',1,async () => { order.push('a-start'); await delay(30); order.push('a-end'); });
  const install = runtime.schedule('@install',2,async () => { order.push('install-start'); await delay(30); order.push('install-end'); });
  await a; await delay(5);
  const b = runtime.schedule('b',0,async () => order.push('b'));
  await Promise.all([install,b]); assert.deepEqual(order,['a-start','a-end','install-start','install-end','b']); await runtime.close();
});
test('queued cancellation and admission bounds do not disrupt a running package', async () => {
  const runtime = new Runtime('/unused', {}); let release;
  const active = runtime.schedule('a',1,() => new Promise(r => { release = r; }));
  const cancellation = new AbortController();
  const queued = assert.rejects(runtime.schedule('a',1,() => assert.fail('cancelled job ran'),cancellation.signal),/cancelled/);
  cancellation.abort(); await queued;
  const jobs = Array.from({length:8},() => runtime.schedule('a',1,async () => true));
  await assert.rejects(runtime.schedule('a',0,async () => false),/busy/);
  release(); await Promise.all([active,...jobs]); await runtime.close();
});
test('shutdown aborts active work and settles before releasing the store', async () => {
  const runtime = new Runtime('/unused', {}); let completed = false;
  const work = assert.rejects(runtime.schedule('a',1,signal => new Promise((_,reject) => {
    signal.addEventListener('abort',() => { completed = true; reject(new Error('cancelled')); },{once:true});
  })),/cancelled/);
  await delay(1); await runtime.close(); await work; assert.equal(completed,true); assert.equal(runtime.active.size,0);
});
test('leased workers survive eviction and installation; queued third source runs after release', async () => {
  const runtime = new Runtime('/unused', {}, {limit:2,browseReserve:0});
  runtime.leases.owns=async()=>true;
  const worker=()=>({pid:process.pid,generation:1,retain(){return ()=>{};},close(){assert.fail('leased worker closed');}});
  const a=worker(),b=worker(); runtime.workers.set('a',a);runtime.workers.set('b',b);
  const leases=[];
  try {
    for(const [id,w] of [['a',a],['b',b]]) leases.push((await runtime.leases.create(id,w,[{url:'http://127.0.0.1:123/session/a/list'}])).lease);
    await assert.rejects(runtime.install(Buffer.from('test'),'https://repo.test',{}),/playback_active/);
    let started=false;
    const waiting=runtime.schedule('c',1,async()=>{started=true;}); await delay(15);assert.equal(started,false);
    a.close=()=>{};runtime.leases.release(leases[0]);await waiting;assert.equal(started,true);
  } finally {a.close=()=>{};b.close=()=>{};await runtime.close();}
});

test('each protected playback freezes its JVM, including two accounts playing the same episode', async () => {
  const workers=[];
  const runtime=new Runtime('/unused',{worker(){
    const worker={pid:1000+workers.length,generation:1,calls:[],closed:false,cacheKey:'v1',
      retain(){return ()=>{};},close(){this.closed=true;this.pid=undefined;},
      async request(method,params){this.calls.push({method,params});return [{url:'http://127.0.0.1:123/session/'+this.pid+'/playlist.m3u8'}];}};
    workers.push(worker);return worker;
  }});
  runtime.store.record=()=>({cacheKey:'v1',metadata:{}});runtime.store.verify=async()=>{};runtime.store.paths=()=>({jar:'fixture',state:'fixture'});
  runtime.leases.owns=async()=>true;
  try {
    const a=await runtime.invoke('same','videos',{episodeUrl:'/one'},undefined,true);
    const b=await runtime.invoke('same','videos',{episodeUrl:'/one'},undefined,true);
    assert.notEqual(a.lease,b.lease);assert.equal(workers.length,2);
    assert.deepEqual(workers.map(w=>w.calls.length),[1,1]);
    assert.notEqual(runtime.leases.get(a.lease).pid,runtime.leases.get(b.lease).pid);
    await assert.rejects(runtime.invoke('same','videos',{episodeUrl:'/two'},undefined,true),/apk_playback_capacity/);
    assert.equal(workers.length,3);assert.equal(workers[2].closed,true);
    runtime.leases.release(a.lease);const c=await runtime.invoke('same','videos',{episodeUrl:'/two'},undefined,true);
    assert.equal(workers[0].closed,true);assert.equal(workers[1].closed,false);
    assert.equal(workers[1].calls.length,1);assert.equal(runtime.status().workers,2);
    assert.equal(runtime.leases.get(b.lease).pid,workers[1].pid);
    runtime.leases.release(b.lease);runtime.leases.release(c.lease);
  }finally{await runtime.close();}
});

test('browse reserve starts lazily, remains usable with two movies, and can extract public streams', async () => {
  const workers=[];
  const runtime=new Runtime('/unused',{worker(){
    const worker={pid:2000+workers.length,generation:1,calls:[],close(){this.pid=undefined;},retain(){return ()=>{};},
      async request(method,params){this.calls.push(method);return method==='videos'?[{url:params.public?'https://cdn.test/live.m3u8':`http://127.0.0.1:123/session/${this.pid}/index.m3u8`}]:{items:[]};}};
    workers.push(worker);return worker;
  }});
  runtime.store.record=()=>({cacheKey:'v1',metadata:{}});runtime.store.verify=async()=>{};runtime.store.paths=()=>({jar:'fixture',state:'fixture'});runtime.leases.owns=async()=>true;
  try {
    assert.equal(workers.length,0);
    const a=await runtime.invoke('factory','videos',{},undefined,true);assert.equal(workers.length,1);
    const b=await runtime.invoke('factory','videos',{},undefined,true);assert.equal(workers.length,2);
    await runtime.invoke('factory','list');assert.equal(workers.length,3);
    const live=await runtime.invoke('factory','videos',{public:true},undefined,true);assert.equal(live.lease,undefined);
    assert.deepEqual(workers.slice(0,2).map(w=>w.calls),[['videos'],['videos']]);
    assert.equal(runtime.status().workers,3);assert.equal(runtime.leases.size,2);
    runtime.leases.release(a.lease);assert.equal(workers[0].pid,undefined);
    assert.equal(runtime.status().workers,2);runtime.leases.release(b.lease);
  } finally {await runtime.close();}
});

test('single-user browsing retains the original two-worker budget', async () => {
  const workers=[];
  const runtime=new Runtime('/unused',{worker(){
    const worker={pid:3000+workers.length,generation:1,close(){this.pid=undefined;},async request(){return {items:[]};}};
    workers.push(worker);return worker;
  }});
  runtime.store.record=()=>({cacheKey:'v1',metadata:{}});runtime.store.verify=async()=>{};runtime.store.paths=()=>({jar:'fixture',state:'fixture'});
  try {
    for(const source of ['a','b','c','d']) {
      await runtime.invoke(source,'list');assert.ok(runtime.status().workers<=2);
    }
    assert.equal(runtime.status().workers,2);assert.equal(workers[0].pid,undefined);assert.equal(workers[1].pid,undefined);
  } finally {await runtime.close();}
});
