/** Decorative packing for UMAP stickers. Source embedding coordinates remain unchanged. */
export type StickerMask = readonly [width: number, height: number, msbBase64: string];
export interface StickerPackingInput { code: string; x: number; y: number; width: number; height: number; mask?: StickerMask }
export interface PackedSticker extends StickerPackingInput {
  anchorX: number; anchorY: number;
  displayAnchorX: number; displayAnchorY: number;
}
export interface PackingBounds { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number }
export interface CenterReserve { x: number; y: number; width: number; height: number }
export interface StickerPackingResult {
  points: PackedSticker[];
  bounds: PackingBounds;
  anchorScale: number;
  anchorCenter: { x: number; y: number };
  gap: number;
  overlapCount: number;
  /** Requested bound in each final sticker's longest-side units; null means unlimited. */
  maxDisplacement: number | null;
  /** Largest actual movement in those same units. */
  maxActualDisplacement: number;
  displacedCount: number;
  stickerScale: number;
  attempts: number;
  elapsedMs: number;
  /** Empty decorative slot for the map count; never a species or a fitted point. */
  centerReserve?: CenterReserve;
}
export interface StickerPackingOptions {
  gap?: number;
  targetCoverage?: number;
  /** Common image-size factor; transformed UMAP anchors remain fixed. */
  stickerScale?: number;
  /** Undefined retains full packing; zero keeps original transformed anchors exactly. */
  maxDisplacement?: number;
  reserveCenter?: boolean;
  checkCancelled?: () => void;
  onProgress?: (completed: number, total: number) => void;
}
export interface DecodedStickerMask { width: number; height: number; rows: Uint32Array; runs: Array<Array<[number, number]>>; occupied: number }
const maskCache = new Map<string, DecodedStickerMask>();

/** Everybird masks are row-major, MSB-first, at most 24 pixels along their long side. */
export function decodeStickerMask(mask: StickerMask): DecodedStickerMask {
  const [width, height, encoded] = mask;
  const key = `${width}:${height}:${encoded}`;
  const cached = maskCache.get(key); if (cached) return cached;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 24 || height > 24) throw new Error('Invalid Everybird sticker mask dimensions.');
  const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
  if (bytes.length < Math.ceil(width * height / 8)) throw new Error('Incomplete Everybird sticker mask.');
  const rows = new Uint32Array(height), runs: DecodedStickerMask['runs'] = [];
  let occupied = 0;
  for (let y = 0; y < height; y++) {
    const rowRuns: Array<[number, number]> = [];
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const index = y * width + x;
      const on = x < width && !!(bytes[index >> 3] & (1 << (7 - (index & 7))));
      if (on) { rows[y] |= 1 << x; occupied++; if (start < 0) start = x; }
      else if (start >= 0) { rowRuns.push([start, x]); start = -1; }
    }
    runs.push(rowRuns);
  }
  const decoded = { width, height, rows, runs, occupied };
  maskCache.set(key, decoded);
  return decoded;
}

const fullMask: DecodedStickerMask = { width: 1, height: 1, rows: new Uint32Array([1]), runs: [[[0, 1]]], occupied: 1 };
interface Prepared extends PackedSticker { decoded: DecodedStickerMask }
const left = (p: StickerPackingInput) => p.x - p.width / 2;
const top = (p: StickerPackingInput) => p.y - p.height / 2;
const maskOf = (point: StickerPackingInput) => {
  const decoded = point.mask ? decodeStickerMask(point.mask) : fullMask;
  return decoded.occupied ? decoded : fullMask;
};

/** Exact intersections of the source mask's occupied rectangles, at arbitrary display scale. */
function masksOverlap(a: StickerPackingInput, am: DecodedStickerMask, b: StickerPackingInput, bm: DecodedStickerMask, gap: number) {
  const al = left(a), at = top(a), bl = left(b), bt = top(b);
  if (al + a.width + gap <= bl || bl + b.width + gap <= al || at + a.height + gap <= bt || bt + b.height + gap <= at) return false;
  const acw = a.width / am.width, ach = a.height / am.height, bcw = b.width / bm.width, bch = b.height / bm.height;
  for (let ay = 0; ay < am.height; ay++) {
    if (!am.rows[ay]) continue;
    const minRow = Math.max(0, Math.floor((at + ay * ach - gap - bt) / bch));
    const maxRow = Math.min(bm.height - 1, Math.ceil((at + (ay + 1) * ach + gap - bt) / bch - 1e-10) - 1);
    for (const [first, end] of am.runs[ay]) {
      const minCol = Math.max(0, Math.floor((al + first * acw - gap - bl) / bcw));
      const maxCol = Math.min(bm.width - 1, Math.ceil((al + end * acw + gap - bl) / bcw - 1e-10) - 1);
      if (minCol > maxCol || minRow > maxRow) continue;
      const columns = ((2 ** (maxCol - minCol + 1) - 1) << minCol) >>> 0;
      for (let by = minRow; by <= maxRow; by++) if (bm.rows[by] & columns) return true;
    }
  }
  return false;
}

export function stickerMasksOverlap(a: StickerPackingInput, b: StickerPackingInput, gap = 0) {
  return masksOverlap(a, maskOf(a), b, maskOf(b), gap);
}

/** Broad phase uses complete tile bounds; narrow phase retains concave alpha occupancy. */
class SpatialGrid {
  private cells = new Map<string, number[]>();
  constructor(private cellSize: number) {}
  private range(point: StickerPackingInput, gap: number) {
    return [Math.floor((left(point) - gap) / this.cellSize), Math.floor((top(point) - gap) / this.cellSize), Math.floor((left(point) + point.width + gap) / this.cellSize), Math.floor((top(point) + point.height + gap) / this.cellSize)];
  }
  insert(point: StickerPackingInput, index: number) {
    const [x0, y0, x1, y1] = this.range(point, 0);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const key = `${x},${y}`, values = this.cells.get(key);
      if (values) values.push(index); else this.cells.set(key, [index]);
    }
  }
  query(point: StickerPackingInput, gap: number) {
    const [x0, y0, x1, y1] = this.range(point, gap), indices = new Set<number>();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (const index of this.cells.get(`${x},${y}`) || []) indices.add(index);
    return indices;
  }
}

function boundsOf(points: StickerPackingInput[]): PackingBounds {
  if (!points.length) return { minX: -1, minY: -1, maxX: 1, maxY: 1, width: 2, height: 2 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) { minX = Math.min(minX, left(point)); minY = Math.min(minY, top(point)); maxX = Math.max(maxX, left(point) + point.width); maxY = Math.max(maxY, top(point) + point.height); }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Useful for verification: tests every nearby pair once without a quadratic full-mask scan. */
export function countPackingOverlaps(points: StickerPackingInput[], gap = 0) {
  if (!points.length) return 0;
  const sizes = points.map(point => Math.max(point.width, point.height)).sort((a, b) => a - b);
  const grid = new SpatialGrid(sizes[Math.floor(sizes.length / 2)] || 1);
  const decoded = points.map(maskOf);
  let overlaps = 0;
  points.forEach((point, index) => {
    for (const other of grid.query(point, gap)) if (masksOverlap(point, decoded[index], points[other], decoded[other], gap)) overlaps++;
    grid.insert(point, index);
  });
  return overlaps;
}

/**
 * Largest-first spiral insertion around scaled UMAP anchors. Every bird receives a
 * position; there is no collision culling or sampling. The layout is decorative,
 * and retains both the raw and transformed anchors for disclosure/leader lines.
 */
export function packStickers(input: readonly StickerPackingInput[], options: StickerPackingOptions = {}): StickerPackingResult {
  const started = performance.now();
  if (options.gap !== undefined && (!Number.isFinite(options.gap) || options.gap < 0)) throw new Error('Invalid sticker packing gap.');
  if (options.targetCoverage !== undefined && !Number.isFinite(options.targetCoverage)) throw new Error('Invalid sticker packing coverage.');
  if (options.maxDisplacement !== undefined && (!Number.isFinite(options.maxDisplacement) || options.maxDisplacement < 0)) throw new Error('Invalid sticker movement bound.');
  if (options.reserveCenter !== undefined && typeof options.reserveCenter !== 'boolean') throw new Error('Invalid center reserve setting.');
  if (options.reserveCenter && options.maxDisplacement !== undefined) throw new Error('A protected center count requires full packing.');
  const stickerScale = options.stickerScale ?? 1;
  if (!Number.isFinite(stickerScale) || stickerScale <= 0) throw new Error('Invalid sticker size scale.');
  const codes = new Set<string>();
  for (const point of input) {
    if (codes.has(point.code)) throw new Error(`Duplicate sticker code: ${point.code}`);
    codes.add(point.code);
    if (![point.x, point.y, point.width, point.height].every(Number.isFinite) || point.width <= 0 || point.height <= 0) throw new Error(`Invalid sticker coordinates or dimensions: ${point.code}`);
  }
  const sizes = input.map(point => Math.max(point.width, point.height)).sort((a, b) => a - b);
  const median = (sizes[Math.floor(sizes.length / 2)] || 1) * stickerScale;
  const gap = Math.max(0, options.gap ?? median * 0.035);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, occupiedArea = 0;
  // Canonical accumulation also keeps floating-point anchor scale independent
  // of the caller's ordering, matching the content-sorted persistent key.
  const prepared = [...input].sort((a,b)=>a.code.localeCompare(b.code,'en')).map(point => {
    const decoded = maskOf(point);
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    occupiedArea += point.width * point.height * decoded.occupied / (decoded.width * decoded.height);
    return { ...point, decoded, anchorX: point.x, anchorY: point.y, displayAnchorX: 0, displayAnchorY: 0 };
  });
  const center = input.length ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : { x: 0, y: 0 };
  const span = Math.max(maxX - minX, maxY - minY);
  const anchorScale = input.length > 1 && span > 1e-12 ? Math.sqrt(occupiedArea / Math.max(0.05, Math.min(0.85, options.targetCoverage ?? 0.42))) / span : 1;
  prepared.forEach(point => {
    point.displayAnchorX = (point.anchorX - center.x) * anchorScale;
    point.displayAnchorY = (point.anchorY - center.y) * anchorScale;
    point.x = point.displayAnchorX; point.y = point.displayAnchorY;
    // Use the original geometry for anchor scale, so image-size tuning cannot
    // rearrange islands. The common factor preserves all mass/shape ratios.
    point.width *= stickerScale; point.height *= stickerScale;
  });
  const largest = sizes.at(-1) || 1;
  const extent = Math.max(input.length > 1 ? span * anchorScale + largest * stickerScale : 0, Math.sqrt(occupiedArea / .42) * stickerScale, median * 4);
  const centerReserve: CenterReserve | undefined = options.reserveCenter ? { x: 0, y: 0, width: extent * .22, height: extent * .18 } : undefined;
  prepared.sort((a, b) => b.width * b.height - a.width * a.height || a.code.localeCompare(b.code, 'en'));
  const placed: Prepared[] = [], grid = new SpatialGrid(median * 1.2);
  let attempts = 0;
  const angle = Math.PI * (3 - Math.sqrt(5));
  let maxActualDisplacement = 0, displacedCount = 0;
  for (const point of prepared) {
    options.checkCancelled?.();
    const step = Math.max(Math.min(point.width, point.height) * 0.38, Math.max(point.width, point.height) * 0.12, gap * 2);
    const bounded = options.maxDisplacement !== undefined;
    const maxRadius = bounded ? options.maxDisplacement! * Math.max(point.width, point.height) : Infinity;
    if (bounded && !Number.isFinite(maxRadius)) throw new Error('Invalid sticker movement radius.');
    // At most 512 off-anchor probes. Include the boundary. Cap zero tests the
    // anchor once, while undefined keeps the original unlimited spiral.
    const lastAttempt = bounded ? Math.min(512, Math.ceil((maxRadius / step) ** 2)) : Infinity;
    let bestCollisions = Infinity, bestX = point.displayAnchorX, bestY = point.displayAnchorY;
    for (let attempt = 0; attempt <= lastAttempt; attempt++) {
      if (attempt % 32 === 0) options.checkCancelled?.();
      const radius = bounded ? lastAttempt ? maxRadius * Math.sqrt(attempt / lastAttempt) : 0 : step * Math.sqrt(attempt);
      point.x = point.displayAnchorX + Math.cos(attempt * angle) * radius;
      point.y = point.displayAnchorY + Math.sin(attempt * angle) * radius;
      attempts++;
      // Count space excludes entire image tiles, including transparent margins.
      let collisions = centerReserve && masksOverlap(point, fullMask, centerReserve as StickerPackingInput, fullMask, gap) ? 1 : 0;
      if (!collisions || bounded) for (const index of grid.query(point, gap)) {
        const other = placed[index];
        if (masksOverlap(point, point.decoded, other, other.decoded, gap)) {
          collisions++;
          if (!bounded || collisions >= bestCollisions) break;
        }
      }
      // Radius increases, so the first equally good candidate requires the
      // least movement. Residual overlap is accepted rather than losing birds.
      if (collisions < bestCollisions) { bestCollisions = collisions; bestX = point.x; bestY = point.y; }
      if (!collisions) break;
    }
    point.x = bestX; point.y = bestY;
    const displacement = Math.hypot(point.x - point.displayAnchorX, point.y - point.displayAnchorY) / Math.max(point.width, point.height);
    maxActualDisplacement = Math.max(maxActualDisplacement, displacement);
    if (displacement > 1e-10) displacedCount++;
    grid.insert(point, placed.length); placed.push(point);
    if (placed.length % 32 === 0 || placed.length === prepared.length) options.onProgress?.(placed.length, prepared.length);
  }
  const points = placed.sort((a, b) => a.code.localeCompare(b.code, 'en')).map(({ decoded: _decoded, ...point }) => point);
  // Report painted-mask overlap, not violations of the desired empty margin.
  const overlapCount = options.maxDisplacement === undefined ? 0 : countPackingOverlaps(points);
  const bounds = boundsOf(centerReserve ? [...points, { code: '__count__', ...centerReserve }] : points);
  return { points, bounds, anchorScale, anchorCenter: center, gap, overlapCount,
    maxDisplacement: options.maxDisplacement ?? null, maxActualDisplacement, displacedCount, stickerScale,
    attempts, elapsedMs: performance.now() - started, ...(centerReserve ? {centerReserve} : {}) };
}
