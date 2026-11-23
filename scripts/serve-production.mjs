import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStaticDelivery } from './static-delivery.ts';

export async function createProductionServer({ root=resolve('dist'), buildFingerprint, maxBytes } = {}) {
  let artworkRevision;
  try { artworkRevision=JSON.parse(await readFile(resolve(root,'.sticker-delivery.json'),'utf8')).artworkRevision; } catch {}
  if (!buildFingerprint) { try { buildFingerprint=JSON.parse(await readFile(resolve(root,'.birds-and-trees-build.json'),'utf8')).fingerprint; } catch {} }
  const delivery=createStaticDelivery({root,artworkRevision,buildFingerprint,maxBytes,compress:true});
  const server=createServer((req,res)=>{delivery.handle(req,res).catch(error=>{console.error('Static request failed:',error.message);if(!res.headersSent){res.statusCode=500;res.setHeader('Cache-Control','no-cache');res.end('Static delivery failed');}else res.destroy();});});
  server.on('close',()=>delivery.clear());
  return {server,delivery};
}

export async function serveProduction({ port=5173, root=resolve('dist'), buildFingerprint }={}) {
  await readFile(resolve(root,'index.html'));
  const {server}=await createProductionServer({root,buildFingerprint});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  console.log(`phyloBirds production app: http://127.0.0.1:${port}/`);
  console.log('Processed on this device. Keep this window open; Ctrl+C stops this server.');
  const stop=()=>server.close(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop);
  return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const index=process.argv.indexOf('--port'),port=index<0?5173:Number(process.argv[index+1]);
  if(!Number.isInteger(port)||port<1||port>65535){console.error('Use --port with a port from1 to65535.');process.exitCode=1;}
  else serveProduction({port}).catch(error=>{console.error(error.code==='EADDRINUSE'?`Port${port} is already in use. Close the earlier phyloBirds server window and launch again.`:error.message);process.exitCode=1;});
}
