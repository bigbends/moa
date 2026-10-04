import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { lockStore } from './lock.mjs';

test('kernel store lock is released after the supervisor is killed', async t => {
 const root=await mkdtemp(join(tmpdir(),'moa-apk-lock-')),path=join(root,'.lock');
 t.after(()=>rm(root,{recursive:true,force:true}));
 const child=spawn(process.execPath,['--input-type=module','-e',`import {lockStore} from ${JSON.stringify(new URL('./lock.mjs',import.meta.url).href)};await lockStore(process.argv[1]);console.log('ready');`,path],{stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill('SIGKILL'));
 await once(child.stdout,'data');
 await assert.rejects(lockStore(path),/store_in_use/);
 const exit=once(child,'exit');child.kill('SIGKILL');await exit;
 let unlock;
 for(let i=0;i<20;i++){try{unlock=await lockStore(path);break;}catch(e){if(i===19)throw e;await new Promise(r=>setTimeout(r,10));}}
 await unlock();
});
