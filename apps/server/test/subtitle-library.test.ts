import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';

test('saved uploads survive restart and preserve profile ownership; admins manage uploaded, AI and online subtitles', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'moa-subtitle-library-'));
  let server = await buildApp({ dataDir: directory, mediaRoot: directory }, false);
  const content = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000 line:20%\n저장 자막\n';
  try {
    const { app, db } = server;
    const owner = (await app.inject({ method: 'POST', url: '/api/profiles', payload: { name: '소유자' } })).json().id;
    const other = (await app.inject({ method: 'POST', url: '/api/profiles', payload: { name: '다른 프로필' } })).json().id;
    const member = { 'x-moa-account': 'member', 'x-moa-role': 'member' };
    const foreign = (await app.inject({ method: 'POST', url: '/api/profiles', headers: member, payload: { name: '다른 계정' } })).json().id;
    db.run("INSERT INTO media VALUES('m',NULL,'저장 작품','movie','{}','2026')");
    db.run("INSERT INTO episodes VALUES('e','m',1,1,'1화',600,NULL)");
    const payload = { episodeId: 'e', filename: '한글.vtt', data: Buffer.from(content).toString('base64') };
    const headers = { 'x-moa-profile': owner };
    const imported = await app.inject({ method: 'POST', url: '/api/subtitles/import', headers, payload });
    assert.equal(imported.statusCode, 200, imported.body);
    const [track] = imported.json();
    assert.equal(track.source, 'upload');
    assert.equal((await app.inject({ method: 'POST', url: '/api/subtitles/import', headers, payload })).json()[0].id, track.id);
    assert.equal((await app.inject({ url: track.url, headers })).body, content);
    assert.equal((await app.inject({ url: track.url, headers: { 'x-moa-profile': other } })).statusCode, 403);
    assert.equal((await app.inject({ url: track.url, headers: member })).statusCode, 403);
    assert.deepEqual((await app.inject({ url: '/api/episodes/e/subtitles/uploads', headers: { ...member, 'x-moa-profile': foreign } })).json(), []);
    assert.equal((await app.inject({ url: '/api/episodes/e/subtitles/uploads', headers })).json()[0].id, track.id);
    assert.equal((await app.inject({ method: 'POST', url: '/api/subtitles/import', headers, payload: { ...payload, episodeId: 'missing' } })).statusCode, 404);
    await app.close();
    server = await buildApp({ dataDir: directory, mediaRoot: directory }, false);
    assert.equal((await server.app.inject({ url: track.url, headers })).body, content);
    assert.equal((await server.app.inject({ url: '/api/episodes/e/subtitles/uploads', headers })).json()[0].id, track.id);
    server.db.run("INSERT INTO translation_cache(key,format,chunks,content,touched,complete) VALUES('translated','vtt','[]',?,?,1)", content, Date.now());
    server.db.run("INSERT INTO translated_subtitles(episode_id,cache_key,created_at) VALUES('e','translated',?)", Date.now());
    server.db.run("INSERT INTO media VALUES('m2',NULL,'다른 작품','anime','{}','2026')");
    server.db.run("INSERT INTO episodes VALUES('e2','m2',2,3,'귀환',600,NULL),('removed','m2',2,4,'삭제한 회차',600,NULL)");
    server.db.run("INSERT INTO translated_subtitles(episode_id,cache_key,created_at) VALUES('e2','translated',?)", Date.now());
    server.db.run("INSERT INTO translation_cache(key,format,chunks,content,touched,complete) VALUES('orphan','vtt','[]',?,?,1)", content, Date.now());
    server.db.run("INSERT INTO translated_subtitles(episode_id,cache_key,created_at) VALUES('removed','orphan',?)", Date.now());
    server.db.run("DELETE FROM episodes WHERE id='removed'");
    server.db.run("INSERT INTO online_subtitles VALUES('online','e','제작자','https://example.com/sub','vtt',?,'hash','token',?)", content, Date.now());
    const listing = await server.app.inject('/api/admin/subtitles');
    assert.equal(listing.statusCode, 200, listing.body);
    assert.equal(listing.json().length, 4);
    assert.equal(listing.json().find((row: any) => row.source === 'upload').profile, '소유자');
    const episode = { id: 'e', mediaId: 'm', season: 1, number: 1, title: '1화', mediaTitle: '저장 작품' };
    assert.deepEqual(listing.json().find((row: any) => row.source === 'upload').episodes, [episode]);
    assert.deepEqual(listing.json().find((row: any) => row.source === 'online').episodes, [episode]);
    assert.deepEqual(listing.json().find((row: any) => row.id === 'translated').episodes, [{ id: 'e2', mediaId: 'm2', season: 2, number: 3, title: '귀환', mediaTitle: '다른 작품' }, episode]);
    assert.deepEqual(listing.json().find((row: any) => row.id === 'orphan').episodes, []);
    for (const row of listing.json()) {
      const url = `/api/admin/subtitles/${row.source}/${row.id}`;
      assert.equal((await server.app.inject({ url: '/api/admin/subtitles', headers: member })).statusCode, 403);
      assert.equal((await server.app.inject({ url: `${url}/content`, headers: member })).statusCode, 403);
      assert.equal((await server.app.inject({ method: 'DELETE', url, headers: member })).statusCode, 403);
      assert.equal((await server.app.inject(`${url}/content`)).body, content);
      if (row.source === 'translation') {
        const work = (server.translations as unknown as { work: Map<string, unknown> }).work;
        work.set(row.id, {});
        assert.equal((await server.app.inject({ method: 'DELETE', url })).statusCode, 409);
        work.delete(row.id);
      }
      assert.equal((await server.app.inject({ method: 'DELETE', url })).statusCode, 204);
      assert.equal((await server.app.inject(`${url}/content`)).statusCode, 404);
    }
    assert.equal((await server.app.inject(track.url)).statusCode, 404);
    assert.equal(server.db.get('SELECT count(*) AS n FROM translated_subtitles')!.n, 0);
    assert.equal(server.db.get('SELECT count(*) AS n FROM online_subtitles')!.n, 0);
    assert.deepEqual((await server.app.inject('/api/admin/subtitles')).json(), []);
    const again = (await server.app.inject({ method: 'POST', url: '/api/subtitles/import', headers, payload })).json()[0];
    await server.app.inject({ method: 'DELETE', url: `/api/profiles/${owner}` });
    assert.equal((await server.app.inject(again.url)).statusCode, 404);
  } finally { await server.app.close(); await rm(directory, { recursive: true, force: true }); }
});
