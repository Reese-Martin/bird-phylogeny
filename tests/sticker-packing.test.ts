import { describe, expect, it } from 'vitest';
import { countPackingOverlaps, decodeStickerMask, packStickers, stickerMasksOverlap, type StickerMask, type StickerPackingInput } from '../src/embedding/sticker-packing';

function mask(rows: string[]): StickerMask {
  const width = rows[0].length, bits = rows.join(''), bytes = new Uint8Array(Math.ceil(bits.length / 8));
  [...bits].forEach((value, index) => { if (value === '1') bytes[index >> 3] |= 1 << (7 - (index & 7)); });
  return [width, rows.length, btoa(String.fromCharCode(...bytes))];
}
const leftWing = mask(['1100', '1000', '1100', '1000']);
const rightWing = mask(['0011', '0001', '0011', '0001']);
const bird = (code: string, x = 0, y = 0, width = 1, height = 1): StickerPackingInput => ({ code, x, y, width, height });

describe('Everybird silhouette occupancy', () => {
  it('decodes row-major MSB-first masks without replacing concave geometry with boxes', () => {
    const diagonal = decodeStickerMask(mask(['100', '010', '001']));
    expect([...diagonal.rows]).toEqual([1, 2, 4]);
    expect(diagonal.occupied).toBe(3);
    const a = { ...bird('a'), mask: leftWing }, b = { ...bird('b'), mask: rightWing };
    expect(stickerMasksOverlap(a, b)).toBe(false);
    expect(stickerMasksOverlap(a, { ...b, x: -0.5 })).toBe(true);
  });

  it('handles unequal display scales, exact edge contact, and configured separation', () => {
    const a = bird('a', 0, 0, 2, 2), b = bird('b', 1.5, 0, 1, 1);
    expect(stickerMasksOverlap(a, b)).toBe(false);
    expect(stickerMasksOverlap(a, b, 0.01)).toBe(true);
    expect(stickerMasksOverlap(a, { ...b, x: 1.49 })).toBe(true);
    expect(stickerMasksOverlap(b, { ...a, x: -0.01 })).toBe(false);
  });

  it('rejects corrupt masks and gives unavailable/empty shapes a visible rectangular fallback', () => {
    expect(() => decodeStickerMask([25, 24, 'AA=='])).toThrow('dimensions');
    expect(() => decodeStickerMask([24, 24, 'AA=='])).toThrow('Incomplete');
    expect(stickerMasksOverlap({ ...bird('a'), mask: mask(['00', '00']) }, bird('b'))).toBe(true);
  });

  it('agrees with occupied-cell rectangle intersections at unequal scales and translations', () => {
    const rowsA = ['1001', '1111', '0110'], rowsB = ['011', '010', '111', '001'];
    let state = 42;
    const random = () => ((state = Math.imul(state, 1664525) + 1013904223 >>> 0) / 4294967296);
    const cells = (point: StickerPackingInput, rows: string[]) => rows.flatMap((row, y) => [...row].flatMap((on, x) => on === '1' ? [{ x: point.x - point.width / 2 + x * point.width / row.length, y: point.y - point.height / 2 + y * point.height / rows.length, width: point.width / row.length, height: point.height / rows.length }] : []));
    for (let index = 0; index < 100; index++) {
      const a = { ...bird('a', random() * 3, random() * 3, 0.3 + random() * 3, 0.3 + random() * 3), mask: mask(rowsA) };
      const b = { ...bird('b', random() * 3, random() * 3, 0.3 + random() * 3, 0.3 + random() * 3), mask: mask(rowsB) };
      const gap = 0.025;
      const expected = cells(a, rowsA).some(first => cells(b, rowsB).some(second => first.x < second.x + second.width + gap && first.x + first.width + gap > second.x && first.y < second.y + second.height + gap && first.y + first.height + gap > second.y));
      expect(stickerMasksOverlap(a, b, gap)).toBe(expected);
      expect(stickerMasksOverlap(b, a, gap)).toBe(expected);
    }
  });
});

describe('complete UMAP sticker packing', () => {
  it('places every species, including coincident concepts, without silhouette overlaps', () => {
    const points = Array.from({ length: 160 }, (_, i) => ({ ...bird(`bird-${String(i).padStart(3, '0')}`, (i % 4) * 0.01, (i % 5) * 0.01, 0.8 + i % 7 * 0.22, 0.5 + i % 3 * 0.3), mask: i % 2 ? leftWing : rightWing }));
    const before = structuredClone(points), result = packStickers(points);
    expect(result.points).toHaveLength(points.length);
    expect(new Set(result.points.map(point => point.code)).size).toBe(points.length);
    expect(countPackingOverlaps(result.points)).toBe(0);
    expect(countPackingOverlaps(result.points, result.gap * 0.99)).toBe(0);
    expect(points).toEqual(before);
    for (const point of result.points) {
      const original = points.find(value => value.code === point.code)!;
      expect([point.anchorX, point.anchorY]).toEqual([original.x, original.y]);
      expect(point.displayAnchorX).toBeCloseTo((point.anchorX - result.anchorCenter.x) * result.anchorScale);
      expect(point.x - point.width / 2).toBeGreaterThanOrEqual(result.bounds.minX);
      expect(point.x + point.width / 2).toBeLessThanOrEqual(result.bounds.maxX);
      expect(point.y - point.height / 2).toBeGreaterThanOrEqual(result.bounds.minY);
      expect(point.y + point.height / 2).toBeLessThanOrEqual(result.bounds.maxY);
    }
  });

  it('is deterministic and independent of input ordering', () => {
    const points = Array.from({ length: 20 }, (_, i) => bird(`bird-${i}`, Math.sin(i), Math.cos(i), 1 + i % 3, 1));
    expect(packStickers(points).points).toEqual(packStickers([...points].reverse()).points);
  });

  it('keeps all700 portraits and source anchors while reserving an empty central count slot',()=>{
    const input=Array.from({length:700},(_,i)=>bird(`species-${String(i).padStart(3,'0')}`,Math.sin(i*1.31)*10,Math.cos(i*.73)*9,.6+i%7*.12,.5+i%5*.08));
    const original=structuredClone(input),result=packStickers(input,{reserveCenter:true}),reserve=result.centerReserve!;
    expect(result.points).toHaveLength(700);expect(input).toEqual(original);
    expect(countPackingOverlaps(result.points)).toBe(0);
    for(const point of result.points){
      const source=input.find(p=>p.code===point.code)!;
      expect([point.anchorX,point.anchorY,point.width,point.height]).toEqual([source.x,source.y,source.width,source.height]);
      expect(stickerMasksOverlap({...point,mask:undefined},{code:'count',...reserve},result.gap*.99)).toBe(false);
    }
    expect(result.bounds.minX).toBeLessThanOrEqual(-reserve.width/2);expect(result.bounds.maxX).toBeGreaterThanOrEqual(reserve.width/2);
    const phoneScale=Math.min((319-40)/result.bounds.width,(340-40)/result.bounds.height);
    expect(reserve.height*phoneScale*.48).toBeGreaterThanOrEqual(18);
    expect(packStickers([...input].reverse(),{reserveCenter:true}).points).toEqual(result.points);
  });

  it('reserves count space for empty and single-point maps without inventing a species',()=>{
    const empty=packStickers([],{reserveCenter:true});expect(empty.points).toEqual([]);expect(empty.centerReserve).toBeDefined();
    const single=packStickers([bird('only',10,20)],{reserveCenter:true});expect(single.points).toHaveLength(1);
    expect(stickerMasksOverlap(single.points[0],{code:'count',...single.centerReserve!})).toBe(false);
    expect(()=>packStickers([bird('only')],{reserveCenter:true,maxDisplacement:0})).toThrow('full packing');
  });

  it('keeps relative Everybird dimensions and aspect unchanged while changing only display positions', () => {
    const points = [bird('small', 0, 0, 1, 0.5), bird('large', 0, 0, 8, 3), bird('tall', 0, 0, 2, 5)];
    const result = packStickers(points);
    expect(result.points.map(({ code, width, height }) => [code, width, height])).toEqual([['large', 8, 3], ['small', 1, 0.5], ['tall', 2, 5]]);
    expect(countPackingOverlaps(result.points)).toBe(0);
    expect(result.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it('keeps every original anchor exact at zero movement and reports unavoidable overlap', () => {
    const points = [bird('a', -1, 2), bird('b', -1, 2), bird('c', 5, 7)];
    const result = packStickers(points, { maxDisplacement: 0 });
    for (const point of result.points) expect([point.x, point.y]).toEqual([point.displayAnchorX, point.displayAnchorY]);
    expect(result.displacedCount).toBe(0);
    expect(result.maxActualDisplacement).toBe(0);
    expect(result.overlapCount).toBe(countPackingOverlaps(result.points));
    expect(result.overlapCount).toBeGreaterThan(0);
    expect(result.attempts).toBe(points.length);
  });

  it('bounds each unequal-size sticker independently and retains every bird in saturated islands', () => {
    const points = Array.from({ length: 50 }, (_, i) => bird(`bounded-${i}`, 0, 0, 0.5 + i % 4 * 0.25, 0.5 + i % 3 * 0.25));
    const before = structuredClone(points), cap = 1.5;
    const result = packStickers(points, { maxDisplacement: cap });
    expect(result.points).toHaveLength(points.length);
    expect(new Set(result.points.map(p => p.code)).size).toBe(points.length);
    expect(points).toEqual(before);
    const normalized = result.points.map(p => Math.hypot(p.x - p.displayAnchorX, p.y - p.displayAnchorY) / Math.max(p.width, p.height));
    for (const movement of normalized) expect(movement).toBeLessThanOrEqual(cap + 1e-12);
    expect(result.maxActualDisplacement).toBeCloseTo(Math.max(...normalized));
    expect(result.displacedCount).toBe(normalized.filter(value => value > 1e-10).length);
    expect(result.displacedCount).toBeGreaterThan(0);
    expect(result.overlapCount).toBeGreaterThan(0);
    expect(result.overlapCount).toBe(countPackingOverlaps(result.points));
    expect(result.attempts).toBeLessThanOrEqual(points.length * 513);
    expect(result.points).toEqual(packStickers([...points].reverse(), { maxDisplacement: cap }).points);
  });

  it('tests finite boundary candidates and minimizes sampled collisions before movement', () => {
    const input = [bird('a'), bird('b')];
    const insufficient = packStickers(input, { maxDisplacement: 0.2 });
    expect(insufficient.points.every(p => p.x === p.displayAnchorX && p.y === p.displayAnchorY)).toBe(true);
    expect(insufficient.overlapCount).toBe(1);
    const enough = packStickers(input, { maxDisplacement: 2 });
    expect(enough.overlapCount).toBe(0);
    expect(enough.maxActualDisplacement).toBeLessThanOrEqual(2 + 1e-12);
    expect(enough.attempts).toBeLessThanOrEqual(2 * 513);
  });

  it('changes common sticker size without changing islands or Everybird size ratios', () => {
    const input = [bird('a', -3, 1, 2, 1), bird('b', 2, 5, 8, 3), bird('c', -1, -2, 1, 2)];
    const normal = packStickers(input, { maxDisplacement: 0 });
    const small = packStickers(input, { maxDisplacement: 0, stickerScale: 0.25 });
    expect(small.anchorScale).toBe(normal.anchorScale);
    expect(small.anchorCenter).toEqual(normal.anchorCenter);
    for (const point of small.points) {
      const original = normal.points.find(p => p.code === point.code)!;
      expect([point.x, point.y]).toEqual([original.x, original.y]);
      expect(point.width).toBe(original.width * 0.25);
      expect(point.height).toBe(original.height * 0.25);
    }
    const bounded = packStickers(input, { maxDisplacement: 0.5, stickerScale: 0.25 });
    for (const point of bounded.points) expect(Math.hypot(point.x - point.displayAnchorX, point.y - point.displayAnchorY)).toBeLessThanOrEqual(Math.max(point.width, point.height) * 0.5 + 1e-12);
  });

  it('handles empty/single collections, reports bounds and supports cooperative worker cancellation', () => {
    expect(packStickers([]).points).toEqual([]);
    expect(packStickers([bird('only', 10, -5, 3, 2)]).bounds).toEqual({ minX: -1.5, maxX: 1.5, minY: -1, maxY: 1, width: 3, height: 2 });
    expect(() => packStickers([bird('x')], { checkCancelled: () => { throw new DOMException('Packing cancelled.', 'AbortError'); } })).toThrow('Packing cancelled');
    expect(() => packStickers([bird('x'), bird('x')])).toThrow('Duplicate');
    expect(() => packStickers([bird('x', NaN)])).toThrow('Invalid');
    expect(() => packStickers([bird('x')], { gap: NaN })).toThrow('Invalid');
    for (const maxDisplacement of [-1, NaN, Infinity]) expect(() => packStickers([bird('x')], { maxDisplacement })).toThrow('movement bound');
    for (const stickerScale of [0, -1, NaN, Infinity]) expect(() => packStickers([bird('x')], { stickerScale })).toThrow('size scale');
    let checks = 0;
    expect(() => packStickers(Array.from({ length: 200 }, (_, i) => bird(`cancel-${i}`)), { maxDisplacement: 2, checkCancelled: () => { if (++checks === 5) throw new DOMException('Bounded packing cancelled.', 'AbortError'); } })).toThrow('Bounded packing cancelled');
  });
});
