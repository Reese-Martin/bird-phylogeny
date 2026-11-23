import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { generateSheet, SHEET_SETTINGS, verifyCrop, type SheetIndex } from '../scripts/sticker-sheets';

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const overview = JSON.parse(readFileSync('data/sticker-overviews-source.json', 'utf8'));
const source = JSON.parse(readFileSync('data/sticker-sheets-source.json', 'utf8'));
const delivery = JSON.parse(readFileSync('src/generated/sticker-delivery.json', 'utf8'));
const index = JSON.parse(readFileSync(`public${delivery.indexUrl}`, 'utf8')) as SheetIndex;

describe('complete display-only overview sheets', () => {
  it('covers every pinned overview exactly once and stays inside bounded sheets with source dimensions', () => {
    const paths = Object.entries(overview.files).flatMap(([code]) => [32, 64].map(tier => `/stickers/${tier}/${code}.webp`)).sort();
    expect(Object.keys(index.images).sort()).toEqual(paths);
    expect(paths).toHaveLength(22054);
    expect(index.sheets).toHaveLength(Math.ceil(11027 / SHEET_SETTINGS.maxSpecies) * 2);
    const counts = new Map<number, number>();
    for (const [path, [sheetIndex, x, y, width, height, bytes]] of Object.entries(index.images)) {
      const [, tier, code] = /^\/stickers\/(32|64)\/([^/]+)\.webp$/.exec(path)!;
      const original = overview.files[code][tier], sheet = index.sheets[sheetIndex];
      expect(sheet.tier).toBe(Number(tier)); expect([width, height, bytes]).toEqual([original.width, original.height, original.bytes]);
      expect(x).toBeGreaterThanOrEqual(1); expect(y).toBeGreaterThanOrEqual(1);
      expect(x + width).toBeLessThan(sheet.width); expect(y + height).toBeLessThan(sheet.height);
      expect(sheet.width * sheet.height * 4).toBeLessThanOrEqual((Number(tier) + 2) ** 2 * SHEET_SETTINGS.maxSpecies * 4);
      counts.set(sheetIndex, (counts.get(sheetIndex) || 0) + 1);
    }
    expect(Math.max(...counts.values())).toBe(SHEET_SETTINGS.maxSpecies);
    expect(source.settings).toEqual(SHEET_SETTINGS);
    expect(source.validation).toMatchObject({ species: 11027, images: 22054, everyCropAlphaAndVisibleRGBExact: true, fullCanvasExtentPreserved: true });
  });

  it('pins every sheet, index, source and generator to content hashes', () => {
    expect(index.revision).toBe(delivery.revision); expect(index.revision).toBe(source.revision); expect(delivery.artworkRevision).toBe(source.artworkRevision);
    expect(delivery.indexUrl).toBe(`/data/sticker-sheets-${source.index.sha256}.json`);
    expect(hash(readFileSync(source.index.path))).toBe(source.index.sha256);
    expect(hash(readFileSync(source.script.path))).toBe(source.script.sha256);
    expect(hash(readFileSync('data/sticker-overviews-source.json'))).toBe(source.inputs.overviews);
    expect(hash(readFileSync('data/sources.lock.json'))).toBe(source.inputs.lock);
    expect(hash(readFileSync('public/data/taxa.json'))).toBe(source.inputs.taxonomy);
    expect(hash(readFileSync('public/data/tree.json'))).toBe(source.inputs.tree);
    for (const row of source.sheets) {
      const bytes = readFileSync(`public${row.path}`);
      expect(bytes.length).toBe(row.bytes); expect(hash(bytes)).toBe(row.sha256);
      expect(row.path).toBe(`/sticker-sheets/${row.tier}-${row.sha256}.webp`);
    }
  }, 30000);

  it('losslessly isolates transparent, thin and partially transparent artwork without resizing or shared pixels', async () => {
    const images = Array.from({ length: 9 }, (_, i) => {
      const width = i % 2 ? 32 : 5, height = i % 2 ? 3 : 32, rgba = Buffer.alloc(width * height * 4);
      for (let pixel = 0; pixel < width * height; pixel++) rgba.set([19 + i * 20, 37 + i, 240 - i * 11, [0, 1, 17, 127, 255][pixel % 5]], pixel * 4);
      return { code: `test-${i}`, path: `/stickers/32/test-${i}.webp`, width, height, rgba, encodedBytes: 100 + i };
    });
    const first = await generateSheet(images, 32), second = await generateSheet(images, 32);
    expect(first.bytes).toEqual(second.bytes); expect(first.width).toBe(136); expect(first.height).toBe(102);
    const raw = await sharp(first.bytes).ensureAlpha().raw().toBuffer();
    for (const [i, image] of images.entries()) {
      const crop = first.crops[i]; expect([crop.width, crop.height, crop.bytes]).toEqual([image.width, image.height, image.encodedBytes]);
      expect(() => verifyCrop(raw, first.width, crop, image.rgba)).not.toThrow();
      for (let y = crop.y - 1; y <= crop.y + crop.height; y++) for (const x of [crop.x - 1, crop.x + crop.width]) expect(raw[(y * first.width + x) * 4 + 3]).toBe(0);
    }
    const broken = Buffer.from(raw), crop = first.crops[0]; broken[((crop.y + 1) * first.width + crop.x) * 4 + 3] ^= 1;
    expect(() => verifyCrop(broken, first.width, crop, images[0].rgba)).toThrow('Crop alpha changed');
  });

  it('rechecks real thin and tall crops from both tiers against the original decoded pixels', async () => {
    for (const code of ['blujay', 'houspa', 'snoowl1', 'scamac1']) for (const tier of [32, 64]) {
      const path = `/stickers/${tier}/${code}.webp`, [sheetId, x, y, width, height] = index.images[path];
      const row = index.sheets[sheetId], pixels = await sharp(readFileSync(`public${row.path}`)).ensureAlpha().raw().toBuffer();
      const original = await sharp(readFileSync(`public${path}`)).ensureAlpha().raw().toBuffer();
      expect(() => verifyCrop(pixels, row.width, { x, y, width, height }, original)).not.toThrow();
    }
  });
});
