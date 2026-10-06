import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.MOA_PLAYWRIGHT_PATH || 'playwright-core');
process.env.VITE_MOCK = '1';
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.MOA_BROWSER_EXECUTABLE });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  // Use the real mock handler: do not intercept /profiles/lock with a fake success.
  await page.goto(new URL('profiles', server.resolvedUrls.local[0]).href);
  const first = page.locator('.profile-tile').first();
  await first.waitFor();
  await page.waitForFunction(() => !document.querySelector('.profile-tile')?.disabled);
  await first.click();
  await page.waitForURL(url => url.pathname === '/');
  assert.ok(await page.evaluate(() => localStorage.getItem('moa.profile')));
  const request = (url, method = 'GET', body, headers = {}) => page.evaluate(async ({ url, method, body, headers }) => {
    const response = await fetch('/api' + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { url, method, body, headers });
  const created = await request('/profiles', 'POST', { name: 'Synthetic locked profile', pin: '1234', avatar: 'cat-1' });
  assert.equal(created.status, 201);
  const id = created.body.id, headers = { 'X-Moa-Profile': id };
  assert.equal(created.body.hasPin, true);
  assert.equal('pin' in created.body, false);
  assert.equal((await request('/profiles/lock', 'POST')).status, 204);
  assert.equal((await request('/settings', 'GET', undefined, headers)).status, 401);
  assert.equal((await request(`/profiles/${id}`, 'PATCH', { name: 'Blocked' })).status, 401);
  assert.equal((await request(`/profiles/${id}/unlock`, 'POST', { pin: '9999' })).body.error, 'profile-pin-invalid');
  assert.equal((await request(`/profiles/${id}/unlock`, 'POST', { pin: '1234' })).status, 204);
  assert.equal((await request('/settings', 'GET', undefined, headers)).status, 200);
  assert.equal((await request(`/profiles/${id}`, 'PATCH', { pin: '5678', name: 'Updated profile' })).status, 200);
  await request('/profiles/lock', 'POST');
  assert.equal((await request(`/profiles/${id}/unlock`, 'POST', { pin: '1234' })).status, 401);
  assert.equal((await request(`/profiles/${id}/unlock`, 'POST', { pin: '5678' })).status, 204);
  assert.equal((await request(`/profiles/${id}`, 'PATCH', { pin: null })).body.hasPin, false);
  await request('/profiles/lock', 'POST');
  assert.equal((await request('/settings', 'GET', undefined, headers)).status, 200);
  assert.equal((await request(`/profiles/${id}`, 'DELETE')).status, 204);
  assert.equal((await request(`/profiles/${id}/unlock`, 'POST', { pin: '5678' })).status, 404);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS actual VITE_MOCK profile entry from empty storage, PIN lifecycle, lock isolation and deletion');
} finally { await browser.close(); await server.close(); }
