import { readFile, readdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { serveProduction } from './serve-production.mjs';

const projectRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));
async function filesUnder(directory,skip=new Set()) {
  const found=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    if(skip.has(entry.name)||entry.name.startsWith('.')||entry.name.endsWith('.tmp'))continue;
    const path=resolve(directory,entry.name);
    if(entry.isDirectory())found.push(...await filesUnder(path,skip));else if(entry.isFile())found.push(path);
  }
  return found;
}

/** Hash source plus public metadata; atlas catalogs already pin44,108 image files. */
export async function sourceFingerprint(root=projectRoot) {
  const files=[...['index.html','package.json','package-lock.json','tsconfig.json','vite.config.ts'].map(path=>resolve(root,path)),...await filesUnder(resolve(root,'src')),...await filesUnder(resolve(root,'scripts')),...await filesUnder(resolve(root,'public'),new Set(['stickers','sticker-sheets']))].sort();
  const hash=createHash('sha256');
  for(const file of files){hash.update(relative(root,file).replace(/\\/g,'/'));hash.update('\0');hash.update(await readFile(file));hash.update('\0');}
  return hash.digest('hex');
}
async function runNode(args,cwd) {
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Build command exited with code${code}.`)));});
}
async function existingServer(port) {
  try { const response=await fetch(`http://127.0.0.1:${port}/`,{method:'HEAD',signal:AbortSignal.timeout(1500)});return{kind:response.headers.get('x-birds-and-trees-server'),fingerprint:response.headers.get('x-birds-and-trees-build')}; }
  catch(error){if(error.cause?.code==='ECONNREFUSED')return null;throw new Error(`Port${port} could not be checked. Close the earlier server window before starting another.`);}
}

export async function startLocal({root=projectRoot,port=5173}={}) {
  const fingerprint=await sourceFingerprint(root), active=await existingServer(port);
  if(active){
    if(active.kind==='production'&&active.fingerprint===fingerprint){console.log(`phyloBirds is already running: http://127.0.0.1:${port}/`);return;}
    throw new Error(`Port${port} already has a running server. Close the earlier phyloBirds server window (Ctrl+C), then launch again to use production delivery. No running server was stopped.`);
  }
  const stamp=resolve(root,'dist/.birds-and-trees-build.json');
  let saved;
  try{saved=JSON.parse(await readFile(stamp,'utf8'));await access(resolve(root,'dist/index.html'));}catch{saved=undefined;}
  if(saved?.fingerprint!==fingerprint){
    console.log('Preparing the production app. This first launch, or a source update, can take about a minute.');
    const npmCli=resolve(root,'.tools/npm/package/bin/npm-cli.js');
    try{await access(npmCli);}catch{await runNode([resolve(root,'scripts/bootstrap-npm.mjs')],root);}
    await runNode([npmCli,'run','build'],root);
    await writeFile(stamp,JSON.stringify({version:1,fingerprint})+'\n');
  }else console.log('Using the unchanged production build.');
  await serveProduction({root:resolve(root,'dist'),port,buildFingerprint:fingerprint});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const index=process.argv.indexOf('--port'),port=index<0?5173:Number(process.argv[index+1]);
  if(!Number.isInteger(port)||port<1||port>65535){console.error('Use --port with a port from1 to65535.');process.exitCode=1;}
  else startLocal({port}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
