/** Lossless, display-only overview sheets. Every crop keeps its original canvas. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

export const SHEET_SETTINGS = { version: 1, tiers: [32, 64], columns: 4, maxSpecies: 16, gutter: 1, format: 'webp', lossless: true, effort: 4, crop: false, resize: false } as const;
export interface SheetImage { code: string; path: string; width: number; height: number; rgba: Buffer; encodedBytes?: number }
export interface SheetOutput { bytes: Buffer; width: number; height: number; crops: Array<{ path: string; x: number; y: number; width: number; height: number; bytes: number }> }
export interface SheetIndex { version: 1; revision: string; sheets: Array<{ path: string; tier: number; width: number; height: number; bytes: number }>; images: Record<string, [number, number, number, number, number, number]> }
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

export async function generateSheet(images: SheetImage[], tier: number): Promise<SheetOutput> {
  assert.ok(SHEET_SETTINGS.tiers.includes(tier as 32 | 64), 'Unsupported sheet tier');
  assert.ok(images.length > 0 && images.length <= SHEET_SETTINGS.maxSpecies, 'A sheet contains 1–16 species');
  const cell = tier + SHEET_SETTINGS.gutter * 2, columns = Math.min(SHEET_SETTINGS.columns, images.length);
  const width = cell * columns, height = cell * Math.ceil(images.length / columns), pixels = Buffer.alloc(width * height * 4);
  const crops = images.map((image, index) => {
    assert.ok(image.width > 0 && image.height > 0 && image.width <= tier && image.height <= tier, `${image.code}: invalid full-canvas extent`);
    assert.equal(image.rgba.length, image.width * image.height * 4);
    const x = index % columns * cell + SHEET_SETTINGS.gutter, y = Math.floor(index / columns) * cell + SHEET_SETTINGS.gutter;
    for (let row = 0; row < image.height; row++) image.rgba.copy(pixels, ((y + row) * width + x) * 4, row * image.width * 4, (row + 1) * image.width * 4);
    return { path: image.path, x, y, width: image.width, height: image.height, bytes: image.encodedBytes || 0 };
  });
  const bytes = await sharp(pixels, { raw: { width, height, channels: 4 } }).webp({ lossless: true, effort: SHEET_SETTINGS.effort, alphaQuality: 100 }).toBuffer();
  return { bytes, width, height, crops };
}

/** WebP may normalize RGB at alpha=0; all visible pixels and every alpha must match. */
export function verifyCrop(sheet: Buffer, sheetWidth: number, crop: { x: number; y: number; width: number; height: number }, expected: Buffer): void {
  assert.equal(expected.length, crop.width * crop.height * 4);
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
    const source = (y * crop.width + x) * 4, target = ((y + crop.y) * sheetWidth + x + crop.x) * 4;
    assert.equal(sheet[target + 3], expected[source + 3], 'Crop alpha changed');
    if (expected[source + 3]) for (let channel = 0; channel < 3; channel++) assert.equal(sheet[target + channel], expected[source + channel], 'Visible crop RGB changed');
  }
}

async function writeStable(path: string, bytes: string | Buffer, verify: boolean) {
  if (verify) { assert.equal(sha256(await readFile(path)), sha256(bytes), `${path}: repeated capture differs`); return; }
  let previous: Buffer | undefined;
  try { previous = await readFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (previous && sha256(previous) === sha256(bytes)) return;
  await writeFile(`${path}.tmp`, bytes); await rename(`${path}.tmp`, path);
}

async function main() {
  const started = performance.now(), verify = process.argv.includes('--verify-only');
  const [lockBytes, overviewBytes, taxaBytes, treeBytes] = await Promise.all(['data/sources.lock.json', 'data/sticker-overviews-source.json', 'public/data/taxa.json', 'public/data/tree.json'].map(path => readFile(path)));
  const lock = JSON.parse(lockBytes.toString()), overview = JSON.parse(overviewBytes.toString());
  const taxa = JSON.parse(taxaBytes.toString()) as Array<{ sticker?: string; stickerSmall?: string; treeTip?: number; treeTips?: number[] }>;
  const tree = JSON.parse(treeBytes.toString()) as { tips: number[] };
  const leafOrder = new Map(tree.tips.map((tip, index) => [tip, index]));
  const imageOrder = new Map<string, { leaf: number; taxonomy: number }>();
  for (const [taxonomy, taxon] of taxa.entries()) {
    const file = taxon.sticker || taxon.stickerSmall; if (!file) continue;
    const code = basename(file, '.webp'), tips = [...(taxon.treeTips || []), ...(taxon.treeTip === undefined ? [] : [taxon.treeTip])];
    const leaf = Math.min(Infinity, ...tips.map(tip => leafOrder.get(tip) ?? Infinity)), previous = imageOrder.get(code);
    if (!previous || leaf < previous.leaf || leaf === previous.leaf && taxonomy < previous.taxonomy) imageOrder.set(code, { leaf, taxonomy });
  }
  const codes = (Object.keys(overview.files) as string[]).sort((a, b) => {
    const left = imageOrder.get(a), right = imageOrder.get(b);
    return (left?.leaf ?? Infinity) - (right?.leaf ?? Infinity) || (left?.taxonomy ?? Infinity) - (right?.taxonomy ?? Infinity) || (a < b ? -1 : a > b ? 1 : 0);
  });
  assert.equal(codes.length, lock.assets.length, 'Overview coverage differs from pinned artwork');
  const artworkRevision = sha256(JSON.stringify({ originals: lock.assets.map((asset: { code: string; files: Array<{ longSide: number; sha256: string }> }) => [asset.code, asset.files.map(file => [file.longSide, file.sha256])]).sort(([a]: string[], [b]: string[]) => a < b ? -1 : a > b ? 1 : 0), overviews: overview.outputCatalogSha256 }));
  const work = SHEET_SETTINGS.tiers.flatMap(tier => Array.from({ length: Math.ceil(codes.length / SHEET_SETTINGS.maxSpecies) }, (_, part) => ({ tier, codes: codes.slice(part * SHEET_SETTINGS.maxSpecies, (part + 1) * SHEET_SETTINGS.maxSpecies) })));
  const results: Array<{ sheet: SheetIndex['sheets'][number]; crops: SheetOutput['crops']; sha256: string; sourceBytes: number; sourceRGBABytes: number }> = [];
  if (!verify) await Promise.all(['public/sticker-sheets', 'public/data', 'src/generated', 'data'].map(path => mkdir(path, { recursive: true })));
  let cursor = 0, complete = 0, verifiedImages = 0, verifiedPixels = 0;
  sharp.concurrency(1);
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < work.length) {
      const index = cursor++, job = work[index], images: SheetImage[] = []; let sourceBytes = 0, sourceRGBABytes = 0;
      for (const code of job.codes) {
        const source = overview.files[code][job.tier], bytes = await readFile(source.path);
        assert.equal(sha256(bytes), source.sha256, `${code}: pinned overview changed`);
        const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.deepEqual([info.width, info.height, info.channels], [source.width, source.height, 4]);
        images.push({ code, path: source.path.replace(/^public/, ''), width: info.width, height: info.height, rgba: data, encodedBytes: bytes.length }); sourceBytes += bytes.length; sourceRGBABytes += data.length;
      }
      const output = await generateSheet(images, job.tier), hash = sha256(output.bytes), path = `/sticker-sheets/${job.tier}-${hash}.webp`;
      const decoded = await sharp(output.bytes).ensureAlpha().raw().toBuffer();
      for (const [image, imageIndex] of images.map((image, i) => [image, i] as const)) { verifyCrop(decoded, output.width, output.crops[imageIndex], image.rgba); verifiedImages++; verifiedPixels += image.width * image.height; }
      await writeStable(`public${path}`, output.bytes, verify);
      results[index] = { sheet: { path, tier: job.tier, width: output.width, height: output.height, bytes: output.bytes.length }, crops: output.crops, sha256: hash, sourceBytes, sourceRGBABytes };
      if (++complete % 40 === 0 || complete === work.length) console.log(JSON.stringify({ verify, complete, total: work.length, elapsedMs: Math.round(performance.now() - started) }));
    }
  }));
  const images: SheetIndex['images'] = {};
  for (const [index, result] of results.entries()) for (const crop of result.crops) images[crop.path] = [index, crop.x, crop.y, crop.width, crop.height, crop.bytes];
  const revision = sha256(JSON.stringify({ settings: SHEET_SETTINGS, artworkRevision, sheets: results.map(result => result.sha256), images }));
  const index: SheetIndex = { version: 1, revision, sheets: results.map(result => result.sheet), images };
  const indexText = JSON.stringify(index) + '\n', indexHash = sha256(indexText), indexUrl = `/data/sticker-sheets-${indexHash}.json`;
  await writeStable(`public${indexUrl}`, indexText, verify);
  await writeStable('src/generated/sticker-delivery.json', JSON.stringify({ version: 1, revision, indexUrl, artworkRevision }) + '\n', verify);
  const totals = Object.fromEntries(SHEET_SETTINGS.tiers.map(tier => {
    const matching = results.filter(result => result.sheet.tier === tier);
    return [tier, { sheets: matching.length, images: matching.reduce((sum, result) => sum + result.crops.length, 0), encodedBytes: matching.reduce((sum, result) => sum + result.sheet.bytes, 0), sheetRGBABytes: matching.reduce((sum, result) => sum + result.sheet.width * result.sheet.height * 4, 0), individualEncodedBytes: matching.reduce((sum, result) => sum + result.sourceBytes, 0), croppedRGBABytes: matching.reduce((sum, result) => sum + result.sourceRGBABytes, 0) }];
  }));
  const provenance = { version: 1, purpose: 'Display-only lossless overview batching; original canvas extent, artwork and geometry unchanged.', revision, artworkRevision, index: { path: `public${indexUrl}`, sha256: indexHash, bytes: Buffer.byteLength(indexText) }, inputs: { lock: sha256(lockBytes), overviews: sha256(overviewBytes), taxonomy: sha256(taxaBytes), tree: sha256(treeBytes) }, grouping: `Complete source-tip leaf order, then taxonomy sequence, then artwork code; deterministic chunks of at most ${SHEET_SETTINGS.maxSpecies}.`, settings: SHEET_SETTINGS, totals, validation: { species: codes.length, images: verifiedImages, verifiedPixels, everyCropAlphaAndVisibleRGBExact: true, fullCanvasExtentPreserved: true }, sheets: results.map(result => ({ ...result.sheet, sha256: result.sha256 })), script: { path: 'scripts/sticker-sheets.ts', sha256: sha256(await readFile('scripts/sticker-sheets.ts')) }, sharpVersion: sharp.versions.sharp, webpVersion: sharp.versions.webp, license: 'Batched derivatives of pinned local AI illustrations. huashu-bird-sticker / Everybird-stickers, CC BY 4.0.' };
  await writeStable('data/sticker-sheets-source.json', JSON.stringify(provenance) + '\n', verify);
  console.log(JSON.stringify({ complete: true, verify, revision, artworkRevision, indexUrl, totals, validation: provenance.validation, elapsedMs: Math.round(performance.now() - started) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1; });
