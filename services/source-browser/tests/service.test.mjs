import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { BrowserService, rpcServer } from '../service.mjs';
import { validateRequest, authorized, sessionKey, REQUEST_LIMIT, RESPONSE_LIMIT } from '../policy.mjs';

const input = (scope = 'source-1', proxy = '') => ({ scope, proxy, url: 'https://example.com/', headers: {}, script: 'true', timeoutMs: 5000 });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const events = []; let failure;
  const engine = {
    call: async (message, signal) => { events.push(['evaluate', message.key]); signal.throwIfAborted(); return { result: message.request.scope }; },
    closeSession: async key => events.push(['close', key]), stop: () => events.push(['stop']), ...options.engine,
  };
  const service = new BrowserService({ engine, maxContexts: 2, idleMs: 100000,
    openProxy: async () => ({ proxy: {}, get failure() { return failure; }, close: () => events.push(['gate-close']) }),
    relayFactory: async () => ({ proxy: {}, attach: () => events.push(['attach']), detach: () => events.push(['detach']), close: () => events.push(['relay-close']) }),
    ...options, engine });
  return { service, events, setFailure: value => { failure = value; } };
}

test('bearer equality and validation reject private targets, unsafe headers, invalid proxy/timeout', () => {
  assert(authorized('Bearer abc', 'abc')); assert(!authorized('Bearer abcd', 'abc'));
  for (const url of ['http://example.com', 'https://127.0.0.1', 'https://[::1]', 'https://user:pass@example.com', 'file:///tmp/x'])
    assert.throws(() => validateRequest({ ...input(), url }), /source_url_denied/);
  for (const proxy of ['socks5://user:pass@localhost:1080', 'file:///x', 'http://localhost:0'])
    assert.throws(() => validateRequest({ ...input(), proxy }), /source_proxy_invalid/);
  for (const headers of [{ Host: 'localhost' }, { 'Proxy-Authorization': 'secret' }, { Referer: 'a\r\nb' }])
    assert.throws(() => validateRequest({ ...input(), headers }), /source_headers_invalid/);
  assert.throws(() => validateRequest({ ...input(), timeoutMs: 90001 }), /source_request_invalid/);
  assert.notEqual(sessionKey(input('s1')), sessionKey(input('s2')));
  assert.notEqual(sessionKey(input()), sessionKey(input('source-1', 'socks5://localhost:1080')));
});

test('context reuse, source/proxy isolation, eviction, idle close, fresh request gate', async () => {
  const { service, events } = fixture();
  for (const req of [input(), input(), input('s2'), input('source-1', 'socks5://localhost:1080')])
    await service.evaluate(req, new AbortController().signal);
  assert.equal(service.sessions.size, 2);
  assert.equal(events.filter(e => e[0] === 'close').length, 1);
  assert.equal(events.filter(e => e[0] === 'attach').length, 4);
  await service.reap(Date.now() + 200000); assert.equal(service.sessions.size, 0);
  await service.close();
});

test('idle reaper closes contexts before stopping Python and protects active/queued work', async t => {
  const releases = [];
  const f = fixture({ maxContexts: 1, engine: { call: message => new Promise(resolve => {
    f.events.push(['running', message.request.scope]); releases.push(() => resolve({ result: true }));
  }) } });
  t.after(() => f.service.close());
  const active = f.service.evaluate(input('active'), new AbortController().signal); await tick();
  const queued = f.service.evaluate(input('queued'), new AbortController().signal); await tick();
  await f.service.reap(Date.now() + 200000);
  assert.equal(f.service.sessions.size, 1);
  assert.equal(f.service.slots.waiters.length, 1);
  assert.equal(f.events.some(e => e[0] === 'stop' || e[0] === 'close'), false);
  releases.shift()(); await active; await tick();
  assert.deepEqual(f.events.filter(e => e[0] === 'running').map(e => e[1]), ['active', 'queued']);
  assert.equal(f.events.some(e => e[0] === 'stop'), false, 'eviction while queued work starts must keep Python alive');
  await f.service.reap(Date.now() + 200000);
  assert.equal(f.service.sessions.size, 1, 'active queued request survives reaping');
  releases.shift()(); await queued;
  assert.equal(f.events.some(e => e[0] === 'stop'), false);
  await f.service.reap(Date.now() + 200000);
  assert.equal(f.service.sessions.size, 0);
  assert.equal(f.service.slots.active, 0);
  assert.equal(f.events.at(-1)[0], 'stop');
  assert.equal(f.events.filter(e => e[0] === 'close').length, 2);
});

test('service exports captured state only for an explicit host capture request', async t => {
  const session = { cookies: [{ name: 'session', value: 'private', domain: 'example.com' }], userAgent: 'Synthetic', engine: 'synthetic' };
  const f = fixture({ engine: { call: async () => ({ result: 'guest-result', session }) } });
  t.after(() => f.service.close());
  assert.deepEqual(JSON.parse(await f.service.evaluate(input(), new AbortController().signal)), { result: 'guest-result' });
  assert.deepEqual(JSON.parse(await f.service.evaluate({ ...input(), captureSession: true }, new AbortController().signal)), { result: 'guest-result', session });
});

test('same context serialized, different contexts parallel, queued abort does not steal a slot', async () => {
  const running = []; const releases = [];
  const { service } = fixture({ engine: { call: (message, signal) => new Promise((resolve, reject) => {
    running.push(message.request.scope); releases.push(() => resolve({ result: true }));
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) } });
  const a = service.evaluate(input(), new AbortController().signal); await tick();
  const aborter = new AbortController();
  const queued = service.evaluate(input(), aborter.signal);
  const rejected = assert.rejects(queued, /source_cancelled/);
  const b = service.evaluate(input('s2'), new AbortController().signal); await tick();
  assert.deepEqual(running, ['source-1', 's2']);
  aborter.abort(Error('source_cancelled')); await rejected;
  releases.forEach(release => release()); await Promise.all([a, b]);
  assert.equal(service.slots.active, 0); assert.equal(service.locks.size, 0); await service.close();
});

test('abort/failure closes context and sockets; ancillary failure alone permits verified result', async () => {
  const { service, events, setFailure } = fixture();
  setFailure('source_connection_failed'); await service.evaluate(input(), new AbortController().signal);
  setFailure('source_address_denied'); await assert.rejects(service.evaluate(input(), new AbortController().signal), /source_address_denied/);
  assert.equal(service.sessions.size, 0); assert(events.some(e => e[0] === 'relay-close'));
  await service.close();
  const aborter = new AbortController();
  const f = fixture({ engine: { call: (_message, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) } });
  const work = f.service.evaluate(input(), aborter.signal); await tick();
  const rejected = assert.rejects(work, /source_request_timeout/); aborter.abort(Error('source_request_timeout')); await rejected;
  assert.equal(f.service.sessions.size, 0); assert(f.events.some(e => e[0] === 'gate-close')); await f.service.close();
});

test('JSON result byte limit applies after UTF8 encoding', async () => {
  const { service } = fixture({ engine: { call: async () => ({ result: '가'.repeat(RESPONSE_LIMIT / 2) }) } });
  await assert.rejects(service.evaluate(input(), new AbortController().signal), /source_body_limit/);
  assert.equal(service.sessions.size, 0); await service.close();
});

test('shutdown prevents queued requests and a pending proxy open from starting the engine', async () => {
  let release;
  const f = fixture({ maxContexts: 1, engine: { call: () => new Promise(resolve => { release = () => resolve({ result: true }); }) } });
  const active = f.service.evaluate(input(), new AbortController().signal); await tick();
  const queued = assert.rejects(f.service.evaluate(input('s2'), new AbortController().signal), /source_browser_unavailable/);
  await f.service.close(); release(); await active; await queued;
  assert.equal(f.service.sessions.size, 0);
  assert.equal(f.events.filter(e => e[0] === 'attach').length, 1);

  let opened, closed = false;
  const g = fixture({ openProxy: () => new Promise(resolve => { opened = () => resolve({ proxy: {}, close: () => { closed = true; } }); }) });
  const pending = assert.rejects(g.service.evaluate(input(), new AbortController().signal), /source_browser_unavailable/);
  await tick(); await g.service.close(); opened(); await pending;
  assert.equal(closed, true);
  assert.equal(g.events.some(e => e[0] === 'evaluate'), false);
});

test('authenticated RPC caps request and enforces deadline/disconnect during evaluate', async t => {
  const secret = 's'.repeat(32); const signals = [];
  const service = { evaluate: async (_request, signal) => { signals.push(signal); await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } };
  const server = rpcServer({ secret, service }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/evaluate`;
  const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
  let response = await fetch(url, { method: 'POST', body: '{}' }); assert.equal(response.status, 401);
  response = await fetch(url, { method: 'POST', headers, body: ' '.repeat(REQUEST_LIMIT + 1) }); assert.equal(response.status, 413);
  response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...input(), timeoutMs: 20 }) });
  assert.equal(response.status, 504); assert.deepEqual(await response.json(), { error: 'source_request_timeout' });
  const req = request(url, { method: 'POST', headers }); req.on('error', () => {}); req.end(JSON.stringify(input()));
  while (signals.length < 2) await tick(); req.destroy();
  for (let i = 0; i < 100 && !signals[1].aborted; i++) await new Promise(r => setTimeout(r, 2));
  assert.equal(signals[1].reason.message, 'source_cancelled');
});
