import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export class ApiFailure extends Error {
  constructor(public statusCode: number, public error: string, message?: string) { super(message || error); }
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);
export const now = () => new Date().toISOString();
export const normalize = (s: string) => s.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s_]+/gu, '');
export function contained(root: string, candidate: string) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
/** Check both lexical containment and real paths: symlinks may never leave the root. */
export async function safePath(root: string, input: string, directory = false): Promise<string> {
  const candidate = path.resolve(root, input);
  if (!contained(path.resolve(root), candidate)) throw new ApiFailure(400, 'path-outside-media-root');
  let actualRoot: string, actual: string;
  try { [actualRoot, actual] = await Promise.all([realpath(root), realpath(candidate)]); }
  catch { throw new ApiFailure(404, 'path-not-found'); }
  if (!contained(actualRoot, actual)) throw new ApiFailure(400, 'path-outside-media-root');
  if (directory && !(await stat(actual)).isDirectory()) throw new ApiFailure(400, 'not-a-directory');
  return actual;
}
export async function command(exe: string, args: string[], timeout = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${exe}: timeout`)); }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 64 * 1024 * 1024) child.kill('SIGKILL'); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16_384); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`${exe} exited ${code}: ${stderr}`)); });
  });
}
