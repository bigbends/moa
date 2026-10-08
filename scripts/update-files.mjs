import { open, rename, rm, mkdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export async function atomic(file, value, mode = 0o600) {
  const temp = `${file}-${randomUUID()}.tmp`;
  const handle = await open(temp, 'wx', mode);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  try {
    await rename(temp, file);
    const directory = await open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await rm(temp, { force: true }); }
}
export async function readJson(file, limit = 2 * 1024 * 1024) {
  const info = await lstat(file);
  if (!info.isFile() || info.size > limit) throw new Error('update-state-invalid');
  return JSON.parse(await readFile(file, 'utf8'));
}
export async function optionalJson(file, fallback) {
  try { return await readJson(file); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export async function privateDirectory(dir) { await mkdir(dir, { recursive: true, mode: 0o700 }); }
// Resolved Compose configurations must not undergo a second $ interpolation.
export function composeJSON(value) {
  if (typeof value === 'string') return value.replaceAll('$', () => '$$');
  if (Array.isArray(value)) return value.map(composeJSON);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, composeJSON(v)]));
  return value;
}
