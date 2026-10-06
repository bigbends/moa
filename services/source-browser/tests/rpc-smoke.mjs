// Test-only localhost gate injection; production DNS/IP pinning is unchanged.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { EngineBridge } from '../bridge.mjs';
import { BrowserService, rpcServer } from '../service.mjs';

const [port, python] = process.argv.slice(2);
const gate = createServer((_req, res) => res.writeHead(403).end());
const sockets = new Set(); let connects = 0;
gate.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
gate.on('connect', (req, client, head) => {
  assert.equal(req.url, 'fixture.invalid:443'); connects++;
  const remote = connect({ host: '127.0.0.1', port: Number(port) }); sockets.add(remote);
  remote.on('error', () => client.destroy()); client.on('error', () => remote.destroy());
  client.once('close', () => remote.destroy()); remote.once('close', () => { sockets.delete(remote); client.destroy(); });
  remote.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) remote.write(head); client.pipe(remote); remote.pipe(client); });
});
gate.listen(0, '127.0.0.1'); await once(gate, 'listening');
const bridge = new EngineBridge({ python, childFactory: (command, _args, options) => {
  const child = spawn(command, ['-u', fileURLToPath(new URL('./rpc-smoke.py', import.meta.url)), '--engine'], options);
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  return child;
} });
const service = new BrowserService({ engine: bridge,
  openProxy: async () => ({ proxy: { server: `http://127.0.0.1:${gate.address().port}`, username: 'test', password: 'test' },
    close() { for (const socket of sockets) socket.destroy(); } }) });
const secret = 'test-secret-'.repeat(4);
const rpc = rpcServer({ secret, service }); rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
try {
  for (let index = 0; index < 2; index++) {
    const response = await fetch(`http://127.0.0.1:${rpc.address().port}/evaluate`, { method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'fixture', proxy: '', url: 'https://fixture.invalid/', headers: { Referer: 'https://fixture.invalid/series/' },
        script: "({title:document.title,text:document.body.textContent})", timeoutMs: 30000 }) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify({ ...result, mockConnects: connects }));
    assert.deepEqual(result, { result: { title: 'RPC fixture', text: 'local-ok' } });
  }
  assert.equal(service.sessions.size, 1); assert(connects >= 2);
  await service.reap(Date.now() + 200000);
  assert.equal(service.sessions.size, 0);
  console.log('PASS authenticated RPC → relay → JSONL → Firefox TLS DOM callback; context reuse; idle close');
} finally {
  await service.close(); rpc.closeAllConnections(); rpc.close();
  for (const socket of sockets) socket.destroy(); gate.close();
}
