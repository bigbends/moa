import { spawn } from 'node:child_process';

/** Kernel lock: released even when Node/container crashes. Keep the lock inode on disk. */
export function lockStore(path) {
  return new Promise((resolve, reject) => {
    const child = spawn('flock', ['--nonblock', path, 'cat'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let ready = false, settled = false;
    let closed;
    const exit = new Promise(r => { closed = r; });
    const fail = code => { if (settled) return; settled = true; clearTimeout(timer); child.kill('SIGKILL'); reject(new Error(code)); };
    const timer = setTimeout(() => fail('apk_lock_unavailable'), 3000);
    child.once('error', () => fail('apk_lock_unavailable'));
    child.stdin.on('error', () => fail('apk_store_in_use'));
    child.once('exit', code => { closed(); if (!ready) fail(code === 1 ? 'apk_store_in_use' : 'apk_lock_unavailable'); });
    child.stdout.once('data', () => {
      if (settled) return;
      ready = settled = true; clearTimeout(timer);
      resolve(async () => { child.stdin.end(); await exit; });
    });
    child.stdin.write('locked\n');
  });
}
