// GPL-3.0-or-later. A host-authorized RPC and bounded in-memory session pool.
import { createServer } from 'node:http';
import { sessionKey, validateRequest, authorized, safeError, REQUEST_LIMIT, RESPONSE_LIMIT, MAX_TIMEOUT } from './policy.mjs';
import { openRelay } from './relay.mjs';

class Slots {
  constructor(limit, queued = 16) { this.limit = limit; this.queued = queued; this.active = 0; this.waiters = []; }
  async take(signal) {
    signal.throwIfAborted();
    if (this.active < this.limit) { this.active++; return; }
    if (this.waiters.length >= this.queued) throw Error('source_browser_busy');
    await new Promise((resolve, reject) => {
      const row = { resolve: () => { signal.removeEventListener('abort', abort); resolve(); } };
      const abort = () => { this.waiters.splice(this.waiters.indexOf(row), 1); reject(signal.reason); };
      signal.addEventListener('abort', abort, { once: true }); this.waiters.push(row);
    });
  }
  release() { const next = this.waiters.shift(); if (next) next.resolve(); else this.active--; }
}

export class BrowserService {
  constructor({ engine, openProxy, relayFactory = openRelay, maxContexts = 2, idleMs = 30_000 }) {
    this.reaping = new Set();
    this.engine = engine; this.openProxy = openProxy; this.relayFactory = relayFactory;
    this.maxContexts = maxContexts; this.idleMs = idleMs; this.sessions = new Map(); this.locks = new Map();
    this.slots = new Slots(maxContexts); this.closed = false;
    this.reaper = setInterval(() => { void this.reap().catch(() => {}); }, Math.min(idleMs, 10_000)); this.reaper.unref();
  }
  async discard(key, row) {
    if (this.sessions.get(key) !== row) return;
    this.sessions.delete(key); row.relay?.close();
    const closing = this.engine.closeSession(key).catch(() => {});
    this.reaping.add(closing);
    try { await closing; } finally { this.reaping.delete(closing); }
  }
  async reap(now = Date.now()) {
    for (const [key, row] of this.sessions) {
      if (row.busy || now - row.last < this.idleMs || this.locks.has(key)) continue;
      const lock = new Slots(1); this.locks.set(key, lock);
      await lock.take(new AbortController().signal);
      try { await this.discard(key, row); }
      finally { lock.release(); if (!lock.active && !lock.waiters.length) this.locks.delete(key); }
    }
    this.stopIdleEngine();
  }
  stopIdleEngine() {
    if (!this.sessions.size && !this.slots.active && !this.slots.waiters.length && !this.reaping.size && !this.locks.size) this.engine.stop();
  }
  async evaluate(request, signal) {
    if (this.closed) throw Error('source_browser_unavailable');
    const key = sessionKey(request);
    let lock = this.locks.get(key);
    if (!lock) { lock = new Slots(1); this.locks.set(key, lock); }
    try { await lock.take(signal); }
    catch (error) { if (!lock.active && !lock.waiters.length) this.locks.delete(key); throw error; }
    let slot = false, row, gate;
    const detach = () => { row?.relay?.detach(); gate?.close(); };
    try {
      await this.slots.take(signal); slot = true;
      signal.throwIfAborted();
      if (this.closed) throw Error('source_browser_unavailable');
      row = this.sessions.get(key);
      if (!row) {
        if (this.sessions.size >= this.maxContexts) {
          const idle = [...this.sessions].filter(([, s]) => !s.busy).sort((a, b) => a[1].last - b[1].last)[0];
          if (!idle) throw Error('source_browser_busy');
          // Reserve the new slot before awaiting cleanup so parallel callers
          // cannot exceed the context ceiling.
          const closing = this.discard(...idle);
          row = { busy: true, last: Date.now() }; this.sessions.set(key, row);
          await closing;
        } else { row = { busy: true, last: Date.now() }; this.sessions.set(key, row); }
        row.relay = await this.relayFactory();
      }
      row.busy = true;
      gate = await this.openProxy({ outboundProxy: request.proxy || undefined }, signal);
      if (this.closed) throw Error('source_browser_unavailable');
      signal.throwIfAborted(); row.relay.attach(gate);
      signal.addEventListener('abort', detach, { once: true });
      const reply = await this.engine.call({ op: 'evaluate', key, proxy: row.relay.proxy, request }, signal);
      signal.throwIfAborted();
      // Ordinary failed ancillary connections (e.g. an IPv6 CF probe) do not
      // invalidate a verified page result. Policy/transport limits fail closed.
      if (gate.failure && gate.failure !== 'source_connection_failed') throw Error(gate.failure);
      if (reply.error) throw Error(safeError({ message: reply.error }));
      if (!Object.hasOwn(reply, 'result')) throw Error('source_result_invalid');
      const body = JSON.stringify({ result: reply.result, ...(request.captureSession && reply.session ? { session: reply.session } : {}) });
      if (Buffer.byteLength(body) > RESPONSE_LIMIT) throw Error('source_body_limit');
      return body;
    } catch (error) {
      detach(); if (row) await this.discard(key, row); throw error;
    } finally {
      signal.removeEventListener('abort', detach); detach();
      if (row) { row.busy = false; row.last = Date.now(); }
      if (slot) this.slots.release(); lock.release();
      if (!lock.active && !lock.waiters.length) this.locks.delete(key);
      this.stopIdleEngine();
    }
  }
  async close() {
    this.closed = true; clearInterval(this.reaper);
    await Promise.all([...this.sessions].map(([key, row]) => this.discard(key, row)));
    this.engine.stop();
  }
}

export function rpcServer({ secret, service }) {
  let inflight = 0;
  const server = createServer(async (req, res) => {
    const send = (status, error, body) => {
      if (!res.destroyed) res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(body ?? JSON.stringify({ error }));
    };
    if (!authorized(req.headers.authorization, secret)) { send(401, 'source_unauthorized'); req.resume(); return; }
    if (req.method === 'GET' && req.url === '/health') { send(200, null, '{"ready":true}'); return; }
    if (req.method !== 'POST' || req.url !== '/evaluate') { send(404, 'source_request_invalid'); req.resume(); return; }
    if (++inflight > 16) { inflight--; send(503, 'source_browser_busy'); req.resume(); return; }
    const aborter = new AbortController(), started = Date.now();
    let timer = setTimeout(() => aborter.abort(Error('source_request_timeout')), Math.min(MAX_TIMEOUT, 10_000));
    const disconnect = () => { if (!res.writableFinished) aborter.abort(Error('source_cancelled')); };
    req.once('aborted', disconnect); res.once('close', disconnect);
    const abortRead = () => { if (!req.complete) req.destroy(); };
    aborter.signal.addEventListener('abort', abortRead, { once: true });
    try {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw Error('source_request_invalid');
      if (Number(req.headers['content-length']) > REQUEST_LIMIT) throw Error('source_request_limit');
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length; if (length > REQUEST_LIMIT) throw Error('source_request_limit'); chunks.push(chunk);
      }
      aborter.signal.throwIfAborted();
      let raw; try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Error('source_request_invalid'); }
      const request = validateRequest(raw), remaining = request.timeoutMs - (Date.now() - started);
      clearTimeout(timer);
      if (remaining <= 0) throw Error('source_request_timeout');
      timer = setTimeout(() => aborter.abort(Error('source_request_timeout')), remaining);
      request.timeoutMs = remaining;
      const body = await service.evaluate(request, aborter.signal); send(200, null, body);
    } catch (error) {
      const code = safeError(aborter.signal.aborted ? aborter.signal.reason : error);
      send(code === 'source_request_limit' || code === 'source_body_limit' ? 413 : code === 'source_request_timeout' ? 504 : code === 'source_browser_busy' ? 503 : 400,
        code === 'source_request_limit' ? 'source_body_limit' : code);
      req.resume();
    } finally {
      clearTimeout(timer); inflight--; req.removeListener('aborted', disconnect); res.removeListener('close', disconnect);
      aborter.signal.removeEventListener('abort', abortRead);
    }
  });
  server.requestTimeout = MAX_TIMEOUT + 5000; server.headersTimeout = 10_000;
  server.maxHeadersCount = 80;
  return server;
}
