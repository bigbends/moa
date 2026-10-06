import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import Fastify from 'fastify';
import type { MangayomiInvocation } from '@moa/extensions';
import { Sources } from '../src/sources.js';
import { Store } from '../src/db.js';
import { Catalog } from '../src/catalog.js';
import { ApkBridge } from '../src/apk-bridge.js';
import { SourceBrowser } from '../src/source-browser.js';
import { RemotePlayback } from '../src/remote-playback.js';

const metadata = { id:'guest-id',name:'Synthetic',format:'mangayomi-js',version:'1',baseUrl:'https://source.test/',iconUrl:'https://source.test/icon.png' };
const defaultProxy = 'socks5://default.test:1080', ownProxy = 'socks5://individual.test:1080';

test('host source network is isolated, defaults off, preserves reinstall, and scopes extraction, images and playback to the same proxy', async t => {
  const root = await mkdtemp(join(tmpdir(),'moa-source-network-')), db = new Store(root), catalog = new Catalog(db);
  const seen: MangayomiInvocation[] = [], downloads: (string|undefined)[] = [], registry: (string|undefined)[] = [];
  class Browser extends SourceBrowser {
    constructor(){ super({}); }
    override get configured(){ return true; }
    override async evaluate(scope:string,proxy:string|undefined,input:any){ browserCalls.push({scope,proxy,url:input.url,headers:input.headers}); return Buffer.from('browser-image').toString('base64'); }
  }
  const browserCalls:any[]=[];
  const sources = new Sources(db,catalog,async input=>{
    seen.push(input);
    assert.ok(!Object.hasOwn(input.preferences||{},'__moa_proxy') && !Object.hasOwn(input.preferences||{},'__moa_browser'));
    const result = input.action === 'preferences' ? [
      {key:'label',editTextPreference:{title:'Label',value:'default'}},
      {key:'__moa_browser',switchPreferenceCompat:{title:'Guest collision',value:true}},
    ] : input.action === 'filters' ? {browse:{filters:[],availableModes:['popular']}} : input.action === 'detail' ? {name:'Synthetic',chapters:[{name:'1',url:'/episode'}]} : input.action === 'videos' ? [{url:'https://media.test/stream.mp4'}] : {list:[{name:'Synthetic',link:'/work',imageUrl:'https://source.test/poster.png'}],hasNextPage:false};
    // Guest attempts to write reserved keys never affect host settings or persist as guest state.
    return {result,changes:{label:input.preferences?.label||'default',__moa_proxy:'socks5://guest.test:9999',__moa_browser:true}};
  },async (_entry,_signal,proxy)=>{downloads.push(proxy);return {source:'synthetic',sha256:'digest'};},async (_url,_signal,proxy)=>{registry.push(proxy);return [];},undefined,new Browser());
  const remote = new RemotePlayback(db,catalog,sources,async (url,_headers,_signal,proxy)=>{
    assert.equal(proxy,ownProxy);
    const response = Readable.from(['synthetic']) as any;
    response.statusCode=200;response.headers={'content-type':'video/mp4'};
    return {response,url};
  });
  const app = Fastify(); app.get('/api/playback/:id/remote/:asset',async (req,reply)=>{ const p=req.params as any;return remote.proxy(req,reply,p.id,p.asset); });
  t.after(async()=>{await app.close();remote.close();await sources.close();db.close();await rm(root,{recursive:true,force:true});});
  for(const id of ['a','b'])db.run('INSERT INTO source_entries(id,repository,entry,installed_entry,code,enabled,preferences) VALUES(?,?,?,?,?,1,?)',id,'https://repo.test/index.json',JSON.stringify(metadata),JSON.stringify(metadata),'synthetic','{"__moa_proxy":"old-guest-value"}');
  db.run('INSERT INTO profiles(id,name,color,kids,created_at) VALUES(?,?,?,?,?)','p','p','blue',0,'2026');
  sources.saveNetwork(defaultProxy,0);
  assert.equal(sources.proxy('a'),defaultProxy);
  const fields=await sources.preferences('a');
  assert.equal(fields.find(p=>p.key==='__moa_proxy')!.value,'');
  assert.equal(fields.filter(p=>p.key==='__moa_browser').length,1);
  assert.equal(fields.find(p=>p.key==='__moa_browser')!.value,false);
  await sources.capabilities('a');assert.equal(seen.at(-1)!.webview,undefined);assert.equal(seen.at(-1)!.timeoutMs,undefined);
  const oldIcon=sources.list().find(s=>s.id==='a')!.iconUrl!;
  const saved=await sources.preferences('a',{label:'host-saved',__moa_proxy:ownProxy,__moa_browser:true});
  assert.equal(saved.find(p=>p.key==='label')!.value,'host-saved');
  assert.equal(sources.proxy('a'),ownProxy);assert.equal(sources.proxy('b'),defaultProxy);assert.equal(sources.proxy(),defaultProxy);
  assert.notEqual(sources.list().find(s=>s.id==='a')!.iconUrl,oldIcon);
  assert.equal(db.get('SELECT 1 FROM source_images WHERE id=?',oldIcon.split('/').at(-1)!),undefined);
  assert.deepEqual(JSON.parse(sources.row('a').preferences),{label:'host-saved'});
  for(const changes of [{__moa_proxy:3},{__moa_proxy:'socks5://user:private@proxy.test'},{__moa_browser:'true'},{__moa_proxy:defaultProxy,unknown:'bad'}])await assert.rejects(sources.preferences('a',changes));
  assert.equal(sources.proxy('a'),ownProxy);
  await sources.install('a');
  assert.equal(downloads.at(-1),defaultProxy,'registry code downloads keep the server default');
  assert.equal(seen.at(-1)!.outboundProxy,ownProxy);assert.equal(seen.at(-1)!.timeoutMs,120_000);
  await sources.refresh('https://repo.test/index.json');assert.deepEqual(registry,[defaultProxy]);
  assert.equal(db.get('SELECT browser FROM source_network WHERE source_id=?','a')!.browser,1);
  const a=await sources.browse('a','p'),b=await sources.browse('b','p');
  assert.notEqual(a.items[0].poster,b.items[0].poster);
  for(const [page,proxy] of [[a,ownProxy],[b,defaultProxy]] as const){
    const id=page.items[0].poster!.split('/').at(-1)!;
    assert.equal((await sources.imageContent(id,async (_input,_signal,_allow,_limit,selected)=>{assert.equal(selected,proxy);return {bytes:Buffer.from('image'),headers:{},statusCode:200,contentType:'image/png'};})).toString(),'image');
  }
  const denied=async()=>({bytes:Buffer.from('challenge'),headers:{},statusCode:403,contentType:'text/html'});
  const aImage=a.items[0].poster!.split('/').at(-1)!,bImage=b.items[0].poster!.split('/').at(-1)!;
  assert.equal((await sources.imageContent(aImage,denied)).toString(),'browser-image','browser-enabled sources retry blocked images in their session');
  assert.deepEqual(browserCalls,[{scope:'a',proxy:ownProxy,url:'https://source.test/poster.png',headers:{Referer:'https://source.test/'}}]);
  await assert.rejects(sources.imageContent(bImage,denied),{message:'image-unavailable'});
  assert.equal(browserCalls.length,1,'sources without the browser option keep plain image failures');
  await sources.detail(a.items[0].id);
  const episode=db.get('SELECT id FROM episodes WHERE media_id=?',a.items[0].id)!.id;
  const session=await remote.create('p',episode);
  assert.equal(seen.at(-1)!.outboundProxy,ownProxy);
  assert.equal(remote.get(session.sessionId).proxy,ownProxy);
  assert.equal((await app.inject(session.url)).body,'synthetic');
  assert.ok(seen.filter(input=>input.action==='preferences').every(input=>input.webview===undefined && input.timeoutMs===undefined));
  await sources.preferences('a',{__moa_proxy:'',__moa_browser:false});
  assert.equal(sources.proxy('a'),defaultProxy);
  await sources.capabilities('a');assert.equal(seen.at(-1)!.webview,undefined);
  await sources.remove(['a']);assert.equal(db.get('SELECT 1 FROM source_network WHERE source_id=?','a'),undefined);
});

test('unconfigured JS browser is disabled; APK host proxy never enters guest preferences and its existing calls are unchanged',async t=>{
  const root=await mkdtemp(join(tmpdir(),'moa-source-network-apk-')),db=new Store(root),received:any[]=[];
  class Apk extends ApkBridge {
    override async preferences(_package:string,_entry:any,changes?:Record<string,unknown>){received.push(changes);return [{key:'language',title:'Language',kind:'text' as const,secret:false,value:'ko'}];}
    override async call(_package:string,_entry:any,action:string,_params:Record<string,unknown>,proxy:string|undefined){received.push({action,proxy});return {browse:{filters:[],availableModes:['popular']}};}
  }
  const sources=new Sources(db,new Catalog(db),async()=>({result:[],changes:{}}),undefined,undefined,new Apk(),new SourceBrowser({}));
  t.after(async()=>{await sources.close();db.close();await rm(root,{recursive:true,force:true});});
  for(const [id,entry] of [['js',metadata],['apk',{...metadata,format:'aniyomi-apk',package:{pkg:'synthetic'}}]] as const)db.run('INSERT INTO source_entries(id,repository,entry,installed_entry,code,enabled) VALUES(?,?,?,?,?,1)',id,'https://repo.test/index.json',JSON.stringify(entry),JSON.stringify(entry),'synthetic');
  db.run('INSERT INTO source_apk VALUES(?,?)','apk','package');
  sources.saveNetwork(defaultProxy,0);
  const browser=(await sources.preferences('js')).find(p=>p.key==='__moa_browser')!;
  assert.equal(browser.value,false);assert.equal(browser.disabled,true);assert.ok(browser.summary);
  assert.equal(browser.title,'소스 브라우저 사용 - 실험');
  await assert.rejects(sources.preferences('js',{__moa_browser:true}),/source-browser-unavailable/);
  assert.equal(db.get('SELECT browser FROM source_network WHERE source_id=?','js'),undefined);
  const apkFields=await sources.preferences('apk',{language:'en',__moa_proxy:ownProxy});
  assert.deepEqual(received[0],{language:'en'});
  assert.ok(!apkFields.some(p=>p.key==='__moa_browser'));
  await sources.preferences('apk',{__moa_proxy:''});assert.equal(received[1],undefined);
  await assert.rejects(sources.preferences('apk',{__moa_browser:true}),/invalid-source-preference/);
  await sources.preferences('apk',{__moa_proxy:ownProxy});
  await sources.capabilities('apk');assert.deepEqual(received.at(-1),{action:'filters',proxy:ownProxy});
  assert.equal(sources.proxy(),defaultProxy);
});
