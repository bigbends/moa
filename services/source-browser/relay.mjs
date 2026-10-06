// GPL-3.0-or-later. Stable context proxy; attaches a fresh pinned gate per RPC.
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';

export async function openRelay() {
  const sockets = new Set();
  let active;
  const track = socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };
  // Production accepts only HTTPS targets, so ordinary HTTP is always refused.
  const server = createServer((_req, res) => res.writeHead(403).end());
  server.on('connection', socket => {
    if (!active || sockets.size >= 64) socket.destroy();
    else track(socket);
  });
  server.on('connect', (req, client, head) => {
    const gate = active;
    // INV loses CONNECT authentication when route headers are overridden.
    // This browser-facing hop is loopback-only in the dedicated container;
    // the attached policy gate and external RPC still require authentication.
    if (!gate) {
      client.end('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return;
    }
    const endpoint = new URL(gate.proxy.server);
    const upstream = httpRequest({ hostname: endpoint.hostname, port: endpoint.port,
      method: 'CONNECT', path: req.url, agent: false,
      headers: { host: req.url, 'proxy-authorization': 'Basic ' + Buffer.from(
        `${gate.proxy.username}:${gate.proxy.password}`).toString('base64') } });
    client.once('close', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    upstream.on('socket', track);
    upstream.on('connect', (res, remote, pending) => {
      if (active !== gate || client.destroyed || res.statusCode !== 200) { remote.destroy(); client.destroy(); return; }
      track(remote);
      remote.once('close', () => client.destroy());
      client.once('close', () => remote.destroy());
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      if (pending.length) client.write(pending);
      client.pipe(remote); remote.pipe(client);
    });
    upstream.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const detach = () => { active = undefined; for (const socket of sockets) socket.destroy(); sockets.clear(); };
  return {
    proxy: { server: `http://127.0.0.1:${server.address().port}`, bypass: '<-loopback>' },
    attach(gate) { if (active) throw Error('source_browser_busy'); active = gate; },
    detach,
    close() { detach(); server.close(); },
  };
}
