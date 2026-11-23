/**
 * Capture mass, painted area and collision masks for every bundled sticker.
 * The mask algorithm is adapted from Everybird (MIT), pinned in the source manifest:
 * https://github.com/yusuftaleb/everybird/blob/50510c2209280b9f259545d8ab08e13970d5f8e6/src/lib/layout/mask.ts
 * No personal collection is read; the complete public artwork library is measured.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { StickerGeometry, StickerGeometryFile, StickerMask } from '../src/embedding/sticker-types';

export const EVERYBIRD_REVISION = '50510c2209280b9f259545d8ab08e13970d5f8e6';
export const MASK_LONG_SIDE = 24;
export const ALPHA_THRESHOLD = 40;
export const SHAPE_REF = 215 / 576;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const gitBlobSha = (bytes: Uint8Array) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

export function maskDims(width: number, height: number): [number, number] {
  return [width >= height ? MASK_LONG_SIDE : Math.max(1, Math.round(MASK_LONG_SIDE * width / height)), height >= width ? MASK_LONG_SIDE : Math.max(1, Math.round(MASK_LONG_SIDE * height / width))];
}

/** Exact upstream area-average BOX resize, including 8-bit rounding before >40. */
export function maskFromAlpha(alpha: Uint8Array, width: number, height: number): StickerMask {
  assert.equal(alpha.length, width * height);
  const [w, h] = maskDims(width, height);
  const bits = new Uint8Array(Math.ceil(w * h / 8));
  const xs = width / w, ys = height / h;
  for (let dy = 0; dy < h; dy++) {
    const y0 = dy * ys, y1 = y0 + ys;
    for (let dx = 0; dx < w; dx++) {
      const x0 = dx * xs, x1 = x0 + xs;
      let sum = 0;
      for (let y = Math.floor(y0); y < Math.min(height, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.min(width, Math.ceil(x1)); x++) {
          sum += alpha[y * width + x] * wy * (Math.min(x + 1, x1) - Math.max(x, x0));
        }
      }
      if (Math.round(sum / (xs * ys)) > ALPHA_THRESHOLD) {
        const index = dy * w + dx;
        bits[index >> 3] |= 0x80 >> (index & 7);
      }
    }
  }
  return [w, h, Buffer.from(bits).toString('base64')];
}

export function maskShape(mask: StickerMask): number {
  let set = 0;
  for (let byte of Buffer.from(mask[2], 'base64')) while (byte) { set += byte & 1; byte >>= 1; }
  return set / (MASK_LONG_SIDE * MASK_LONG_SIDE);
}

export async function captureGeometry(bytes: Buffer, massG: number, massSource: string): Promise<StickerGeometry> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = new Uint8Array(info.width * info.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  const mask = maskFromAlpha(alpha, info.width, info.height);
  return { massG, massSource, aspect: Math.round(info.width / info.height * 10000) / 10000, imageWidth: info.width, imageHeight: info.height, mask, shape: maskShape(mask) };
}

type SourceRow = { code: string; g: number; gSrc: string; ar: number; sv?: string };
type Asset = { code: string; sourceFile: string; files: Array<{path: string; sha256: string; gitBlobSha: string; longSide: number}> };

async function main() {
  const started = performance.now();
  const lock = JSON.parse(await readFile('data/sources.lock.json', 'utf8'));
  assert.equal(lock.revisions.everybird, EVERYBIRD_REVISION);
  const massSource = lock.sources.find((source: {path: string}) => source.path === 'data/raw/everybird-species.json');
  const massBytes = await readFile(massSource.path);
  assert.equal(sha256(massBytes), massSource.sha256, 'Pinned mass input changed');
  const massRows: SourceRow[] = JSON.parse(massBytes.toString('utf8')).species;
  const byCode = new Map(massRows.map(row => [row.code, row]));
  const assets: Asset[] = [...lock.assets].sort((a: Asset, b: Asset) => a.code.localeCompare(b.code, 'en'));
  const referencePath = 'data/raw/everybird-geometry-masks.json';
  const referenceBlobSha = 'c72ce0c60b95b8e3fcf510a30a0e673b15cf5593';
  if (process.argv.includes('--fetch-reference')) {
    const response = await fetch(`https://raw.githubusercontent.com/yusuftaleb/everybird/${EVERYBIRD_REVISION}/public/data/masks.v2.json`);
    assert.ok(response.ok, `Reference masks HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(gitBlobSha(bytes), referenceBlobSha, 'Pinned upstream reference masks changed');
    await writeFile(referencePath, bytes);
  }
  let reference: Record<string, Record<string, StickerMask>> | null = null;
  let referenceBytes: Buffer | undefined;
  try { referenceBytes = await readFile(referencePath); } catch { /* Optional upstream comparison, measurements always use local images. */ }
  if (referenceBytes) { assert.equal(gitBlobSha(referenceBytes), referenceBlobSha, 'Reference masks differ from the pinned Git blob'); reference = JSON.parse(referenceBytes.toString('utf8')); }
  const referenceMasks = new Map<string, StickerMask>();
  for (const table of Object.values(reference || {})) for (const [code, mask] of Object.entries(table)) referenceMasks.set(code, mask);
  const records: Record<string, StickerGeometry> = {};
  const imageHashes: string[] = [];
  const differences: string[] = [], absentReferences: string[] = [];
  const massCounts: Record<string, number> = {};
  let index = 0, completed = 0;
  sharp.concurrency(1);
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (index < assets.length) {
      const asset = assets[index++];
      const mass = byCode.get(asset.code);
      assert.ok(mass && Number.isFinite(mass.g) && mass.g > 0, `${asset.code}: valid source mass required`);
      const image = asset.files.find(file => file.longSide === 384)!;
      assert.ok(image, `${asset.code}: 384px image required`);
      const bytes = await readFile(image.path);
      assert.equal(sha256(bytes), image.sha256, `${asset.code}: local image differs from pinned source`);
      assert.equal(gitBlobSha(bytes), image.gitBlobSha, `${asset.code}: local image Git blob differs`);
      const geometry = await captureGeometry(bytes, mass.g, mass.gSrc);
      assert.ok(geometry.shape > 0, `${asset.code}: empty mask`);
      records[asset.code] = geometry;
      imageHashes.push(`${asset.code}:${image.sha256}`);
      massCounts[mass.gSrc] = (massCounts[mass.gSrc] || 0) + 1;
      const expected = referenceMasks.get(asset.code);
      if (!expected) absentReferences.push(asset.code);
      else if (JSON.stringify(geometry.mask) !== JSON.stringify(expected)) differences.push(asset.code);
      if (++completed % 1000 === 0 || completed === assets.length) console.log(JSON.stringify({ completed, total: assets.length, elapsedMs: Math.round(performance.now() - started) }));
    }
  }));
  const file: StickerGeometryFile = { version: 1, maskLongSide: 24, alphaThreshold: 40, shapeRef: SHAPE_REF, exponents: { even: 0.2, true: 1 / 3 }, species: Object.fromEntries(Object.entries(records).sort(([a], [b]) => a.localeCompare(b, 'en'))) };
  const output = JSON.stringify(file);
  await writeFile('public/data/sticker-geometry.json', output + '\n');
  const byAssetCode = new Map(assets.map(asset => [asset.code, asset]));
  const versionMismatchCodes = differences.filter(code => {
    const row = byCode.get(code)!;
    return row.sv && byAssetCode.get(code)!.sourceFile !== `${code}.${row.sv}.webp`;
  });
  const sourceManifest = {
    version: 1, everybirdRevision: EVERYBIRD_REVISION, artworkRevision: lock.revisions.stickers,
    inputMass: massSource, inputImageCount: assets.length, inputImageCatalogSha256: sha256(imageHashes.sort().join('\n')),
    method: { longSide: 24, alphaThresholdExclusive: 40, resampling: 'area-average BOX, rounded 8-bit', bitOrder: 'row-major MSB first', shapeDenominator: 576, shapeReference: SHAPE_REF, sizeExponents: { even: 0.2, true: 1 / 3 }, massFloorG: 0.1, shapeFloor: 0.05 },
    sourceUrls: ['src/lib/layout/mask.ts', 'src/lib/layout/pack.ts', 'src/lib/layout/constants.ts', 'scripts/build-data/build-stickers.ts', 'scripts/build-data/build-species.ts'].map(path => `https://github.com/yusuftaleb/everybird/blob/${EVERYBIRD_REVISION}/${path}`),
    massSources: massCounts,
    comparison: { reference: referenceBytes ? { path: referencePath, sha256: sha256(referenceBytes), gitBlobSha: referenceBlobSha, url: `https://raw.githubusercontent.com/yusuftaleb/everybird/${EVERYBIRD_REVISION}/public/data/masks.v2.json` } : null, compared: referenceMasks.size ? assets.length - absentReferences.length : 0, identical: assets.length - absentReferences.length - differences.length, differentCodes: differences.sort(), expectedArtworkVersionDifferences: versionMismatchCodes.length, unexpectedDifferentCodes: differences.filter(code => !versionMismatchCodes.includes(code)).sort(), absentCodes: absentReferences.sort() },
    output: { path: 'public/data/sticker-geometry.json', sha256: sha256(output + '\n'), bytes: Buffer.byteLength(output + '\n'), species: assets.length },
    sharpVersion: sharp.versions.sharp,
  };
  await writeFile('data/sticker-geometry-source.json', JSON.stringify(sourceManifest, null, 2) + '\n');
  console.log(JSON.stringify({ complete: true, species: assets.length, compared: sourceManifest.comparison.compared, differences: differences.length, absentReferences: absentReferences.length, elapsedMs: Math.round(performance.now() - started), bytes: sourceManifest.output.bytes }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1; });
