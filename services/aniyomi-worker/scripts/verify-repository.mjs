import { tmpdir } from 'node:os';
/** Isolated fixture probe. No downloads and no production DB; source calls are opt-in. */
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Runtime } from '../runtime.mjs';
import { createJavaTools } from '../java-tools.mjs';
import { parseRepository } from '../repository.mjs';

const repository=process.argv[2];
if(!repository || !process.argv[3])throw new Error('Usage: verify-repository.mjs <repository URL> <fixtures directory>');
const fixtures=process.argv[3],root=process.env.MOA_APK_DATA || await mkdtemp(join(tmpdir(),'extension-verification-'));
const rows=parseRepository(await readFile(join(fixtures,'index.json')),repository);
const selected=new Set((process.env.MOA_APK_PACKAGES || '').split(',').filter(Boolean));
const runtime=await new Runtime(root,await createJavaTools(resolve('build'))).open();
const reports=[],candidates=[];
const timed=async fn=>{const start=performance.now();try{return {result:await fn(),ms:Math.round(performance.now()-start)}}catch(e){return {error:/^apk_[a-z_]+$/.test(e.message)?e.message:'request-failed',ms:Math.round(performance.now()-start)}}};
try {
 for(const entry of rows.filter(r=>r.supportedVersion && (!selected.size || selected.has(r.pkg)))) {
  const r={package:entry.pkg,version:entry.version};reports.push(r);
  const installed=await timed(async()=>runtime.install(await readFile(join(fixtures,entry.apk)),repository,entry));
  Object.assign(r,{installMs:installed.ms,installError:installed.error});
  if(!installed.result){console.log(JSON.stringify(r));continue;}
  const record=installed.result;r.cacheHit=record.cacheHit;r.sources=record.sources.length;
  const source=record.sources.find(s=>s.lang==='en'||s.lang==='ko') || record.sources[0];
  const invoke=(method,params={})=>runtime.invoke(record.id,method,{sourceId:source.id,...params});
  for(const method of ['filters','preferences']) {
   const out=await timed(()=>invoke(method));r[method+'Error']=out.error;r[method+'Count']=Array.isArray(out.result)?out.result.length:out.result?.fields?.length;
  }
  if(process.env.MOA_APK_PROBE_NETWORK==='1') {
   const list=await timed(()=>invoke('list',{mode:'popular',page:1}));Object.assign(r,{listMs:list.ms,listError:list.error,items:list.result?.items?.length});
   const item=list.result?.items?.[0];
   if(item) {
    const params={workUrl:item.url,title:item.title};const detail=await timed(()=>invoke('detail',params));r.detailError=detail.error;
    const episodes=await timed(()=>invoke('episodes',params));r.episodesError=episodes.error;r.episodes=episodes.result?.length;
    const episode=episodes.result?.[0];
    if(episode) {
     const videos=await timed(()=>invoke('videos',{episodeUrl:episode.url,title:episode.title}));Object.assign(r,{videoMs:videos.ms,videoError:videos.error,videos:videos.result?.length});
     if(videos.result)candidates.push({source:source.name,items:videos.result});
    }
   }
  }
  console.log(JSON.stringify(r));
 }
} finally {
 await runtime.close();const output=join(root,'verification');await mkdir(output,{recursive:true});
 await writeFile(join(output,'repository-report.json'),JSON.stringify(reports,null,2),{mode:0o600});
 // Private: includes expiring stream URLs/headers. Never log or commit this file.
 await writeFile(join(output,'repository-candidates.json'),JSON.stringify(candidates),{mode:0o600});
}
