// Verify generated videos against the built server in an isolated temporary directory.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, mkdtemp, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { buildApp } from '../dist/app.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const output = process.env.MOA_VERIFY_DIR || tmpdir();
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(output, 'verification-fixtures-')), media = `${root}/media`, data = `${root}/database`;
const ffmpeg = process.env.MOA_FFMPEG || 'ffmpeg', ffprobe = process.env.MOA_FFPROBE || 'ffprobe';
await mkdir(`${media}/Fixture`, { recursive: true });
const run = (...args) => execFileSync(ffmpeg, ['-v', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' });
const ass = '[Script Info]\nScriptType: v4.00+\nPlayResX: 640\nPlayResY: 360\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,30,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Embedded ASS\n';
await writeFile(`${root}/embedded.ass`, ass);
run('-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '48', '-bf', '2', '-c:a', 'aac', `${media}/Direct.2024.mp4`);
run('-i', `${media}/Direct.2024.mp4`, '-i', `${root}/embedded.ass`, '-map', '0:v', '-map', '0:a', '-map', '0:a', '-map', '1', '-c:v', 'copy', '-c:a:0', 'aac', '-c:a:1', 'ac3', '-c:s', 'ass', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=kor', '-attach', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '-metadata:s:t', 'mimetype=application/x-truetype-font', `${media}/Fixture/Fixture.S01E01.mkv`);
run('-f', 'lavfi', '-i', 'testsrc2=size=256x144:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '4', '-vf', 'format=yuv420p10le', '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'pools=2:frame-threads=2:log-level=error:colorprim=9:transfer=16:colormatrix=9:hdr10=1', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-c:a', 'aac', `${media}/Hdr.2024.mkv`);
await writeFile(`${media}/Fixture/Fixture.S01E01.ko.srt`, '1\n00:00:01,000 --> 00:00:03,000\n외부 SRT\n');
await writeFile(`${media}/Fixture/Fixture.S01E01.en.smi`, '<SAMI><BODY><SYNC Start=1000><P>SMI line<SYNC Start=3000><P>&nbsp;</BODY></SAMI>');
const { app, library, playback } = await buildApp({ dataDir: data, mediaRoot: media, ffmpeg, ffprobe, vaapiDevice: '/dev/dri/invalid', maxTranscodes: 1 }, false);
const results = [];
try {
  const p = (await app.inject({ method: 'POST', url: '/api/profiles', payload: { name: 'Fixture' } })).json(); const headers = { 'X-Moa-Profile': p.id };
  await app.inject({ method: 'POST', url: '/api/library/folders', headers, payload: { path: media, type: 'series' } });
  library.start(); await library.pending; assert.equal(library.status.error, undefined);
  const cards = (await app.inject({ url: '/api/media', headers })).json().items;
  const episode = async title => (await app.inject({ url: `/api/media/${cards.find(c => c.title === title).id}`, headers })).json().seasons[0].episodes[0].id;
  const direct = (await app.inject({ method: 'POST', url: '/api/playback', headers, payload: { episodeId: await episode('Direct'), capabilities: { h264: true, hevc: false, av1: false } } })).json();
  assert.equal(direct.mode, 'direct'); assert.equal((await app.inject({ url: direct.url, headers: { range: 'bytes=0-99' } })).statusCode, 206); results.push('direct Range');
  const ep = await episode('Fixture');
  const remux = (await app.inject({ method: 'POST', url: '/api/playback', headers, payload: { episodeId: ep, capabilities: { h264: true, hevc: false, av1: false }, audioTrackId: '2', startPosition: 10 } })).json();
  assert.equal(remux.mode, 'remux'); assert.equal(remux.startPosition, 10);
  const manifest = (await app.inject(remux.url)).body; assert.ok(manifest.includes('#EXT-X-ENDLIST'));
  const checkSegment = async (s, n, expectedCodec = 'h264') => {
    const url = s.url.replace('index.m3u8', '');
    const response = await app.inject(`${url}seg-${n}.m4s`); assert.equal(response.statusCode, 200, response.body);
    const init = await app.inject(`${url}init.mp4`); assert.equal(init.statusCode, 200, init.body);
    const output = `${root}/${s.sessionId}-${n}.mp4`; await writeFile(output, Buffer.concat([init.rawPayload, response.rawPayload]));
    const info = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { encoding: 'utf8' }));
    assert.equal(info.streams[0].codec_name, expectedCodec); assert.equal(info.streams[1].codec_name, 'aac');
    run('-i', output, '-frames:v', '5', '-f', 'null', '-'); return info;
  };
  const first = await checkSegment(remux, 0), middle = await checkSegment(remux, 5);
  assert.ok(Math.abs(Number(middle.streams[0].start_time) - 10) < .15); results.push('remux video copy, selected AC3 → AAC, seek timestamp');
  for (const sub of remux.subtitles) {
    const response = await app.inject(sub.url); assert.equal(response.statusCode, 200, response.body);
    assert.ok(sub.format === 'ass' ? response.body.includes('Embedded ASS') : response.body.startsWith('WEBVTT'));
  }
  assert.equal(remux.subtitles.length, 3); results.push('embedded ASS, external SRT/SMI → VTT');
  assert.equal(remux.fonts.length, 1);
  const font = await app.inject(remux.fonts[0]); assert.equal(font.statusCode, 200, font.body);
  assert.equal(font.rawPayload.compare(await readFile('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')), 0); results.push('MKV attachment font extraction');
  const transcode = (await app.inject({ method: 'POST', url: '/api/playback', headers, payload: { episodeId: ep, capabilities: { h264: true, hevc: false, av1: false, maxHeight: 144 } } })).json();
  assert.equal(transcode.mode, 'transcode');
  const scaled = await checkSegment(transcode, 0); assert.equal(scaled.streams[0].height, 144); assert.equal(playback.get(transcode.sessionId).hardware, false); results.push('VAAPI failure → libx264, maxHeight=144');
  for (const s of [remux, transcode]) await app.inject({ method: 'DELETE', url: `/api/playback/${s.sessionId}`, headers });
  const hdr = (await app.inject({ method: 'POST', url: '/api/playback', headers, payload: { episodeId: await episode('Hdr'), capabilities: { h264: true, hevc: false, av1: false } } })).json();
  const toned = await checkSegment(hdr, 0); assert.equal(toned.streams[0].color_transfer, 'bt709'); assert.equal(toned.streams[0].pix_fmt, 'yuv420p'); results.push('HDR 10bit PQ → SDR BT.709 tone mapping');
  const tail = await checkSegment(hdr, playback.get(hdr.sessionId).timeline.length - 1); assert.equal(tail.streams[0].pix_fmt, 'yuv420p'); results.push('last video/audio tail segment decodes');
  await app.inject({ method: 'DELETE', url: `/api/playback/${hdr.sessionId}`, headers });
  const session = playback.get(direct.sessionId); session.touched = 0;
  assert.equal((await app.inject(direct.url)).statusCode, 404); results.push('idle session expiry');
  // Keep the first encoder alive to verify the limit and immediate cancellation deterministically.
  const slow = `${root}/slow-encoder`; await writeFile(slow, '#!/usr/bin/env node\nsetTimeout(() => process.exit(1), 10000);\n'); await chmod(slow, 0o755);
  playback.config.ffmpeg = slow;
  await app.inject({ method: 'PATCH', url: '/api/settings', headers, payload: { hardwareTranscoding: false } });
  const create = async () => (await app.inject({ method: 'POST', url: '/api/playback', headers, payload: { episodeId: ep, capabilities: { h264: true, hevc: false, av1: false, maxHeight: 144 } } })).json();
  const one = await create(), two = await create();
  const pending = playback.segment(playback.get(one.sessionId), 0).catch(e => e);
  while (!playback.active.size) await new Promise(resolve => setTimeout(resolve, 10));
  await assert.rejects(() => playback.segment(playback.get(two.sessionId), 0), { statusCode: 429, error: 'transcoding-limit' });
  const replacement = playback.segment(playback.get(one.sessionId), 8).catch(e => e);
  assert.equal((await pending).error, 'segment-superseded');
  while (playback.get(one.sessionId).run?.start !== 8) await new Promise(resolve => setTimeout(resolve, 10));
  results.push('far seek supersedes obsolete segment with 409');
  await app.inject({ method: 'DELETE', url: `/api/playback/${one.sessionId}`, headers });
  assert.equal((await replacement).error, 'session-expired');
  await app.inject({ method: 'DELETE', url: `/api/playback/${two.sessionId}`, headers });
  results.push('concurrent encoder limit returns 429');
  assert.equal(playback.sessions.size, 0); assert.equal(playback.active.size, 0); results.push('DELETE terminates processes');
} finally { await app.close(); }
await writeFile(process.env.MOA_VERIFY_REPORT || join(root,'fixtures-report.json'), JSON.stringify({ date: new Date().toISOString(), passed: results }, null, 2));
console.log(results);
