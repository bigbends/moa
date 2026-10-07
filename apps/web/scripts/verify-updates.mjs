import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { verificationPath } from './verification-path.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.MOA_PLAYWRIGHT_PATH || 'playwright-core');
process.env.VITE_MOCK = '0';
const web = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { port: 0, open: false } });
await web.listen();
const browser = await chromium.launch({ executablePath: process.env.MOA_BROWSER_EXECUTABLE });
const errors = [];
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(() => { localStorage.setItem('moa.profile', 'test'); localStorage.setItem('moa.remoteMode', 'off'); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { errors.push(dialog.type()); await dialog.dismiss(); });
    let status = { configured: true, connected: true, state: 'current', mode: 'docker', current: 'a'.repeat(40), latest: 'a'.repeat(40), branch: 'main', behind: 0, ahead: 0, checkedAt: Date.now(), error: null };
    let applies = 0, role = 'admin';
    await context.route(url => url.pathname.startsWith('/api/'), route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/me') return route.fulfill({ json: { id: 'account', username: '테스트', role } });
      if (path === '/api/profiles') return route.fulfill({ json: [{ id: 'test', name: '테스트', color: 'blue' }] });
      if (path === '/api/settings') return route.fulfill({ json: { autoplayNext: false, preferredQuality: 'auto', defaultSubtitleLang: 'ko', subtitleSize: 'medium', translationMode: 'manual' } });
      if (path === '/api/admin/updates') return route.fulfill({ json: status });
      if (path.endsWith('/updates/check')) { status = { ...status, state: 'available', latest: 'b'.repeat(40), behind: 1 }; return route.fulfill({ status: 202, json: { ...status, state: 'checking' } }); }
      if (path.endsWith('/updates/apply')) { applies++; status = { ...status, state: 'updating' }; return route.fulfill({ status: 202, json: status }); }
      if (path.endsWith('/translation/config')) return route.fulfill({ json: { enabled: false, configured: false, provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keys: [], batchSize: 50 } });
      if (path === '/api/network') return route.fulfill({ json: { defaultProxy: '', revision: 0 } });
      if (path === '/api/admin/default-navigation') return route.fulfill({ json: { navigation: null } });
      return route.fulfill({ json: [] });
    });
    await page.goto(`${web.resolvedUrls.local[0]}settings`);
    const section = page.locator('#updates');
    await section.getByText('최신 상태', { exact: true }).waitFor();
    await section.getByRole('button', { name: '업데이트 확인', exact: true }).click();
    const apply = section.getByRole('button', { name: '업데이트', exact: true });
    await apply.click();
    const dialog = page.getByRole('alertdialog', { name: '서버를 업데이트할까요?' });
    await dialog.getByRole('button', { name: '취소' }).click();
    assert.equal(applies, 0);
    await apply.click();
    await dialog.getByRole('button', { name: '업데이트', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(applies, 1);
    assert.equal(await section.getByRole('button', { name: '업데이트 확인' }).isDisabled(), true);
    status = { ...status, state: 'blocked', error: 'update-dirty' };
    await section.getByRole('alert').filter({ hasText: '수정한 파일' }).waitFor();
    status = { ...status, connected: false, error: null };
    await section.getByText('도구 연결 끊김', { exact: true }).waitFor();
    assert.equal(await section.getByRole('button', { name: '업데이트 확인' }).isDisabled(), true);
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: verificationPath(`updates-${width}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    role = 'member';
    await page.reload();
    await page.getByRole('heading', { name: '설정', exact: true }).waitFor();
    assert.equal(await section.count(), 0);
    await context.close();
  }
  for (const width of [1280, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(() => { localStorage.setItem('moa.profile', 'test'); localStorage.setItem('moa.remoteMode', 'off'); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const policy = { channel: 'stable', autoCheck: true, autoApply: false, intervalHours: 6, timezone: 'Asia/Seoul', windowStart: '03:00', windowEnd: '05:00' };
    let status = { configured: true, connected: true, state: 'current', mode: 'release', current: '1.2.0', latest: '1.2.0', branch: null, behind: 0, ahead: 0, checkedAt: Date.now(), error: null, policy, nextCheckAt: Date.now() + 3600e3, notesUrl: null, updaterVersion: '1.0.0', history: [{ version: '1.2.0', previous: '1.1.0', at: Date.now() - 864e5, outcome: 'complete' }], deferredReason: null };
    const patches = [];
    await context.route(url => url.pathname.startsWith('/api/'), route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path === '/api/me') return route.fulfill({ json: { id: 'account', username: '테스트', role: 'admin' } });
      if (path === '/api/profiles') return route.fulfill({ json: [{ id: 'test', name: '테스트', color: 'blue' }] });
      if (path === '/api/settings') return route.fulfill({ json: { autoplayNext: false, preferredQuality: 'auto', defaultSubtitleLang: 'ko', subtitleSize: 'medium', translationMode: 'manual' } });
      if (path === '/api/admin/updates') return route.fulfill({ json: status });
      if (path.endsWith('/updates/settings') && request.method() === 'PATCH') { patches.push(request.postDataJSON()); return route.fulfill({ status: 202, json: status }); }
      if (path.endsWith('/translation/config')) return route.fulfill({ json: { enabled: false, configured: false, provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keys: [], batchSize: 50 } });
      if (path === '/api/network') return route.fulfill({ json: { defaultProxy: '', revision: 0 } });
      if (path === '/api/admin/default-navigation') return route.fulfill({ json: { navigation: null } });
      return route.fulfill({ json: [] });
    });
    await page.goto(`${web.resolvedUrls.local[0]}settings`);
    const section = page.locator('#updates');
    await section.getByText('MOA v1.2.0', { exact: true }).waitFor();
    await section.getByText('최신 상태', { exact: true }).waitFor();
    assert.equal(await section.getByText('설정 안내').count(), 0);
    await section.getByRole('combobox', { name: '업데이트 채널' }).click();
    await page.getByRole('option', { name: '베타' }).click();
    await section.getByText(/베타는 새 기능/).waitFor();
    await section.getByRole('button', { name: '설정 저장' }).click();
    await section.getByText('업데이트 도구에 반영하는 중…').waitFor();
    assert.equal(patches.at(-1).channel, 'beta');
    await page.waitForTimeout(3500);
    assert.match(await section.getByRole('combobox', { name: '업데이트 채널' }).innerText(), /베타/);
    status = { ...status, policy: patches.at(-1) };
    await section.getByText('업데이트 도구에 반영하는 중…').waitFor({ state: 'detached' });
    await section.getByText('베타 채널', { exact: true }).waitFor();

    status = { ...status, state: 'available', latest: '1.3.0-beta.1', notesUrl: 'https://github.com/sidetool/moa/releases/tag/v1.3.0-beta.1' };
    await section.getByText('새 버전 v1.3.0-beta.1', { exact: true }).waitFor();
    assert.equal(await section.getByRole('link', { name: '변경 사항 보기' }).getAttribute('href'), status.notesUrl);
    const apply = section.getByRole('button', { name: '지금 업데이트' });
    assert.equal(await apply.isDisabled(), false);
    await section.getByRole('switch', { name: '자동 업데이트' }).click();
    await section.getByLabel('끝 시간').fill('03:00');
    await section.getByText('시작과 끝 시간을 다르게 정해 주세요.').waitFor();
    assert.equal(await section.getByRole('button', { name: '설정 저장' }).isDisabled(), true);
    await section.getByLabel('끝 시간').fill('02:00');
    await section.getByText('다음 날까지 이어지는 시간이에요.').waitFor();
    await section.getByRole('button', { name: '설정 저장' }).click();
    await section.getByText('업데이트 도구에 반영하는 중…').waitFor();
    assert.equal(await apply.isDisabled(), true);
    assert.deepEqual(patches.at(-1), { ...policy, channel: 'beta', autoApply: true, windowEnd: '02:00' });
    status = { ...status, policy: patches.at(-1), state: 'waiting', deferredReason: 'busy' };
    await section.getByText(/재생이나 진행 중인 작업이 끝나면/).waitFor();
    assert.equal(await apply.isDisabled(), false);
    await section.getByRole('button', { name: '예약 취소' }).click();
    await section.getByText('업데이트 도구에 반영하는 중…').waitFor();
    assert.equal(patches.at(-1).autoApply, false);
    status = { ...status, policy: patches.at(-1), state: 'applying', deferredReason: null, notesUrl: 'https://example.com/notes' };
    await section.getByText('4/5', { exact: true }).waitFor();
    assert.equal(await section.getByRole('button', { name: '업데이트 확인' }).isDisabled(), true);
    assert.equal(await section.getByRole('switch', { name: '자동 확인' }).isDisabled(), true);
    status = { ...status, state: 'available' };
    await apply.waitFor();
    assert.equal(await section.getByRole('link', { name: '변경 사항 보기' }).count(), 0);
    await section.getByText('자세히').click();
    await section.getByRole('list', { name: '업데이트 기록' }).getByText('v1.1.0 → v1.2.0').waitFor();
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: verificationPath(`updates-release-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('Update status, modal confirmation, progress, failure, disconnect, admin visibility, release policy sync and responsive layout passed.');
} catch (error) { console.error(errors); throw error; }
finally { await browser.close(); await web.close(); }
