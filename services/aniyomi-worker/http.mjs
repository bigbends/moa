import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { parseRepository } from './repository.mjs';
import { methods } from './supervisor.mjs';

const safeError = e => /^apk_[a-z_]+$/.test(e?.message) ? e.message : 'apk_request_failed';
export function createBridgeServer(runtime, secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw new Error('apk_bridge_secret_required');
  const expected = Buffer.from(`Bearer ${secret}`);
  return createServer({ maxHeaderSize: 16_384, requestTimeout: 130_000 }, async (req, res) => {
    const incoming = Buffer.from(req.headers.authorization || '');
    const json = (status, value) => { if (!res.headersSent && !res.destroyed) res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value)); };
    if (incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) { req.resume(); return json(401, { error: 'apk_bridge_unauthorized' }); }
    const abort = new AbortController();
    const close = () => { if (!res.writableEnded) abort.abort(); }; res.once('close', close);
    const signal = req.method === 'GET' ? abort.signal : AbortSignal.any([abort.signal, AbortSignal.timeout(120_000)]);
    try {
      const asset = /^\/leases\/([\w-]{32})\/assets\/([\w-]{32})$/.exec(req.url || '');
      if (req.method === 'GET' && asset) {
        const { response, url } = await runtime.leases.stream(asset[1], asset[2], req.headers.range, signal);
        try {
          const status = response.statusCode;
          if (![200, 206].includes(status)) { response.destroy(); return json(status === 416 ? 416 : 502, { error: 'apk_stream_unavailable' }); }
          const type = String(response.headers['content-type'] || '');
          if (/mpegurl/i.test(type) || /\.m3u8(?:\?|$)/i.test(url)) {
            const parts = []; let size = 0;
            for await (const chunk of response) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('apk_playlist_limit'); parts.push(chunk); }
            const body = runtime.leases.playlist(asset[1], Buffer.concat(parts).toString('utf8'), url);
            res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' }).end(body);
          } else {
            const headers = { 'Content-Type': /^(video|audio)\//.test(type) ? type : 'application/octet-stream', 'Cache-Control': 'no-store' };
            for (const key of ['content-length', 'content-range', 'accept-ranges']) if (response.headers[key]) headers[key] = response.headers[key];
            res.writeHead(status, headers); await pipeline(response, res, { signal });
          }
        } finally { response.destroy(); }
        return;
      }
      if (req.method !== 'POST' || req.url !== '/rpc') { req.resume(); return json(404, { error: 'apk_route_not_found' }); }
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { req.resume(); return json(415, { error: 'apk_content_type_invalid' }); }
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 44 * 1024 * 1024) { json(413, { error: 'apk_request_limit' }); req.destroy(); return; } chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('apk_request_invalid');
      let result;
      if (input.method === 'repository') {
        if (typeof input.index !== 'string' || input.index.length > 6 * 1024 * 1024) throw new Error('apk_index_limit');
        result = parseRepository(Buffer.from(input.index, 'base64'), input.repository);
      } else if (input.method === 'status') result = runtime.status();
      else if (input.method === 'packages') result = runtime.store.snapshot();
      else if (input.method === 'release') { runtime.leases.release(input.lease); result = { released: true }; }
      else if (input.method === 'renew') { runtime.leases.get(input.lease); result = { renewed: true }; }
      else if (input.method === 'remove') result = await runtime.remove(input.packageId, signal);
      else if (input.method === 'install') {
        if (typeof input.apk !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.apk)) throw new Error('apk_request_invalid');
        const bytes = Buffer.from(input.apk, 'base64');
        if (bytes.length > 32 * 1024 * 1024) throw new Error('apk_request_limit');
        result = await runtime.install(bytes, input.repository, input.advertised, signal);
      } else {
        const method = input.method === 'extract' ? 'videos' : input.method;
        if (!methods.has(method) || input.method === 'videos' || typeof input.packageId !== 'string' || !/^[a-f0-9]{64}$/.test(input.packageId) || !input.params || typeof input.params !== 'object' || Array.isArray(input.params) || Buffer.byteLength(JSON.stringify(input.params)) > 1024 * 1024) throw new Error('apk_request_invalid');
        result = await runtime.invoke(input.packageId, method, input.params, signal, input.method === 'extract');
      }
      json(200, { result });
    } catch (e) {
      if (res.headersSent) res.destroy();
      else { const error = safeError(e); json(/busy|playback_active|playback_capacity/.test(error) ? 409 : /expired|not_found/.test(error) ? 404 : 502, { error }); }
    } finally { res.off('close', close); }
  });
}
