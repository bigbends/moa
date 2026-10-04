import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createAuthServer } from './server.mjs';
import { setupCode } from './state.mjs';

test('first setup persists, rejects CSRF and wrong codes, limits attempts, atomically creates one admin, and closes setup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moa-setup-'));
  const cli = (...args) => execFileSync(process.execPath, [new URL('./moa-setup-code', import.meta.url).pathname, ...args], { env: {...process.env, DATA_DIR: dir, CREDENTIALS_FILE: join(dir, 'absent')}, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  let server, db, clock = Date.now();
  try {
    const first = cli(); assert.match(first, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/);
    assert.equal(cli(), first);
    assert.equal(statSync(join(dir, 'sessions.sqlite')).mode & 0o777, 0o600);
    const code = cli('--regenerate'); assert.notEqual(code, first);
    db = new DatabaseSync(join(dir, 'sessions.sqlite'));
    const start = async () => {
      server = createAuthServer({ database: db, credentials: {users: [], csrfSecret:'test-secret'}, origin:'http://localhost', secure:false, allowAnyHost:true, now: () => clock });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    };
    await start();
    await new Promise(resolve => server.close(resolve)); await start();
    assert.equal(setupCode(db), code);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const get = path => fetch(origin + path, {redirect:'manual'});
    assert.equal((await get('/__moa/login')).headers.get('location'), '/__moa/setup');
    const page = await get('/__moa/setup'); assert.equal(page.status, 200);
    const cookie = page.headers.getSetCookie()[0].split(';')[0];
    const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)[1];
    const post = (data = {}, headers = {}) => fetch(origin + '/__moa/setup', {method:'POST', redirect:'manual', headers:{Origin:origin, Cookie:cookie, 'Content-Type':'application/x-www-form-urlencoded', ...headers}, body:new URLSearchParams({csrf, code, username:'admin', password:'test-password', confirm:'test-password', ...data})});
    assert.equal((await post({}, {Origin:'http://other.test'})).status, 403);
    assert.equal((await post({csrf:''})).status, 403);
    assert.equal((await post({code:first})).status, 400);
    for (let i=0;i<7;i++) assert.equal((await post({code:'wrong'})).status, 400);
    assert.equal((await post()).status, 429);
    clock += 15 * 60000;
    assert.equal((await post({confirm:'mismatch'})).status, 400);
    const responses = await Promise.all([post(), post()]);
    assert.deepEqual(responses.map(r=>r.status).sort(), [303,409]);
    const success = responses.find(r=>r.status === 303);
    assert.ok(success.headers.getSetCookie().some(c=>c.startsWith('moa_session=')));
    const invite = await fetch(origin + '/__moa/api/invites', {method:'POST', headers:{Origin:origin, Cookie:success.headers.getSetCookie().find(c=>c.startsWith('moa_session=')).split(';')[0], 'X-Moa-Request':'1', 'Content-Type':'application/json'}, body:JSON.stringify({maxUses:1,expiresInDays:1})});
    assert.equal(invite.status,201);
    assert.ok((await invite.json()).url.startsWith(origin + '/__moa/join?'));
    assert.equal(db.prepare('SELECT count(*) n FROM accounts').get().n, 1);
    assert.equal(db.prepare('SELECT role FROM accounts').get().role, 'admin');
    assert.equal(db.prepare("SELECT value FROM auth_state WHERE key='setup-code'").get(), undefined);
    assert.equal((await get('/__moa/setup')).status, 404);
    assert.equal((await post()).status, 404);
    assert.equal(cli(), 'already set up'); assert.equal(cli('--regenerate'), 'already set up');
    assert.equal((await get('/__moa/login')).status, 200);
  } finally { if (server) await new Promise(resolve => server.close(resolve)); db?.close(); rmSync(dir, {recursive:true, force:true}); }
});
