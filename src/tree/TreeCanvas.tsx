import { forwardRef, useCallback, useEffect, useLayoutEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { quadtree } from 'd3-quadtree';
import type { Taxon, TreeData } from '../types';
import { buildLayout, cladeBounds, collectAncestry, computeTreeVisibility, containsPolarSector, findMonophyleticClade, mappedTipIds, recordedOrderGroups, resizeViewportTransform, type LayoutMode, type LayoutNode } from './geometry';
import type { ArtworkMetrics } from './artwork-cache';
import type { ArtworkImage } from './artwork-image-loader';
import { createArtworkCache } from './sticker-delivery';
import { ArtworkResolver } from './artwork-resolution';
import { drawTreeScene, treeGrowthBranches, treeGrowthPoints, type TreeGrowthReveal, type HitBox, type RendererOrder, type OrderWedge, type RadialPortrait } from './renderer';
import { themeColors, FONT, DISPLAY_FONT } from './visual-theme';
import { useResolvedTheme } from '../theme';
import { colorRadialAngles, compactRadialAngles, radialPortraitSizes, radialStickerLayout, radialViewportFit } from './radial-sticker-placement';
import type { StickerGeometryData, StickerSizeMode } from '../embedding/sticker-types';
import type { StickerColorsFile } from './color-order';
import { branchScale, type BranchScale } from './scale-legend';
import { appendRoundedBranch, buildBranchGrowthPlan, traceBranchGrowth, branchTipProgress } from './branch-growth';
import { createGrowthMotion, updateGrowthMotion, sampleGrowthMotion } from './growth-motion';
import type { SharedArtworkPool, ArtworkClient } from './shared-artwork';

export type ArtworkStatus = ArtworkMetrics;
export type { TreeGrowthReveal } from './renderer';

export interface ViewInfo {
  zoom: number;
  visibleSpecies: number;
  focusLabel: string | null;
  branchScale?: BranchScale;
}

export interface TreeCanvasHandle {
  reset(): void;
  zoomIn(): void;
  zoomOut(): void;
  focusSpecies(code: string): void;
  focusClade(codes: string[]): void;
  exportPng(options?: { title?: string; subtitle?: string }): Promise<void>;
}

export interface TreeCanvasProps {
  tree: TreeData;
  taxa: Taxon[];
  observedCodes: Set<string>;
  /** Recorded taxa surviving the current order/family/genus filter. */
  visibleCodes?: Set<string>;
  /** Reveal dated sightings against the fixed geometry of the complete displayed scope. */
  growth?: TreeGrowthReveal;
  artworkPool?: SharedArtworkPool;
  /** Playback comparison cards use the same scene without inspection gestures. */
  interactive?: boolean;
  backgroundTone?: 'paper'|'surface';
  /** Opt-in source diversity surrounding the personal paths. */
  showAllBranches?: boolean;
  /** Restrict optional background context to the active taxonomic group. */
  backgroundCodes?: Set<string>;
  layoutMode?: LayoutMode;
  sizeMode?: StickerSizeMode;
  showTree?: boolean;
  portraitOrder?: 'phylogeny' | 'color';
  stickerColors?: StickerColorsFile;
  stickerGeometry?: StickerGeometryData;
  focusedOrder?: string | null;
  selectedCode: string | null;
  onSelect: (code: string) => void;
  focusCodes?: string[] | null;
  onViewChange?: (info: ViewInfo) => void;
  onSelectGroup?: (rank: 'order' | 'family' | 'genus', name: string) => void;
  onArtworkStatus?: (status: ArtworkMetrics) => void;
  credits?: string;
  className?: string;
}

interface TipPoint extends LayoutNode { code: string; taxon: Taxon }
interface Size { width: number; height: number }
interface SourceClade { name: string; rank: 'order' | 'family'; nodeId: number; tipCount: number }
interface OverviewClade { name: string; node: number; tipCount: number; recordedCount: number; memberCodes?: string[]; selectedContext?: boolean; backgroundContext?: boolean; rank: 'order' | 'family' | 'genus'; interior?: boolean; angle?: number }

function makePath(tree: TreeData, layout: ReturnType<typeof buildLayout>, subset?: Set<number>) {
  const path = new Path2D();
  // Revealing a personal tree visits its ancestry only, rather than all source nodes.
  for (const id of subset || tree.nodes.keys()) {
    const node=tree.nodes[id];
    if (node.parent === null) continue;
    appendRoundedBranch(path, layout.nodes[node.parent], layout.nodes[node.id]);
  }
  return path;
}

function wrapText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, lineHeight: number) {
  let line = '';
  for (const word of value.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) { ctx.fillText(line, x, y); y += lineHeight; line = word; }
    else line = next;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineHeight;
}

function wrappedLineCount(ctx: CanvasRenderingContext2D, value: string, width: number) {
  let count = 1;
  let line = '';
  for (const word of value.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) { count++; line = word; }
    else line = next;
  }
  return count;
}

export const TreeCanvas = forwardRef<TreeCanvasHandle, TreeCanvasProps>(function TreeCanvas({
  tree, taxa, observedCodes, visibleCodes, growth, artworkPool, backgroundTone='paper', interactive=true, showAllBranches:requestedShowAllBranches = false, backgroundCodes, layoutMode = 'true-distance', sizeMode = 'even', showTree:requestedShowTree = true, portraitOrder='phylogeny',stickerColors,stickerGeometry, focusedOrder, selectedCode:requestedSelectedCode, onSelect, focusCodes, onViewChange, onSelectGroup, onArtworkStatus, credits, className,
}, forwardedRef) {
  const displayedCodes = visibleCodes || observedCodes;
  const showAllBranches=requestedShowAllBranches&&!growth;
  const selectedCode=requestedSelectedCode&&(!growth||displayedCodes.has(requestedSelectedCode)&&growth.revealedCodes.has(requestedSelectedCode))?requestedSelectedCode:null;
  const showTree=requestedShowTree&&portraitOrder==='phylogeny';
  const theme=useResolvedTheme(),palette=themeColors(theme);
  const colors=backgroundTone==='surface'?{...palette,paper:palette.surface}:palette;
  const colorsRef=useRef(colors);colorsRef.current=colors;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 800, height: 700 });
  const sizeRef = useRef(size);
  const previousSizeRef = useRef(size);
  sizeRef.current = size;
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const baseScaleRef = useRef(250);
  const frameRef = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const sceneRef = useRef<(ctx: CanvasRenderingContext2D, viewSize: Size, transform: ZoomTransform) => number>(() => 0);
  const imageCacheRef = useRef<ArtworkClient | null>(null);
  const artworkResolverRef = useRef(new ArtworkResolver());
  const hitBoxesRef = useRef<HitBox[]>([]);
  const orderWedgesRef = useRef<OrderWedge[]>([]);
  const hoveredOrderRef = useRef<string | null>(null);
  const hoveredCodeRef = useRef<string | null>(null);
  const focusLabelRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  const onViewChangeRef = useRef(onViewChange);
  const onSelectGroupRef = useRef(onSelectGroup);
  const onArtworkStatusRef = useRef(onArtworkStatus);
  const artworkStatusKeyRef = useRef('');
  onSelectRef.current = onSelect;
  onViewChangeRef.current = onViewChange;
  onSelectGroupRef.current = onSelectGroup;
  onArtworkStatusRef.current = onArtworkStatus;
  const lastReportRef = useRef(0);
  const reportTimerRef = useRef(0);
  const viewInfoRef = useRef<ViewInfo>({ zoom: 1, visibleSpecies: 0, focusLabel: null });
  const renderMetricsRef = useRef({ count: 0, totalMs: 0, maxMs: 0, firstSceneMs: 0, mountStartedMs: performance.now() });
  const taxaByCode = useMemo(() => new Map(taxa.map((taxon) => [taxon.code, taxon])), [taxa]);
  const growthState=useMemo(()=>growth?treeGrowthBranches(tree,taxaByCode,displayedCodes,growth):null,[tree,taxaByCode,displayedCodes,growth?.revealedCodes,growth?.newCodes]);
  const growthEventKey=useMemo(()=>growth?`${growth.date||''}:${[...growth.revealedCodes].sort().join(',')}:${[...growth.newCodes].sort().join(',')}`:'',[growth?.date,growth?.revealedCodes,growth?.newCodes]);
  const growthMotionRef=useRef(createGrowthMotion());
  const visibility = useMemo(() => computeTreeVisibility(tree, taxa, displayedCodes, selectedCode, showAllBranches, backgroundCodes), [tree, taxa, displayedCodes, selectedCode, showAllBranches, backgroundCodes]);
  const referenceCodes=useMemo(()=>[...observedCodes].filter(code=>taxaByCode.get(code)?.category==='species'),[observedCodes,taxaByCode]);
  const referenceSizing=useMemo(()=>radialPortraitSizes(referenceCodes,stickerGeometry,sizeMode),[referenceCodes,stickerGeometry,sizeMode]);
  const sizingExtraCode=selectedCode&&!observedCodes.has(selectedCode)?selectedCode:'';
  const portraitSizing=useMemo(()=>sizingExtraCode?radialPortraitSizes(referenceCodes,stickerGeometry,sizeMode,[sizingExtraCode]):referenceSizing,[referenceCodes,stickerGeometry,sizeMode,sizingExtraCode,referenceSizing]);
  const tipWeights=useMemo(()=>{
    const weights=new Map<number,number>();
    for(const code of referenceCodes){
      const taxon=taxaByCode.get(code),dimensions=referenceSizing.sizes.get(code);
      if(!taxon||!dimensions)continue;
      const footprint=Math.pow(dimensions.width*dimensions.height,.625);
      // Shared historical source concepts keep one angular anchor.
      for(const tip of mappedTipIds(taxon))weights.set(tip,Math.max(weights.get(tip)||0,footprint));
    }
    return weights;
  },[referenceCodes,referenceSizing,taxaByCode]);
  const angularTips=useMemo(()=>focusedOrder?new Set([...(backgroundCodes||displayedCodes)].flatMap(code=>mappedTipIds(taxaByCode.get(code)))):undefined,[focusedOrder,backgroundCodes,displayedCodes,taxaByCode]);
  const compactTipKey = useMemo(() => layoutMode === 'compact' ? [...visibility.tipIds].sort((a, b) => a - b).join(',') : '', [layoutMode, visibility]);
  const layout = useMemo(() => buildLayout(tree, { mode: layoutMode, visibleTips: visibility.tipIds, angularTips, tipWeights, fanAngle: focusedOrder ? Math.PI * 4 / 3 : undefined }), [tree, layoutMode, focusedOrder, compactTipKey,tipWeights,angularTips]);
  const tipTaxa = useMemo(() => {
    const result = new Map<number, Taxon[]>();
    for (const taxon of taxa) {
      if (taxon.category !== 'species') continue;
      for (const tip of mappedTipIds(taxon)) {
        const group = result.get(tip) || [];
        group.push(taxon);
        result.set(tip, group);
      }
    }
    return result;
  }, [taxa]);
  const points = useMemo<TipPoint[]>(() => tree.tips.map((id) => {
    if (!visibility.tipIds.has(id)) return null;
    const candidates = tipTaxa.get(id) || [];
    const taxon = candidates.find((item) => item.code === selectedCode)
      || candidates.find((item) => displayedCodes.has(item.code)) || candidates.find((item) => backgroundCodes?.has(item.code)) || candidates[0];
    return taxon ? { ...layout.nodes[id], code: taxon.code, taxon } : null;
  }).filter((point): point is TipPoint => point !== null), [tree, layout, tipTaxa, displayedCodes, visibility, selectedCode, backgroundCodes]);
  const portraitMemberKey=useMemo(()=>[...new Set([...displayedCodes,...(selectedCode?[selectedCode]:[])])].sort().join(','),[displayedCodes,selectedCode]);
  const speciesCount=useMemo(()=>[...displayedCodes].filter(code=>taxaByCode.get(code)?.category==='species'&&observedCodes.has(code)).length,[displayedCodes,taxaByCode,observedCodes]);
  const sceneSpeciesCount=growthState?.codes.size??speciesCount;
  const radialSources=useMemo(()=>{
    const members=portraitMemberKey?portraitMemberKey.split(','):[];
    const colorAngles=portraitOrder==='color'?colorRadialAngles(members.flatMap(code=>{
      const taxon=taxaByCode.get(code);return taxon?.category==='species'?[{code,order:taxon.order||'Unclassified',sourceOrder:Math.min(...mappedTipIds(taxon).map(id=>tree.nodes[id]?.leafStart??Infinity))}]:[];
    }),stickerColors?.species||{}):null;
    const sources=members.flatMap(code=>{
      const taxon=taxaByCode.get(code);if(!taxon||taxon.category!=='species')return [];
      const dimensions=portraitSizing.sizes.get(code);if(!dimensions)return [];
      if(colorAngles){const angle=colorAngles.get(code)!;const tip={id:-1,angle,radius:1,x:Math.cos(angle),y:Math.sin(angle),code,taxon};return [{id:`${code}:color`,angle,...dimensions,code,taxon,tip}];}
      return mappedTipIds(taxon).flatMap(id=>layout.nodes[id]?[{id:`${code}:${id}`,angle:layout.nodes[id].angle,...dimensions,code,taxon,tip:{...layout.nodes[id],code,taxon}}]:[]);
    });
    if(showTree)return sources;
    const angles=compactRadialAngles(sources.map(source=>({...source,weight:Math.pow(source.width*source.height,.625)})));
    return sources.map(source=>({...source,angle:angles.get(source.id)!}));
  },[portraitMemberKey,taxaByCode,layout,portraitSizing,portraitOrder,stickerColors,tree,showTree]);
  const radialArrangement=useMemo(()=>{
    if(showTree)return {layout:radialStickerLayout(radialSources),centerRadius:0};
    const initial=radialStickerLayout(radialSources,{exclusionRadius:.36});
    // Reserve a small, readable center even when a large collection fills the overview.
    const centerRadius=Math.max(.36,initial.maxRadius*.12);
    return {layout:centerRadius>.36?radialStickerLayout(radialSources,{exclusionRadius:centerRadius}):initial,centerRadius};
  },[radialSources,showTree]);
  const {layout:radialLayout,centerRadius}=radialArrangement;
  const radialPortraits=useMemo<RadialPortrait[]>(()=>{const byId=new Map(radialSources.map(p=>[p.id,p]));return radialLayout.points.map(point=>({...byId.get(point.id)!,...point}));},[radialLayout,radialSources]);
  const radialLayoutSignature=useMemo(()=>{let hash=2166136261;for(const p of radialPortraits)for(const c of `${p.id}:${p.x},${p.y},${p.width},${p.height};`)hash=Math.imul(hash^c.charCodeAt(0),16777619);return `${radialPortraits.length}:${(hash>>>0).toString(16)}`;},[radialPortraits]);
  const radialPointIndex=useMemo(()=>quadtree<RadialPortrait>().x(p=>p.x).y(p=>p.y).addAll(radialPortraits),[radialPortraits]);
  const backgroundPath = useMemo(() => showAllBranches ? makePath(tree, layout, visibility.backgroundNodeIds) : null, [tree, layout, showAllBranches, visibility]);
  const observedPath = useMemo(() => makePath(tree, layout, visibility.recordedNodeIds), [tree, layout, visibility]);
  const selectedPath = useMemo(() => visibility.selectedTipIds.size ? makePath(tree, layout, visibility.selectedNodeIds) : null, [tree, layout, visibility]);
  const growthPaths=useMemo(()=>growthState?{prior:makePath(tree,layout,growthState.priorNodeIds),fresh:makePath(tree,layout,growthState.newNodeIds)}:null,[tree,layout,growthState]);
  const growthBranchPlan=useMemo(()=>growthState?buildBranchGrowthPlan(tree,layout,growthState.newNodeIds):null,[tree,layout,growthState]);
  const scenePoints=useMemo(()=>growthState?treeGrowthPoints(points,tipTaxa,growthState,selectedCode):points,[points,growthState,tipTaxa,selectedCode]);
  const majorClades = useMemo<OverviewClade[]>(() => {
    const members = taxa.filter((taxon) => taxon.category === 'species' && displayedCodes.has(taxon.code) && mappedTipIds(taxon).length);
    const selectedTips = mappedTipIds(selectedCode ? taxaByCode.get(selectedCode) : undefined);
    const sourceClades = (tree as TreeData & { sourceClades?: SourceClade[] }).sourceClades || [];
    const candidates: Array<{ name: string; rank: 'order' | 'family' | 'genus'; nodeId: number; tipCount: number }> = [...sourceClades];
    const genera = new Map<string, number[]>();
    const visibleGenera = new Set(members.map((taxon) => taxon.scientificName.split(' ')[0]));
    for (const taxon of taxa) {
      if (taxon.category !== 'species') continue;
      const genus = taxon.scientificName.split(' ')[0];
      if (!visibleGenera.has(genus)) continue;
      const tips = genera.get(genus) || [];
      tips.push(...mappedTipIds(taxon));
      genera.set(genus, tips);
    }
    for (const [name, tips] of genera) {
      const unique = [...new Set(tips)];
      const nodeId = findMonophyleticClade(tree, unique);
      if (nodeId !== null) candidates.push({ name, rank: 'genus', nodeId, tipCount: unique.length });
    }
    return candidates.map((clade): OverviewClade => {
      const node = tree.nodes[clade.nodeId];
      const covers = (tip: number) => tree.nodes[tip]?.leafStart >= node.leafStart && tree.nodes[tip]?.leafStart < node.leafEnd;
      const recorded = members.filter((taxon) => mappedTipIds(taxon).some(covers));
      const selectedContext = selectedTips.some(covers);
      const backgroundContext = showAllBranches && (!backgroundCodes || [...visibility.backgroundTipIds].some(covers));
      const anchorTips = [...new Set(recorded.flatMap((taxon) => mappedTipIds(taxon).filter(covers)))];
      if (!anchorTips.length && selectedContext) anchorTips.push(...selectedTips.filter(covers));
      const sin = anchorTips.reduce((sum, tip) => sum + Math.sin(layout.nodes[tip].angle), 0);
      const cos = anchorTips.reduce((sum, tip) => sum + Math.cos(layout.nodes[tip].angle), 0);
      return {
        name: clade.name, rank: clade.rank, node: clade.nodeId, tipCount: clade.tipCount,
        recordedCount: recorded.length, memberCodes:recorded.map(taxon=>taxon.code), selectedContext, backgroundContext,
        interior: clade.rank === 'order' && clade.tipCount > tree.tips.length * 0.35,
        angle: !showAllBranches && anchorTips.length ? Math.atan2(sin, cos) : layout.nodes[clade.nodeId].angle,
      };
    }).filter((clade) => clade.backgroundContext || clade.recordedCount > 0 || clade.selectedContext)
      .sort((a, b) => b.recordedCount - a.recordedCount || b.tipCount - a.tipCount);
  }, [taxa, tree, displayedCodes, selectedCode, taxaByCode, showAllBranches, layout, backgroundCodes, visibility]);

  const orderGroups = useMemo<RendererOrder[]>(() => {
    const groups = recordedOrderGroups(taxa, displayedCodes);
    return [...groups.entries()].map(([name, members]): RendererOrder | null => {
      const mappedMembers = members.filter((member) => mappedTipIds(member).length);
      if (!mappedMembers.length) return null;
      const source = tree.sourceClades?.find((clade) => clade.rank === 'order' && clade.name === name);
      const step = focusedOrder ? Math.PI * 4 / 3 / Math.max(1, layout.tipCount) : Math.PI * 2 / Math.max(1, layout.tipCount);
      const tipNodes=[...new Set(mappedMembers.flatMap(mappedTipIds))].map(tip=>layout.nodes[tip]);
      let start = Math.min(...tipNodes.map(node=>node.angularStart??node.angle-step/2)), end = Math.max(...tipNodes.map(node=>node.angularEnd??node.angle+step/2));
      if (source && !focusedOrder) {
        const node = tree.nodes[source.nodeId];
        start = layout.nodes[source.nodeId].angularStart??node.leafStart / tree.tips.length * Math.PI * 2 - Math.PI / 2;
        end = layout.nodes[source.nodeId].angularEnd??node.leafEnd / tree.tips.length * Math.PI * 2 - Math.PI / 2;
      }
      return { name, count: members.length, start, end, verified: Boolean(source) };
    }).filter((order): order is RendererOrder => order !== null).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [taxa, displayedCodes, tree, layout, layoutMode, focusedOrder]);
  const sceneClades=useMemo(()=>growthState?majorClades.flatMap(clade=>{
    const recordedCount=clade.memberCodes?.filter(code=>growthState.codes.has(code)).length||0;
    return recordedCount?[{...clade,recordedCount,backgroundContext:false,selectedContext:undefined}]:[];
  }):majorClades,[majorClades,growthState]);
  const sceneOrders=useMemo(()=>{
    if(!growthState)return orderGroups;
    const counts=new Map<string,number>();
    for(const code of growthState.codes){const order=taxaByCode.get(code)?.order;if(order)counts.set(order,(counts.get(order)||0)+1);}
    return orderGroups.flatMap(order=>counts.has(order.name)?[{...order,count:counts.get(order.name)!}]:[]);
  },[orderGroups,growthState,taxaByCode]);

  const requestDraw = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => { frameRef.current = 0; drawRef.current(); });
  }, []);
  useLayoutEffect(()=>{
    const newEvent=growthMotionRef.current.key!==growthEventKey||growthMotionRef.current.count!==(growthState?.codes.size||0);
    growthMotionRef.current=updateGrowthMotion(growthMotionRef.current,{key:growthEventKey,count:growthState?.codes.size||0,newCount:growthState?.newCodes.size||0,duration:growth?.durationMs??350,progress:growth?.progress,now:newEvent&&growth?.startedAt!==undefined?growth.startedAt:performance.now()});
    if(growthState&&hoveredCodeRef.current&&!growthState.codes.has(hoveredCodeRef.current))hoveredCodeRef.current=null;
    if(growthState)hoveredOrderRef.current=null;
    requestDraw();
  },[growthEventKey,growthState,growth?.progress,growth?.durationMs,growth?.startedAt,requestDraw]);

  const getArtworkCache = useCallback(() => {
    if (!imageCacheRef.current) imageCacheRef.current = artworkPool?artworkPool.connect(requestDraw):createArtworkCache(requestDraw);
    return imageCacheRef.current;
  }, [requestDraw,artworkPool]);
  useEffect(() => {
    requestDraw();
    return () => { imageCacheRef.current?.dispose(); imageCacheRef.current = null; };
  }, [requestDraw,artworkPool]);

  sceneRef.current = (ctx, viewSize, transform) => {
    const growthProgress=sampleGrowthMotion(growthMotionRef.current,performance.now());
    const branchProgress=Math.min(1,growthProgress/.8);
    let newGrowthPath=growthPaths?.fresh;
    if(growthBranchPlan&&branchProgress<1){newGrowthPath=new Path2D();traceBranchGrowth(newGrowthPath,growthBranchPlan,branchProgress);}
    const result = drawTreeScene(ctx, {
      ...viewSize, transform, baseScale: baseScaleRef.current, layout, points:scenePoints,
      clades: sceneClades, orders: sceneOrders, observedCodes, selectedCode,
      backgroundPath:growthState?null:backgroundPath, observedPath:growthPaths?.prior||observedPath, selectedPath, cache: getArtworkCache(),
      focusedOrder, hoveredOrder: hoveredOrderRef.current,
      radialPortraits,hoveredCode:hoveredCodeRef.current,showTree,speciesCount:sceneSpeciesCount,centerRadius,colors,artworkResolver:artworkResolverRef.current,pixelRatio:Math.min(2,window.devicePixelRatio||1),
      growth:growthState&&growthPaths&&growthBranchPlan&&newGrowthPath?{revealedCodes:growthState.codes,newCodes:growthState.newCodes,newTipIds:growthState.newTipIds,progress:growthProgress,newPath:newGrowthPath,branchPlan:growthBranchPlan}:undefined,
    });
    if(growthState&&growth?.progress===undefined&&growthProgress<1)requestDraw();
    hitBoxesRef.current = result.hitBoxes;
    orderWedgesRef.current = result.wedges;
    if (canvasRef.current) {
      canvasRef.current.dataset.orderWedges = String(result.wedges.length);
      canvasRef.current.dataset.speciesStickers = String(result.speciesStickerCount);
      canvasRef.current.dataset.requestedArtwork = String(result.requestedArtwork);
      canvasRef.current.dataset.hoveredOrder = hoveredOrderRef.current || '';
      canvasRef.current.dataset.radialPortraits=String(result.radialPortraitCount);
      canvasRef.current.dataset.radialPortraitsTotal=String(radialPortraits.length);
      canvasRef.current.dataset.radialMaxRadius=String(radialLayout.maxRadius);
      canvasRef.current.dataset.radialAngleError=String(radialLayout.maxAngleError);
      canvasRef.current.dataset.radialOverlaps=String(radialLayout.overlapCount);
      canvasRef.current.dataset.hoveredSpecies=hoveredCodeRef.current||'';
      canvasRef.current.dataset.radialLayoutSignature=radialLayoutSignature;
      canvasRef.current.dataset.viewTransform=JSON.stringify({x:transform.x,y:transform.y,k:transform.k});
      canvasRef.current.dataset.annotationBoxes=JSON.stringify(result.annotationBoxes);
      canvasRef.current.dataset.artworkDrawableSpecies=String(result.readyPortraitCount);
      canvasRef.current.dataset.renderTheme=theme;
      canvasRef.current.dataset.canvasPaper=colors.paper;
      canvasRef.current.dataset.canvasInk=colors.ink;
      canvasRef.current.dataset.growthProgress=String(growthState?growthProgress:1);
      canvasRef.current.dataset.growthNewBranches=String(growthState?growthState.newNodeIds.size-Number(growthState.newNodeIds.has(tree.root)):0);
      canvasRef.current.dataset.growthBranchProgress=String(branchProgress);
      canvasRef.current.dataset.growthPartialBranches=String(growthBranchPlan?.segments.filter(segment=>{const p=branchTipProgress(growthBranchPlan,segment.id,branchProgress);return p>0&&p<1;}).length||0);
      canvasRef.current.dataset.growthReachedBranches=String(growthBranchPlan?.segments.filter(segment=>branchTipProgress(growthBranchPlan,segment.id,branchProgress)===1).length||0);
      canvasRef.current.dataset.growthDurationMs=String(growthMotionRef.current.duration);
    }
    return result.visibleCount;
  };
  drawRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const viewSize = sizeRef.current;
    if (canvas.width !== Math.round(viewSize.width * ratio) || canvas.height !== Math.round(viewSize.height * ratio)) {
      canvas.width = Math.round(viewSize.width * ratio); canvas.height = Math.round(viewSize.height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const drawStarted = performance.now();
    const count = sceneRef.current(ctx, viewSize, transformRef.current);
    const now = performance.now();
    const drawMs = now - drawStarted;
    const metrics = renderMetricsRef.current;
    metrics.count++;
    metrics.totalMs += drawMs;
    metrics.maxMs = Math.max(metrics.maxMs, drawMs);
    if (metrics.count === 1) {
      metrics.firstSceneMs = now;
      performance.mark('phylogeny:first-render');
      console.info('Phylogeny first scene rendered', { sourceTips: tree.tips.length, sceneDrawMs: Number(drawMs.toFixed(2)), afterNavigationMs: Number(now.toFixed(2)) });
    }
    // Read-only QA counters contain rendering measurements, never observation data.
    (window as unknown as { __phylogenyPerformance: Record<string, number> }).__phylogenyPerformance = {
      sourceTips: tree.tips.length,
      sceneCount: metrics.count,
      firstSceneAfterNavigationMs: metrics.firstSceneMs,
      firstSceneAfterMountMs: metrics.firstSceneMs - metrics.mountStartedMs,
      latestDrawMs: drawMs,
      meanDrawMs: metrics.totalMs / metrics.count,
      maxDrawMs: metrics.maxMs,
    };
    canvas.dataset.renderMs = drawMs.toFixed(2);
    canvas.dataset.meanRenderMs = (metrics.totalMs / metrics.count).toFixed(2);
    canvas.dataset.firstSceneMs = metrics.firstSceneMs.toFixed(2);
    const artwork = getArtworkCache().metrics();
    canvas.dataset.artworkDecodedBytes = String(artwork.decodedBytes);
    canvas.dataset.artworkVisibleDecodedBytes = String(artwork.visibleDecodedBytes);
    canvas.dataset.artworkVisibleTiers = JSON.stringify(artwork.visibleTiers);
    canvas.dataset.artworkOverBudgetBytes = String(artwork.overBudgetBytes);
    canvas.dataset.artworkQueued = String(artwork.queued);
    canvas.dataset.artworkActive = String(artwork.active);
    canvas.dataset.artworkReady = String(artwork.ready);
    canvas.dataset.artworkFailed = String(artwork.failed);
    canvas.dataset.artworkHits = String(artwork.cacheHits);
    canvas.dataset.artworkVisibleReady = String(artwork.visibleReady);
    canvas.dataset.artworkVisiblePending = String(artwork.visibleQueued + artwork.visibleActive);
    canvas.dataset.artworkVisibleFailed = String(artwork.visibleFailed);
    canvas.dataset.artworkEvictions = String(artwork.evictions);
    canvas.dataset.artworkDelivery = JSON.stringify(artwork.delivery || {});
    const artworkKey = [artwork.queued, artwork.active, artwork.ready, artwork.failed, artwork.visibleQueued, artwork.visibleActive, artwork.visibleReady, artwork.visibleFailed].join(':');
    if (artworkKey !== artworkStatusKeyRef.current) { artworkStatusKeyRef.current = artworkKey; onArtworkStatusRef.current?.(artwork); }
    viewInfoRef.current = { zoom: transformRef.current.k / baseScaleRef.current, visibleSpecies: count, focusLabel: focusLabelRef.current, branchScale: showTree && layoutMode === 'true-distance' ? branchScale(transformRef.current.k, layout.maxDistance, viewSize.width) : undefined };
    if (now - lastReportRef.current > 100) {
      lastReportRef.current = now;
      if (reportTimerRef.current) { clearTimeout(reportTimerRef.current); reportTimerRef.current = 0; }
      onViewChangeRef.current?.(viewInfoRef.current);
    } else if (!reportTimerRef.current) {
      reportTimerRef.current = window.setTimeout(() => {
        reportTimerRef.current = 0;
        lastReportRef.current = performance.now();
        onViewChangeRef.current?.(viewInfoRef.current);
      }, 100 - (now - lastReportRef.current));
    }
  };

  const setTransform = useCallback((transform: ZoomTransform) => {
    if (canvasRef.current && zoomRef.current) select(canvasRef.current).call(zoomRef.current.transform, transform);
  }, []);

  const reset = useCallback(() => {
    const current = sizeRef.current;
    focusLabelRef.current = null;
    const fit=radialViewportFit(radialLayout.bounds,current.width,current.height);
    setTransform(zoomIdentity.translate(fit.x,fit.y).scale(fit.k));
  }, [setTransform,radialLayout.bounds]);

  const focusSpecies = useCallback((code: string) => {
    if(growthState&&!growthState.codes.has(code))return;
    const taxon = taxaByCode.get(code);
    if (!taxon) return;
    const current = sizeRef.current;
    const portraits=radialPortraits.filter(p=>p.code===code);if(!portraits.length)return;
    const minX=Math.min(...portraits.map(p=>p.x-p.width/2)),maxX=Math.max(...portraits.map(p=>p.x+p.width/2)),minY=Math.min(...portraits.map(p=>p.y-p.height/2)),maxY=Math.max(...portraits.map(p=>p.y+p.height/2));
    const longest=Math.max(...portraits.map(p=>Math.max(p.width,p.height)));
    const k=Math.min(baseScaleRef.current*120,current.width*.55/Math.max(.01,maxX-minX),current.height*.5/Math.max(.01,maxY-minY),Math.max(baseScaleRef.current*3,150/longest));
    focusLabelRef.current=taxon.commonName;setTransform(zoomIdentity.translate(current.width/2-(minX+maxX)/2*k,current.height/2-(minY+maxY)/2*k).scale(k));
  }, [taxaByCode, setTransform,radialPortraits,growthState]);

  const focusClade = useCallback((codes: string[]) => {
    if(growthState)codes=codes.filter(code=>growthState.codes.has(code));
    if(portraitOrder==='color'){
      const members=radialPortraits.filter(p=>codes.includes(p.code));if(!members.length)return;
      const minX=Math.min(-1.14,...members.map(p=>p.x-p.width/2)),maxX=Math.max(1.14,...members.map(p=>p.x+p.width/2)),minY=Math.min(-1.14,...members.map(p=>p.y-p.height/2)),maxY=Math.max(1.14,...members.map(p=>p.y+p.height/2));
      const current=sizeRef.current,fit=radialViewportFit({minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY},current.width,current.height);
      focusLabelRef.current=`${new Set(members.map(p=>p.code)).size} species · illustration colors within orders`;
      setTransform(zoomIdentity.translate(fit.x,fit.y).scale(fit.k));return;
    }
    const ids = [...new Set(codes.flatMap((code) => mappedTipIds(taxaByCode.get(code))))];
    let bounds = cladeBounds(tree, layout, ids, layoutMode === 'compact' || focusedOrder ? collectAncestry(tree, ids) : undefined);
    if (!bounds) return;
    const members=radialPortraits.filter(p=>codes.includes(p.code));
    if(members.length){const minX=Math.min(bounds.x-bounds.width/2,...members.map(p=>p.x-p.width/2)),maxX=Math.max(bounds.x+bounds.width/2,...members.map(p=>p.x+p.width/2)),minY=Math.min(bounds.y-bounds.height/2,...members.map(p=>p.y-p.height/2)),maxY=Math.max(bounds.y+bounds.height/2,...members.map(p=>p.y+p.height/2));bounds={x:(minX+maxX)/2,y:(minY+maxY)/2,width:maxX-minX,height:maxY-minY};}
    const current = sizeRef.current;
    const k = Math.min(baseScaleRef.current * 100, Math.min(current.width * 0.7 / bounds.width, current.height * 0.7 / bounds.height));
    const clade = findMonophyleticClade(tree, ids);
    focusLabelRef.current = clade === null ? `${ids.length} source tips across clades` : `${ids.length} source tips · verified clade`;
    setTransform(zoomIdentity.translate(current.width / 2 - bounds.x * k, current.height / 2 - bounds.y * k).scale(k));
  }, [tree, layout, taxaByCode, setTransform, layoutMode, focusedOrder,radialPortraits,portraitOrder,growthState]);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, entry.contentRect.width);
      const height = Math.max(1, entry.contentRect.height);
      setSize({ width, height });
    });
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const behavior = zoom<HTMLCanvasElement, unknown>().clickDistance(5)
      .filter(event=>interactive&&(!event.ctrlKey||event.type==='wheel')&&!event.button)
      .scaleExtent([60, 90000])
      .extent(() => [[0, 0], [sizeRef.current.width, sizeRef.current.height]])
      .on('zoom', (event) => { transformRef.current = event.transform; requestDraw(); });
    zoomRef.current = behavior;
    select(canvas).call(behavior);
    return () => { select(canvas).on('.zoom', null); zoomRef.current = null; cancelAnimationFrame(frameRef.current); frameRef.current = 0; clearTimeout(reportTimerRef.current); reportTimerRef.current = 0; };
  }, [requestDraw,interactive]);

  useEffect(() => {
    const previousBase = baseScaleRef.current;
    const fit=radialViewportFit(radialLayout.bounds,size.width,size.height),nextBase=fit.k;
    const resize = resizeViewportTransform(previousSizeRef.current, size, transformRef.current, previousBase, nextBase);
    const current=transformRef.current,previousCenter={x:previousSizeRef.current.width/2,y:previousSizeRef.current.height/2},center={x:size.width/2,y:size.height/2};
    const resized=current.k===1?fit:{x:center.x-(previousCenter.x-current.x)/current.k*resize.k,y:center.y-(previousCenter.y-current.y)/current.k*resize.k,k:resize.k};
    previousSizeRef.current = size;
    baseScaleRef.current = nextBase;
    zoomRef.current?.scaleExtent([nextBase * 0.45, nextBase * 160]);
    setTransform(zoomIdentity.translate(resized.x, resized.y).scale(resized.k));
  }, [size, setTransform,radialLayout.bounds]);

  useEffect(() => { reset(); }, [layoutMode, focusedOrder,radialLayout.bounds, reset]);
  useEffect(() => { requestDraw(); }, [tree, observedCodes, selectedCode, scenePoints, sceneClades, sceneOrders, size, requestDraw,radialPortraits,showTree,sceneSpeciesCount]);
  useEffect(() => { requestDraw(); }, [theme,backgroundTone,requestDraw]);
  useEffect(() => { if (!growth&&focusCodes?.length) focusClade(focusCodes); }, [focusCodes, focusClade,Boolean(growth)]);
  useEffect(() => {
    let active = true;
    document.fonts.ready.then(() => { if (active) requestDraw(); });
    return () => { active = false; };
  }, [requestDraw]);

  useImperativeHandle(forwardedRef, () => ({
    reset,
    zoomIn() { if (canvasRef.current && zoomRef.current) select(canvasRef.current).call(zoomRef.current.scaleBy, 1.65); },
    zoomOut() { if (canvasRef.current && zoomRef.current) select(canvasRef.current).call(zoomRef.current.scaleBy, 1 / 1.65); },
    focusSpecies,
    focusClade,
    async exportPng(options = {}) {
      // Resolve visible local artwork before capturing this exact transform.
      drawRef.current();
      await getArtworkCache().settleVisible(8000);
      drawRef.current();
      await getArtworkCache().settleVisible(8000);
      await Promise.all([document.fonts.load(`600 18px ${DISPLAY_FONT}`),document.fonts.load(`11px ${FONT}`)]);
      const colors=colorsRef.current;
      const viewSize = sizeRef.current;
      const exportCanvas = document.createElement('canvas');
      const measuringContext = exportCanvas.getContext('2d');
      if (!measuringContext) throw new Error('This browser could not create an export canvas.');
      const caption=portraitOrder==='color'?'Illustration-color order; bird positions are decorative.':!showTree?'Phylogenetic order retained; bird positions are decorative.':layoutMode==='compact'?'Compact branches are not to scale; bird positions are decorative.':'Estimated divergence distances; bird positions are decorative.';
      const attribution=credits||'Tree: McTavish et al., Aves 1.7 · AI artwork: huashu-bird-sticker, resized by Everybird · CC BY 4.0.';
      const textWidth = Math.max(50, viewSize.width - 48);
      const legend: Array<{ label: string; color: string }> = showTree ? [{ label: 'Recorded ancestry', color: colors.observed }] : [];
      if (showTree&&showAllBranches) legend.push({ label: 'Other birds', color: colors.line });
      if(showTree&&growthState&&growthState.newNodeIds.size>Number(growthState.newNodeIds.has(tree.root)))legend.push({label:'New additions',color:colors.accent});
      if (showTree&&visibility.selectedTipIds.size) legend.push({ label: 'Selected species', color: colors.accent });
      measuringContext.font = `10px ${FONT}`;
      let legendRows = 1;
      let measuredLegendX = 24;
      for (const item of legend) {
        const entryWidth = 40 + measuringContext.measureText(item.label).width;
        if (measuredLegendX > 24 && measuredLegendX + entryWidth > viewSize.width - 24) { legendRows++; measuredLegendX = 24; }
        measuredLegendX += entryWidth;
      }
      const legendExtraHeight = (legendRows - 1) * 18;
      measuringContext.font = `11px ${FONT}`;
      const subtitleHeight = options.subtitle ? wrappedLineCount(measuringContext, options.subtitle, textWidth) * 15 : 0;
      const captionHeight = wrappedLineCount(measuringContext, caption, textWidth) * 14;
      measuringContext.font = `9px ${FONT}`;
      const creditHeight = wrappedLineCount(measuringContext, attribution, textWidth) * 13;
      const scaleLegendHeight = showTree ? 54 : 0;
      const footerHeight = scaleLegendHeight + Math.max(170, 100 + subtitleHeight + captionHeight + creditHeight + legendExtraHeight);
      const ratio = Math.min(2, 4096 / Math.max(viewSize.width, viewSize.height + footerHeight));
      exportCanvas.width = Math.ceil(viewSize.width * ratio);
      exportCanvas.height = Math.ceil((viewSize.height + footerHeight) * ratio);
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) throw new Error('This browser could not create an export canvas.');
      ctx.scale(ratio, ratio);
      sceneRef.current(ctx, viewSize, transformRef.current);
      ctx.fillStyle = colors.surface; ctx.fillRect(0, viewSize.height, viewSize.width, footerHeight);
      if (showTree) {
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = colors.label; ctx.font = `10px ${FONT}`;
        const right = viewSize.width - 24;
        ctx.fillText(layoutMode === 'compact' ? 'Aves · Compact · branch lengths not to scale' : `Aves · True distance · ≈${Math.round(layout.maxDistance)} Ma at root`, right, viewSize.height + 15, textWidth);
        if (layoutMode === 'true-distance') {
          const scale = branchScale(transformRef.current.k, layout.maxDistance, viewSize.width), left = right - scale.width, y = viewSize.height + 44;
          ctx.fillText(`≈${scale.age} million years · branch radial distance`, right, viewSize.height + 30, textWidth);
          ctx.strokeStyle = colors.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.moveTo(left,y-3);ctx.lineTo(left,y+3);ctx.moveTo(right,y-3);ctx.lineTo(right,y+3);ctx.stroke();
        }
      }
      ctx.textAlign = 'left';
      ctx.font = `10px ${FONT}`; ctx.textBaseline = 'middle'; ctx.fillStyle = colors.label;
      let legendX = 24;
      let legendY = viewSize.height + scaleLegendHeight + 20;
      for (const item of legend) {
        const entryWidth = 40 + ctx.measureText(item.label).width;
        if (legendX > 24 && legendX + entryWidth > viewSize.width - 24) { legendX = 24; legendY += 18; }
        ctx.strokeStyle = item.color; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(legendX, legendY); ctx.lineTo(legendX + 15, legendY);
        ctx.stroke();
        ctx.fillText(item.label, legendX + 21, legendY);
        legendX += entryWidth;
      }
      ctx.fillStyle = colors.ink; ctx.font = `600 18px ${DISPLAY_FONT}`; ctx.textBaseline = 'top';
      ctx.fillText(options.title || 'phyloBirds · My collection', 24, viewSize.height + scaleLegendHeight + 42 + legendExtraHeight, viewSize.width - 48);
      ctx.font = `11px ${FONT}`; ctx.fillStyle = colors.label;
      let textY = viewSize.height + scaleLegendHeight + 71 + legendExtraHeight;
      if (options.subtitle) textY = wrapText(ctx, options.subtitle, 24, textY, viewSize.width - 48, 15);
      textY = wrapText(ctx, caption, 24, textY + 2, viewSize.width - 48, 14);
      ctx.font = `9px ${FONT}`;
      wrapText(ctx, attribution, 24, textY + 5, viewSize.width - 48, 13);
      const blob = await new Promise<Blob>((resolve, reject) => exportCanvas.toBlob((result) => result ? resolve(result) : reject(new Error('PNG export failed.')), 'image/png'));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'phylobirds.png'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
  }), [reset, focusSpecies, focusClade, tree.version, credits, displayedCodes, showAllBranches, backgroundCodes, selectedCode, visibility, layoutMode, focusedOrder, getArtworkCache,showTree,sizeMode,sceneSpeciesCount,portraitOrder,growth?.date]);

  return <div ref={wrapperRef} className={className || 'tree-canvas-wrap'} style={{ width: '100%', height: '100%', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
    <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', touchAction: interactive?'none':'auto', cursor: interactive?'grab':'default' }}
      data-recorded-branches={showTree?growthState?growthState.nodeIds.size-Number(growthState.nodeIds.has(tree.root)):visibility.recordedNodeIds.size - Number(visibility.recordedNodeIds.has(tree.root)):0}
      data-background-branches={showTree?visibility.backgroundNodeIds.size - Number(visibility.backgroundNodeIds.has(tree.root)):0}
      data-selected-branches={showTree?visibility.selectedNodeIds.size - Number(visibility.selectedNodeIds.has(tree.root)):0}
      data-visible-tips={scenePoints.length}
      data-recorded-tips={growthState?.tipIds.size??visibility.recordedTipIds.size}
      data-background-tips={visibility.backgroundTipIds.size}
      data-layout-mode={portraitOrder==='color'?'color':layoutMode}
      data-branch-layout={layoutMode}
      data-portrait-order={portraitOrder}
      data-theme={theme}
      data-source-angles-preserved={false}
      data-source-radii-preserved={layoutMode==='true-distance'}
      data-angle-spacing={showTree?'portrait-footprint':portraitOrder==='color'?'color-footprint':'sequence-footprint'}
      data-order-angles={JSON.stringify(sceneOrders.map(order=>({order:order.name,degrees:(order.end-order.start)*180/Math.PI})))}
      data-compact-bird-circle={!showTree}
      data-center-radius={showTree?undefined:centerRadius}
      data-size-mode={sizeMode}
      data-show-tree={showTree}
      data-species-count={sceneSpeciesCount}
      data-growth-active={Boolean(growthState)}
      data-growth-date={growth?.date||''}
      data-growth-total={growthState?speciesCount:undefined}
      data-lightest-mass={portraitSizing.lightestMass}
      data-portrait-world-scale={portraitSizing.worldScale}
      data-geometry-missing={portraitSizing.missingGeometry}
      data-focused-order={focusedOrder || ''}
      data-time-scale={showTree&&layoutMode === 'true-distance' ? 'calibrated-radial' : 'none'}
      tabIndex={interactive?0:-1} role="img" aria-label={!interactive?`phyloBirds playback. ${sceneSpeciesCount.toLocaleString()} species as of ${growth?.date||'the beginning'}. Fixed radial layout. Switch to Single tree to explore individual birds.`:`phyloBirds. Interactive radial birds. ${sceneSpeciesCount.toLocaleString()} recorded species in the current group.${growth?` Growing life list through ${growth.date||'the beginning'}.`:''} ${portraitOrder==='color'?'Decorative color arrangement: one portrait per species, grouped by order and illustration color within each order. Neither angles nor radii represent phylogenetic distances. Tree hidden.':showTree?`${layoutMode === 'compact' ? 'Compact layout; branch lengths not to scale.' : 'True radial branch distances with approximate dates.'} ${showAllBranches ? 'Background branches visible' : 'Recorded ancestry only'}. Hover or select a portrait to see its source-tip connection.${growth?'':' Hover order wedges to enlarge; click a wedge to fan out that order.'} Angular spacing follows portrait footprints. Portraits retain the displayed tip angles and stack outward; radius is decorative, not evolutionary time.`:'Tree hidden. Unused angular gaps close into a compact circle, retaining phylogenetic sequence. Angles and portrait radii are decorative.'} ${!showTree?'The small protected center shows the unique recorded species count.':''} Everybird ${sizeMode==='true'?'true size':'averaged size'} scaling. Drag to pan, wheel or pinch to zoom. Use plus and minus to zoom, arrow keys to pan, Home to reset. The taxonomy selector and species list provide accessible selection.`}
      onClick={(event) => {
        if (!interactive||event.defaultPrevented) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const localX = event.clientX - rect.left, localY = event.clientY - rect.top;
        const hit = [...hitBoxesRef.current].reverse().find((box) => localX >= box.x && localX <= box.x + box.width && localY >= box.y && localY <= box.y + box.height);
        if (hit?.order && onSelectGroupRef.current) { onSelectGroupRef.current('order', hit.order); return; }
        if (hit?.code) { onSelectRef.current(hit.code); return; }
        const point = transformRef.current.invert([localX, localY]);
        const wedge = orderWedgesRef.current.find((sector) => containsPolarSector(point[0], point[1], sector));
        if (wedge && onSelectGroupRef.current) { onSelectGroupRef.current('order', wedge.order); return; }
        const nearest = radialPointIndex.find(point[0],point[1],13/transformRef.current.k);
        if (nearest&&!growthState) onSelectRef.current(nearest.code);
      }}
      onPointerMove={(event) => {
        if(!interactive)return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left, y = event.clientY - rect.top;
        const hit = [...hitBoxesRef.current].reverse().find((box) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height);
        const point = transformRef.current.invert([x, y]);
        const wedge = orderWedgesRef.current.find((sector) => containsPolarSector(point[0], point[1], sector));
        const order = hit?.order || wedge?.order || null;
        const code=hit?.code||null;
        event.currentTarget.style.cursor = hit || wedge ? 'pointer' : 'grab';
        if (order !== hoveredOrderRef.current||code!==hoveredCodeRef.current) { hoveredOrderRef.current = order; hoveredCodeRef.current=code;requestDraw(); }
      }}
      onPointerLeave={() => { if (hoveredOrderRef.current||hoveredCodeRef.current) { hoveredOrderRef.current = null;hoveredCodeRef.current=null; requestDraw(); } }}
      onKeyDown={(event) => {
        if(!interactive)return;
        const behavior = zoomRef.current;
        const canvas = canvasRef.current;
        if (!behavior || !canvas) return;
        if (event.key === '+' || event.key === '=') { event.preventDefault(); select(canvas).call(behavior.scaleBy, 1.5); }
        else if (event.key === '-') { event.preventDefault(); select(canvas).call(behavior.scaleBy, 1 / 1.5); }
        else if (event.key === 'Home' || event.key === '0') { event.preventDefault(); reset(); }
        else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault();
          const amount = 70 / transformRef.current.k;
          select(canvas).call(behavior.translateBy, event.key === 'ArrowLeft' ? amount : event.key === 'ArrowRight' ? -amount : 0, event.key === 'ArrowUp' ? amount : event.key === 'ArrowDown' ? -amount : 0);
        }
      }} />
  </div>;
});
