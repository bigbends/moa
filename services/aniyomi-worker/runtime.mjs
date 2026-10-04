import { randomUUID } from 'node:crypto';
import { InstallationStore } from './store.mjs';
import { PlaybackLeases } from './leases.mjs';

export class Runtime {
  constructor(root, tools, { limit = 2, browseReserve = 1 } = {}) {
    this.tools = tools; this.limit = limit; this.browseReserve = browseReserve; this.capacity = limit + browseReserve; this.workers = new Map(); this.pending = []; this.active = new Set(); this.closed = false; this.shutdown = new AbortController(); this.running = new Set();
    this.leases = new PlaybackLeases(entry => {
      // A frozen playback process cannot be reused by another extraction.
      if (entry?.workerKey && this.workers.get(entry.workerKey) === entry.worker) {
        entry.worker.close(); this.workers.delete(entry.workerKey);
      }
      this.pump();
    }, { limit });
    this.store = new InstallationStore(root, { ...tools,
      describe: async (jar, metadata, directory, signal) => {
        const worker = tools.worker(jar, metadata, directory);
        try { return await worker.request('describe', {}, signal); } finally { await (worker.dispose?.() ?? worker.close()); }
      } });
  }
  async open() { await this.store.open(); return this; }
  // All operations are serial per installation; a conversion uses the same slot as a running APK.
  schedule(key, priority, task, signal = new AbortController().signal) {
    signal = AbortSignal.any([signal, this.shutdown.signal]);
    if (this.closed) return Promise.reject(new Error('apk_runtime_closed'));
    if (signal.aborted) return Promise.reject(new Error('cancelled'));
    if (this.pending.length >= 24 || this.pending.filter(t => t.key === key).length >= 8) return Promise.reject(new Error('apk_worker_busy'));
    return new Promise((resolve, reject) => {
      const job = { key, priority, task, signal, resolve, reject };
      job.abort = () => { const index = this.pending.indexOf(job); if (index >= 0) { this.pending.splice(index, 1); reject(new Error('cancelled')); signal.removeEventListener('abort', job.abort); } };
      signal.addEventListener('abort', job.abort, { once: true });
      this.pending.push(job); this.pending.sort((a, b) => a.priority - b.priority); this.pump();
    });
  }
  workerBudget() { return Math.max(this.limit, this.leases.workerKeys().length + this.browseReserve); }
  pump() {
    if(this.pumping) return;
    this.pumping = true;
    try {
    this.leases.sweep();
    if (this.closed || this.active.has('@install')) return;
    while (this.active.size < this.limit) {
      const index = this.pending.findIndex(job => {
        if (this.active.has(job.key)) return false;
        if (job.key === '@install') return this.active.size === 0 && this.leases.size === 0;
        const protectedKeys = new Set([...this.active, ...this.leases.workerKeys()]);
        return protectedKeys.has(job.key) || protectedKeys.size < this.workerBudget();
      }); if (index < 0) return;
      const job = this.pending.splice(index, 1)[0]; job.signal.removeEventListener('abort', job.abort);
      this.active.add(job.key);
      const stopping = job.key === '@install' ? [...this.workers.values()].map(worker => worker.dispose?.() ?? worker.close()) : [];
      if (job.key === '@install') this.workers.clear();
      // Evict only idle workers. Includes installation/conversion jobs in the total budget.
      for (const [key, worker] of this.workers) {
        if (this.workers.size + [...this.active].filter(k => !this.workers.has(k)).length <= this.workerBudget()) break;
        if (!this.active.has(key) && !this.leases.hasWorker(key)) { worker.close(); this.workers.delete(key); }
      }
      const running = Promise.resolve().then(async () => { await Promise.all(stopping); job.signal.throwIfAborted(); return job.task(job.signal); }).then(job.resolve, job.reject).finally(() => { this.active.delete(job.key); this.running.delete(running); this.pump(); });
      this.running.add(running);
      if (job.key === '@install') return;
    }
    } finally { this.pumping = false; }
  }
  install(bytes, repository, advertised, signal = AbortSignal.timeout(120_000)) {
    // This lane serializes installations. No invocation may swap a running package under its caller.
    if (this.leases.size) return Promise.reject(new Error('apk_playback_active'));
    return this.schedule('@install', 2, async (activeSignal) => {
      await this.tools.drainState?.();
      return this.store.install(bytes, repository, advertised, activeSignal);
    }, signal);
  }
  remove(id, signal = AbortSignal.timeout(120_000)) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return Promise.reject(new Error('apk_request_invalid'));
    return this.schedule(id, 0, async () => {
      const workers = [...this.workers].filter(([key]) => key === id || key.startsWith(id + ':playback:'));
      // Only this installation's sessions are revoked; other packages remain playable.
      for (const [lease, entry] of this.leases.entries) if (entry.installation === id) this.leases.release(lease);
      for (const [key, worker] of workers) { await (worker.dispose?.() ?? worker.close()); this.workers.delete(key); }
      // Also wait for browser-state saves from previously evicted JVMs of this package.
      await this.tools.drainState?.(this.store.statePath(id));
      return this.store.remove(id);
    }, signal);
  }
  invoke(id, method, params = {}, signal = AbortSignal.timeout(method === 'list' ? 15_000 : 30_000), retain = false) {
    return this.schedule(id, method === 'videos' ? 0 : 1, async (activeSignal) => {
      const record = this.store.record(id); await this.store.verify(record);
      let worker = this.workers.get(id);
      if (worker && worker.cacheKey !== record.cacheKey) { worker.close(); this.workers.delete(id); worker = undefined; }
      if (!worker) {
        const paths = this.store.paths(record); worker = this.tools.worker(paths.jar, record.metadata, paths.state); worker.cacheKey = record.cacheKey; this.workers.set(id, worker);
      }
      const result = await worker.request(method, params, activeSignal);
      if(method !== 'videos' || !retain) return result;
      let playback;
      try { playback = await this.leases.create(id, worker, result); }
      catch(error) {
        if(error.message === 'apk_playback_capacity') { worker.close(); this.workers.delete(id); }
        throw error;
      }
      if(activeSignal.aborted) { this.leases.release(playback.lease); activeSignal.throwIfAborted(); }
      if (playback.lease) {
        // Android extensions may clear their previous HLS session on every extraction.
        // Freeze this JVM for its playback lease; later calls use another bounded slot.
        const workerKey = id + ':playback:' + randomUUID();
        this.leases.get(playback.lease).workerKey = workerKey;
        this.workers.delete(id); this.workers.set(workerKey, worker);
      }
      return playback;
    }, signal);
  }
  status() { return { ...(this.tools.browserStatus ? {browser:this.tools.browserStatus()} : {}), playbackLimit: this.limit, workerLimit: this.capacity, active: this.active.size, queued: this.pending.length, leases: this.leases.size, workers: [...this.workers.values()].filter(w => w.pid).length, pids: [...this.workers.values()].flatMap(w => w.pid ? [w.pid] : []) }; }
  async close() {
    this.closed = true; this.shutdown.abort(); this.leases.close();
    for (const job of this.pending.splice(0)) { job.signal.removeEventListener('abort', job.abort); job.reject(new Error('apk_runtime_closed')); }
    for (const worker of this.workers.values()) worker.close(); this.workers.clear();
    await Promise.allSettled([...this.running]);
    await this.store.chain.catch(() => {}); await this.store.close(); await this.tools.close?.();
  }
}
