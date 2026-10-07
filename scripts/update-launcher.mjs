// Fixed supervisor. Versioned updater code is replaced only through signed releases.
import { spawn } from 'node:child_process';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--cwd') throw new Error('usage: node update-launcher.mjs --cwd /absolute/install');
const cwd = path.resolve(args[1]), root = path.join(cwd, '.moa-release');
const validRuntime = value => typeof value === 'string' && path.resolve(value).startsWith(`${root}/releases/`) && path.resolve(value) === value;
let stopping = false, child;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child?.kill(signal); });
while (!stopping) {
  const currentFile = path.join(root, 'current.json');
  const current = JSON.parse(await readFile(currentFile, 'utf8'));
  if (!validRuntime(current.runtime)) throw new Error('update-runtime-invalid');
  const started = Date.now();
  child = spawn(process.execPath, [path.join(current.runtime, 'scripts/update.mjs'), 'serve', '--mode', 'release', '--cwd', cwd, '--dir', path.join(cwd, 'data/updater')], { cwd, stdio: 'inherit' });
  const code = await new Promise(resolve => { child.once('error', () => resolve(1)); child.once('exit', value => resolve(value)); });
  if (stopping) break;
  if (code === 75) continue;
  // If a new runtime cannot start, restore only the updater pointer. User data and
  // the successfully deployed app version are untouched.
  if (code !== 0 && Date.now() - started < 30000 && current.previousRuntime && current.previousRuntime !== current.runtime && validRuntime(current.previousRuntime)) {
    const updated = JSON.parse(await readFile(currentFile, 'utf8'));
    if (updated.runtime === current.runtime) {
      updated.runtime = current.previousRuntime; delete updated.previousRuntime;
      const temp = `${currentFile}.launcher.tmp`;
      await writeFile(temp, JSON.stringify(updated), { mode: 0o600 }); await rename(temp, currentFile);
      continue;
    }
  }
  process.exitCode = code || 1; break;
}
