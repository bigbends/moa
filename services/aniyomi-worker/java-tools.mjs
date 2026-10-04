import {createBrowserBridge} from './browser/bridge.mjs';
import { spawn } from 'node:child_process';
import { readdir, readFile, rename, rm } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ApkWorkerSupervisor } from './supervisor.mjs';

export async function createJavaTools(build, { java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/java') : 'java', debug = false, idleMs = 600_000, browserHost } = {}) {
  const dependencies = (await readdir(join(build, 'dependencies'))).filter(n => n.endsWith('.jar')).sort();
  const main = join(build, 'target/apk-worker-0.1.0.jar');
  const fingerprint = createHash('sha256').update('dex2jar-compute-frames-v1\n').update(await readFile(main)).update(await readFile(join(build, 'build-inventory.json'))).digest('hex');
  const paths = names => [main, ...names.map(n => join(build, 'dependencies', n))].join(delimiter);
  const toolsPath = paths(dependencies);
  const runtimePath = paths(dependencies.filter(n => !/^(dex-|d2j-|asm-|antlr|apk-parser-|apksig-)/.test(n)));
  const env = { LANG: 'C.UTF-8', HOME: '/tmp' };
  const browser = await createBrowserBridge(browserHost);
  const stateWriters = new Map();
  async function tool(args, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = spawn(java, ['-Xms32m', '-Xmx256m', '-cp', toolsPath, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let size = 0, failure, diagnostic = ''; const parts = [];
      const fail = code => { failure = code; child.kill('SIGKILL'); };
      const abort = () => fail('cancelled');
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => fail('apk_tool_timeout'), 60_000);
      child.stdout.on('data', data => { size += data.length; if (size > 1024 * 1024) fail('apk_tool_output_limit'); else parts.push(data); });
      child.stderr.on('data', data => {
        if (diagnostic.length < 4096) diagnostic += data.toString('utf8').slice(0,4096-diagnostic.length);
        if (debug) process.stderr.write(data);
      });
      child.on('error', () => { failure = 'apk_java_unavailable'; });
      child.on('close', code => {
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        if (failure || code !== 0) reject(new Error(failure || diagnostic.match(/\b(apk_(?:signature_invalid|size_limit|expansion_limit|native_unsupported|api_unsupported|anime_api_required|manifest_invalid|entry_invalid|version_invalid))\b/)?.[1] || 'apk_tool_failed'));
        else resolve(Buffer.concat(parts).toString('utf8'));
      });
    });
  }
  return {
    fingerprint,
    drainState: async directory => { await Promise.all([...stateWriters].filter(([key]) => directory === undefined || key === directory).flatMap(([,writers]) => [...writers])); },
    close: () => browser.close(),
    browserStatus: () => browser.host.status(),
    inspect: async (archive, signal) => JSON.parse(await tool(['org.moa.apk.Inspect', archive], signal)),
    convert: async (archive, target, signal) => {
      const temporary = target + '.' + randomUUID() + '.tmp';
      try { await tool(['com.googlecode.dex2jar.tools.Dex2jarCmd', archive, '-o', temporary, '-f', '-dsn', '-cf'], signal); await tool(['org.moa.apk.CopyAssets', archive, temporary], signal); await tool(['org.moa.apk.UrlHeaderCalls', temporary], signal); signal.throwIfAborted(); await rename(temporary, target); }
      finally { await rm(temporary, { force: true }); }
    },
    worker: (archive, metadata, directory) => {
      const workerEnv={...env};
      const worker=new ApkWorkerSupervisor(java,
        ['-Xms32m', '-Xmx192m', '-cp', [runtimePath, archive].join(delimiter), 'org.moa.apk.Main', metadata.entry, directory, metadata.pkg],
        {env:workerEnv,timeoutMs:30_000,queueLimit:8,idleMs});
      const disposing = new Set();
      const launch=worker.launch;
      worker.launch=()=>{
        const scope=browser.register(directory);
        workerEnv.MOA_WEBVIEW_URL=scope.url;workerEnv.MOA_WEBVIEW_TOKEN=scope.token;
        const child=launch();
        const done = new Promise(resolve => child.once('close', resolve)).then(() => browser.release(scope.token));
        disposing.add(done);
        const writers = stateWriters.get(directory) || new Set(); stateWriters.set(directory, writers); writers.add(done);
        void done.finally(() => { disposing.delete(done); writers.delete(done); if (!writers.size) stateWriters.delete(directory); }).catch(() => {});
        return child;
      };
      worker.dispose = async () => { worker.close(); await Promise.all([...disposing]); };
      return worker;
    },
  };
}
