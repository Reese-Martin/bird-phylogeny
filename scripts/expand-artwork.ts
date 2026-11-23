/** Expand the locally served artwork for the whole public taxonomy.
 * No personal collection is read or used to select assets. Source files remain
 * pinned; every image is checked against the Git blob at that exact revision. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const lockPath = 'data/sources.lock.json';
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const raw = 'https://raw.githubusercontent.com/';
const indexPath = 'data/raw/everybird-stickers-index.json';
const indexUrl = `https://api.github.com/repos/yusuftaleb/everybird-stickers/git/trees/${lock.revisions.stickers}?recursive=1`;
let indexBytes: Uint8Array;
try { indexBytes = await readFile(indexPath); } catch {
  const response = await fetch(indexUrl); assert.ok(response.ok, `Source index HTTP ${response.status}`);
  indexBytes = new Uint8Array(await response.arrayBuffer()); await writeFile(indexPath, indexBytes);
}
const index = JSON.parse(Buffer.from(indexBytes).toString('utf8'));
assert.equal(index.sha, lock.revisions.stickers, 'Source index revision mismatch');
assert.equal(index.truncated, false, 'Source index must be complete');
const paths = new Map<string, { sha: string; size: number }>(index.tree.map((x: any) => [x.path, x]));
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const gitSha = (b: Uint8Array) => createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const retrievedAt = new Date().toISOString();
const source = { id: 'sticker-file-index', path: indexPath, url: indexUrl, revision: lock.revisions.stickers,
  sha256: sha256(indexBytes), bytes: indexBytes.length, retrievedAt, license: 'CC BY 4.0 artwork metadata' };
const existingIndex = lock.sources.findIndex((s: any) => s.id === source.id);
if (existingIndex >= 0) lock.sources[existingIndex] = source; else lock.sources.push(source);
const species = JSON.parse(await readFile('data/raw/everybird-species.json', 'utf8')).species;
const huashu = JSON.parse(await readFile('data/raw/huashu-species.json', 'utf8')).species;
const huashuByCode = new Map<string, any>(huashu.filter((h: any) => h.ids?.ebird).map((h: any) => [h.ids.ebird, h]));
const excluded: any[] = [];
const candidates: any[] = [];
for (const s of species) {
  const art = huashuByCode.get(s.code);
  if (!s.st || s.q === false || art?.sticker?.meetsQualityBar === false) {
    excluded.push({ code: s.code, reason: s.q === false || art?.sticker?.meetsQualityBar === false ? 'source-quality-fallback' : 'source-image-unavailable' });
    continue;
  }
  const desiredFile = s.code + (s.sv ? `.${s.sv}` : '') + '.webp';
  const file = paths.has(`v1/384/${desiredFile}`) ? desiredFile : `${s.code}.webp`;
  if (!paths.has(`v1/128/${file}`) || !paths.has(`v1/384/${file}`)) {
    excluded.push({ code: s.code, reason: 'not-published-at-pinned-revision' }); continue;
  }
  candidates.push({ s, file, desiredFile });
}
await mkdir('public/stickers/128', { recursive: true });
await mkdir('public/stickers/384', { recursive: true });
const totalBytes = candidates.reduce((sum, c) => sum + paths.get(`v1/128/${c.file}`)!.size + paths.get(`v1/384/${c.file}`)!.size, 0);
console.log(JSON.stringify({ species: candidates.length, files: candidates.length * 2, expectedBytes: totalBytes, excluded: excluded.length, concurrency: 16 }));
let next = 0, completed = 0, fetched = 0, reused = 0, bytesDownloaded = 0;
const assets: any[] = new Array(candidates.length);
const began = Date.now();
async function download(path: string, url: string, expected: { sha: string; size: number }) {
  try {
    const b = await readFile(path);
    if (b.length === expected.size && gitSha(b) === expected.sha) { reused++; return b; }
  } catch { /* Download below. */ }
  let failure: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
      const b = new Uint8Array(await response.arrayBuffer());
      assert.equal(b.length, expected.size, `Size mismatch: ${path}`);
      assert.equal(gitSha(b), expected.sha, `Pinned Git blob mismatch: ${path}`);
      assert.equal(Buffer.from(b.subarray(0, 4)).toString('ascii'), 'RIFF', `Not WebP RIFF: ${path}`);
      assert.equal(Buffer.from(b.subarray(8, 12)).toString('ascii'), 'WEBP', `Not WebP: ${path}`);
      await writeFile(path, b); fetched++; bytesDownloaded += b.length; return b;
    } catch (error) { failure = error; if (attempt < 3) await delay(400 * 2 ** attempt); }
  }
  throw failure;
}
await Promise.all(Array.from({ length: 16 }, async () => {
  while (next < candidates.length) {
    const i = next++, { s, file, desiredFile } = candidates[i];
    const files = [];
    for (const size of [128, 384]) {
      const remotePath = `v1/${size}/${file}`;
      const expected = paths.get(remotePath)!;
      const path = `public/stickers/${size}/${s.code}.webp`;
      const url = `${raw}yusuftaleb/everybird-stickers/${lock.revisions.stickers}/${remotePath}`;
      const b = await download(path, url, expected);
      files.push({ path, url, sha256: sha256(b), gitBlobSha: expected.sha, bytes: b.length, longSide: size, retrievedAt });
    }
    assets[i] = { code: s.code, name: s.com, localPath: `/stickers/384/${s.code}.webp`, smallPath: `/stickers/128/${s.code}.webp`,
      revision: lock.revisions.stickers, sourceFile: file, license: 'CC BY 4.0',
      quality: file === desiredFile && s.q === true ? 'meets-source-quality-bar' : 'unknown', files };
    completed++;
    if (completed % 250 === 0 || completed === candidates.length) {
      const elapsed = (Date.now() - began) / 1000;
      console.log(JSON.stringify({ completed, total: candidates.length, fetched, reused, downloadedMB: +(bytesDownloaded / 1e6).toFixed(1), elapsedSeconds: +elapsed.toFixed(1), estimatedRemainingSeconds: Math.round(elapsed * (candidates.length - completed) / completed) }));
    }
  }
}));
lock.demoCodes ||= lock.assets.map((a: any) => a.code);
lock.assets = assets;
lock.artworkScope = 'all-available-current-species';
lock.artworkExpansion = { completedAt: new Date().toISOString(), currentSpecies: species.length, bundledSpecies: assets.length,
  bundledFiles: assets.length * 2, bytes: totalBytes, sourceMissing: excluded, sourceRevision: lock.revisions.stickers };
await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
console.log(JSON.stringify({ complete: true, elapsedSeconds: +((Date.now() - began) / 1000).toFixed(1), bytes: totalBytes, bundledSpecies: assets.length }));
