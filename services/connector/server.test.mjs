import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Connector, rpcServer } from './server.mjs';
function binaries() {
  const children = [], commands = [];
  const launch = (bin, args) => {
    commands.push([bin, ...args]);
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.exitCode = null;
    child.kill = signal => { child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0, signal)); }; children.push(child); return child;
  };
  return { launch, children, commands };
}
test('RPC authenticates, Quick URL parser spans chunks, repeated apply preserves process, stop kills owned PID', async () => {
  const dir = await mkdtemp(`${tmpdir()}/connector-`), mock = binaries();
  const connector = new Connector({ dir, launch: mock.launch }); const server = rpcServer(connector, 'test-secret');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/rpc`;
  try {
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
    const call = body => fetch(url, { method: 'POST', headers: { Authorization: 'Bearer test-secret' }, body: JSON.stringify(body) });
    const config = { mode: 'cloudflare-quick' };
    assert.equal((await (await call({ method: 'apply', config })).json()).state, 'starting');
    mock.children[0].stderr.emit('data', 'https://example.trycloud'); mock.children[0].stderr.emit('data', 'flare.com\nRegistered tunnel connection');
    assert.equal((await connector.rpc('apply', config)).url, 'https://example.trycloudflare.com');
    assert.equal(mock.children.length, 1); assert.ok(connector.deadline > Date.now());
    assert.ok(mock.commands[0].includes('http://moa-gateway:8080')); assert.ok(!mock.commands.flat().some(x => x.includes('8795')));
    assert.equal((await connector.checkLease(connector.deadline + 1)).state, 'off'); assert.equal(mock.children[0].exitCode, 0);
    assert.equal((await connector.rpc('stop')).state, 'off');
  } finally { await connector.rpc('stop'); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
test('token is a private file, never a command argument; Tailscale login, Serve and Funnel', async () => {
  const dir = await mkdtemp(`${tmpdir()}/connector-`), mock = binaries(); let running = false;
  const calls = [];
  const connector = new Connector({ dir, launch: mock.launch, run: async (bin, args) => {
    calls.push(args);
    if (args.includes('reset') && !running) throw new Error('netMap is nil');
    if (args.includes('status') && args.includes('serve')) return JSON.stringify({ Web: { 'moa.example.ts.net:443': {} } });
    if (args.includes('status')) return JSON.stringify({ BackendState: running ? 'Running' : 'NeedsLogin', AuthURL: 'https://login.tailscale.com/a/test', Self: { DNSName: 'moa.example.ts.net.' } });
    return '';
  } });
  try {
    await connector.rpc('apply', { mode: 'cloudflare-token', cloudflareToken: 'private-test-token', publicHostname: 'moa.example.com' });
    assert.equal((await stat(`${dir}/cloudflare-token`)).mode & 0o777, 0o600); assert.ok(!JSON.stringify(mock.commands).includes('private-test-token'));
    const config = { mode: 'tailscale', funnel: false };
    assert.equal((await connector.rpc('apply', config)).state, 'needs-login'); running = true;
    assert.equal((await connector.rpc('apply', config)).url, 'https://moa.example.ts.net');
    assert.ok(calls.some(args => args.includes('serve') && args.includes('http://127.0.0.1:8788')));
    await connector.rpc('apply', { ...config, funnel: true });
    assert.ok(calls.some(args => args.includes('funnel')));
  } finally { await connector.rpc('stop'); await rm(dir, { recursive: true, force: true }); }
});
