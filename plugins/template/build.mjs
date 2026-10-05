import { readFile, mkdir, writeFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const directory = new URL('../../data/plugins/', import.meta.url);
await mkdir(directory, { recursive: true });
const output = new URL(`${manifest.id}.moa-plugin.json`, directory);
await writeFile(output, JSON.stringify({ ...manifest, html }, null, 2) + '\n');
console.log(output.pathname);
