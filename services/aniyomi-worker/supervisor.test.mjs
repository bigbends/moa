import assert from 'node:assert/strict';
import test from 'node:test';
import { ApkWorkerSupervisor } from './supervisor.mjs';

function worker(options = {}) {
  return new ApkWorkerSupervisor(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import readline from 'node:readline';
    for await (const line of readline.createInterface({ input: process.stdin })) {
      const request = JSON.parse(line);
      if (request.params.hang) continue;
      if (request.params.crash) process.exit(1);
      if (request.params.bad) { console.log('not json'); continue; }
      if (request.params.delay) await new Promise(resolve => setTimeout(resolve, request.params.delay));
      console.log(JSON.stringify({ id: request.id, result: { pid: process.pid, value: request.params.value } }));
    }
  `,
    ],
    { timeoutMs: 3000, idleMs: 100, ...options },
  );
}
test('reuses an idle worker, keeps order, and shuts down explicitly', async () => {
  const host = worker();
  try {
    const results = await Promise.all([host.request('list', { value: 1 }), host.request('detail', { value: 2 })]);
    assert.equal(results[0].pid, results[1].pid);
    assert.deepEqual(
      results.map((r) => r.value),
      [1, 2],
    );
  } finally {
    host.close();
  }
  await assert.rejects(host.request('describe'), /closed/);
});

test('active cancellation releases the lane and queued work starts in a fresh process', async () => {
  const host = worker();
  const abort = new AbortController();
  try {
    const running = assert.rejects(host.request('list', { hang: true }, abort.signal), /cancelled/);
    const queued = host.request('list', { value: 2 });
    abort.abort();
    await running;
    assert.equal((await queued).value, 2);
  } finally {
    host.close();
  }
});
test('queued cancellation never kills the active request', async () => {
  const host = worker();
  const abort = new AbortController();
  try {
    const active = host.request('describe');
    const queued = assert.rejects(host.request('list', {}, abort.signal), /cancelled/);
    abort.abort();
    const first = await active;
    await queued;
    assert.equal((await host.request('describe')).pid, first.pid);
  } finally {
    host.close();
  }
});
test('crashes and malformed replies fail once and do not replay failed operations', async () => {
  const host = worker();
  try {
    await assert.rejects(host.request('list', { crash: true }), /exited/);
    await assert.rejects(host.request('list', { bad: true }), /response_invalid/);
    assert.equal((await host.request('list', { value: 'recovered' })).value, 'recovered');
  } finally {
    host.close();
  }
});
test('deadline and admission bounds are enforced', async () => {
  const host = worker({ timeoutMs: 300, queueLimit: 1 });
  try {
    const first = assert.rejects(host.request('list', { hang: true }), /timeout/);
    const queued = assert.rejects(host.request('describe'), /timeout/);
    await assert.rejects(host.request('describe'), /busy/);
    await first;
    await queued;
    await assert.rejects(host.request('invalid'), /method_invalid/);
  } finally {
    host.close();
  }
});
test('idle shutdown frees the JVM and next invocation starts a new process', async () => {
  const host = worker({ idleMs: 40 });
  try {
    const first = await host.request('describe');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(host.pid, undefined);
    assert.notEqual((await host.request('describe')).pid, first.pid);
  } finally { host.close(); }
});
test('a playback retain prevents idle shutdown until its last release', async () => {
  const host = worker({ idleMs: 30 });
  try {
    const first = await host.request('describe'), release = host.retain();
    await new Promise(r=>setTimeout(r,100)); assert.equal(host.pid,first.pid);
    release(); release(); await new Promise(r=>setTimeout(r,100)); assert.equal(host.pid,undefined);
  } finally { host.close(); }
});
