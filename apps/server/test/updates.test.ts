import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { Updates } from '../src/updates.js';

test('updates require an administrator and a live agent; requests contain only fixed actions', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'moa-updates-api-'));
  const stateDir = path.join(dir, 'updater');
  await mkdir(stateDir);
  const previous = process.env.MOA_UPDATER_DIR;
  process.env.MOA_UPDATER_DIR = stateDir;
  const { app } = await buildApp({ dataDir: dir, mediaRoot: path.join(dir, 'media'), webDir: path.join(dir, 'web'), requireAccount: true }, false);
  const admin = { 'x-moa-account': 'admin', 'x-moa-role': 'admin' };
  const member = { 'x-moa-account': 'member', 'x-moa-role': 'member' };
  const state = { connected: true, state: 'available', mode: 'git', current: 'abc', latest: 'def', branch: 'feature', behind: 1, ahead: 0, checkedAt: Date.now(), heartbeat: Date.now(), error: null };
  try {
    for (const [method, url] of [['GET', '/api/admin/updates'], ['POST', '/api/admin/updates/check'], ['POST', '/api/admin/updates/apply']] as const) {
      assert.equal((await app.inject({ method, url })).statusCode, 401);
      assert.equal((await app.inject({ method, url, headers: member })).statusCode, 403);
    }
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/updates/check', headers: admin })).statusCode, 503);
    await writeFile(path.join(stateDir, 'status.json'), JSON.stringify(state));
    const status = await app.inject({ url: '/api/admin/updates', headers: admin });
    assert.equal(status.json().connected, true);
    assert.equal(status.headers['cache-control'], 'private, no-store');
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/updates/apply', headers: admin, payload: { command: 'anything' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/updates/apply', headers: admin })).statusCode, 202);
    const request = JSON.parse(await readFile(path.join(stateDir, 'request.json'), 'utf8'));
    assert.deepEqual(Object.keys(request).sort(), ['action', 'createdAt', 'id']);
    assert.equal(request.action, 'apply');
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/updates/apply', headers: admin })).statusCode, 409);
    await rm(path.join(stateDir, 'request.json'));
    await writeFile(path.join(stateDir, 'status.json'), JSON.stringify({ ...state, state: 'current' }));
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/updates/apply', headers: admin })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/updates/check', headers: admin, payload: {} })).statusCode, 202);
    await rm(path.join(stateDir, 'request.json'));
    await writeFile(path.join(stateDir, 'status.json'), JSON.stringify({ ...state, heartbeat: 1 }));
    assert.equal((await app.inject({ url: '/api/admin/updates', headers: admin })).json().connected, false);
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/updates/check', headers: admin })).statusCode, 503);
    assert.equal((await new Updates('').status()).configured, false);
  } finally {
    if (previous === undefined) delete process.env.MOA_UPDATER_DIR; else process.env.MOA_UPDATER_DIR = previous;
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
