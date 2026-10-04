import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function verificationPath(name) {
  const directory = process.env.MOA_VERIFY_DIR || tmpdir();
  mkdirSync(directory, { recursive: true });
  return join(directory, name);
}
