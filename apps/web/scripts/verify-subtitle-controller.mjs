// Run: node --experimental-vm-modules apps/web/scripts/verify-subtitle-controller.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const source = stripTypeScriptTypes(await readFile(new URL('../src/player/engine.ts', import.meta.url), 'utf8'), { mode: 'transform' });
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const vtt = { format: 'vtt', label: 'VTT', url: '/test.vtt' };
const ass = { format: 'ass', label: 'ASS', url: '/test.ass' };
const cue = (startTime = 2, endTime = 4) => ({ startTime, endTime, line: 'auto' });

async function harness({ importGate, readyGate, constructorError, destroyError, swapGates } = {}) {
  const tracks = [], renderers = [], swaps = [];
  const video = {
    append(el) { tracks.push(el); },
    get textTracks() { return tracks.map(el => el.track); }
  };
  class Renderer {
    constructor(options) {
      if (constructorError) throw constructorError;
      this.timeOffset = options.timeOffset;
      this.ready = readyGate?.promise ?? Promise.resolve();
      this.destroyed = 0;
      this.renderer = { getStyles: async()=>[], setStyle: async()=>{}, setTrackByUrl: async url => { await swapGates?.[url]?.promise; swaps.push(url); } };
      this._demandRender = async()=>{};
      renderers.push(this);
    }
    destroy() {
      this.destroyed++;
      // Like installed JASSUB, cleanup can reject when ready rejects.
      return destroyError ? Promise.reject(destroyError) : this.ready;
    }
  }
  const context = createContext({ setTimeout, clearTimeout, document: {
    createElement() {
      const el = new EventTarget();
      el.track = { mode: 'disabled', cues: null };
      el.track.removeCue = cue => el.track.cues.splice(el.track.cues.indexOf(cue), 1);
      el.track.addCue = cue => el.track.cues.push(cue);
      el.remove = () => { const i = tracks.indexOf(el); if (i >= 0) tracks.splice(i, 1); el.removed = true; };
      return el;
    }
  } });
  const rendererModule = new SyntheticModule(['default'], function () { this.setExport('default', Renderer); }, { context });
  const fontModule = new SyntheticModule(['default'], function () { this.setExport('default', '/local-font.woff2'); }, { context });
  for (const module of [rendererModule, fontModule]) { await module.link(() => {}); await module.evaluate(); }
  const module = new SourceTextModule(source, {
    context,
    importModuleDynamically: async specifier => {
      if (specifier === 'jassub') {
        if (importGate) await importGate.promise;
        return rendererModule;
      }
      return fontModule;
    }
  });
  await module.link(() => { throw new Error('Unexpected static import'); });
  await module.evaluate();
  return { controller: new module.namespace.SubtitleController(video), tracks, renderers, swaps };
}

test('VTT load applies controls lift with zero offset and supports saved height and keeps a minimum bottom inset', async () => {
  const { controller, tracks } = await harness();
  controller.setLift(true);
  await controller.show(vtt);
  tracks[0].track.cues = [cue()];
  tracks[0].dispatchEvent(new Event('load'));
  assert.equal(tracks[0].track.cues[0].line, -3);
  controller.setLift(false);
  assert.equal(tracks[0].track.cues[0].line, -2);
  controller.setHeight(25);
  assert.equal(tracks[0].track.cues[0].line,-5);
  controller.setHeight(0);
  assert.equal(tracks[0].track.cues[0].line, -1);
});

test('VTT positive/negative offsets are absolute, survive switches, and apply after load', async () => {
  const { controller, tracks } = await harness();
  controller.setOffset(1);
  await controller.show(vtt);
  const cues = [cue(), cue(5, 6)];
  tracks[0].track.cues = cues;
  tracks[0].dispatchEvent(new Event('load'));
  assert.deepEqual(cues.map(c => [c.startTime, c.endTime]), [[3, 5], [6, 7]]);
  controller.setOffset(1);
  controller.setOffset(-3);
  assert.deepEqual(cues.map(c => [c.startTime, c.endTime]), [[-1, 1], [2, 3]]);
  controller.setOffset(0);
  assert.deepEqual(cues.map(c => [c.startTime, c.endTime]), [[2, 4], [5, 6]]);
  await controller.show(vtt);
  tracks[0].track.cues = [cue()];
  tracks[0].dispatchEvent(new Event('load'));
  assert.equal(tracks[0].track.cues[0].startTime, 2);
  await controller.show(null);
  assert.equal(tracks.length, 0);
});

for (const action of ['clear', 'destroy', 'off', 'vtt']) {
  test(`pending ASS import cannot reattach after ${action}`, async () => {
    const importGate = deferred();
    const { controller, tracks, renderers } = await harness({ importGate });
    const pending = controller.show(ass);
    if (action === 'off') await controller.show(null);
    else if (action === 'vtt') await controller.show(vtt);
    else controller[action]();
    importGate.resolve();
    await pending;
    assert.equal(renderers.length, 0);
    assert.equal(tracks.length, action === 'vtt' ? 1 : 0);
  });
}

test('ASS show waits for readiness and uses the latest offset during preparation', async () => {
  const readyGate = deferred();
  const { controller, renderers } = await harness({ readyGate });
  controller.setOffset(1);
  let settled = false;
  const pending = controller.show(ass).then(() => { settled = true; });
  await turn();
  assert.equal(renderers.length, 1);
  assert.equal(settled, false);
  assert.equal(renderers[0].timeOffset, -1);
  controller.setOffset(-0.5);
  assert.equal(renderers[0].timeOffset, 0.5);
  readyGate.resolve();
  await pending;
  controller.destroy();
  assert.equal(renderers[0].destroyed, 1);
});

test('ASS preparation failure rejects show and cleans up without an unhandled destroy rejection', async () => {
  const readyGate = deferred(), failure = new Error('renderer failed');
  const { controller, renderers } = await harness({ readyGate });
  const pending = controller.show(ass);
  const rejected = assert.rejects(pending, error => error === failure);
  await turn();
  readyGate.reject(failure);
  await rejected;
  await turn();
  assert.equal(renderers[0].destroyed, 1);
  controller.clear();
  assert.equal(renderers[0].destroyed, 1);
});

test('a stale ASS readiness failure cannot remove the replacement VTT track', async () => {
  const readyGate = deferred();
  const { controller, tracks, renderers } = await harness({ readyGate });
  const pending = controller.show(ass);
  await turn();
  await controller.show(vtt);
  readyGate.reject(new Error('old renderer failed'));
  await pending;
  await turn();
  assert.equal(tracks.length, 1);
  assert.equal(renderers[0].destroyed, 1);
});

test('only the last of rapid ASS requests is constructed', async () => {
  const importGate = deferred();
  const { controller, renderers } = await harness({ importGate });
  const first = controller.show(ass), second = controller.show(ass);
  importGate.resolve();
  await Promise.all([first, second]);
  assert.equal(renderers.length, 1);
  controller.destroy();
});

test('active import/constructor failures reject; stale import failures are ignored', async () => {
  const failure = new Error('import failed'), importGate = deferred();
  const active = await harness({ importGate });
  const pending = active.controller.show(ass);
  const rejected = assert.rejects(pending, error => error === failure);
  importGate.reject(failure);
  await rejected;
  const staleGate = deferred(), stale = await harness({ importGate: staleGate });
  const stalePending = stale.controller.show(ass);
  await stale.controller.show(vtt);
  staleGate.reject(failure);
  await stalePending;
  assert.equal(stale.tracks.length, 1);
  const broken = await harness({ constructorError: failure });
  await assert.rejects(broken.controller.show(ass), error => error === failure);
});

test('failed ASS teardown cannot interfere with the new track', async () => {
  const { controller, tracks, renderers } = await harness({ destroyError: new Error('destroy failed') });
  await controller.show(ass);
  await controller.show(vtt);
  await turn();
  assert.equal(tracks.length, 1);
  assert.equal(renderers[0].destroyed, 1);
});

/* Live AI translation revisions arrive while older ones may still be loading. */
const revision = n => ({ format: 'vtt', label: 'AI', url: `/translation.vtt?revision=${n}` });
const loadTrack = (tracks, url, cues = [cue()]) => {
  const el = tracks.find(item => item.src === url);
  el.track.cues = cues;
  el.dispatchEvent(new Event('load'));
};

for (const order of ['newer first', 'older first']) {
  test(`overlapping VTT revisions keep only the newest (${order} load)`, async () => {
    const { controller, tracks } = await harness();
    await controller.show(revision(1));
    loadTrack(tracks, revision(1).url);
    const a = controller.replace(revision(2)), b = controller.replace(revision(3));
    if (order === 'newer first') { loadTrack(tracks, revision(3).url); await b; loadTrack(tracks, revision(2).url); await a; }
    else { loadTrack(tracks, revision(2).url); await a; loadTrack(tracks, revision(3).url); await b; }
    assert.deepEqual(tracks.map(el => el.src), [revision(3).url], 'only the newest revision stays attached');
    assert.equal(tracks[0].track.mode, 'showing');
  });
}

test('a VTT revision still loading cannot attach after the subtitle changes', async () => {
  const { controller, tracks } = await harness();
  await controller.show(revision(1));
  loadTrack(tracks, revision(1).url);
  const pending = controller.replace(revision(2));
  const loading = tracks.find(el => el.src === revision(2).url);
  await controller.show(vtt);
  loading.track.cues = [cue()];
  loading.dispatchEvent(new Event('load'));
  await pending;
  assert.deepEqual(tracks.map(el => el.src), [vtt.url]);
});

test('VTT revision swap keeps the shown cues until the new ones load and keeps the offset', async () => {
  const { controller, tracks } = await harness();
  controller.setOffset(1);
  await controller.show(revision(1));
  loadTrack(tracks, revision(1).url);
  const pending = controller.replace(revision(2));
  assert.equal(tracks.find(el => el.src === revision(1).url).track.mode, 'showing', 'old revision stays visible while loading');
  const cues = [cue()];
  loadTrack(tracks, revision(2).url, cues);
  await pending;
  assert.deepEqual(cues.map(c => [c.startTime, c.endTime]), [[3, 5]]);
});

test('overlapping ASS revisions are applied in request order, newest last', async () => {
  const gates = { '/a?revision=2': deferred(), '/a?revision=3': deferred() };
  const { controller, swaps } = await harness({ swapGates: gates });
  await controller.show({ format: 'ass', label: 'AI', url: '/a?revision=1' });
  const older = controller.replace({ format: 'ass', label: 'AI', url: '/a?revision=2' });
  await turn();
  const newer = controller.replace({ format: 'ass', label: 'AI', url: '/a?revision=3' });
  gates['/a?revision=3'].resolve();
  await turn();
  assert.deepEqual(swaps, [], 'the newer swap waits for the older one');
  gates['/a?revision=2'].resolve();
  await Promise.all([older, newer]);
  assert.deepEqual(swaps, ['/a?revision=2', '/a?revision=3']);
});

test('queued stale ASS revisions are skipped', async () => {
  const gates = { '/a?revision=2': deferred() };
  const { controller, swaps } = await harness({ swapGates: gates });
  await controller.show({ format: 'ass', label: 'AI', url: '/a?revision=1' });
  const first = controller.replace({ format: 'ass', label: 'AI', url: '/a?revision=2' });
  await turn();
  const skipped = controller.replace({ format: 'ass', label: 'AI', url: '/a?revision=3' });
  const last = controller.replace({ format: 'ass', label: 'AI', url: '/a?revision=4' });
  gates['/a?revision=2'].resolve();
  await Promise.all([first, skipped, last]);
  assert.deepEqual(swaps, ['/a?revision=2', '/a?revision=4']);
});
