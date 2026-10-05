import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pluginPackage } from '../src/website-plugins.js';
import { buildApp } from '../src/app.js';

const template = { ...JSON.parse(await readFile(new URL('../../../plugins/template/manifest.json', import.meta.url), 'utf8')), html: '<p>Plugin test</p>' };

test('plugin packages validate permissions, sizes, origins and API versions', () => {
  assert.deepEqual(pluginPackage(template), template);
  for (const patch of [{ apiVersion: 2 }, { id: '../x' }, { permissions: ['admin'] }, { permissions: ['player.context', 'player.context'] }, { placements: [] }, { connect: ['http://example.org'] }, { connect: ['https://example.org/path'] }, { connect: ['https://user:pass@example.org'] }, { html: 'x'.repeat(200 * 1024 + 1) }, { future: true }]) {
    assert.throws(() => pluginPackage({ ...template, ...patch }));
  }
  assert.doesNotThrow(() => pluginPackage({ ...template, connect: ['https://example.org'] }));
});

test('plugin installation persists, admin controls are protected and network access is limited', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'moa-plugin-'));
  let env = await buildApp({ dataDir: directory, mediaRoot: directory, requireAccount: true }, false);
  const admin = { 'x-moa-account': 'owner', 'x-moa-role': 'admin' }, member = { 'x-moa-account': 'member', 'x-moa-role': 'member' };
  try {
    const p = (await env.app.inject({ method: 'POST', url: '/api/profiles', headers: member, payload: { name: 'Member' } })).json();
    const profile = { ...member, 'x-moa-profile': p.id };
    assert.equal((await env.app.inject({ method: 'POST', url: '/api/admin/plugins', headers: member, payload: template })).statusCode, 403);
    assert.equal((await env.app.inject({ method: 'POST', url: '/api/admin/plugins', payload: template })).statusCode, 401);
    assert.equal((await env.app.inject({ method: 'POST', url: '/api/admin/plugins', headers: admin, payload: template })).statusCode, 200);
    assert.equal((await env.app.inject({ url: '/api/plugins', headers: member })).statusCode, 401);
    const listing = (await env.app.inject({ url: '/api/plugins', headers: profile })).json();
    assert.equal(listing.length, 1); assert.equal(listing[0].html, undefined);
    const endpoint = `/api/plugins/${template.id}`;
    let revision = listing[0].revision;
    assert.equal((await env.app.inject({ url: endpoint, headers: profile })).json().html, template.html);
    assert.equal((await env.app.inject({ method: 'POST', url: endpoint + '/request', headers: profile, payload: { url: 'https://example.org/file.srt', revision } })).statusCode, 403);
    await env.app.inject({ method: 'POST', url: '/api/admin/plugins', headers: admin, payload: { ...template, connect: ['https://127.0.0.1'] } });
    assert.equal((await env.app.inject({ method: 'POST', url: endpoint + '/request', headers: profile, payload: { url: 'https://127.0.0.1/file.srt', revision } })).statusCode, 409);
    revision = (await env.app.inject({ url: endpoint, headers: profile })).json().revision;
    assert.equal((await env.app.inject({ method: 'POST', url: endpoint + '/request', headers: profile, payload: { url: 'https://127.0.0.1/file.srt', revision } })).statusCode, 502);
    assert.equal((await env.app.inject({ method: 'POST', url: endpoint + '/request', headers: profile, payload: { url: 'https://127.0.0.1/file.srt', method: 'POST' } })).statusCode, 400);
    assert.equal((await env.app.inject({ method: 'PATCH', url: `/api/admin/plugins/${template.id}`, headers: member, payload: { enabled: false } })).statusCode, 403);
    await env.app.inject({ method: 'PATCH', url: `/api/admin/plugins/${template.id}`, headers: admin, payload: { enabled: false } });
    await env.app.inject({ method: 'POST', url: '/api/admin/plugins', headers: admin, payload: { ...template, version: '1.0.1' } });
    assert.equal((await env.app.inject({ url: endpoint, headers: profile })).statusCode, 404);
    assert.deepEqual((await env.app.inject({ url: '/api/plugins', headers: profile })).json(), []);
    await env.app.close();
    env = await buildApp({ dataDir: directory, mediaRoot: directory, requireAccount: true }, false);
    const saved = env.db.get('SELECT * FROM website_plugins WHERE id=?', template.id)!;
    assert.equal(JSON.parse(saved.package).version, '1.0.1'); assert.equal(saved.enabled, 0);
    await env.app.inject({ method: 'PATCH', url: `/api/admin/plugins/${template.id}`, headers: admin, payload: { enabled: true } });
    assert.equal((await env.app.inject({ url: endpoint, headers: profile })).statusCode, 200);
    await env.app.inject({ method: 'DELETE', url: `/api/admin/plugins/${template.id}`, headers: admin });
    assert.equal((await env.app.inject({ url: endpoint, headers: profile })).statusCode, 404);
  } finally { await env.app.close(); await rm(directory, { recursive: true, force: true }); }
});
