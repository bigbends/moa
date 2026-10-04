import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstallationStore } from './store.mjs';

const repository = 'https://example.org/aniyomi/index.min.json';
const metadata = () => ({ pkg: 'org.example.video', entry: 'org.example.Entry', code: 12, version: '14.12', signers: ['a'.repeat(64)] });
const sources = [{ id: '900000000000000001', name: '영화', lang: 'ko' }, { id: '9000000000000000001', name: '애니', lang: 'ko' }];
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'moa-apk-store-')); let conversions = 0;
  const tools = { fingerprint: 'api14-v1', inspect: async () => metadata(), convert: async (_, to) => { conversions++; await writeFile(to, 'converted-jar'); }, describe: async () => sources };
  let store = await new InstallationStore(root, tools).open();
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  return { root, tools, get store() { return store; }, get conversions() { return conversions; }, reopen: async () => { await store.close(); store = await new InstallationStore(root, tools).open(); } };
}
test('conversion persists across restarts and retains exact 64-bit factory source IDs', async t => {
  const s = await setup(t), bytes = Buffer.from('first-apk');
  const first = await s.store.install(bytes, repository, metadata());
  assert.equal(first.cacheHit, false); assert.deepEqual(first.sources, sources); assert.equal(s.conversions, 1);
  await s.reopen();
  const next = await s.store.install(bytes, repository, metadata());
  assert.equal(next.cacheHit, true); assert.equal(next.id, first.id); assert.equal(s.conversions, 1); await s.store.verify(next);
});
test('toolchain changes reprepare; corrupted cache is never silently executed', async t => {
  const s = await setup(t), bytes = Buffer.from('first-apk');
  const first = await s.store.install(bytes, repository);
  await writeFile(s.store.paths(first).jar, 'tampered');
  await assert.rejects(s.store.verify(first), /cache_integrity/);
  assert.equal((await s.store.install(bytes, repository)).cacheHit, false); assert.equal(s.conversions, 2);
  s.tools.fingerprint = 'api14-v2'; await assert.rejects(s.store.verify(first), /reprepare/);
  const rebuilt = await s.store.install(bytes, repository); assert.notEqual(rebuilt.cacheKey, first.cacheKey); assert.equal(s.conversions, 3);
});
test('signature change, downgrade, index mismatch, and failed preparation preserve active installation', async t => {
  const s = await setup(t); const first = await s.store.install(Buffer.from('first-apk'), repository);
  const unchanged = async () => assert.equal(s.store.record(first.id).digest, first.digest);
  s.tools.inspect = async () => ({ ...metadata(), code: 13, version: '14.13', signers: ['b'.repeat(64)] });
  await assert.rejects(s.store.install(Buffer.from('next-apk'), repository), /publisher_changed/); await unchanged();
  s.tools.inspect = async () => ({ ...metadata(), code: 11, version: '14.11' });
  await assert.rejects(s.store.install(Buffer.from('older-apk'), repository), /version_not_newer/); await unchanged();
  s.tools.inspect = async () => metadata();
  await assert.rejects(s.store.install(Buffer.from('first-apk'), repository, { ...metadata(), pkg: 'org.other' }), /index_mismatch/); await unchanged();
  s.tools.inspect = async () => ({ ...metadata(), code: 13, version: '14.13' });
  s.tools.convert = async () => { throw new Error('conversion_failed'); };
  await assert.rejects(s.store.install(Buffer.from('next-apk'), repository), /conversion_failed/); await unchanged();
});
test('same-version republish converts new bytes; malformed factory never activates', async t => {
  const s = await setup(t); const first = await s.store.install(Buffer.from('first-apk'), repository);
  await writeFile(join(s.store.paths(first).state,'preferences.json'),'keep-me');
  const next = await s.store.install(Buffer.from('other-apk'), repository, metadata());
  assert.equal(next.id,first.id); assert.notEqual(next.digest,first.digest); assert.notEqual(next.cacheKey,first.cacheKey);
  assert.equal(next.cacheHit,false); assert.equal(s.conversions,2); assert.equal(next.previous.digest,first.digest);
  assert.equal(await readFile(join(s.store.paths(next).state,'preferences.json'),'utf8'),'keep-me');
  await s.store.verify(next); await s.reopen(); assert.equal(s.store.record(next.id).digest,next.digest);
  s.tools.inspect=async()=>({...metadata(),signers:['b'.repeat(64)]});
  await assert.rejects(s.store.install(Buffer.from('foreign-same-code'),repository),/publisher_changed/);
  assert.equal(s.store.record(next.id).digest,next.digest);
  s.tools.inspect = async () => ({ ...metadata(), code: 13, version: '14.13' });
  s.tools.describe = async () => [sources[0], sources[0]];
  await assert.rejects(s.store.install(Buffer.from('next-apk'), repository), /sources_invalid/);
  assert.equal(s.store.snapshot().packages[0].metadata.code, 12);
});
test('simultaneous duplicate installs convert once; repository identity is distinct', async t => {
  const s = await setup(t); const bytes = Buffer.from('first-apk');
  const [a, b] = await Promise.all([s.store.install(bytes, repository), s.store.install(bytes, repository)]);
  assert.equal(a.id, b.id); assert.equal(s.conversions, 1);
  const other = await s.store.install(bytes, 'https://other.example/index.json');
  assert.notEqual(other.id, a.id); assert.equal(other.cacheHit, true); assert.equal(s.store.snapshot().packages.length, 2);
});
test('cancelled preparation and a second supervisor cannot change the inventory', async t => {
  const s = await setup(t);
  await assert.rejects(new InstallationStore(s.root, s.tools).open(), /store_in_use/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(s.store.install(Buffer.from('first-apk'), repository, undefined, controller.signal));
  assert.equal(s.store.snapshot().packages.length, 0);
});
test('update retains the last known working artifact', async t => {
  const s = await setup(t); const first = await s.store.install(Buffer.from('first-apk'), repository);
  s.tools.inspect = async () => ({ ...metadata(), code: 13, version: '14.13' });
  const second = await s.store.install(Buffer.from('next-apk'), repository);
  assert.equal(second.previous.digest, first.digest); assert.equal(await readFile(s.store.paths(first).jar, 'utf8'), 'converted-jar');
});
test('a required source is verified before activation, with only unique exact name/language fallback', async t => {
  const s=await setup(t),first=await s.store.install(Buffer.from('first-apk'),repository);
  s.tools.inspect=async()=>({...metadata(),code:13,version:'14.13'});
  const advertised={...metadata(),code:13,version:'14.13',requiredSource:{id:'42',name:'없는 소스',lang:'ko'}};
  await assert.rejects(s.store.install(Buffer.from('next-apk'),repository,advertised),/source_missing/);
  assert.equal(s.store.record(first.id).digest,first.digest);
  const next=await s.store.install(Buffer.from('next-apk'),repository,{...advertised,requiredSource:{id:'42',name:'영화',lang:'ko'}});
  assert.equal(next.metadata.code,13);assert.equal(next.cacheHit,true);
});
test('API16 preserves manifest validation, persistent conversion and publisher checks',async t=>{
 const s=await setup(t);const newer={...metadata(),version:'16.8',code:8};
 s.tools.inspect=async()=>newer;
 const bytes=Buffer.from('api16-apk');
 const first=await s.store.install(bytes,repository,newer);
 await s.reopen();assert.equal((await s.store.install(bytes,repository,newer)).cacheHit,true);
 assert.equal(s.conversions,1);await s.store.verify(first);
 s.tools.inspect=async()=>({...newer,version:'17.1',code:9});
 await assert.rejects(s.store.install(Buffer.from('unsupported'),repository),/unsupported|metadata/);
 assert.equal(s.store.record(first.id).metadata.version,'16.8');
});


test('remove persists inventory deletion, clears only package state, and permits fresh reinstall',async t=>{
  const s=await setup(t), bytes=Buffer.from('first-apk');
  const first=await s.store.install(bytes,repository);
  await writeFile(join(s.store.paths(first).state,'preferences.json'),'old-state');
  const other=await s.store.install(bytes,'https://other.example/index.json');
  await writeFile(join(s.store.paths(other).state,'preferences.json'),'other-state');
  assert.deepEqual(await s.store.remove(first.id),{removed:true});
  assert.throws(()=>s.store.record(first.id),/not_installed/);
  await assert.rejects(readFile(join(s.store.paths(first).state,'preferences.json')),/ENOENT/);
  assert.equal(await readFile(join(s.store.paths(other).state,'preferences.json'),'utf8'),'other-state');
  await s.reopen();assert.throws(()=>s.store.record(first.id),/not_installed/);
  assert.deepEqual(await s.store.remove(first.id),{removed:false});
  await assert.rejects(s.store.remove('../state'),/request_invalid/);
  const installed=await s.store.install(bytes,repository);assert.equal(installed.id,first.id);assert.equal(installed.cacheHit,true);
  await assert.rejects(readFile(join(s.store.paths(installed).state,'preferences.json')),/ENOENT/);
});

test('republish compares complete signer sets independent of order',async t=>{
  const s=await setup(t),a='a'.repeat(64),b='b'.repeat(64);
  s.tools.inspect=async()=>({...metadata(),signers:[a,b]});
  const first=await s.store.install(Buffer.from('first-apk'),repository);
  s.tools.inspect=async()=>({...metadata(),signers:[b,a]});
  const next=await s.store.install(Buffer.from('republished-apk'),repository);assert.notEqual(next.digest,first.digest);
  s.tools.inspect=async()=>({...metadata(),signers:[a]});
  await assert.rejects(s.store.install(Buffer.from('missing-signer'),repository),/publisher_changed/);
  assert.equal(s.store.record(first.id).digest,next.digest);
});
