import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { createStaticDelivery } from './static-delivery.ts';

/** Fast artwork serving in development; production receives the same revision. */
export function stickerDeliveryPlugin(): Plugin {
  let root = '', outDir = '', currentRevision: string | undefined;
  const readRevision = async () => {
    try { const config=JSON.parse(await readFile(resolve(root,'src/generated/sticker-delivery.json'),'utf8'));currentRevision=typeof config.artworkRevision === 'string' ? config.artworkRevision : undefined; }
    catch { currentRevision=undefined; }
  };
  return {
    name:'birds-and-trees-sticker-delivery',
    configResolved(config) { root=config.root;outDir=resolve(root,config.build.outDir); },
    async configureServer(server) {
      await readRevision();
      const delivery=createStaticDelivery({root:resolve(root,'public'),artworkOnly:true,artworkRevision:()=>currentRevision,maxBytes:32*1024*1024,compress:true});
      server.middlewares.use((req,res,next) => { delivery.handle(req,res).then(handled=>{if(!handled)next();}).catch(next); });
      server.watcher.on('change',async file=>{if(file.replace(/\\/g,'/').endsWith('/src/generated/sticker-delivery.json')){delivery.clear();await readRevision();}});
      server.httpServer?.once('close',()=>delivery.clear());
    },
    async closeBundle() {
      try {
        const config=await readFile(resolve(root,'src/generated/sticker-delivery.json'));
        await mkdir(outDir,{recursive:true});await writeFile(resolve(outDir,'.sticker-delivery.json'),config);
      } catch (error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
    },
  };
}
