import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = path.resolve(root, process.argv[2] || '.');
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
const entry = existsSync(path.join(source, 'plugin.js')) ? 'plugin.js' : 'index.html';
const files = ['manifest.json', entry];
const local = [], central = [];
let offset = 0;
for (const filename of files) {
  const name = Buffer.from(filename), content = await readFile(path.join(source, filename));
  const header = Buffer.alloc(30), record = Buffer.alloc(46);
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(crc32(content), 14); header.writeUInt32LE(content.length, 18); header.writeUInt32LE(content.length, 22); header.writeUInt16LE(name.length, 26);
  record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); header.copy(record, 6, 4, 30); record.writeUInt32LE(offset, 42);
  local.push(header, name, content); central.push(record, name);
  offset += header.length + name.length + content.length;
}
const directoryData = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directoryData.length, 12); end.writeUInt32LE(offset, 16);
const directory = path.join(root, 'dist');
await mkdir(directory, { recursive: true });
const output = path.join(directory, `${manifest.id}.zip`);
await writeFile(output, Buffer.concat([...local, directoryData, end]));
console.log(output);
