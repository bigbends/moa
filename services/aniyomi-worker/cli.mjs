import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createJavaTools } from './java-tools.mjs';
import { Runtime } from './runtime.mjs';

// Local administrative JSONL interface for feasibility verification. Not an Internet-facing API.
const runtime = await new Runtime(process.env.MOA_APK_DATA || './data/apk', await createJavaTools(resolve('build'))).open();
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await runtime.close(); }
process.on('SIGTERM', () => stop().finally(() => process.exit()));
process.on('SIGINT', () => stop().finally(() => process.exit()));
try {
  for await (const line of createInterface({ input: process.stdin })) {
    let id = null;
    const start = performance.now();
    try {
      if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('apk_request_limit');
      const input = JSON.parse(line); id = input.id ?? null;
      const result = input.method === 'install' ? await runtime.install(await readFile(input.file), input.repository, input.advertised)
        : input.method === 'packages' ? runtime.store.snapshot()
        : input.method === 'status' ? runtime.status()
        : await runtime.invoke(input.packageId, input.method, input.params);
      process.stdout.write(JSON.stringify({ id, result, elapsedMs: Math.round(performance.now() - start) }) + '\n');
    } catch (e) { process.stdout.write(JSON.stringify({ id, error: /^apk_|^cancelled$/.test(e.message) ? e.message : 'apk_request_failed', elapsedMs: Math.round(performance.now() - start) }) + '\n'); }
  }
} finally { await stop(); }
