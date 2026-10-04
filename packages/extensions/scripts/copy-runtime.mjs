import { cp, copyFile } from 'node:fs/promises';
await cp(new URL('../src/vendor/',import.meta.url),new URL('../dist/vendor/',import.meta.url),{recursive:true});
await copyFile(new URL('../src/filters.mjs',import.meta.url),new URL('../dist/filters.mjs',import.meta.url));
