/** Offline upgrade of retained APKs. Stop the supervisor and snapshot its volume first. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Runtime } from '../runtime.mjs';
import { createJavaTools } from '../java-tools.mjs';

const root=process.env.MOA_APK_DATA;
if(!root)throw new Error('Set MOA_APK_DATA to the offline volume to reprepare');
const runtime=await new Runtime(root,await createJavaTools(process.env.MOA_APK_BUILD || '/app/build')).open();
try {
  for(const record of runtime.store.snapshot().packages) {
    // No repository request or version change: revalidate the exact retained signed APK.
    const bytes=await readFile(join(root,'archives',record.digest+'.apk'));
    const prepared=await runtime.install(bytes,record.repository,record.metadata);
    await runtime.store.verify(prepared);
    console.log(JSON.stringify({pkg:prepared.metadata.pkg,version:prepared.metadata.version,cacheHit:prepared.cacheHit}));
  }
} finally { await runtime.close(); }
