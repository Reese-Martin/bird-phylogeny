/**
 * Packing-only occupancy, separate from Everybird's painted-area measurements.
 * Any nonzero alpha in every displayed asset tier contributes every intersected
 * grid cell, including a one-source-pixel resampling guard on each side.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import type { StickerMask } from '../src/embedding/sticker-types';
import type { StickerCollisionMasksFile } from '../src/embedding/collision-masks';

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const gitBlobSha = (bytes: Uint8Array) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

/** Occupied source-pixel rectangles are expanded before projection, not sampled at centers. */
export function conservativeMaskFromAlpha(alpha: Uint8Array, width: number, height: number, maskWidth: number, maskHeight: number, guard = 1): StickerMask {
  assert.ok(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0, 'Invalid native image dimensions');
  assert.equal(alpha.length, width * height, 'Native alpha dimensions disagree');
  assert.ok(Number.isInteger(maskWidth) && maskWidth > 0 && maskWidth <= 24 && Number.isInteger(maskHeight) && maskHeight > 0 && maskHeight <= 24, 'Invalid collision grid dimensions');
  assert.ok(Number.isInteger(guard) && guard >= 0, 'Invalid source pixel guard');
  const rows = new Uint32Array(maskHeight), xBits = new Uint32Array(width);
  for (let x = 0; x < width; x++) {
    const first = Math.max(0, Math.floor((x - guard) * maskWidth / width));
    const last = Math.min(maskWidth - 1, Math.ceil((x + 1 + guard) * maskWidth / width) - 1);
    xBits[x] = ((2 ** (last - first + 1) - 1) << first) >>> 0;
  }
  for (let y = 0; y < height; y++) {
    let bits = 0;
    for (let x = 0; x < width; x++) if (alpha[y * width + x] > 0) bits |= xBits[x];
    if (!bits) continue;
    const first = Math.max(0, Math.floor((y - guard) * maskHeight / height));
    const last = Math.min(maskHeight - 1, Math.ceil((y + 1 + guard) * maskHeight / height) - 1);
    for (let row = first; row <= last; row++) rows[row] |= bits;
  }
  const packed = new Uint8Array(Math.ceil(maskWidth * maskHeight / 8));
  for (let y = 0; y < maskHeight; y++) for (let x = 0; x < maskWidth; x++) if (rows[y] & (1 << x)) {
    const index = y * maskWidth + x; packed[index >> 3] |= 0x80 >> (index & 7);
  }
  return [maskWidth, maskHeight, Buffer.from(packed).toString('base64')];
}

export function unionCollisionMasks(first: StickerMask, second: StickerMask): StickerMask {
  assert.deepEqual(first.slice(0, 2), second.slice(0, 2), 'Union requires identical tile grids');
  const a = Buffer.from(first[2], 'base64'), b = Buffer.from(second[2], 'base64');
  assert.equal(a.length, b.length, 'Union requires identical bit lengths');
  return [first[0], first[1], Buffer.from(a.map((byte, i) => byte | b[i])).toString('base64')];
}

export async function captureCollisionMask(bytes: Buffer, maskWidth: number, maskHeight: number): Promise<StickerMask> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = new Uint8Array(info.width * info.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  return conservativeMaskFromAlpha(alpha, info.width, info.height, maskWidth, maskHeight);
}

interface Asset { code: string; sourceFile: string; files: Array<{ path: string; sha256: string; gitBlobSha: string; longSide: number }> }

async function main() {
  const started = performance.now(), lockPath = 'data/sources.lock.json', geometryPath = 'public/data/sticker-geometry.json';
  const overviewPath = 'data/sticker-overviews-source.json';
  const [lockBytes, geometryBytes, overviewBytes] = await Promise.all([readFile(lockPath), readFile(geometryPath), readFile(overviewPath)]);
  const lock = JSON.parse(lockBytes.toString('utf8')), geometry = JSON.parse(geometryBytes.toString('utf8')), overviews = JSON.parse(overviewBytes.toString('utf8'));
  const assets: Asset[] = [...lock.assets].sort((a: Asset, b: Asset) => a.code.localeCompare(b.code, 'en'));
  const records = new Map<string, StickerMask>(), imageHashes: string[] = [];
  let cursor = 0, completed = 0, tierMasksCovered = 0, expandedSpecies = 0, addedCells = 0, maxAddedCells = 0;
  sharp.concurrency(1);
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < assets.length) {
      const asset = assets[cursor++], dimensions = geometry.species[asset.code]?.mask;
      assert.ok(dimensions, `${asset.code}: Everybird tile dimensions required`);
      let merged: StickerMask | undefined, originalMerged: StickerMask | undefined;
      const tierMasks: StickerMask[] = [];
      for (const longSide of [32, 64, 128, 384]) {
        const file = longSide < 128 ? overviews.files[asset.code]?.[longSide] : asset.files.find(file => file.longSide === longSide);
        assert.ok(file, `${asset.code}: ${longSide}px image required`);
        const bytes = await readFile(file.path);
        assert.equal(sha256(bytes), file.sha256, `${asset.code}: image SHA256 differs from pinned source`);
        if (longSide >= 128) assert.equal(gitBlobSha(bytes), file.gitBlobSha, `${asset.code}: image Git blob differs from pinned source`);
        imageHashes.push(`${asset.code}:${longSide}:${file.sha256}`);
        const mask = await captureCollisionMask(bytes, dimensions[0], dimensions[1]);
        tierMasks.push(mask);
        merged = merged ? unionCollisionMasks(merged, mask) : mask;
        if (longSide >= 128) originalMerged = originalMerged ? unionCollisionMasks(originalMerged, mask) : mask;
      }
      assert.ok(merged && originalMerged && Buffer.from(merged[2], 'base64').some(byte => byte), `${asset.code}: empty collision mask`);
      const full = Buffer.from(merged[2], 'base64'), original = Buffer.from(originalMerged[2], 'base64');
      for (const tier of tierMasks) {
        const occupied = Buffer.from(tier[2], 'base64');
        for (let i = 0; i < full.length; i++) assert.equal(full[i] & occupied[i], occupied[i], `${asset.code}: native tier escapes shared grid`);
        tierMasksCovered++;
      }
      let growth = 0;
      for (let i = 0; i < full.length; i++) { let extra = full[i] & ~original[i]; while (extra) { growth += extra & 1; extra >>>= 1; } }
      if (growth) expandedSpecies++;
      addedCells += growth; maxAddedCells = Math.max(maxAddedCells, growth);
      records.set(asset.code, merged);
      if (++completed % 1000 === 0 || completed === assets.length) console.log(JSON.stringify({ completed, total: assets.length, elapsedMs: Math.round(performance.now() - started) }));
    }
  }));
  assert.equal(records.size, assets.length, 'Every bundled species requires one collision mask');
  const output: StickerCollisionMasksFile = { version: 1, maskLongSide: 24, alphaThresholdExclusive: 0, sourcePixelGuard: 1,
    species: Object.fromEntries([...records].sort(([a], [b]) => a.localeCompare(b, 'en'))) };
  const text = JSON.stringify(output) + '\n', outputPath = 'public/data/sticker-collision-masks.json';
  await writeFile(`${outputPath}.tmp`, text); await rename(`${outputPath}.tmp`, outputPath);
  const provenance = { version: 1, purpose: 'Conservative packing occupancy only; original Everybird sizing and hit masks remain unchanged.',
    inputCatalog: { path: lockPath, sha256: sha256(lockBytes), artworkRevision: lock.revisions.stickers },
    overviewInputs: { path: overviewPath, sha256: sha256(overviewBytes), outputCatalogSha256: overviews.outputCatalogSha256 },
    sizingGrid: { path: geometryPath, sha256: sha256(geometryBytes), source: 'Everybird rounded-aspect 24-cell tiles' },
    inputImages: assets.length * 4, species: assets.length, inputImageCatalogSha256: sha256(imageHashes.sort().join('\n')),
    method: { longSide: 24, alphaThresholdExclusive: 0, sourcePixelGuard: 1, projection: 'Max-pool union of all intersected target cells for each guarded native pixel rectangle', artworkLongSides: [32, 64, 128, 384], bitOrder: 'row-major MSB first', guardClippedToTile: true },
    validation: { tierMasksCovered, allNativeTierMasksContained: tierMasksCovered === assets.length * 4, comparisonAgainst128And384: { expandedSpecies, addedCells, maxAddedCells } },
    script: { path: 'scripts/sticker-collision-masks.ts', sha256: sha256(await readFile('scripts/sticker-collision-masks.ts')) },
    output: { path: outputPath, sha256: sha256(text), bytes: Buffer.byteLength(text), species: records.size }, sharpVersion: sharp.versions.sharp };
  await writeFile('data/sticker-collision-masks-source.json', JSON.stringify(provenance, null, 2) + '\n');
  console.log(JSON.stringify({ complete: true, species: records.size, bytes: Buffer.byteLength(text), elapsedMs: Math.round(performance.now() - started), sha256: provenance.output.sha256 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1; });
