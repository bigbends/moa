import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { buildApp } from '../../server/dist/app.js';
import { verificationPath } from './verification-path.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.MOA_PLAYWRIGHT_PATH || 'playwright-core');
const directory = await mkdtemp(path.join(tmpdir(), 'moa-cast-browser-'));
const env = await buildApp({ dataDir: directory, mediaRoot: directory }, false);
await env.app.listen({ host: '127.0.0.1', port: 0 });
process.env.MOA_API = `http://127.0.0.1:${env.app.server.address().port}`;
process.env.VITE_MOCK = '0';
const web = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { port: 0, open: false, hmr: false } });
await web.listen();
const browser = await chromium.launch({ executablePath: process.env.MOA_BROWSER_EXECUTABLE, args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
try {
  const profile = (await env.app.inject({ method: 'POST', url: '/api/profiles', payload: { name: 'Cast test' } })).json();
  env.db.run("INSERT INTO media VALUES('m',NULL,'TV Test','movie','{}','2026')");
  env.db.run("INSERT INTO episodes VALUES('e1','m',1,1,'Episode',600,NULL)");
  env.db.run('INSERT INTO settings VALUES(?,?)', profile.id, JSON.stringify({ autoFetchSubtitles: false, translationMode: 'manual', defaultSubtitleLang: 'ko' }));
  const video = path.join(directory, 'video.mp4'); await copyFile(process.env.MOA_TEST_VIDEO, video);
  env.db.run('INSERT INTO files VALUES(?,?,?,?,?,?,?)', 'e1', video, 0, 0, '', JSON.stringify({ duration: 600, container: 'mp4', streams: [{ index: 0, codec_type: 'video', codec_name: 'h264' }, { index: 1, codec_type: 'audio', codec_name: 'aac' }] }), '[]');
  const imported = await env.app.inject({ method: 'POST', url: '/api/subtitles/import', headers: { 'x-moa-profile': profile.id }, payload: { episodeId: 'e1', filename: '한국어.vtt', data: Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nTV 한국어 자막\n').toString('base64') } });
  assert.equal(imported.statusCode, 200);
  for (const mode of ['cast', 'cast-unmount', 'airplay', 'localhost']) {
    const context = await browser.newContext({ viewport: { width: mode === 'cast' ? 1280 : 390, height: 844 } });
    await context.addInitScript(({ id, mode }) => {
      localStorage.setItem('moa.profile', id); localStorage.setItem('moa.fullscreenOnPlay', '0'); localStorage.setItem('moa.remoteMode', 'off');
      window.castLoads = []; window.castEnds = 0;
      if (mode === 'airplay') {
        HTMLVideoElement.prototype.webkitShowPlaybackTargetPicker = function () { window.airplayPickerCalls = (window.airplayPickerCalls || 0) + 1; this.webkitCurrentPlaybackTargetIsWireless = true; this.dispatchEvent(new Event('webkitcurrentplaybacktargetiswirelesschanged')); };
        return;
      }
      let player, listener;
      const changed = () => listener?.(); window.castChanged = changed;
      const receiver = { getCastDevice: () => ({ friendlyName: 'Test TV' }), loadMedia: async request => { window.castLoads.push(request); Object.assign(player, { isConnected: true, isPaused: false, currentTime: request.currentTime, duration: 600 }); changed(); } };
      const context = { setOptions: value => { window.castOptions = value; }, requestSession: async () => {}, getCurrentSession: () => receiver, endCurrentSession: () => { window.castEnds++; player.isConnected = false; changed(); } };
      window.cast = { framework: { CastContext: { getInstance: () => context }, RemotePlayer: class { constructor() { player = this; window.castPlayer = this; this.volumeLevel = .5; } }, RemotePlayerController: class {
        addEventListener(_name, callback) { listener = callback; } removeEventListener() { listener = null; }
        playOrPause() { player.isPaused = !player.isPaused; changed(); } seek() { changed(); } setVolumeLevel() { changed(); }
      }, RemotePlayerEventType: { ANY_CHANGE: 'change' } } };
      window.chrome.cast = { AutoJoinPolicy: { TAB_AND_ORIGIN_SCOPED: 'tab' }, media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: 'default', MediaInfo: class { constructor(contentId, contentType) { Object.assign(this, { contentId, contentType }); } }, LoadRequest: class { constructor(media) { this.media = media; } }, GenericMediaMetadata: class {}, Track: class { constructor(trackId, type) { Object.assign(this, { trackId, type }); } }, TrackType: { TEXT: 'TEXT' }, TextTrackType: { SUBTITLES: 'SUBTITLES' }
      } };
    }, { id: profile.id, mode });
    const base = web.resolvedUrls.local[0];
    let closing = false;
    await context.route('https://moa.test/**', async route => {
      try {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: base + url.pathname.slice(1) + url.search });
        await route.fulfill({ response });
      } catch (error) { if (!closing) throw error; }
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { errors.push(`Unexpected dialog: ${dialog.type()}`); void dialog.dismiss(); });
    await page.goto((mode === 'localhost' ? base : 'https://moa.test/') + 'watch/e1');
    await page.locator('video').waitFor();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await page.locator('video').evaluate(element => { element.pause(); element.currentTime = 25; });
    await page.getByRole('button', { name: 'TV 스트리밍', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'TV 스트리밍', exact: true });
    await modal.waitFor();
    assert.ok(await modal.evaluate(element => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
    if (mode === 'localhost') {
      await modal.getByRole('alert').filter({ hasText: 'LAN IP' }).waitFor();
      assert.equal(await modal.getByRole('button', { name: 'Chromecast 연결', exact: true }).isDisabled(), true);
    } else if (mode.startsWith('cast')) {
      await modal.getByRole('button', { name: 'Chromecast 연결', exact: true }).click();
      await modal.getByRole('status').filter({ hasText: 'Test TV' }).waitFor();
      const request = await page.evaluate(() => window.castLoads[0]);
      assert.match(request.media.contentId, /^https:\/\/moa\.test\/api\/cast\//);
      assert.equal(request.currentTime, 25); assert.deepEqual(request.activeTrackIds, [1]);
      assert.equal(request.media.tracks[0].trackContentType, 'text/vtt');
      await modal.getByRole('button', { name: 'TV 일시정지', exact: true }).click();
      assert.equal(await page.evaluate(() => window.castPlayer.isPaused), true);
      await modal.getByRole('button', { name: 'TV 10초 앞으로', exact: true }).click();
      assert.equal(await page.evaluate(() => window.castPlayer.currentTime), 35);
      const saved = page.waitForResponse(response => response.url().endsWith('/api/progress') && response.request().postDataJSON()?.position === 155);
      await page.evaluate(() => { window.castPlayer.currentTime = 155; window.castChanged(); });
      await saved;
      await page.screenshot({ path: verificationPath(mode === 'cast' ? 'casting-desktop.png' : 'casting-mobile.png') });
      const mediaUrl = request.media.contentId;
      const revoked = page.waitForResponse(response => response.url().includes('/cast/') && response.request().method() === 'DELETE');
      if (mode === 'cast-unmount') {
        await modal.locator('.sheet-foot').getByRole('button', { name: '닫기', exact: true }).click();
        await page.getByRole('button', { name: '뒤로', exact: true }).click();
        await page.locator('video').waitFor({ state: 'detached' });
      } else await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
      await page.waitForFunction(() => window.castEnds === 1);
      await revoked;
      assert.equal((await env.app.inject(new URL(mediaUrl).pathname)).statusCode, 404);
      const progress = env.db.get('SELECT position FROM progress WHERE profile_id=? AND episode_id=?', profile.id, 'e1');
      assert.equal(progress.position, 155);
    } else {
      await modal.getByRole('button', { name: 'AirPlay 준비', exact: true }).click();
      await modal.getByRole('button', { name: 'AirPlay 기기 선택', exact: true }).waitFor();
      assert.ok(await page.locator('video').evaluate(element => element.src.includes('/api/cast/')));
      await page.waitForFunction(() => document.querySelector('video track')?.src.includes('/api/cast/'));
      await modal.getByRole('button', { name: 'AirPlay 기기 선택', exact: true }).click();
      await modal.getByRole('status').filter({ hasText: 'AirPlay로 재생 중' }).waitFor();
      assert.equal(await page.evaluate(() => window.airplayPickerCalls), 1);
      await page.screenshot({ path: verificationPath('casting-airplay-mobile.png') });
      await modal.getByRole('button', { name: '연결 종료', exact: true }).click();
      await modal.getByRole('button', { name: 'AirPlay 준비', exact: true }).waitFor();
      assert.ok(await page.locator('video').evaluate(element => element.src.includes('/api/playback/')));
    }
    closing = true; await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('Cast load, captions, remote controls, progress on pagehide and unmount, revocation, AirPlay preparation/restoration and localhost guidance passed.');
} finally { await browser.close(); await web.close(); await env.app.close(); await rm(directory, { recursive: true, force: true }); }
