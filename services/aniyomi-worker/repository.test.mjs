import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRepository } from './repository.mjs';
const item={name:'Factory',pkg:'org.example.factory',code:12,version:'14.12',apk:'aniyomi-factory-v14.12.apk',sources:[{id:'900000000000000001',name:'애니',lang:'ko'}]};
const parse = rows => parseRepository(Buffer.from(JSON.stringify(rows)), 'https://example.com/aniyomi/index.min.json');
test('index preserves string IDs and resolves APKs beneath the supplied repository',()=>{
 const [r]=parse([item]);assert.equal(r.sources[0].id,item.sources[0].id);assert.equal(r.supportedVersion,true);assert.match(r.apkUrl,/\/aniyomi\/apk\/aniyomi-factory-v14\.12\.apk$/);
});
test('path escapes, duplicate packages, lossy numeric IDs, and duplicate factory IDs are rejected',()=>{
 for(const apk of ['../evil.apk','/evil.apk','https://evil/evil.apk','file.apk?x=1'])assert.throws(()=>parse([{...item,apk}]),/index_invalid/);
 assert.throws(()=>parse([item,item]),/index_invalid/);
 assert.throws(()=>parse([{...item,sources:[{...item.sources[0],id:Number(item.sources[0].id)}]}]),/index_invalid/);
 assert.throws(()=>parse([{...item,sources:[...item.sources,...item.sources]}]),/index_invalid/);
});
test('unsupported versions remain visible but are not declared installable',()=>{
 assert.equal(parse([{...item,version:'17.1'}])[0].supportedVersion,false);
});
test('API16 packages are installable with repository-relative downloads',()=>{
 const repository='https://example.org/extensions/index.min.json';
 const [entry]=parseRepository(Buffer.from(JSON.stringify([{...item,version:'16.8',apk:'sample-en-v16.8.apk'}])),repository);
 assert.equal(entry.supportedVersion,true);
 assert.equal(entry.apkUrl,'https://example.org/extensions/apk/sample-en-v16.8.apk');
 for(const version of ['13.1','15.1','17.1','16.x','16.8beta'])assert.equal(parse([{...item,version}])[0].supportedVersion,false);
});

test('repository URL is required and must be explicit HTTPS',()=>{
 for(const url of [undefined, null, '', 'garbage', 'http://example.com/index.json'])
   assert.throws(()=>parseRepository(Buffer.from('[]'),url),/apk_repository_invalid/);
});
