import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import type { Taxon } from '../types';
import type { TreeCanvasHandle, ViewInfo } from '../tree/TreeCanvas';
import type { StickerGeometryData, StickerMask } from '../embedding/sticker-types';
import type { EmbeddingResult } from '../embedding/types';
import type { StickerCollisionMasksFile } from '../embedding/collision-masks';
import { leaderSegments, placeAnnotation, type AnnotationRect } from '../tree/radial-sticker-placement';
import { startStickerPacking, type StickerPackingInput, type StickerPackingResult } from '../embedding/sticker-packing-client';
import { ArtworkCache, ArtworkVariantBatch, type ArtworkMetrics } from '../tree/artwork-cache';
import type { ArtworkImage } from '../tree/artwork-image-loader';
import { createArtworkCache } from '../tree/sticker-delivery';
import { ArtworkResolver, artworkRequests, readyArtwork, grayscaleArtwork } from '../tree/artwork-resolution';
import { themeColors, FONT, DISPLAY_FONT } from '../tree/visual-theme';
import { exportCredits } from '../sources';
import { useResolvedTheme } from '../theme';
import type { CenterReserve } from '../embedding/sticker-packing';
import { mapCountReserve, projectCountReserve } from './map-count-layout';
import './ClusterCanvas.css';

export interface ClusterPoint { code: string; x: number; y: number; sourceGroup?: string }
export type StickerPlacementMode = 'original' | 'limited' | 'full';
export interface ClusterCanvasProps {
  points: ClusterPoint[];
  embeddingMetadata?: EmbeddingResult['metadata'];
  taxa: Taxon[];
  stickerGeometry?: StickerGeometryData;
  collisionMasks?: StickerCollisionMasksFile;
  sizeMode?: 'even' | 'true';
  placementMode?: StickerPlacementMode;
  movementLimit?: number;
  portraitScale?: number;
  /** Full country collection's placement gaps; visibleCodes filters the tray. */
  unplacedTaxa?: Taxon[];
  visibleCodes?: Set<string>;
  /** Taxonomy emphasis only; membership, packing and camera are unchanged. */
  highlightedCodes?: Set<string>;
  highlightedLabel?: string;
  selectedCode: string | null;
  onSelect: (code: string) => void;
  focusCodes?: string[] | null;
  onViewChange?: (info: ViewInfo) => void;
  onArtworkStatus?: (status: ArtworkMetrics) => void;
  credits?: string;
  className?: string;
}
interface Size { width: number; height: number }
interface Bounds { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number }
interface Geometry { width: number; height: number; mask: StickerMask; bits: Uint8Array }
interface DisplayPoint extends Geometry { code: string; x: number; y: number; taxon: Taxon; unplaced: boolean; sourceGroup?: string; anchorX?: number; anchorY?: number }
interface HitBox { point: DisplayPoint; x: number; y: number; width: number; height: number }
const EMPTY_TAXA: Taxon[] = [];
const OPAQUE_MASK: StickerMask = [24, 24, '/'.repeat(96)];
const HUD_HEIGHT = 0;
const viewCenter = (size: Size) => ({ x: size.width / 2, y: (size.height + HUD_HEIGHT) / 2 });

function boundsOf(points: Array<{ x: number; y: number; width: number; height: number }>): Bounds {
  if (!points.length) return { minX: -1, maxX: 1, minY: -1, maxY: 1, width: 2, height: 2 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x - p.width / 2); maxX = Math.max(maxX, p.x + p.width / 2); minY = Math.min(minY, p.y - p.height / 2); maxY = Math.max(maxY, p.y + p.height / 2); }
  return { minX, minY, maxX, maxY, width: Math.max(0.001, maxX - minX), height: Math.max(0.001, maxY - minY) };
}
function decodeMask(mask: StickerMask): Uint8Array {
  try { return Uint8Array.from(atob(mask[2]), c => c.charCodeAt(0)); }
  catch { return new Uint8Array(Math.ceil(mask[0] * mask[1] / 8)).fill(255); }
}
function alphaHit(hit: HitBox, x: number, y: number): boolean {
  if (x < hit.x || y < hit.y || x >= hit.x + hit.width || y >= hit.y + hit.height) return false;
  const [w, h] = hit.point.mask;
  const index = Math.min(h - 1, Math.floor((y - hit.y) / hit.height * h)) * w + Math.min(w - 1, Math.floor((x - hit.x) / hit.width * w));
  return Boolean(hit.point.bits[index >> 3] & (1 << (7 - (index & 7))));
}
function wrappedLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines:string[]=[];
  let line='';
  for(const word of text.trim().split(/\s+/).filter(Boolean)){
    if(line&&ctx.measureText(`${line} ${word}`).width>width){lines.push(line);line='';}
    if(ctx.measureText(word).width<=width){line=line?`${line} ${word}`:word;continue;}
    // Source URLs can be longer than a phone-width line; retain every character.
    let piece='';
    for(const character of word){
      if(piece&&ctx.measureText(piece+character).width>width){lines.push(piece);piece='';}
      piece+=character;
    }
    line=piece;
  }
  if(line)lines.push(line);
  return lines;
}
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number): number {
  const lines=wrappedLines(ctx,text,width);
  for(const line of lines){ctx.fillText(line,x,y);y+=lineHeight;}
  return y;
}

/** Portrait spacing is a display layer. It never overwrites the fitted coordinates. */
export const ClusterCanvas = forwardRef<TreeCanvasHandle, ClusterCanvasProps>(function ClusterCanvas({
  points, embeddingMetadata, taxa, stickerGeometry, collisionMasks, sizeMode = 'even', placementMode = 'full', movementLimit = 0.25, portraitScale = 1, unplacedTaxa = EMPTY_TAXA, visibleCodes, highlightedCodes, highlightedLabel, selectedCode, onSelect, focusCodes, onViewChange, onArtworkStatus, credits, className,
}, forwardedRef) {
  const theme=useResolvedTheme(),colors=themeColors(theme);
  const colorsRef=useRef(colors);colorsRef.current=colors;
  const canvasRef = useRef<HTMLCanvasElement>(null), wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 800, height: 700 });
  const sizeRef = useRef(size); sizeRef.current = size;
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null), baseScaleRef = useRef(1);
  const frameRef = useRef(0), drawRef = useRef<() => void>(() => {});
  const sceneRef = useRef<(ctx: CanvasRenderingContext2D, viewSize: Size, transform: ZoomTransform,flushVariants?:boolean) => number>(() => 0);
  const artworkResolverRef = useRef(new ArtworkResolver());
  const cacheRef = useRef<ArtworkCache<ArtworkImage> | null>(null), hitBoxesRef = useRef<HitBox[]>([]);
  const hoveredCodeRef = useRef<string | null>(null), focusLabelRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const onViewChangeRef = useRef(onViewChange); onViewChangeRef.current = onViewChange;
  const onArtworkStatusRef = useRef(onArtworkStatus); onArtworkStatusRef.current = onArtworkStatus;
  const artworkStatusKeyRef = useRef(''), reportTimeRef = useRef(0), reportTimerRef = useRef(0);
  const viewInfoRef = useRef<ViewInfo>({ zoom: 1, visibleSpecies: 0, focusLabel: null });
  const taxaByCode = useMemo(() => new Map(taxa.map(taxon => [taxon.code, taxon])), [taxa]);
  const prepared = useMemo(() => {
    const valid = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && taxaByCode.has(p.code));
    const mappedCodes = new Set(valid.map(p => p.code));
    const gaps = unplacedTaxa.filter(taxon => !mappedCodes.has(taxon.code)).sort((a, b) => a.code.localeCompare(b.code));
    const allTaxa = [...valid.map(p => taxaByCode.get(p.code)!), ...gaps];
    const masses = allTaxa.map(t => stickerGeometry?.species[t.code]?.massG).filter((mass): mass is number => typeof mass === 'number' && Number.isFinite(mass) && mass > 0);
    const lightest = masses.length ? Math.max(0.1, Math.min(...masses)) : 20, exponent = sizeMode === 'true' ? 1 / 3 : 0.2, shapeRef = stickerGeometry?.shapeRef || 215 / 576;
    let missingGeometry = 0;
    const geometries = new Map<string, Geometry>();
    for (const taxon of allTaxa) {
      const source = stickerGeometry?.species[taxon.code]; if (!source) missingGeometry++;
      const mass = source?.massG && source.massG > 0 ? Math.max(0.1, source.massG) : 20, mask = source?.mask || OPAQUE_MASK;
      const L = Math.pow(mass / lightest, exponent) * Math.sqrt(shapeRef / Math.max(0.05, source?.shape || shapeRef));
      geometries.set(taxon.code, { width: L * mask[0] / 24, height: L * mask[1] / 24, mask, bits: decodeMask(mask) });
    }
    const input: StickerPackingInput[] = valid.map(p => { const shape = geometries.get(p.code)!; return { code: p.code, x: p.x, y: p.y, width: shape.width, height: shape.height, mask: collisionMasks?.species[p.code] || OPAQUE_MASK }; });
    return { input, valid, gaps, geometries, missingGeometry, lightest };
  }, [points, taxaByCode, unplacedTaxa, stickerGeometry, collisionMasks, sizeMode]);
  const maxDisplacement = placementMode === 'original' ? 0 : placementMode === 'limited' ? movementLimit : undefined;
  const packingOptions = useMemo(() => ({ maxDisplacement, stickerScale: portraitScale, reserveCenter: placementMode === 'full' }), [maxDisplacement, portraitScale, placementMode]);
  const [packing, setPacking] = useState<{ input: StickerPackingInput[]; options: typeof packingOptions; result: StickerPackingResult } | null>(null);
  const [packingProgress, setPackingProgress] = useState(0), [packingError, setPackingError] = useState('');
  const packingPromiseRef = useRef<Promise<StickerPackingResult> | null>(null);
  const packed = packing?.input === prepared.input && packing.options === packingOptions ? packing.result : null;
  const placementLabel = placementMode === 'original' ? 'Original positions' : placementMode === 'limited' ? 'Limited movement' : 'Full packing';
  const isMds = embeddingMetadata?.method === 'umap-mds';
  const algorithmLabel = embeddingMetadata?.method === 'small-collection' ? 'Small collection' : embeddingMetadata?.method === 'degenerate-distance' ? 'Unscaled map' : isMds ? 'MDS from UMAP' : 'UMAP';
  const placementNote = placementMode === 'original' ? `Original ${algorithmLabel} positions; stickers may overlap.` : placementMode === 'limited' ? `Movement capped at ${movementLimit} sticker lengths; overlaps may remain.` : 'Positions adjusted to avoid sticker overlaps.';
  useEffect(() => {
    let active = true; setPackingProgress(0); setPackingError('');
    const run = startStickerPacking(prepared.input, { ...packingOptions, onProgress: (completed, total) => { if (active) setPackingProgress(completed / Math.max(1, total)); } });
    packingPromiseRef.current = run.promise;
    run.promise.then(result => { if (active) setPacking({ input: prepared.input, options: packingOptions, result }); }).catch(error => { if (active && !(error instanceof Error && error.name === 'AbortError')) setPackingError(error instanceof Error ? error.message : 'Sticker packing failed.'); });
    return () => { active = false; run.cancel(); };
  }, [prepared.input, packingOptions]);
  const layout = useMemo(() => {
    if (!packed) return { all: [] as DisplayPoint[], bounds: boundsOf([]), trayTop: null as number | null, centerReserve: undefined as CenterReserve | undefined };
    const originals = new Map(prepared.valid.map(p => [p.code, p]));
    const geometryFor = (code: string): Geometry => { const g = prepared.geometries.get(code)!; return { ...g, width: g.width * portraitScale, height: g.height * portraitScale }; };
    const mapped: DisplayPoint[] = packed.points.map(p => ({ code: p.code, x: p.x, y: p.y, ...prepared.geometries.get(p.code)!, width: p.width, height: p.height, anchorX: p.displayAnchorX, anchorY: p.displayAnchorY, sourceGroup: originals.get(p.code)?.sourceGroup, taxon: taxaByCode.get(p.code)!, unplaced: false }));
    const centerReserve=mapCountReserve(packed.centerReserve,mapped.length,prepared.gaps.map(taxon=>geometryFor(taxon.code)));
    const reserved=centerReserve?[centerReserve]:[];
    const mappedBounds = boundsOf([...mapped,...reserved]), sizes = [...prepared.geometries.values()].map(g => Math.max(g.width, g.height) * portraitScale);
    const average = sizes.reduce((sum, value) => sum + value, 0) / Math.max(1, sizes.length) || 1, gap = average * 0.35;
    const tray: DisplayPoint[] = []; let trayTop: number | null = null;
    if (prepared.gaps.length) {
      const targetWidth = Math.max(mapped.length ? mappedBounds.width : 0, Math.sqrt(prepared.gaps.reduce((sum, taxon) => { const g = geometryFor(taxon.code); return sum + g.width * g.height; }, 0)) * 2, average * 4);
      const rows: Array<{ items: Taxon[]; width: number; height: number }> = [];
      for (const taxon of prepared.gaps) { const g = geometryFor(taxon.code); let row = rows.at(-1); if (!row || row.width + g.width + gap > targetWidth) { row = { items: [], width: 0, height: 0 }; rows.push(row); } row.width += (row.items.length ? gap : 0) + g.width; row.height = Math.max(row.height, g.height); row.items.push(taxon); }
      const centerX = mapped.length ? (mappedBounds.minX + mappedBounds.maxX) / 2 : 0; trayTop = mapped.length || reserved.length ? mappedBounds.maxY + average * 1.6 : 0; let top = trayTop + average;
      for (const row of rows) { let left = centerX - row.width / 2; for (const taxon of row.items) { const g = geometryFor(taxon.code); tray.push({ code: taxon.code, taxon, ...g, x: left + g.width / 2, y: top + row.height / 2, unplaced: true }); left += g.width + gap; } top += row.height + gap; }
    }
    const all = [...mapped, ...tray], bounds = boundsOf([...all,...reserved]); if (trayTop !== null) { bounds.minY = Math.min(bounds.minY, trayTop - average * 0.4); bounds.height = bounds.maxY - bounds.minY; }
    return { all, bounds, trayTop, centerReserve };
  }, [packed, prepared, taxaByCode, portraitScale]);
  const displayed = useMemo(() => layout.all.filter(p => !visibleCodes || visibleCodes.has(p.code) || p.code === selectedCode), [layout, visibleCodes, selectedCode]);
  const memberCount = highlightedCodes ? displayed.filter(point => highlightedCodes.has(point.code)).length : 0;
  // An explicit group remains selected even when it contains the entire map or
  // has no members in the current country. Undefined alone clears emphasis.
  const highlightActive = highlightedCodes !== undefined;
  const highlightedCount = highlightActive ? memberCount : 0;
  const highlightDescription = highlightActive ? `${highlightedCount.toLocaleString()} of ${displayed.length.toLocaleString()} species highlighted${highlightedLabel ? ` in ${highlightedLabel}` : ''}; other birds are gray but remain in the map.` : `${displayed.length.toLocaleString()} species in the map; all birds use their normal colors.`;
  const pointByCode = useMemo(() => new Map(layout.all.map(p => [p.code, p])), [layout]);
  const requestDraw = useCallback(() => { if (!frameRef.current) frameRef.current = requestAnimationFrame(() => { frameRef.current = 0; drawRef.current(); }); }, []);
  const getCache = useCallback(() => { if (!cacheRef.current) cacheRef.current = createArtworkCache(requestDraw); return cacheRef.current; }, [requestDraw]);

  sceneRef.current = (ctx, viewSize, transform,flushVariants=false) => {
    const { width, height } = viewSize, cache = getCache();
    const isHighlighted = (point: DisplayPoint) => highlightActive && highlightedCodes!.has(point.code);
    const priority = (point: DisplayPoint) => point.code === selectedCode ? 3 : point.code === hoveredCodeRef.current ? 2 : isHighlighted(point) ? 1 : 0;
    const plans = displayed.map(point => { const imageWidth = point.width * transform.k, imageHeight = point.height * transform.k; return { point, width: imageWidth, height: imageHeight, x: point.x * transform.k + transform.x - imageWidth / 2, y: point.y * transform.k + transform.y - imageHeight / 2, artwork: artworkResolverRef.current.select(point.taxon, Math.max(imageWidth, imageHeight), Math.min(2, window.devicePixelRatio || 1)) }; }).filter(p => p.x + p.width >= 0 && p.y + p.height >= HUD_HEIGHT && p.x <= width && p.y <= height)
      .sort((a, b) => priority(a.point) - priority(b.point) || b.width * b.height - a.width * a.height || a.point.code.localeCompare(b.point.code));
    // During a pending pack, keep the previous ready set instead of evicting it.
    if (packed || !prepared.valid.length && !prepared.gaps.length) cache.setWanted(plans.flatMap(p => artworkRequests(cache, p.artwork, p.point.code === selectedCode ? 1000 : p.point.code === hoveredCodeRef.current ? 900 : 300, highlightActive && !isHighlighted(p.point) ? ['gray'] : [])));
    ctx.save(); ctx.fillStyle = colors.paper; ctx.fillRect(0, 0, width, height); ctx.beginPath(); ctx.rect(0, HUD_HEIGHT, width, Math.max(0, height - HUD_HEIGHT)); ctx.clip();
    if (displayed.some(p => p.unplaced) && layout.trayTop !== null) {
      const y = layout.trayTop * transform.k + transform.y, x = layout.bounds.minX * transform.k + transform.x, right = layout.bounds.maxX * transform.k + transform.x;
      ctx.strokeStyle = colors.ring; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(right, y); ctx.stroke(); ctx.font = `10px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = 'Without a source placement · shown separately', labelWidth = ctx.measureText(label).width; ctx.fillStyle = colors.paper; ctx.fillRect(width / 2 - labelWidth / 2 - 7, y - 10, labelWidth + 14, 20); ctx.fillStyle = colors.label; ctx.fillText(label, width / 2, y);
    }
    const tileRects = plans.map(p => ({ x: p.x, y: p.y, width: p.width, height: p.height }));
    const countReserve=layout.centerReserve;
    const countBox=countReserve?projectCountReserve(countReserve,transform):undefined;
    const annotations: AnnotationRect[] = countBox?[countBox]:[];
    const leaderObstacles=[...tileRects,...annotations];
    for (const plan of plans.filter(p => p.point.code === selectedCode || p.point.code === hoveredCodeRef.current)) {
      const { point } = plan;
      if (point.anchorX === undefined || point.anchorY === undefined) continue;
      const ax = point.anchorX * transform.k + transform.x, ay = point.anchorY * transform.k + transform.y;
      const cx = point.x * transform.k + transform.x, cy = point.y * transform.k + transform.y;
      if (Math.hypot(ax - cx, ay - cy) < 2) continue;
      ctx.strokeStyle = colors.accent; ctx.lineWidth = 0.8; ctx.setLineDash([3, 3]); ctx.beginPath(); for (const segment of leaderSegments({ x: ax, y: ay }, { x: cx, y: cy }, leaderObstacles)) { ctx.moveTo(segment.start.x, segment.start.y); ctx.lineTo(segment.end.x, segment.end.y); } ctx.stroke(); ctx.setLineDash([]);
      if (!leaderObstacles.some(rect => ax >= rect.x - 3 && ax <= rect.x + rect.width + 3 && ay >= rect.y - 3 && ay <= rect.y + rect.height + 3)) { ctx.beginPath(); ctx.arc(ax, ay, 2, 0, Math.PI * 2); ctx.stroke(); }
    }
    let drawableSpecies = 0, graySpecies = 0;
    const grayBatch=new ArtworkVariantBatch(cache,flushVariants?Infinity:4);
    for (const plan of plans) {
      const { point, x, y } = plan, entry = readyArtwork(cache, plan.artwork);
      const neutral = highlightActive && !isHighlighted(point);
      ctx.save(); ctx.globalAlpha = neutral ? 0.35 : 1;
      if (entry) {
        const gray=neutral?grayBatch.get(entry.key,'gray',grayscaleArtwork,canvas=>canvas.width*canvas.height*4):undefined;
        // New conversions are spread over frames; every source remains drawable.
        const image=gray||entry.value;
        ctx.drawImage(image,x,y,plan.width,plan.height);drawableSpecies++;if(gray)graySpecies++;
      }
      else { const cx = x + plan.width / 2, cy = y + plan.height / 2, radius = Math.max(1, Math.min(8, plan.width * 0.22, plan.height * 0.22)); ctx.strokeStyle = colors.line; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.ellipse(cx, cy, radius * 0.6, radius, 0.6, 0, Math.PI * 2); if (plan.artwork.key && ['loading', 'queued'].includes(cache.peek(plan.artwork.key)?.state || '')) ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]); }
      ctx.restore();
    }
    if(grayBatch.pendingCount)requestDraw();
    if(canvasRef.current){canvasRef.current.dataset.artworkGrayPending=String(grayBatch.pendingCount);canvasRef.current.dataset.artworkGrayCreateMs=grayBatch.elapsedMs.toFixed(2);canvasRef.current.dataset.artworkGrayCreated=String(grayBatch.createdCount);canvasRef.current.dataset.artworkGrayFailed=String(grayBatch.failedCount);}
    for (const plan of plans.filter(p => p.point.code === selectedCode || p.point.code === hoveredCodeRef.current)) {
      const selected = plan.point.code === selectedCode, source = plan.point.sourceGroup, shared = source ? displayed.filter(p => !p.unplaced && p.sourceGroup === source).length : 1;
      const secondary = plan.point.unplaced ? 'No phylogenetic source placement' : shared > 1 ? `${shared} species share the source concept` : ''; ctx.font = `${selected ? '600 ' : ''}12px ${FONT}`;
      const labelWidth = Math.min(width - 24, Math.max(ctx.measureText(plan.point.taxon.commonName).width, secondary ? ctx.measureText(secondary).width : 0) + 18), labelHeight = secondary ? 42 : 24;
      const label = placeAnnotation({ width, height, anchor: plan, boxWidth: labelWidth, boxHeight: labelHeight, occupied: [{ x: 0, y: 0, width, height: HUD_HEIGHT }, ...tileRects, ...annotations] });
      if (!label) continue;
      annotations.push(label); const labelX = label.x, labelY = label.y;
      ctx.fillStyle = colors.paper; ctx.fillRect(labelX, labelY, labelWidth, labelHeight); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = selected ? colors.accent : colors.ink; ctx.fillText(plan.point.taxon.commonName, labelX + labelWidth / 2, labelY + 12, labelWidth - 12);
      if (secondary) { ctx.font = `10px ${FONT}`; ctx.fillStyle = colors.label; ctx.fillText(secondary, labelX + labelWidth / 2, labelY + 30, labelWidth - 12); }
    }
    let countFont=0;
    if (countBox) {
      const cx=countBox.x+countBox.width/2,cy=countBox.y+countBox.height/2;
      countFont=Math.min(32,countBox.height*.48);
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=colors.ink;ctx.font=`600 ${countFont}px ${FONT}`;
      ctx.fillText(displayed.length.toLocaleString(),cx,cy-Math.min(countBox.height*.16,12),countBox.width*.86);
      ctx.fillStyle=colors.label;ctx.font=`${Math.min(11,countBox.height*.18)}px ${FONT}`;
      ctx.fillText('species',cx,cy+Math.min(countBox.height*.19,16),countBox.width*.86);
      if(highlightActive){ctx.fillStyle=colors.accent;ctx.font=`${Math.min(9,countBox.height*.14)}px ${FONT}`;ctx.fillText(`${highlightedCount.toLocaleString()} highlighted`,cx,cy+Math.min(countBox.height*.39,31),countBox.width*.9);}
    } else if (packed && !displayed.length) {ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`13px ${FONT}`;ctx.fillStyle=colors.label;ctx.fillText('No birds in this selection.',width/2,height/2);}
    ctx.restore();
    hitBoxesRef.current = plans.map(p => ({ point: p.point, x: p.x, y: p.y, width: p.width, height: p.height }));
    if (canvasRef.current) { canvasRef.current.dataset.speciesStickers = String(plans.length); canvasRef.current.dataset.visiblePoints = String(plans.filter(p => !p.point.unplaced).length); canvasRef.current.dataset.visibleUnplaced = String(plans.filter(p => p.point.unplaced).length); canvasRef.current.dataset.hoveredSpecies = hoveredCodeRef.current || ''; canvasRef.current.dataset.annotationBoxes = JSON.stringify(annotations); canvasRef.current.dataset.hudHeight = String(HUD_HEIGHT); canvasRef.current.dataset.artworkDrawableSpecies = String(drawableSpecies); canvasRef.current.dataset.artworkGraySpecies = String(graySpecies); canvasRef.current.dataset.groupHighlightBoxes = '0'; }
    if(canvasRef.current){canvasRef.current.dataset.centerCount=String(displayed.length);canvasRef.current.dataset.centerCountBox=JSON.stringify(countBox||null);canvasRef.current.dataset.centerCountFontPx=String(countFont);canvasRef.current.dataset.centerReserve=JSON.stringify(countReserve||null);}
    return plans.length;
  };
  drawRef.current = () => {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d'); if (!canvas || !ctx) return; const ratio = Math.min(2, window.devicePixelRatio || 1), current = sizeRef.current;
    if (canvas.width !== Math.round(current.width * ratio) || canvas.height !== Math.round(current.height * ratio)) { canvas.width = Math.round(current.width * ratio); canvas.height = Math.round(current.height * ratio); }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); const began = performance.now(), visibleSpecies = sceneRef.current(ctx, current, transformRef.current); canvas.dataset.renderTheme = theme; canvas.dataset.renderMs = (performance.now() - began).toFixed(2);
    const { x, y, k } = transformRef.current; canvas.dataset.viewTransform = JSON.stringify({ x, y, k });
    const art = getCache().metrics(); canvas.dataset.artworkDecodedBytes = String(art.decodedBytes); canvas.dataset.artworkVisibleDecodedBytes = String(art.visibleDecodedBytes); canvas.dataset.artworkVariantBytes = String(art.variantBytes); canvas.dataset.artworkVisibleTiers = JSON.stringify(art.visibleTiers); canvas.dataset.artworkOverBudgetBytes = String(art.overBudgetBytes); canvas.dataset.artworkQueued = String(art.queued); canvas.dataset.artworkActive = String(art.active); canvas.dataset.artworkReady = String(art.ready); canvas.dataset.artworkFailed = String(art.failed); canvas.dataset.artworkVisibleReady = String(art.visibleReady); canvas.dataset.artworkVisiblePending = String(art.visibleQueued + art.visibleActive); canvas.dataset.artworkVisibleFailed = String(art.visibleFailed);
    const key = [art.queued, art.active, art.ready, art.failed, art.visibleQueued, art.visibleActive, art.visibleReady, art.visibleFailed].join(':'); if (key !== artworkStatusKeyRef.current) { artworkStatusKeyRef.current = key; onArtworkStatusRef.current?.(art); }
    canvas.dataset.artworkDelivery = JSON.stringify(art.delivery || {});
    viewInfoRef.current = { zoom: transformRef.current.k / baseScaleRef.current, visibleSpecies, focusLabel: focusLabelRef.current }; const now = performance.now();
    if (now - reportTimeRef.current >= 100) { reportTimeRef.current = now; clearTimeout(reportTimerRef.current); reportTimerRef.current = 0; onViewChangeRef.current?.(viewInfoRef.current); } else if (!reportTimerRef.current) reportTimerRef.current = window.setTimeout(() => { reportTimerRef.current = 0; reportTimeRef.current = performance.now(); onViewChangeRef.current?.(viewInfoRef.current); }, 100 - (now - reportTimeRef.current));
  };
  const setTransform = useCallback((transform: ZoomTransform) => { if (canvasRef.current && zoomRef.current) select(canvasRef.current).call(zoomRef.current.transform, transform); }, []);
  const fittedScale = useCallback((bounds: Bounds, current: Size) => Math.max(0.0001, Math.min(Math.max(20, current.width - 40) / bounds.width, Math.max(20, current.height - HUD_HEIGHT - 40) / bounds.height)), []);
  const reset = useCallback(() => { const current = sizeRef.current, center = viewCenter(current), bounds = layout.bounds, k = fittedScale(bounds, current); baseScaleRef.current = k; focusLabelRef.current = null; zoomRef.current?.scaleExtent([k * 0.4, k * 200]); setTransform(zoomIdentity.translate(center.x - (bounds.minX + bounds.maxX) / 2 * k, center.y - (bounds.minY + bounds.maxY) / 2 * k).scale(k)); }, [layout.bounds, fittedScale, setTransform]);
  const focusClade = useCallback((codes: string[]) => { const members = codes.flatMap(code => pointByCode.has(code) ? [pointByCode.get(code)!] : []); if (!members.length) return; const bounds = boundsOf(members), current = sizeRef.current, center = viewCenter(current), k = Math.min(baseScaleRef.current * 200, fittedScale(bounds, current) * 0.88); focusLabelRef.current = `${members.length.toLocaleString()} birds in the selected group`; setTransform(zoomIdentity.translate(center.x - (bounds.minX + bounds.maxX) / 2 * k, center.y - (bounds.minY + bounds.maxY) / 2 * k).scale(k)); }, [pointByCode, fittedScale, setTransform]);
  const focusSpecies = useCallback((code: string) => { const point = pointByCode.get(code); if (!point) return; const current = sizeRef.current, center = viewCenter(current), k = Math.max(baseScaleRef.current, Math.min(current.width * 0.27 / point.width, current.height * 0.30 / point.height)); focusLabelRef.current = point.taxon.commonName; setTransform(zoomIdentity.translate(center.x - point.x * k, center.y - point.y * k).scale(k)); }, [pointByCode, setTransform]);
  useEffect(() => { const wrapper = wrapperRef.current; if (!wrapper) return; const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) })); observer.observe(wrapper); return () => observer.disconnect(); }, []);
  useEffect(() => { const canvas = canvasRef.current; if (!canvas) return; const behavior = zoom<HTMLCanvasElement, unknown>().clickDistance(5).extent(() => [[0, 0], [sizeRef.current.width, sizeRef.current.height]]).scaleExtent([0.0001, 100000]).on('zoom', event => { transformRef.current = event.transform; requestDraw(); }); zoomRef.current = behavior; select(canvas).call(behavior); return () => { select(canvas).on('.zoom', null); zoomRef.current = null; cancelAnimationFrame(frameRef.current); frameRef.current = 0; clearTimeout(reportTimerRef.current); }; }, [requestDraw]);
  const fittedSceneRef = useRef<{ input: StickerPackingInput[]; placementMode: StickerPlacementMode; size: Size } | null>(null);
  useEffect(() => {
    if (!packed) return;
    const previous = fittedSceneRef.current;
    if (!previous || previous.input !== prepared.input || previous.placementMode !== placementMode) {
      fittedSceneRef.current = { input: prepared.input, placementMode, size }; reset();
    } else if (previous.size.width !== size.width || previous.size.height !== size.height) {
      // Keep the explored world center and relative zoom when the canvas resizes.
      // In the overview this also keeps the complete packed extent in view.
      const oldCenter = viewCenter(previous.size), nextCenter = viewCenter(size), current = transformRef.current;
      const worldX = (oldCenter.x - current.x) / current.k, worldY = (oldCenter.y - current.y) / current.k;
      const relativeZoom = current.k / baseScaleRef.current, base = fittedScale(layout.bounds, size), k = base * relativeZoom;
      baseScaleRef.current = base; zoomRef.current?.scaleExtent([base * .4, base * 200]);
      fittedSceneRef.current = { ...previous, size };
      setTransform(zoomIdentity.translate(nextCenter.x - worldX * k, nextCenter.y - worldY * k).scale(k));
    } else requestDraw();
  }, [packed, prepared.input, placementMode, size, layout.bounds, fittedScale, setTransform, reset, requestDraw]);
  useEffect(() => { requestDraw(); }, [displayed, highlightedCodes, highlightedLabel, selectedCode, size, placementLabel, placementMode, movementLimit, algorithmLabel, theme, requestDraw]);
  useEffect(() => { if (focusCodes?.length) focusClade(focusCodes); }, [focusCodes, focusClade]);
  useEffect(() => { let active = true; document.fonts.ready.then(() => { if (active) requestDraw(); }); return () => { active = false; }; }, [requestDraw]);
  useEffect(() => () => { cacheRef.current?.dispose(); cacheRef.current = null; }, []);
  useImperativeHandle(forwardedRef, () => ({
    reset, focusSpecies, focusClade,
    zoomIn() { if (canvasRef.current && zoomRef.current) select(canvasRef.current).call(zoomRef.current.scaleBy, 1.65); },
    zoomOut() { if (canvasRef.current && zoomRef.current) select(canvasRef.current).call(zoomRef.current.scaleBy, 1 / 1.65); },
    async exportPng(options = {}) {
      if (!packed) { await packingPromiseRef.current; await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }
      drawRef.current(); await getCache().settleVisible(8000); drawRef.current(); await getCache().settleVisible(8000); const current = sizeRef.current,exportColors=colorsRef.current;
      const caption = 'Bird map · Approximate evolutionary neighborhoods. Portraits spaced to fit.';
      const sourceCredits = `${credits || exportCredits} ${isMds?'Map: metric MDS from UMAP.':'Map: UMAP.'} UMAP: McInnes, Healy and Melville · umap-js by PAIR (MIT) · github.com/PAIR-code/umap-js.`;
      const title=options.title||'phyloBirds · Bird map',textWidth=Math.max(80,current.width-48);
      const output=document.createElement('canvas'),ctx=output.getContext('2d');
      if(!ctx)throw new Error('This browser could not create an export canvas.');
      ctx.font=`600 18px ${DISPLAY_FONT}`;const titleHeight=wrappedLines(ctx,title,textWidth).length*24;
      ctx.font=`11px ${FONT}`;const subtitleHeight=options.subtitle?wrappedLines(ctx,options.subtitle,textWidth).length*15+8:0;
      const captionHeight=wrappedLines(ctx,caption,textWidth).length*14;
      ctx.font=`9px ${FONT}`;const creditHeight=wrappedLines(ctx,sourceCredits,textWidth).length*13;
      const footerHeight=24+titleHeight+subtitleHeight+8+captionHeight+10+creditHeight+24;
      const ratio=Math.min(2,4096/Math.max(current.width,current.height+footerHeight));
      output.width=Math.ceil(current.width*ratio);output.height=Math.ceil((current.height+footerHeight)*ratio);
      ctx.scale(ratio,ratio);sceneRef.current(ctx,current,transformRef.current,true);
      ctx.fillStyle=exportColors.surface;ctx.fillRect(0,current.height,current.width,footerHeight);
      ctx.textAlign='left';ctx.textBaseline='top';ctx.fillStyle=exportColors.ink;ctx.font=`600 18px ${DISPLAY_FONT}`;
      let y=wrapText(ctx,title,24,current.height+24,textWidth,24);
      ctx.font=`11px ${FONT}`;ctx.fillStyle=exportColors.label;
      if(options.subtitle)y=wrapText(ctx,options.subtitle,24,y+8,textWidth,15);
      y=wrapText(ctx,caption,24,y+8,textWidth,14);
      ctx.font=`9px ${FONT}`;wrapText(ctx,sourceCredits,24,y+10,textWidth,13);
      const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(value => value ? resolve(value) : reject(new Error('PNG export failed.')), 'image/png')); const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `phylobirds-bird-neighborhoods-${isMds ? 'mds' : 'umap'}.png`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
  }), [reset, focusSpecies, focusClade, getCache, setTransform, credits, sizeMode, packed, placementLabel, placementNote, portraitScale, algorithmLabel, isMds, highlightDescription]);
  const hitCode = (x: number, y: number) => { if (y < HUD_HEIGHT) return null; for (let index = hitBoxesRef.current.length - 1; index >= 0; index--) if (alphaHit(hitBoxesRef.current[index], x, y)) return hitBoxesRef.current[index].point.code; return null; };
  return <div ref={wrapperRef} className={`cluster-canvas-wrap ${className || ''}`}>
    <canvas ref={canvasRef} tabIndex={0} role="img" aria-label={`${algorithmLabel} bird neighborhoods. ${placementLabel}. ${highlightDescription} ${displayed.filter(p => !p.unplaced).length.toLocaleString()} mapped birds and ${displayed.filter(p => p.unplaced).length} without source placement. Taxonomy selection greys other birds without drawing boxes; every bird and position is retained. ${placementMode==='full'?'The central count includes every species and occupies protected empty space.':'Every portrait is drawn; overlaps may obscure birds.'} ${placementNote} Everybird ${sizeMode === 'true' ? 'true size' : 'evened out'} scaling at ${Math.round(portraitScale * 100)}%. Hover or select a bird for its name. A dashed line connects a shifted bird to its fitted position. Drag to pan, wheel or pinch to zoom. Arrow keys pan, plus and minus zoom, Home resets. The species list provides keyboard selection.`}
      data-theme={theme} data-collision-mask-method={collisionMasks ? 'native-alpha-union' : 'rectangle-fallback'} data-layout-mode={isMds ? 'mds' : 'umap'} data-species-count={displayed.length} data-highlighted-count={highlightedCount} data-highlighted-label={highlightActive ? highlightedLabel : undefined} data-highlight-active={highlightActive} data-mds-iterations={embeddingMetadata?.mds?.iterations} data-mds-initial-stress={embeddingMetadata?.mds?.initialStress} data-mds-stress={embeddingMetadata?.mds?.stress} data-placement-mode={placementMode} data-movement-limit={maxDisplacement ?? 'unlimited'} data-max-actual-displacement={packed?.maxActualDisplacement} data-displaced-count={packed?.displacedCount} data-portrait-scale={portraitScale} data-anchor-scale={packed?.anchorScale} data-time-scale="none" data-embedding-points={points.length} data-filtered-points={displayed.filter(p => !p.unplaced).length} data-unplaced-count={displayed.filter(p => p.unplaced).length} data-all-stickers={displayed.length} data-packing-state={packed ? 'ready' : packingError ? 'error' : 'running'} data-packing-overlaps={packed?.overlapCount} data-packing-ms={packed?.elapsedMs.toFixed(1)} data-packing-cache-source={packed?.cacheSource} data-packing-cache-read-ms={packed?.cacheReadMs?.toFixed(1)} data-packing-load-ms={packed?.loadMs?.toFixed(1)} data-geometry-missing={prepared.missingGeometry} data-size-mode={sizeMode} data-lightest-mass={prepared.lightest} data-packed-bounds={JSON.stringify(layout.bounds)}
      onClick={event => { if (event.defaultPrevented) return; const bounds = event.currentTarget.getBoundingClientRect(), code = hitCode(event.clientX - bounds.left, event.clientY - bounds.top); if (code) onSelectRef.current(code); }}
      onMouseMove={event => { const bounds = event.currentTarget.getBoundingClientRect(), code = hitCode(event.clientX - bounds.left, event.clientY - bounds.top); event.currentTarget.style.cursor = code ? 'pointer' : 'grab'; if (code !== hoveredCodeRef.current) { hoveredCodeRef.current = code; requestDraw(); } }}
      onMouseLeave={() => { if (hoveredCodeRef.current) { hoveredCodeRef.current = null; requestDraw(); } }}
      onKeyDown={event => { const canvas = canvasRef.current, behavior = zoomRef.current; if (!canvas || !behavior) return; if (event.key === 'Home' || event.key === '0') { event.preventDefault(); reset(); } else if (event.key === '+' || event.key === '=') { event.preventDefault(); select(canvas).call(behavior.scaleBy, 1.4); } else if (event.key === '-' || event.key === '_') { event.preventDefault(); select(canvas).call(behavior.scaleBy, 1 / 1.4); } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const step = 65 / transformRef.current.k; select(canvas).call(behavior.translateBy, event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0, event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0); } }}/>
    {!packed && <div className="cluster-packing-state" role="status"><strong>{packingError ? 'Could not arrange these stickers' : placementMode === 'original' ? 'Drawing original positions…' : 'Arranging bird stickers…'}</strong>{packingError ? <p>{packingError}</p> : <progress max="1" value={packingProgress}/>}</div>}
  </div>;
});
