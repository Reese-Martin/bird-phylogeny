import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { captureCollisionMask, conservativeMaskFromAlpha, unionCollisionMasks } from '../scripts/sticker-collision-masks';
import { decodeStickerMask, packStickers, countPackingOverlaps } from '../src/embedding/sticker-packing';

describe('separate conservative collision occupancy', () => {
  it('retains single faint pixels that area averaging would discard and covers their complete guarded rectangle', () => {
    const alpha = new Uint8Array(100 * 100); alpha[49 * 100 + 49] = 1;
    const mask = decodeStickerMask(conservativeMaskFromAlpha(alpha, 100, 100, 24, 24));
    // Pixel [49,50) expanded to [48,51) intersects cells11 and12 on both axes.
    expect(mask.rows[11] & (1 << 11)).not.toBe(0);
    expect(mask.rows[11] & (1 << 12)).not.toBe(0);
    expect(mask.rows[12] & (1 << 11)).not.toBe(0);
    expect(mask.rows[12] & (1 << 12)).not.toBe(0);
    expect(mask.occupied).toBe(4);
  });

  it('unions both asset resolutions in a common rounded-aspect tile and clips guards at its edges', () => {
    const small = new Uint8Array(8 * 4); small[0] = 255;
    const large = new Uint8Array(16 * 8); large[large.length - 1] = 1;
    const a = conservativeMaskFromAlpha(small, 8, 4, 24, 12), b = conservativeMaskFromAlpha(large, 16, 8, 24, 12);
    const union = decodeStickerMask(unionCollisionMasks(a, b));
    expect(union.rows[0] & 1).toBe(1);
    expect(union.rows[11] & (1 << 23)).not.toBe(0);
    expect(unionCollisionMasks(a, b)).toEqual(unionCollisionMasks(b, a));
    expect(() => unionCollisionMasks(a, [24, 24, b[2]])).toThrow('identical tile grids');
  });

  it('includes every target cell intersected by native occupied pixels at unequal dimensions', () => {
    const width = 31, height = 17, mw = 24, mh = 13, alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) if (i % 19 === 0) alpha[i] = 1;
    const mask = decodeStickerMask(conservativeMaskFromAlpha(alpha, width, height, mw, mh));
    for (let sy = 0; sy < height; sy++) for (let sx = 0; sx < width; sx++) if (alpha[sy * width + sx]) {
      for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
        if (x / mw < (sx + 2) / width && (x + 1) / mw > (sx - 1) / width && y / mh < (sy + 2) / height && (y + 1) / mh > (sy - 1) / height) expect(mask.rows[y] & (1 << x)).not.toBe(0);
      }
    }
  });

  it('packs every thin-feature tile without intersections using the conservative occupancy', () => {
    const alpha = new Uint8Array(128 * 128);
    for (let i = 0; i < 128; i++) { alpha[i * 128 + 64] = 1; alpha[64 * 128 + i] = 255; }
    const mask = conservativeMaskFromAlpha(alpha, 128, 128, 24, 24);
    const points = Array.from({ length: 40 }, (_, i) => ({ code: `thin-${i}`, x: 0, y: 0, width: 1 + i % 3 * .5, height: 1, mask }));
    const result = packStickers(points);
    expect(result.points).toHaveLength(points.length);
    expect(countPackingOverlaps(result.points)).toBe(0);
    expect(countPackingOverlaps(result.points, result.gap * .99)).toBe(0);
  });

  it('covers every bundled species, preserves the sizing grid and contains every original sizing-mask cell', () => {
    const collision = JSON.parse(readFileSync('public/data/sticker-collision-masks.json', 'utf8'));
    const geometry = JSON.parse(readFileSync('public/data/sticker-geometry.json', 'utf8'));
    const lock = JSON.parse(readFileSync('data/sources.lock.json', 'utf8'));
    expect(Object.keys(collision.species).sort()).toEqual(lock.assets.map((asset: { code: string }) => asset.code).sort());
    expect(Object.keys(collision.species)).toHaveLength(11027);
    const missingCells: Array<{ code: string; byte: number }> = [];
    for (const [code, mask] of Object.entries(collision.species) as Array<[string, [number, number, string]]>) {
      expect(mask.slice(0, 2)).toEqual(geometry.species[code].mask.slice(0, 2));
      const full = Buffer.from(mask[2], 'base64'), sizing = Buffer.from(geometry.species[code].mask[2], 'base64');
      expect(full.length).toBe(sizing.length);
      for (let i = 0; i < sizing.length; i++) if ((full[i] & sizing[i]) !== sizing[i]) missingCells.push({ code, byte: i });
    }
    expect(missingCells).toEqual([]);
  });

  it('records complete four-tier coverage with pinned source and generated asset catalogs', () => {
    const source = JSON.parse(readFileSync('data/sticker-collision-masks-source.json', 'utf8'));
    expect(source.method.artworkLongSides).toEqual([32, 64, 128, 384]);
    expect(source.inputImages).toBe(44108);
    expect(source.validation).toMatchObject({ tierMasksCovered: 44108, allNativeTierMasksContained: true });
    for (const row of [source.inputCatalog, source.overviewInputs, source.sizingGrid, source.script, source.output]) expect(createHash('sha256').update(readFileSync(row.path)).digest('hex')).toBe(row.sha256);
  });

  it('contains guarded native alpha from every runtime tier for representative real thin and broad silhouettes', async () => {
    const collision = JSON.parse(readFileSync('public/data/sticker-collision-masks.json', 'utf8'));
    const lock = JSON.parse(readFileSync('data/sources.lock.json', 'utf8'));
    for (const code of ['blujay', 'norcar', 'houspa', 'monpar', 'amecro', 'snoowl1', 'scamac1']) {
      const shared = collision.species[code], full = Buffer.from(shared[2], 'base64');
      const asset = lock.assets.find((row: {code: string}) => row.code === code);
      for (const size of [32, 64, 128, 384]) {
        const path = size < 128 ? `public/stickers/${size}/${code}.webp` : asset.files.find((row: {longSide: number}) => row.longSide === size).path;
        const native = await captureCollisionMask(readFileSync(path), shared[0], shared[1]), bits = Buffer.from(native[2], 'base64');
        for (let i = 0; i < bits.length; i++) expect(full[i] & bits[i]).toBe(bits[i]);
      }
    }
  });
});
