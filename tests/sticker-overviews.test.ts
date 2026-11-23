import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { generateOverview, overviewPixels } from '../scripts/sticker-overviews';

const source = JSON.parse(readFileSync('data/sticker-overviews-source.json', 'utf8'));
const lock = JSON.parse(readFileSync('data/sources.lock.json', 'utf8'));
const geometry = JSON.parse(readFileSync('public/data/sticker-geometry.json', 'utf8'));
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

describe('complete small overview artwork tiers', () => {
  it('covers all 11,027 pinned artwork species at both stable URL paths', () => {
    const codes = lock.assets.map((asset: {code: string}) => asset.code).sort();
    expect(codes).toHaveLength(11027); expect(Object.keys(source.files).sort()).toEqual(codes);
    for (const size of [32, 64]) {
      expect(readdirSync(`public/stickers/${size}`).sort()).toEqual(codes.map((code: string) => `${code}.webp`));
      expect(source.totals[size].files).toBe(11027);
      const catalog = codes.map((code: string) => `${code}:${source.files[code][size].sha256}`).join('\n');
      expect(sha256(catalog)).toBe(source.outputCatalogSha256[size]);
    }
    expect(source.validation).toMatchObject({ species: 11027, files: 22054, emptyImages: 0, missingTransparency: 0, completeAlphaMeasuredForEveryOutput: true });
    expect(sha256(readFileSync(source.inputCatalog.path))).toBe(source.inputCatalog.sha256);
    expect(sha256(readFileSync(source.script.path))).toBe(source.script.sha256);
    expect(source.inputImageCatalogSha256).toBe(JSON.parse(readFileSync('data/sticker-geometry-source.json', 'utf8')).inputImageCatalogSha256);
  });

  it('retains full-canvas aspect within resize rounding and visible transparent alpha for every generated file', () => {
    for (const [code, rows] of Object.entries(source.files) as Array<[string, Record<string, any>]>) for (const size of [32, 64]) {
      const row = rows[size], original = geometry.species[code];
      expect(row.path).toBe(`public/stickers/${size}/${code}.webp`);
      expect(Math.max(row.width, row.height)).toBe(size);
      expect(Math.abs(row.width - original.imageWidth * size / 384)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.height - original.imageHeight * size / 384)).toBeLessThanOrEqual(0.5);
      expect(row.zeroAlpha).toBeGreaterThan(0); expect(row.nonzeroAlpha).toBeGreaterThan(0);
      expect(row.zeroAlpha + row.nonzeroAlpha).toBe(row.width * row.height);
    }
    expect(source.settings).toMatchObject({ fit: 'inside', trim: false, crop: false, lossless: true, kernel: 'lanczos3' });
    expect(source.totals[32].nativeRGBABytes / source.totals[128].nativeRGBABytes).toBeLessThan(0.063);
    expect(source.totals[64].nativeRGBABytes / source.totals[128].nativeRGBABytes).toBeLessThan(0.251);
  });

  it('preserves thin opaque features and never trims the transparent canvas', async () => {
    const width = 384, height = 128, raw = new Uint8Array(width * height * 4);
    for (let x = 0; x < width; x++) raw.set([220, 40, 10, 255], (64 * width + x) * 4);
    const input = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
    for (const size of [32, 64] as const) {
      const first = await generateOverview(input, size), second = await generateOverview(input, size), info = await overviewPixels(first);
      expect(first).toEqual(second); expect(info.width).toBe(size); expect(info.height).toBe(Math.round(height * size / width));
      expect(info.nonzeroAlpha).toBeGreaterThan(0); expect(info.zeroAlpha).toBeGreaterThan(0); expect(info.maxAlpha).toBeGreaterThan(0);
    }
  });

  it('does not introduce an opaque background or quantize the resized RGBA palette', async () => {
    const width = 384, height = 192, raw = new Uint8Array(width * height * 4);
    for (let y = 40; y < 152; y++) for (let x = 60; x < 324; x++) raw.set([193, 41, 97, 255], (y * width + x) * 4);
    const input = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
    for (const size of [32, 64] as const) {
      const output = await generateOverview(input, size);
      const actual = await sharp(output).ensureAlpha().raw().toBuffer();
      const expected = await sharp(input).toColourspace('srgb').ensureAlpha().resize({ width: size, height: size, fit: 'inside', kernel: 'lanczos3', withoutEnlargement: true }).raw().toBuffer();
      expect(actual.length).toBe(expected.length);
      for (let i = 0; i < actual.length; i += 4) {
        expect(actual[i + 3]).toBe(expected[i + 3]);
        if (actual[i + 3]) expect([...actual.subarray(i, i + 3)]).toEqual([...expected.subarray(i, i + 3)]);
      }
    }
  });

  it('reproduces real source derivatives and retains every pinned source hash', async () => {
    for (const code of ['blujay', 'norcar', 'houspa', 'monpar', 'amecro', 'snoowl1', 'scamac1']) {
      const asset = lock.assets.find((row: {code: string}) => row.code === code);
      for (const original of asset.files) expect(sha256(readFileSync(original.path))).toBe(original.sha256);
      const original = asset.files.find((row: {longSide: number}) => row.longSide === 384), bytes = readFileSync(original.path);
      for (const size of [32, 64] as const) {
        expect(sha256(await generateOverview(bytes, size))).toBe(source.files[code][size].sha256);
        expect(sha256(readFileSync(source.files[code][size].path))).toBe(source.files[code][size].sha256);
        const info = await overviewPixels(readFileSync(source.files[code][size].path));
        expect([info.width, info.height, info.zeroAlpha, info.nonzeroAlpha]).toEqual([source.files[code][size].width, source.files[code][size].height, source.files[code][size].zeroAlpha, source.files[code][size].nonzeroAlpha]);
      }
    }
  });
});
