import { randomBytes } from 'node:crypto';
import { readdir, readlink, readFile } from 'node:fs/promises';
import { request } from 'node:http';

export const RELAY_ORIGIN = 'https://moa-apk.invalid';
const token = () => randomBytes(24).toString('base64url');
const local = u => ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
// Linux socket ownership is checked against this exact child, not merely an open localhost port.
export async function ownsListener(pid, port) {
  const sockets = new Set(await Promise.all((await readdir(`/proc/${pid}/fd`)).map(async fd => {
    try { return (await readlink(`/proc/${pid}/fd/${fd}`)).match(/^socket:\[(\d+)\]$/)?.[1]; } catch { return undefined; }
  })));
  for (const name of ['tcp', 'tcp6']) {
    const rows = (await readFile(`/proc/${pid}/net/${name}`, 'utf8')).trim().split('\n').slice(1);
    if (rows.some(row => { const cells = row.trim().split(/\s+/); return cells[3] === '0A' && parseInt(cells[1].split(':')[1], 16) === port && sockets.has(cells[9]); })) return true;
  }
  return false;
}
export class PlaybackLeases {
  constructor(onRelease = () => {}, { ttlMs = 3 * 60_000, limit = 32, owns = ownsListener } = {}) {
    this.limit = limit; this.entries = new Map(); this.onRelease = onRelease; this.ttlMs = ttlMs; this.owns = owns;
    this.timer = setInterval(() => this.sweep(), Math.min(15_000, ttlMs)); this.timer.unref();
  }
  get size() { this.sweep(); return this.entries.size; }
  installations() { return [...this.entries.values()].map(e => e.installation); }
  workerKeys() { return [...this.entries.values()].map(e => e.workerKey || e.installation); }
  hasWorker(key) { return this.workerKeys().includes(key); }
  hasInstallation(id) { return this.installations().includes(id); }
  sweep() { for (const [id, e] of this.entries) if (e.expires <= Date.now() || e.worker.pid !== e.pid || e.worker.generation !== e.generation) this.release(id); }
  get(id) {
    const e = this.entries.get(id);
    if (!e || e.expires <= Date.now() || e.worker.pid !== e.pid || e.worker.generation !== e.generation) { this.release(id); throw new Error('apk_lease_expired'); }
    e.expires = Date.now() + this.ttlMs; return e;
  }
  release(id) { const e = this.entries.get(id); if (!e) return; this.entries.delete(id); e.release(); this.onRelease(e); }
  close() { clearInterval(this.timer); for (const id of this.entries.keys()) this.release(id); }
  async create(installation, worker, videos) {
    if (!Array.isArray(videos) || videos.length > 128) throw new Error('apk_response_invalid');
    const requires = videos.some(v => { try { return local(new URL(v.url)) || v.requiresRuntime; } catch { return false; } });
    if (!requires) return { videos, lease: undefined };
    if (this.size >= this.limit) throw new Error('apk_playback_capacity');
    const id = token(), e = { installation, worker, pid: worker.pid, generation: worker.generation, release: worker.retain(), expires: Date.now() + this.ttlMs, assets: new Map(), reverse: new Map(), roots: new Set() };
    this.entries.set(id, e);
    try {
      for (const v of videos) {
        const u = new URL(v.url); if (!local(u)) continue;
        const root = /^\/session\/[^/]+\//.exec(u.pathname)?.[0];
        if (u.protocol !== 'http:' || !root || !(await this.owns(e.pid, Number(u.port || 80)))) throw new Error('apk_local_stream_forbidden');
        e.roots.add(u.origin + root);
      }
      const mapped = videos.map(v => ({ ...v, url: this.map(id, v.url), subtitles: v.subtitles?.map(t => ({ ...t, url: this.map(id, t.url) })), audio: v.audio?.map(t => ({ ...t, url: this.map(id, t.url) })) }));
      this.get(id); return { videos: mapped, lease: id };
    } catch (error) { this.release(id); throw error; }
  }
  map(id, value) {
    const e = this.get(id), u = new URL(value);
    if (u.username || u.password) throw new Error('apk_stream_url_invalid');
    if (!local(u)) { if (u.protocol !== 'https:' || u.origin === RELAY_ORIGIN) throw new Error('apk_stream_url_invalid'); return u.href; }
    // A session is allowed only its own path; encoded path delimiters/traversal are rejected.
    if (u.protocol !== 'http:' || /%2f|%5c|%2e/i.test(u.pathname) || ![...e.roots].some(root => u.href.startsWith(root))) throw new Error('apk_local_stream_forbidden');
    let key = e.reverse.get(u.href);
    if (!key) {
      if (e.assets.size >= 50_000) throw new Error('apk_asset_limit');
      key = token(); e.assets.set(key, u.href); e.reverse.set(u.href, key);
    }
    return `${RELAY_ORIGIN}/${id}/assets/${key}`;
  }
  async stream(id, asset, range, signal) {
    const e = this.get(id), value = e.assets.get(asset);
    if (!value) throw new Error('apk_asset_not_found');
    const url = new URL(value);
    if (!(await this.owns(e.pid, Number(url.port || 80)))) throw new Error('apk_local_stream_forbidden');
    this.get(id); // Detect a process exit while checking socket ownership.
    url.hostname = url.hostname === '[::1]' ? '[::1]' : '127.0.0.1';
    if (range && !/^bytes=\d*-\d*$/.test(range)) throw new Error('apk_range_invalid');
    return new Promise((resolve, reject) => {
      const req = request(url, { signal, headers: range ? { Range: range } : {} }, response => resolve({ response, url: value }));
      req.setTimeout(30_000, () => req.destroy(new Error('apk_stream_timeout')));
      req.on('error', reject); req.end();
    });
  }
  playlist(id, body, base) {
    if (Buffer.byteLength(body) > 2 * 1024 * 1024 || !body.trimStart().startsWith('#EXTM3U') || /#EXT-X-DEFINE|\{\$/.test(body)) throw new Error('apk_playlist_invalid');
    const map = uri => this.map(id, new URL(uri, base).href);
    return body.split(/\r?\n/).map(line => !line.trim() ? line : line.startsWith('#') ? line.replace(/\bURI="([^"]+)"/g, (_, uri) => `URI="${map(uri)}"`) : map(line.trim())).join('\n');
  }
}
