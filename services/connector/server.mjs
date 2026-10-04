import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const GATEWAY = 'http://moa-gateway:8080';
const empty = () => ({ state: 'off', url: null, loginUrl: null, lastError: null });
export class Connector {
  constructor({ dir = '/data', launch = spawn, run = async (bin, args) => (await execute(bin, args, { timeout: 8000, maxBuffer: 1024 * 1024 })).stdout } = {}) {
    this.dir = dir; this.launch = launch; this.run = run; this.children = new Set(); this.state = empty(); this.key = ''; this.config = null;
    this.queue = Promise.resolve(); this.deadline = 0;
  }
  checkLease(now = Date.now()) { return this.deadline && now > this.deadline ? this.rpc('stop') : Promise.resolve({ ...this.state }); }
  rpc(method, config) {
    const next = this.queue.then(async () => {
      if (method === 'stop') await this.stop();
      else if (method === 'apply') {
        const key = JSON.stringify(config);
        if (key !== this.key || this.state.state === 'error') { await this.stop(); this.key = key; this.config = config; await this.start(config); }
        this.deadline = Date.now() + 45000;
        if (config.mode === 'tailscale') await this.pollTailscale();
      } else if (method !== 'status') throw new Error('invalid-method');
      return { ...this.state };
    }).catch(async () => { await this.stop(); this.state = { ...empty(), state: 'error', lastError: 'connector-operation-failed' }; return { ...this.state }; });
    this.queue = next; return next;
  }
  child(bin, args, output = () => {}, fatal = true) {
    const child = this.launch(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); this.children.add(child);
    child.stdout.on('data', output); child.stderr.on('data', output);
    child.on('error', () => { this.state = { ...empty(), state: 'error', lastError: 'connector-process-failed' }; });
    child.on('exit', () => { if (this.children.delete(child) && fatal) this.state = { ...empty(), state: 'error', lastError: 'connector-process-exited' }; });
    return child;
  }
  async stop() {
    this.config = null; this.key = ''; this.deadline = 0;
    const children = [...this.children]; this.children.clear();
    await Promise.all(children.map(child => new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, 2000); timer.unref();
      child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
    })));
    await rm(`${this.dir}/cloudflare-token`, { force: true }); await rm(`${this.dir}/tailscale-key`, { force: true });
    this.state = empty();
  }
  async start(config) {
    if (!['cloudflare-quick', 'cloudflare-token', 'tailscale'].includes(config?.mode)) throw new Error('invalid-mode');
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    this.state = { ...empty(), state: 'starting' };
    if (config.mode.startsWith('cloudflare-')) {
      let buffer = ''; let registered = false;
      const output = chunk => {
        buffer = (buffer + chunk.toString()).slice(-16384);
        const url = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
        if (url && config.mode === 'cloudflare-quick') this.state.url = url;
        if (buffer.includes('Registered tunnel connection')) registered = true;
        if (registered && this.state.url) this.state.state = 'connected';
      };
      let args = ['tunnel', '--no-autoupdate', '--url', GATEWAY];
      if (config.mode === 'cloudflare-token') {
        if (!config.cloudflareToken || !config.publicHostname) throw new Error('missing-config');
        await writeFile(`${this.dir}/cloudflare-token`, config.cloudflareToken, { mode: 0o600 });
        args = ['tunnel', '--no-autoupdate', 'run', '--token-file', `${this.dir}/cloudflare-token`];
        this.state.url = `https://${config.publicHostname}`;
      }
      this.child('cloudflared', args, output); return;
    }
    this.child('tailscaled', ['--tun=userspace-networking', `--state=${this.dir}/tailscaled.state`, `--statedir=${this.dir}`, '--socket=/tmp/tailscaled.sock']);
    // Wait for local daemon readiness, without holding an RPC open for login.
    for (let i = 0; i < 20; i++) {
      try { await this.ts(['status', '--json']); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    // Clear persisted Serve/Funnel config before reconnecting.
    const initial = JSON.parse(await this.ts(['status', '--json']));
    if (initial.BackendState === 'Running') await this.ts(['serve', 'reset']);
    const args = ['up', '--hostname=moa', '--accept-dns=false', '--accept-routes=false', '--timeout=5s'];
    if (config.tailscaleAuthKey) {
      await writeFile(`${this.dir}/tailscale-key`, config.tailscaleAuthKey, { mode: 0o600 }); args.push(`--auth-key=file:${this.dir}/tailscale-key`);
    }
    let loginOutput = '';
    this.child('tailscale', ['--socket=/tmp/tailscaled.sock', ...args], chunk => {
      loginOutput = (loginOutput + chunk.toString()).slice(-8192);
      const url = loginOutput.match(/https:\/\/login\.tailscale\.com\/[a-zA-Z0-9/_-]+/)?.[0];
      if (url) { this.state.loginUrl = url; this.state.state = 'needs-login'; }
    }, false);
  }
  ts(args) { return this.run('tailscale', ['--socket=/tmp/tailscaled.sock', ...args]); }
  async pollTailscale() {
    const status = JSON.parse(await this.ts(['status', '--json']));
    if (status.BackendState !== 'Running') {
      const loginUrl = status.AuthURL || this.state.loginUrl;
      this.state = { ...empty(), state: loginUrl ? 'needs-login' : 'starting', loginUrl }; return;
    }
    const name = status.Self?.DNSName?.replace(/\.$/, '');
    if (!name || !/^[a-z0-9.-]+\.ts\.net$/.test(name)) throw new Error('missing-dns');
    if (this.state.state !== 'connected') {
      await this.ts(['serve', 'reset']);
      await this.ts([this.config.funnel ? 'funnel' : 'serve', '--bg', '--https=443', 'http://127.0.0.1:8788']);
    }
    const serving = JSON.parse(await this.ts(['serve', 'status', '--json']));
    if (!serving.Web || !Object.keys(serving.Web).length) throw new Error('serve-not-configured');
    this.state = { ...empty(), state: 'connected', url: `https://${name}` };
  }
}
export function rpcServer(connector, secret) {
  return http.createServer(async (req, res) => {
    const provided = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${secret}`);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) { res.writeHead(401).end(); return; }
    if (req.url !== '/rpc' || req.method !== 'POST') { res.writeHead(404).end(); return; }
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16384) { res.writeHead(413).end(); return; } }
      const { method, config } = JSON.parse(raw);
      if (!['apply', 'stop', 'status'].includes(method)) { res.writeHead(400).end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(await connector.rpc(method, config)));
    } catch { if (!res.headersSent) res.writeHead(400); res.end(); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const secretFile = process.env.MOA_CONNECTOR_SECRET_FILE || '/run/moa-connector/token';
  await mkdir('/run/moa-connector', { recursive: true });
  try { await writeFile(secretFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o640 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  await chmod(secretFile, 0o640);
  const connector = new Connector();
  // Tailscale Serve accepts loopback backends. This fixed proxy always targets the login gateway.
  const proxy = http.createServer((req, res) => {
    const upstream = http.request(GATEWAY + req.url, { method: req.method, headers: { ...req.headers, 'x-forwarded-proto': 'https' } }, incoming => { res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res); });
    upstream.on('error', () => { res.writeHead(502).end(); }); req.pipe(upstream);
  }).listen(8788, '127.0.0.1');
  const server = rpcServer(connector, (await readFile(secretFile, 'utf8')).trim()); server.requestTimeout = 15000; server.listen(8798, '0.0.0.0');
  const timer = setInterval(() => { void connector.checkLease(); }, 5000).unref();
  process.on('SIGTERM', async () => { clearInterval(timer); await connector.rpc('stop'); server.close(); proxy.close(); });
}
