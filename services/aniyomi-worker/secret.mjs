import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, chmod, link, rm } from 'node:fs/promises';

/** Publish a complete token atomically, without replacing an existing credential. */
export async function loadSecret(file, generate = false) {
  try {
    const value = (await readFile(file, 'utf8')).trim();
    if (!value) throw new Error('apk-secret-empty');
    return value;
  } catch (error) {
    if (error.code !== 'ENOENT' || !generate) throw new Error('apk-secret-unreadable');
  }
  // The shared directory is owned by worker UID 10001, group 1000, mode 2750.
  // setgid makes the token readable by the app's GID 1000, never by other users.
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o640 });
    await chmod(temporary, 0o640);
    try { await link(temporary, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { await rm(temporary, { force: true }); }
  return loadSecret(file);
}
