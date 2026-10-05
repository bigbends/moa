import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = path.resolve(root, process.argv[2] || '.');
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
const kind = existsSync(path.join(source, 'plugin.js')) ? 'script' : 'html';
const content = await readFile(path.join(source, kind === 'script' ? 'plugin.js' : 'index.html'), 'utf8');
const directory = path.join(root, 'dist');
await mkdir(directory, { recursive: true });
const output = path.join(directory, `${manifest.id}.moa-plugin.json`);
await writeFile(output, JSON.stringify({ ...manifest, [kind]: content }, null, 2) + '\n');
console.log(output);
