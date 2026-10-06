// GPL-3.0-or-later. Child stdout is bounded JSONL; raw child diagnostics are not logged.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RESPONSE_LIMIT } from './policy.mjs';

export class EngineBridge {
  constructor({ python = process.env.MOA_SOURCE_BROWSER_PYTHON || 'python3', childFactory = spawn } = {}) {
    this.python = python; this.childFactory = childFactory; this.pending = new Map(); this.sequence = 0;
  }
  start() {
    if (this.child) return;
    const env = {};
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'XDG_CACHE_HOME', 'MOA_SOURCE_BROWSER_BINARY'])
      if (process.env[key]) env[key] = process.env[key];
    env.INVPW_TRUE_HEADLESS = '1'; env.PYTHONUNBUFFERED = '1';
    const child = this.childFactory(this.python, ['-u', fileURLToPath(new URL('./engine.py', import.meta.url))],
      { env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let buffer = Buffer.alloc(0);
    child.stderr.on('data', () => {});
    const stopThis = () => { this.killGroup(child); if (this.child === child) { this.child = undefined; this.failPending(); } };
    child.stdin.on('error', stopThis);
    child.stdout.on('data', chunk => {
      if (this.child !== child) return;
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const end = buffer.indexOf(10);
        if (end < 0) break;
        if (end > RESPONSE_LIMIT + 1024) { stopThis(); return; }
        let message;
        try { message = JSON.parse(buffer.subarray(0, end).toString('utf8')); }
        catch { stopThis(); return; }
        buffer = buffer.subarray(end + 1);
        const pending = this.pending.get(message.id);
        if (pending) { this.pending.delete(message.id); pending.resolve(message); }
      }
      if (buffer.length > RESPONSE_LIMIT + 1024) stopThis();
    });
    child.on('error', stopThis);
    child.on('exit', () => {
      this.killGroup(child);
      if (this.child === child) { this.child = undefined; this.failPending(); }
    });
  }
  failPending() {
    for (const pending of this.pending.values()) pending.reject(Error('source_browser_unavailable'));
    this.pending.clear();
  }
  stop() {
    const child = this.child; this.child = undefined;
    if (child) this.killGroup(child);
    this.failPending();
  }
  killGroup(child) {
    if (child?.groupKilled) return;
    if (child) child.groupKilled = true;
    if (child?.pid) {
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
      catch { child.kill('SIGKILL'); }
    }
  }
  call(message, signal) {
    signal?.throwIfAborted(); this.start();
    const id = ++this.sequence;
    const child = this.child;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id); reject(signal.reason ?? Error('source_cancelled'));
        // A cancel command closes the context. If the engine cannot acknowledge
        // cleanup promptly, kill it so all browser/context lifetime guards run.
        if (this.child !== child) return;
        const cleanup = this.call({ op: 'cancel', target: id });
        const timer = setTimeout(() => { if (this.child === child) this.stop(); }, 2000); timer.unref();
        cleanup.finally(() => clearTimeout(timer)).catch(() => {});
      };
      const finish = callback => value => { signal?.removeEventListener('abort', abort); callback(value); };
      this.pending.set(id, { resolve: finish(resolve), reject: finish(reject) });
      signal?.addEventListener('abort', abort, { once: true });
      child.stdin.write(JSON.stringify({ ...message, id }) + '\n');
    });
  }
  async closeSession(key) {
    if (!this.child) return;
    const child = this.child;
    const timer = setTimeout(() => { if (this.child === child) this.stop(); }, 2000); timer.unref();
    try { await this.call({ op: 'close', key }); } finally { clearTimeout(timer); }
  }
}
