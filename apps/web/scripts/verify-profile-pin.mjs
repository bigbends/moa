import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { buildApp } from '../../server/src/app.ts';
import { verificationPath } from './verification-path.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.MOA_PLAYWRIGHT_PATH || 'playwright-core');
const dir = await mkdtemp(path.join(tmpdir(), 'moa-pin-browser-'));
const mediaRoot = path.join(dir, 'media'); await mkdir(mediaRoot);
const { app } = await buildApp({ dataDir: dir, mediaRoot, webDir: path.join(dir, 'web'), requireAccount: false }, false);
process.env.MOA_API = await app.listen({ host: '127.0.0.1', port: 0 });
process.env.VITE_MOCK = '0';
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { port: 0, open: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.MOA_BROWSER_EXECUTABLE });
const errors = [];
try {
  for (const width of [1280, 390]) {
    const name = `잠금 프로필 ${width}`;
    const created = await app.inject({ method: 'POST', url: '/api/profiles', payload: { name, pin: '1234', avatar: 'cat-1' } });
    assert.equal(created.statusCode, 201);
    const profile = created.json();
    await app.inject({ method: 'POST', url: '/api/profiles', payload: { name: `공용 ${width}` } });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(() => localStorage.setItem('moa.remoteMode', 'off'));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    const base = server.resolvedUrls.local[0];
    const settingsStatus = () => page.evaluate(async id => (await fetch('/api/settings', { headers: { 'X-Moa-Profile': id } })).status, profile.id);
    const enterPin = async value => { await page.locator('input[aria-label="PIN"]').fill(value); await page.getByRole('button', { name: '확인', exact: true }).click(); };
    await page.goto(`${base}profiles`);
    await page.getByRole('button', { name: `${name} PIN 잠금`, exact: true }).click();
    await enterPin('9999');
    await page.getByRole('alert').filter({ hasText: 'PIN이 일치하지 않아요.' }).waitFor();
    assert.equal(await settingsStatus(), 401);
    await enterPin('1234');
    await page.waitForURL(base);
    assert.equal(await settingsStatus(), 200);
    if (width > 720) {
      await page.getByRole('button', { name: '프로필 메뉴' }).click();
      await page.getByRole('menuitem', { name: '프로필 전환' }).click();
    } else {
      await page.goto(`${base}me`);
      await page.getByRole('button', { name: '프로필 전환' }).click();
    }
    await page.getByRole('button', { name: '프로필 관리', exact: true }).click();
    assert.equal(await settingsStatus(), 401);
    await page.getByRole('button', { name: `${name} 편집`, exact: true }).click();
    await enterPin('1234');
    await page.getByRole('heading', { name: '프로필 편집', exact: true }).waitFor();
    await page.getByLabel('새 PIN', { exact: true }).fill('5678');
    await page.getByLabel('PIN 확인', { exact: true }).fill('5679');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '동일하게 두 번' }).waitFor();
    await page.getByLabel('PIN 확인', { exact: true }).fill('5678');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: verificationPath(`profile-pin-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('button', { name: `${name} 편집`, exact: true }).click();
    assert.equal(await settingsStatus(), 401);
    await enterPin('1234');
    await page.getByRole('alert').filter({ hasText: 'PIN이 일치하지 않아요.' }).waitFor();
    await enterPin('5678');
    await page.getByRole('switch', { name: 'PIN 잠금', exact: true }).click();
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('button', { name: `${name} 편집`, exact: true }).click();
    await page.getByRole('heading', { name: '프로필 편집', exact: true }).waitFor();
    assert.equal(await settingsStatus(), 200);
    await page.getByRole('switch', { name: 'PIN 잠금', exact: true }).click();
    await page.getByLabel('PIN', { exact: true }).fill('9876');
    await page.getByLabel('PIN 확인', { exact: true }).fill('9876');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('button', { name: `${name} 편집`, exact: true }).click();
    await enterPin('9876');
    await page.getByRole('button', { name: '프로필 삭제', exact: true }).click();
    await page.getByRole('button', { name: '삭제', exact: true }).click();
    await page.getByRole('heading', { name: '프로필 관리', exact: true }).waitFor();
    assert.equal((await app.inject('/api/profiles')).json().some(item => item.id === profile.id), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('Profile PIN desktop/mobile selection, edit protection, set/change/remove, delete and server lock checks passed.');
} finally {
  await browser.close(); await server.close(); await app.close(); await rm(dir, { recursive: true, force: true });
}
