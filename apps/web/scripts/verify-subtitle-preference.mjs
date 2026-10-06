import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.MOA_PLAYWRIGHT_PATH || 'playwright-core');
const video = await readFile(process.env.MOA_TEST_VIDEO);
process.env.VITE_MOCK = '0';
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { port: 0, open: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.MOA_BROWSER_EXECUTABLE, args: ['--autoplay-policy=no-user-gesture-required'] });
let session = 0, resolved = 0, reordered = false, resolveGate;
const lookups = [], errors = [];
const upload = () => ({ id: 'upload-stable', source: 'upload', label: '선택한 파일.srt', format: 'vtt', url: `/fixture/upload-${++resolved}.vtt` });
const translated = () => ({ id: 'translation-stable', source: 'translation', label: '한국어 · AI 번역', lang: 'ko', format: 'vtt', url: `/fixture/translation-${++resolved}.vtt` });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(() => { if (!localStorage.getItem('moa.profile')) localStorage.setItem('moa.profile', 'first'); localStorage.setItem('moa.fullscreenOnPlay', '0'); });
  await page.route('**/fixture/video.mp4', route => {
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = Number(range?.[1] || 0), end = Math.min(video.length - 1, range?.[2] ? Number(range[2]) : video.length - 1);
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4', body: video.subarray(start, end + 1), headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${video.length}` } : {}) } });
  });
  await page.route('**/fixture/*.vtt', route => route.fulfill({ contentType: 'text/vtt', body: `WEBVTT\n\n00:00:00.000 --> 00:10:00.000\n${new URL(route.request().url()).pathname}\n` }));
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    const json = body => route.fulfill({ json: body });
    if (pathname === '/api/settings') return json({ defaultSubtitleLang: 'ja', subtitleSize: 'medium', autoFetchSubtitles: false, autoplayNext: false, translationMode: 'manual' });
    if (pathname === '/api/me') return json({ role: 'admin' });
    if (pathname === '/api/plugins' || pathname === '/api/sources') return json([]);
    if (pathname === '/api/translation/config') return json({ configured: false, enabled: false });
    if (pathname.endsWith('/subtitles/uploads') || pathname.endsWith('/subtitles/translations')) {
      lookups.push(pathname);
      if (pathname.endsWith('/uploads')) await resolveGate;
      const episode = pathname.split('/')[3];
      return json(episode === 'e1' ? [pathname.endsWith('/uploads') ? upload() : translated()] : []);
    }
    if (pathname === '/api/playback' && request.method() === 'POST') {
      const { episodeId } = request.postDataJSON();
      session++;
      const originals = [{ id: `extension-${reordered ? 1 : 0}`, source: 'extension', label: 'English', lang: 'en', format: 'vtt', url: `/fixture/english-${session}.vtt` }, { id: `extension-${reordered ? 0 : 1}`, source: 'extension', label: '日本語', lang: 'ja', format: 'vtt', url: `/fixture/japanese-${session}.vtt` }];
      return json({ sessionId: `session-${session}`, episodeId, mediaId: episodeId === 'e1' ? 'm1' : 'm2', mediaTitle: '선택 기억 검증', mediaType: 'anime', mode: 'direct', mime: 'video/mp4', url: '/fixture/video.mp4', duration: 600, startPosition: 0, subtitles: [...originals, ...(episodeId === 'e1' ? [upload(), translated()] : [])], audioTracks: [], streams: [{ id: 'a', label: '서버 A' }] });
    }
    if (pathname.endsWith('/context')) return json({ mediaId: pathname.includes('/e1/') ? 'm1' : 'm2', season: 1, number: pathname.includes('/e3/') ? 2 : 1 });
    if (pathname.endsWith('/group')) return json({ members: [{ id: 'm1', provider: { name: '소스 A' } }, { id: 'm2', provider: { name: '소스 B' } }] });
    if (pathname.startsWith('/api/media/')) return json({ id: pathname.split('/').at(-1), title: '선택 기억 검증', type: 'anime', provider: { id: 'local', name: '로컬', kind: 'local' }, seasons: [{ number: 1, episodes: [{ id: 'e2', season: 1, number: 1, title: '같은 회차' }, { id: 'e3', season: 1, number: 2, title: '다른 회차' }] }] });
    return route.fulfill({ status: 204 });
  });
  const base = server.resolvedUrls.local[0];
  const ready = async () => { await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await page.locator('video').evaluate(element => element.pause()); };
  const open = async () => { await page.mouse.move(100, 100); await page.getByRole('button', { name: '자막 및 음성', exact: true }).click(); };
  const close = () => page.getByRole('button', { name: '닫기', exact: true }).click();
  const selected = label => page.waitForFunction(label => [...document.querySelectorAll('.panel-subs .opt.is-active')].some(element => element.textContent.includes(label)), label);
  const shown = part => page.waitForFunction(part => document.querySelector('track')?.src.includes(part), part);
  const toSource = async otherEpisode => {
    await page.mouse.move(100, 100);
    await page.getByRole('button', { name: '재생 설정', exact: true }).click();
    await page.getByRole('button', { name: '다른 소스 선택', exact: true }).click();
    await page.getByRole('button', { name: '소스 B', exact: true }).click();
    if (otherEpisode) {
      await page.getByRole('combobox', { name: '다른 소스의 회차', exact: true }).click();
      await page.getByRole('option', { name: '시즌 1 · 2화 · 다른 회차', exact: true }).click();
    }
    await page.getByRole('button', { name: '이 회차로 재생', exact: true }).click(); await ready();
  };
  await page.goto(`${base}watch/e1`); await ready(); await open();
  await page.getByRole('button', { name: 'English', exact: true }).click(); await shown('english');
  const previousUrl = await page.locator('track').getAttribute('src');
  reordered = true;
  await page.reload(); await ready(); await open(); await selected('English'); await shown('english');
  assert.notEqual(await page.locator('track').getAttribute('src'), previousUrl);
  await page.getByRole('button', { name: '끄기', exact: true }).click();
  await page.reload(); await ready(); await open(); await selected('끄기');
  await close(); await toSource(false); await open(); await selected('끄기');
  await page.goto(`${base}watch/e1`); await ready(); await open();
  await page.getByRole('button', { name: '선택한 파일.srt', exact: true }).click(); await close();
  await toSource(false); await shown('upload');
  assert.equal(new URL(page.url()).pathname, '/watch/e2');
  await page.goto(`${base}watch/e2`); await ready(); await shown('upload');
  assert.ok(lookups.includes('/api/episodes/e1/subtitles/uploads'));
  await page.goto(`${base}watch/e1`); await ready(); await open();
  await page.getByRole('button', { name: '한국어 AI 번역', exact: true }).click(); await close();
  await toSource(false); await shown('translation');
  await page.goto(`${base}watch/e2`); await ready(); await shown('translation');
  assert.ok(lookups.includes('/api/episodes/e1/subtitles/translations'));
  await page.goto(`${base}watch/e1`); await ready();
  await toSource(true); await shown('japanese');
  assert.equal(await page.evaluate(() => localStorage.getItem('moa.subtitleChoice:["first","e3"]')), null);
  await page.evaluate(() => localStorage.setItem('moa.profile', 'second'));
  await page.goto(`${base}watch/e2`); await ready(); await shown('japanese');
  assert.equal(await page.evaluate(() => localStorage.getItem('moa.subtitleChoice:["second","e2"]')), null);
  await page.evaluate(async () => {
    localStorage.setItem('moa.profile', 'first');
    const { rememberSubtitle } = await import('/src/player/subtitle-preference.ts');
    rememberSubtitle('e2', { id: 'upload-stable', source: 'upload', label: '선택한 파일.srt', format: 'vtt', url: '/expired' }, 'e1');
  });
  let release;
  resolveGate = new Promise(resolve => { release = resolve; });
  const before = lookups.filter(item => item.endsWith('/uploads')).length;
  await page.goto(`${base}watch/e2`); await ready(); await open();
  await page.getByRole('button', { name: 'English', exact: true }).click(); await shown('english');
  release(); resolveGate = undefined;
  await page.waitForTimeout(100);
  assert.ok(lookups.filter(item => item.endsWith('/uploads')).length > before);
  await selected('English');
  const values = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('moa.subtitleChoice:')).map(([, value]) => JSON.parse(value)));
  assert.ok(values.every(value => !value || !('url' in value) && !('content' in value)));
  assert.deepEqual(errors, []);
  console.log('Subtitle selection replay, fresh URL resolution, reordered tracks, off, profile/episode isolation, carried upload/translation and late-response checks passed.');
} finally { await browser.close(); await server.close(); }
