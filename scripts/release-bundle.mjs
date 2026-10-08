import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fail } from './release.mjs';
export const BUNDLE_FILES = [
  'scripts/update.mjs', 'scripts/release.mjs', 'scripts/release-updater.mjs',
  'scripts/release-bundle.mjs', 'scripts/update-files.mjs', 'scripts/install-release.mjs', 'scripts/update-launcher.mjs',
  'compose.yaml', 'compose.updates.yaml', 'compose.source-browser.yaml', 'compose.vaapi.yaml',
  'deploy/gateway/default.conf.template', '.env.example', 'LICENSE', 'NOTICE', 'docs/UPDATES.md', 'trusted-key.pem'
];
export async function stageBundle(bundle, directory) {
  if (bundle?.format !== 1 || Object.keys(bundle.files ?? {}).sort().join() !== [...BUNDLE_FILES].sort().join()) fail('update-bundle-invalid');
  for (const name of BUNDLE_FILES) {
    const content = bundle.files[name];
    if (typeof content !== 'string' || Buffer.byteLength(content) > 512 * 1024) fail('update-bundle-invalid');
    const file = path.join(directory, name);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    try { await writeFile(file, content, { mode: 0o600, flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST' || await readFile(file, 'utf8') !== content) fail('update-release-mutated'); }
  }
}
