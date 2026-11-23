import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { StickerGeometryData } from '../../src/embedding/sticker-types';

const measured: StickerGeometryData = JSON.parse(readFileSync('public/data/sticker-geometry.json', 'utf8'));
const source = JSON.parse(readFileSync('data/sticker-geometry-source.json', 'utf8'));
const masses = JSON.parse(readFileSync(source.inputMass.path, 'utf8')).species as Array<{code: string; g: number; gSrc: string}>;

describe('independent Everybird mass source', () => {
  it('retains every bundled source mass and declared imputation', () => {
    for (const row of masses) {
      const geometry = measured.species[row.code];
      if (!geometry) continue;
      expect([geometry.massG, geometry.massSource]).toEqual([row.g, row.gSrc]);
    }
    expect(createHash('sha256').update(readFileSync(source.inputMass.path)).digest('hex')).toBe(source.inputMass.sha256);
  });
});
