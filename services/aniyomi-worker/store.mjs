import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { lockStore } from './lock.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const pkgPattern = /^[A-Za-z]\w*(?:\.[A-Za-z]\w*)+$/;
async function atomic(path, value) {
  const temp = path + '.' + randomUUID() + '.tmp';
  try { await writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
export function validMetadata(m) {
  return m && pkgPattern.test(m.pkg) && m.pkg.length <= 256 && typeof m.entry === 'string' && /^[\w$.]+$/.test(m.entry) && m.entry.length <= 512 &&
    Number.isSafeInteger(m.code) && m.code > 0 && /^(?:14|16)\.\d+$/.test(m.version) && Array.isArray(m.signers) && m.signers.length > 0 && m.signers.length <= 16 && m.signers.every(s => hashPattern.test(s));
}
export function validSources(sources) {
  return Array.isArray(sources) && sources.length > 0 && sources.length <= 1000 && new Set(sources.map(s => s.id)).size === sources.length && sources.every(s =>
    typeof s.id === 'string' && /^[1-9]\d{0,18}$/.test(s.id) && BigInt(s.id) <= 9223372036854775807n && typeof s.name === 'string' && s.name.length > 0 && s.name.length <= 512 && typeof s.lang === 'string' && s.lang.length <= 32);
}
/** Single supervisor owns a root. APK/JAR files survive process and container restarts. */
export class InstallationStore {
  constructor(root, tools) { this.root = root; this.tools = tools; this.state = { version: 1, packages: [] }; this.chain = Promise.resolve(); }
  async open() {
    await mkdir(this.root, { recursive: true });
    this.unlock = await lockStore(join(this.root, '.lock'));
    try {
      let bytes;
      try { bytes = await readFile(join(this.root, 'inventory.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (bytes) {
        if (bytes.length > 4 * 1024 * 1024) throw new Error('apk_inventory_invalid');
        const data = JSON.parse(bytes);
        if (data.version !== 1 || !Array.isArray(data.packages) || data.packages.length > 256 || new Set(data.packages.map(p => p.id)).size !== data.packages.length || data.packages.some(p =>
          !hashPattern.test(p.id) || !validMetadata(p.metadata) || !hashPattern.test(p.digest) || !hashPattern.test(p.cacheKey) || !validSources(p.sources) || p.id !== sha(p.repository + '\n' + p.metadata.pkg))) throw new Error('apk_inventory_invalid');
        this.state = data;
      }
      return this;
    } catch (e) { await this.close(); throw e; }
  }
  snapshot() { return structuredClone(this.state); }
  async close() { if (this.unlock) { const unlock = this.unlock; this.unlock = undefined; await unlock(); } }
  record(id) { const p = this.state.packages.find(p => p.id === id); if (!p) throw new Error('apk_not_installed'); return structuredClone(p); }
  statePath(id) { return join(this.root, 'state', id); }
  paths(record) { return { jar: join(this.root, 'converted', record.cacheKey, 'source.jar'), state: this.statePath(record.id) }; }
  install(bytes, repository, advertised, signal = new AbortController().signal) {
    const work = this.chain.then(() => this.prepare(bytes, repository, advertised, signal)); this.chain = work.catch(() => {}); return work;
  }
  async prepare(bytes, repository, advertised, signal) {
    signal.throwIfAborted();
    if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes.length > 32 * 1024 * 1024) throw new Error('apk_size_limit');
    const repo = new URL(repository); if (repo.protocol !== 'https:' || repo.username || repo.password || repo.hash) throw new Error('apk_repository_invalid');
    repository = repo.href;
    const digest = sha(bytes), archives = join(this.root, 'archives'); await mkdir(archives, { recursive: true });
    const archive = join(archives, digest + '.apk');
    try { await writeFile(archive, bytes, { flag: 'wx', mode: 0o600 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (sha(await readFile(archive)) !== digest) throw new Error('apk_archive_integrity');
    const metadata = await this.tools.inspect(archive, signal);
    if (!validMetadata(metadata)) throw new Error('apk_metadata_invalid');
    if (advertised && ['pkg', 'version', 'code'].some(k => metadata[k] !== advertised[k])) throw new Error('apk_index_mismatch');
    const id = sha(repository + '\n' + metadata.pkg), previous = this.state.packages.find(p => p.id === id);
    if (!previous && this.state.packages.length >= 256) throw new Error('apk_install_limit');
    if (previous) {
      if ([...new Set(metadata.signers)].sort().join(':') !== [...new Set(previous.metadata.signers)].sort().join(':')) throw new Error('apk_publisher_changed');
      if (metadata.code < previous.metadata.code) throw new Error('apk_version_not_newer');
    }
    const cacheKey = sha(digest + '\n' + this.tools.fingerprint), directory = join(this.root, 'converted', cacheKey);
    await mkdir(directory, { recursive: true });
    const jar = join(directory, 'source.jar'), receiptPath = join(directory, 'receipt.json');
    let receipt;
    try { receipt = JSON.parse(await readFile(receiptPath)); } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
    const hit = receipt?.digest === digest && receipt?.fingerprint === this.tools.fingerprint && validSources(receipt?.sources) &&
      receipt?.jarHash === await readFile(jar).then(sha, e => { if (e.code === 'ENOENT') return null; throw e; });
    const stateDirectory = join(this.root, 'state', id); await mkdir(stateDirectory, { recursive: true });
    if (!hit) {
      await this.tools.convert(archive, jar, signal);
      const sources = await this.tools.describe(jar, metadata, stateDirectory, signal);
      if (!validSources(sources)) throw new Error('apk_sources_invalid');
      receipt = { digest, fingerprint: this.tools.fingerprint, jarHash: sha(await readFile(jar)), sources };
      await atomic(receiptPath, receipt);
    }
    const required = advertised?.requiredSource;
    if (required && (!validSources([required]) || !receipt.sources.some(s => s.id === required.id) && receipt.sources.filter(s => s.name === required.name && s.lang === required.lang).length !== 1)) throw new Error('apk_source_missing');
    signal.throwIfAborted();
    const record = { id, repository, metadata, digest, cacheKey, sources: receipt.sources,
      ...(previous && previous.cacheKey !== cacheKey ? { previous: { ...previous, previous: undefined } } : previous?.previous ? { previous: previous.previous } : {}) };
    const next = { version: 1, packages: [...this.state.packages.filter(p => p.id !== id), record] };
    await atomic(join(this.root, 'inventory.json'), next); this.state = next;
    return { ...structuredClone(record), cacheHit: !!hit };
  }
  remove(id) {
    if (typeof id !== 'string' || !hashPattern.test(id)) return Promise.reject(new Error('apk_request_invalid'));
    const work = this.chain.then(async () => {
      const existed = this.state.packages.some(p => p.id === id);
      const next = { version: 1, packages: this.state.packages.filter(p => p.id !== id) };
      // Clear state before forgetting publisher identity; a failed cleanup must not let a
      // later, unrelated publisher inherit preferences from an uninstalled package.
      await rm(this.statePath(id), { recursive: true, force: true });
      await atomic(join(this.root, 'inventory.json'), next); this.state = next;
      // Content-addressed archives/conversions may be shared and remain available for cache reuse/GC.
      return { removed: existed };
    });
    this.chain = work.catch(() => {}); return work;
  }
  async verify(record) {
    try {
    const { jar } = this.paths(record);
    const receipt = JSON.parse(await readFile(join(this.root, 'converted', record.cacheKey, 'receipt.json')));
    if (receipt.fingerprint !== this.tools.fingerprint) throw new Error('apk_reprepare_required');
    if (receipt.digest !== record.digest || receipt.jarHash !== sha(await readFile(jar))) throw new Error('apk_cache_integrity');
    } catch(error) { throw new Error(error.message === 'apk_reprepare_required' ? 'apk_reprepare_required' : 'apk_cache_integrity'); }
  }
}
