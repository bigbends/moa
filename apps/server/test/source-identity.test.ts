import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/db.js';
import {Catalog} from '../src/catalog.js';
import {Sources} from '../src/sources.js';
import {sourceIdentity,SourceIdentities} from '../src/source-identity.js';

test('numbered source mirrors preserve paths, query and fragment but isolate unrelated hosts',()=>{
 const base='https://example12.test';
 assert.equal(sourceIdentity('https://example13.test/work/7?q=1#ep2',base),sourceIdentity('/work/7?q=1#ep2',base));
 for(const other of ['https://foreign.test/work/7?q=1#ep2','/work/7?q=2#ep2','/work/7?q=1#ep3','https://example13.test:8443/work/7?q=1#ep2'])assert.notEqual(sourceIdentity(other,base),sourceIdentity('/work/7?q=1#ep2',base));
 assert.match(sourceIdentity('{"url":"/work"}',base),/opaque/);
});

test('existing work/episode IDs and two profiles survive mirror change and database reopen',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'source-identity-'));let db=new Store(dir);let sources:Sources|undefined;
 let origin='https://example12.test';
 const runtime=async(input:any)=>({result:input.action==='list'?{list:[{name:'Same title',link:origin+'/work/7'}],hasNextPage:false}:{name:'Same title',chapters:[{name:'1화',url:origin+'/watch/7?episode=1#v'}]},changes:{}});
 try{
  let catalog=new Catalog(db);sources=new Sources(db,catalog,runtime);
  const entry=JSON.stringify({id:'fixture',name:'Test',version:'1',baseUrl:origin,format:'mangayomi-js'});
  db.run('INSERT INTO source_entries(id,repository,entry,installed_entry,code,enabled) VALUES(?,?,?,?,?,1)','s','https://repo.test/index.json',entry,entry,'fixture');
  for(const p of ['p1','p2'])db.run('INSERT INTO profiles(id,name,color,kids,created_at) VALUES(?,?,?,?,?)',p,p,'blue',0,'2026');
  const first=(await sources.browse('s','p1')).items[0].id;await sources.detail(first);
  const ep=db.get('SELECT id FROM episodes WHERE media_id=?',first)!.id;
  db.run('INSERT INTO progress VALUES(?,?,?,?,?,?)','p1',ep,300,1200,0,'2026');
  db.run('INSERT INTO progress VALUES(?,?,?,?,?,?)','p2',ep,900,1200,0,'2026');
  db.run('INSERT INTO watchlist VALUES(?,?,?)','p1',first,'2026');
  // Simulate upgrading an old database with no identity indexes.
  await sources.close();db.db.exec('DROP TABLE source_work_identity;DROP TABLE source_episode_identity');db.close();
  db=new Store(dir);catalog=new Catalog(db);sources=new Sources(db,catalog,runtime);
  origin='https://example13.test';sources.invalidate('s');
  assert.equal((await sources.browse('s','p1')).items[0].id,first);
  await sources.detail(first);
  assert.equal(db.get('SELECT COUNT(*) n FROM media')!.n,1);
  assert.equal(db.get('SELECT COUNT(*) n FROM episodes')!.n,1);
  assert.equal(db.get('SELECT url FROM source_episodes WHERE episode_id=?',ep)!.url,origin+'/watch/7?episode=1#v');
  assert.deepEqual(db.all('SELECT position FROM progress ORDER BY profile_id').map(r=>r.position),[300,900]);
  assert.equal(db.get('SELECT media_id FROM watchlist')!.media_id,first);
  const identities=new SourceIdentities(db);
  assert.equal(identities.findWork('other',origin+'/work/7','https://example12.test'),undefined);
  assert.equal(identities.findEpisode(first,origin+'/watch/7?episode=2#v','https://example12.test'),undefined);
  // Pre-existing ambiguity must not merge or delete either history.
  db.run('INSERT INTO media VALUES(?,NULL,?,?,?,?)','duplicate','Same title','series','{}','2026');
  identities.work('s','duplicate','https://example14.test/work/7','https://example12.test');
  assert.equal(identities.findWork('s','https://example15.test/work/7','https://example12.test'),undefined);
 }finally{await sources?.close();db.close();await rm(dir,{recursive:true,force:true});}
});
