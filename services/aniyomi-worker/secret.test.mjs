import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSecret } from './secret.mjs';

test('auto token is persistent, private, and atomically initialized by concurrent starts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moa-apk-secret-')), file = join(dir, 'token');
  try {
    const tokens = await Promise.all(Array.from({ length: 8 }, () => loadSecret(file, true)));
    assert.equal(new Set(tokens).size, 1); assert.match(tokens[0], /^[a-f0-9]{64}$/);
    assert.equal((await stat(file)).mode & 0o777, 0o640);
    assert.equal(await loadSecret(file, true), tokens[0]); assert.equal(await loadSecret(file, false), tokens[0]);
    assert.deepEqual(await readdir(dir), ['token']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('legacy credentials are preserved, missing or empty explicit credentials fail closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moa-apk-secret-')), file = join(dir, 'token');
  try {
    await assert.rejects(loadSecret(file), /apk-secret-unreadable/);
    await writeFile(file, 'existing-test-token\n', { mode: 0o600 });
    assert.equal(await loadSecret(file), 'existing-test-token');
    assert.equal(await loadSecret(file, true), 'existing-test-token');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(await readFile(file, 'utf8'), 'existing-test-token\n');
    await writeFile(file, ''); await assert.rejects(loadSecret(file, true), /apk-secret-unreadable/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
