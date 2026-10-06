// GPL-3.0-or-later.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { EngineBridge } from './bridge.mjs';
import { BrowserService, rpcServer } from './service.mjs';
import { openSourceBrowserProxy } from '../aniyomi-worker/browser/proxy.mjs';

try {
  if (process.env.MOA_SOURCE_BROWSER_GENERATE_SECRET === '1') {
    const file = process.env.MOA_SOURCE_BROWSER_SECRET_FILE;
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    try { await writeFile(file, randomBytes(32).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const secret = (await readFile(process.env.MOA_SOURCE_BROWSER_SECRET_FILE, 'utf8')).trim();
  if (!/^[a-zA-Z0-9_-]{32,256}$/.test(secret)) throw Error('source_secret_invalid');
  const service = new BrowserService({ engine: new EngineBridge(), openProxy: openSourceBrowserProxy });
  const server = rpcServer({ secret, service });
  server.listen(8799, '0.0.0.0');
  let stopping = false;
  for (const name of ['SIGTERM', 'SIGINT']) process.on(name, async () => {
    if (stopping) return; stopping = true;
    const deadline = setTimeout(() => process.exit(1), 4000); deadline.unref();
    server.closeAllConnections(); server.close(); await service.close(); clearTimeout(deadline); process.exit(0);
  });
} catch {
  process.stderr.write('source_browser_startup_failed\n'); process.exitCode = 1;
}
