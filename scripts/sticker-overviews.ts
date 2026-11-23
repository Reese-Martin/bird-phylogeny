/** Deterministic display-only overview tiers; source art and layout geometry stay intact. */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { basename } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';

export const OVERVIEW_SIZES = [32, 64] as const;
export const OVERVIEW_SETTINGS = { sourceLongSide: 384, sizes: OVERVIEW_SIZES, fit: 'inside', kernel: 'lanczos3', withoutEnlargement: true, trim: false, crop: false, colorSpace: 'srgb', format: 'webp', lossless: true, effort: 4, alphaQuality: 100 } as const;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

export async function generateOverview(bytes: Buffer, size: typeof OVERVIEW_SIZES[number]): Promise<Buffer> {
  assert.ok(OVERVIEW_SIZES.includes(size), 'Unsupported overview size');
  return sharp(bytes).toColourspace('srgb').ensureAlpha().resize({ width: size, height: size, fit: 'inside', kernel: 'lanczos3', withoutEnlargement: true }).webp({ lossless: true, effort: 4, alphaQuality: 100 }).toBuffer();
}
export async function overviewPixels(bytes: Buffer) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let zeroAlpha = 0, nonzeroAlpha = 0, alphaSum = 0, maxAlpha = 0;
  for (let i = 3; i < data.length; i += 4) { const alpha = data[i]; if (alpha === 0) zeroAlpha++; else nonzeroAlpha++; alphaSum += alpha; maxAlpha = Math.max(maxAlpha, alpha); }
  return { width: info.width, height: info.height, zeroAlpha, nonzeroAlpha, alphaSum, maxAlpha, nativeRGBABytes: info.width * info.height * 4 };
}
interface Asset { code: string; files: Array<{ path: string; sha256: string; longSide: number }> }
interface OutputRow { path: string; sha256: string; bytes: number; width: number; height: number; zeroAlpha: number; nonzeroAlpha: number; alphaSum: number }
async function main() {
  const started = performance.now(), verify = process.argv.includes('--verify-only');
  const lockPath = 'data/sources.lock.json', lockBytes = await readFile(lockPath), lock = JSON.parse(lockBytes.toString('utf8'));
  const assets = [...lock.assets as Asset[]].sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  if (!verify) for (const size of OVERVIEW_SIZES) await mkdir(`public/stickers/${size}`, { recursive: true });
  const outputs = new Map<string, Record<string, OutputRow>>(), inputHashes: string[] = [];
  const totals = Object.fromEntries([32, 64, 128, 384].map(size => [size, { files: 0, encodedBytes: 0, nativeRGBABytes: 0 }]));
  let cursor = 0, completed = 0, maxAspectRoundingErrorPixels = 0, missingTransparency = 0, emptyImages = 0;
  sharp.concurrency(1);
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < assets.length) {
      const asset = assets[cursor++], source = asset.files.find(file => file.longSide === 384);
      assert.ok(source, `${asset.code}: pinned 384px source required`);
      const bytes = await readFile(source.path); assert.equal(sha256(bytes), source.sha256, `${asset.code}: source hash changed`);
      inputHashes.push(`${asset.code}:${source.sha256}`);
      const sourceInfo = await sharp(bytes).metadata();
      assert.ok(sourceInfo.width && sourceInfo.height && Math.max(sourceInfo.width, sourceInfo.height) === 384, `${asset.code}: source dimensions`);
      for (const sourceSize of [128, 384]) {
        const file = asset.files.find(file => file.longSide === sourceSize)!;
        const input = sourceSize === 384 ? bytes : await readFile(file.path);
        assert.equal(sha256(input), file.sha256, `${asset.code}: ${sourceSize}px source changed`);
        const meta = sourceSize === 384 ? sourceInfo : await sharp(input).metadata();
        assert.ok(meta.width && meta.height);
        totals[sourceSize].files++; totals[sourceSize].encodedBytes += input.length; totals[sourceSize].nativeRGBABytes += meta.width * meta.height * 4;
      }
      const rows: Record<string, OutputRow> = {};
      for (const size of OVERVIEW_SIZES) {
        const resized = await generateOverview(bytes, size);
        const info = await overviewPixels(resized);
        const outputPath: string = `public/stickers/${size}/${basename(source.path)}`;
        const ratio = size / 384;
        const error = Math.max(Math.abs(info.width - sourceInfo.width * ratio), Math.abs(info.height - sourceInfo.height * ratio));
        maxAspectRoundingErrorPixels = Math.max(maxAspectRoundingErrorPixels, error);
        assert.ok(error <= 1 && Math.max(info.width, info.height) === size, `${asset.code}: full-canvas aspect changed`);
        if (!info.zeroAlpha) missingTransparency++;
        if (!info.nonzeroAlpha) emptyImages++;
        assert.ok(info.zeroAlpha && info.nonzeroAlpha, `${asset.code}: transparency or visible silhouette lost`);
        if (verify) assert.equal(sha256(await readFile(outputPath)), sha256(resized), `${asset.code}: ${size}px repeat differs`);
        else {
          let existing: Buffer | undefined;
          try { existing = await readFile(outputPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          // Do not reopen unchanged images for writing while the local app decodes them.
          if (!existing || sha256(existing) !== sha256(resized)) {
            await writeFile(`${outputPath}.tmp`, resized); await rename(`${outputPath}.tmp`, outputPath);
          }
        }
        rows[size] = { path: outputPath, sha256: sha256(resized), bytes: resized.length, width: info.width, height: info.height, zeroAlpha: info.zeroAlpha, nonzeroAlpha: info.nonzeroAlpha, alphaSum: info.alphaSum };
        totals[size].files++; totals[size].encodedBytes += resized.length; totals[size].nativeRGBABytes += info.nativeRGBABytes;
      }
      outputs.set(asset.code, rows);
      if (++completed % 1000 === 0 || completed === assets.length) console.log(JSON.stringify({ verify, completed, total: assets.length, elapsedMs: Math.round(performance.now() - started) }));
    }
  }));
  const ordered = Object.fromEntries([...outputs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const catalogs = Object.fromEntries(OVERVIEW_SIZES.map(size => [size, sha256(Object.entries(ordered).map(([code, row]) => `${code}:${row[size].sha256}`).join('\n'))]));
  const manifest = {
    version: 1, purpose: 'Display-only small overview tiers; layout positions, palettes, full-canvas extent and source assets unchanged.',
    inputCatalog: { path: lockPath, sha256: sha256(lockBytes), artworkRevision: lock.revisions.stickers, originalArtworkRevision: lock.revisions.huashu },
    inputImageCount: assets.length, inputImageCatalogSha256: sha256(inputHashes.sort().join('\n')),
    settings: OVERVIEW_SETTINGS, pathRule: '/stickers/{32|64}/{same local filename as 384px source}',
    outputCatalogSha256: catalogs, totals,
    validation: { species: completed, files: completed * 2, missingTransparency, emptyImages, maxAspectRoundingErrorPixels, completeAlphaMeasuredForEveryOutput: true },
    files: ordered,
    sharpVersion: sharp.versions.sharp, libvipsVersion: sharp.versions.vips, webpVersion: sharp.versions.webp,
    script: { path: 'scripts/sticker-overviews.ts', sha256: sha256(await readFile('scripts/sticker-overviews.ts')) },
    license: 'Resized derivatives of pinned local AI illustrations. huashu-bird-sticker / Everybird-stickers, CC BY 4.0.',
  };
  if (verify) {
    const previous = JSON.parse(await readFile('data/sticker-overviews-source.json', 'utf8'));
    assert.deepEqual(manifest, previous, 'Repeated capture manifest differs');
  } else {
    await writeFile('data/sticker-overviews-source.json.tmp', JSON.stringify(manifest) + '\n');
    await rename('data/sticker-overviews-source.json.tmp', 'data/sticker-overviews-source.json');
  }
  console.log(JSON.stringify({ complete: true, verify, species: completed, catalogs, totals, validation: manifest.validation, elapsedMs: Math.round(performance.now() - started) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1; });
