import type { Taxon, TreeData } from '../types';
import { ArtworkCache, type ArtworkRequest } from './artwork-cache';
import { ageRingStep, collectAncestry, mappedTipIds, type LayoutNode, type TreeLayout } from './geometry';
import { COLORS, colorWithAlpha, FAMILY_LABELS, FONT, type ColorPalette } from './visual-theme';
import { annotationRectsOverlap, leaderSegments, placeAnnotation, type AnnotationRect, type RadialStickerPlacement } from './radial-sticker-placement';
import { ArtworkResolver, artworkRequests, baseArtworkPath, readyArtwork, type ArtworkSelection } from './artwork-resolution';
import type { ArtworkImage } from './artwork-image-loader';
import { artworkDimensions } from './sticker-delivery';
import type { BranchGrowthPlan } from './branch-growth';

type SceneArtworkCache = Pick<ArtworkCache<ArtworkImage>, 'peek' | 'getReady' | 'setWanted'>;

export interface RendererTip extends LayoutNode { code: string; taxon: Taxon }
export interface RadialPortrait extends RadialStickerPlacement { code: string; taxon: Taxon; tip: RendererTip }
export interface HitBox { x: number; y: number; width: number; height: number; code?: string; order?: string }
export interface OrderWedge { order: string; start: number; end: number; inner: number; outer: number }
export interface RendererOrder { name: string; count: number; start: number; end: number; verified: boolean }
export interface RendererClade { name: string; node: number; tipCount: number; recordedCount: number; selectedContext?: boolean; rank: 'order' | 'family' | 'genus'; angle?: number }
export interface TreeGrowthReveal {
  revealedCodes: ReadonlySet<string>;
  newCodes: ReadonlySet<string>;
  /** Omit while playing for continuous branch extension; use one for completed date frames. */
  progress?: number;
  durationMs?: number;
  /** Shared event epoch lets comparison panels advance on the same animation clock. */
  startedAt?: number;
  date: string | null;
}
export interface TreeGrowthBranches {
  codes: Set<string>; newCodes: Set<string>; tipIds: Set<number>; nodeIds: Set<number>;
  priorNodeIds: Set<number>; newNodeIds: Set<number>; newTipIds: Set<number>;
}

/** Shared historical source tips grow once, even when another current species later maps to them. */
export function treeGrowthBranches(tree: TreeData, taxa: ReadonlyMap<string, Taxon>, finalCodes: ReadonlySet<string>, growth: Pick<TreeGrowthReveal, 'revealedCodes' | 'newCodes'>): TreeGrowthBranches {
  const codes=new Set([...growth.revealedCodes].filter(code=>finalCodes.has(code)&&taxa.get(code)?.category==='species'));
  const newCodes=new Set([...growth.newCodes].filter(code=>codes.has(code)));
  const tipsFor=(members:Iterable<string>)=>new Set([...members].flatMap(code=>mappedTipIds(taxa.get(code))).filter(id=>tree.nodes[id]&&!tree.nodes[id].children.length));
  const tipIds=tipsFor(codes),priorTips=tipsFor([...codes].filter(code=>!newCodes.has(code)));
  const nodeIds=collectAncestry(tree,tipIds),priorNodeIds=collectAncestry(tree,priorTips);
  return{codes,newCodes,tipIds,nodeIds,priorNodeIds,newNodeIds:new Set([...nodeIds].filter(id=>!priorNodeIds.has(id))),newTipIds:new Set([...tipIds].filter(id=>!priorTips.has(id)))};
}

/** A shared source anchor belongs to a revealed species, even if the final representative arrives later. */
export function treeGrowthPoints(points: RendererTip[], tipTaxa: ReadonlyMap<number, Taxon[]>, growth: TreeGrowthBranches, selectedCode: string|null): RendererTip[] {
  return points.flatMap(point=>{
    if(!growth.tipIds.has(point.id))return [];
    const candidates=tipTaxa.get(point.id)||[];
    const taxon=candidates.find(taxon=>taxon.code===selectedCode&&growth.codes.has(taxon.code))
      ||candidates.find(taxon=>growth.codes.has(taxon.code)&&!growth.newCodes.has(taxon.code))
      ||candidates.find(taxon=>growth.codes.has(taxon.code));
    return taxon?[{...point,code:taxon.code,taxon}]:[];
  });
}
interface SceneOptions {
  width: number; height: number; transform: { x: number; y: number; k: number }; baseScale: number;
  layout: TreeLayout; points: RendererTip[]; clades: RendererClade[]; orders: RendererOrder[];
  observedCodes: Set<string>; selectedCode: string | null;
  backgroundPath: Path2D | null; observedPath: Path2D; selectedPath: Path2D | null;
  cache: SceneArtworkCache; focusedOrder?: string | null; hoveredOrder?: string | null;
  radialPortraits: RadialPortrait[]; hoveredCode?: string | null; showTree?: boolean;
  /** Unique recorded species in the active country/taxonomy group, excluding context. */
  speciesCount: number;
  /** Packing disk reserved for the count in birds-only views, in world units. */
  centerRadius?: number;
  artworkResolver?: ArtworkResolver;
  pixelRatio?: number;
  colors?: Readonly<ColorPalette>;
  growth?: { revealedCodes: ReadonlySet<string>; newCodes: ReadonlySet<string>; newTipIds: ReadonlySet<number>; progress: number; newPath: Path2D; branchPlan: BranchGrowthPlan };
}

/** Portraits follow the arrival of their own source branch, including shared older tips. */
export function growthPortraitOpacity(plan: BranchGrowthPlan, tipId: number, progress: number): number {
  if(progress>=1)return 1;
  if(progress<=0)return 0;
  const segment=plan.byId.get(tipId);
  const arrival=segment&&plan.totalLength>0?segment.endDistance/plan.totalLength*.8:0;
  const t=Math.max(0,Math.min(1,(progress-arrival)/.2));
  return t*t*(3-2*t);
}

function overviewArtwork(selection: ArtworkSelection): ArtworkSelection {
  if(!selection.key||!/^\/stickers\/(?:32|64|128|384)\//.test(selection.key))return selection;
  const key=selection.key.replace(/\/stickers\/\d+\//,'/stickers/32/');
  return{key,tier:32,fallbackKeys:[...new Set([selection.key,...selection.fallbackKeys].filter(path=>path!==key))]};
}

export function artworkPath(taxon: Taxon, large = false): string | undefined {
  return baseArtworkPath(taxon, large);
}

function paintPortrait(ctx: CanvasRenderingContext2D, cache: SceneArtworkCache, artwork: ArtworkSelection, x: number, y: number, width: number, height: number, colors:Readonly<ColorPalette>) {
  const ready = readyArtwork(cache, artwork);
  if (ready) {
    const dimensions=artworkDimensions(ready.value);
    const ratio = Math.min(width / dimensions.width, height / dimensions.height);
    const w = dimensions.width * ratio, h = dimensions.height * ratio;
    ctx.drawImage(ready.value, x + (width - w) / 2, y + (height - h) / 2, w, h);
    return true;
  }
  const entry = artwork.key ? cache.peek(artwork.key) : undefined;
  const size = Math.min(width, height), cx = x + width / 2, cy = y + height / 2;
  ctx.save(); ctx.fillStyle = colors.surface; ctx.beginPath(); ctx.arc(cx, cy, size * .32, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = colors.line; ctx.lineWidth = Math.min(1.2, size * .05); ctx.beginPath();
  if (entry?.state === 'loading' || entry?.state === 'queued') {
    ctx.setLineDash([2, 3]); ctx.arc(cx, cy, size * .25, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  } else {
    ctx.ellipse(cx, cy, size * .12, size * .22, .6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - size * .1, cy + size * .18); ctx.lineTo(cx + size * .09, cy - size * .16); ctx.stroke();
  }
  ctx.restore();
  return false;
}

export function drawTreeScene(ctx: CanvasRenderingContext2D, options: SceneOptions) {
  const { width, height, transform, layout, points, clades, orders, observedCodes, selectedCode, cache } = options;
  const colors=options.colors??COLORS;
  const showTree = options.showTree !== false, { x: tx, y: ty, k } = transform;
  const artworkResolver = options.artworkResolver || new ArtworkResolver();
  const dpr = options.pixelRatio || (typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1));
  const relativeZoom = k / options.baseScale, overview = relativeZoom < 1.75;
  const project = (point: LayoutNode) => ({ x: point.x * k + tx, y: point.y * k + ty });
  const inside = (point: { x: number; y: number }, margin = 0) => point.x >= -margin && point.x <= width + margin && point.y >= -margin && point.y <= height + margin;
  const occupied: HitBox[] = [], hitBoxes: HitBox[] = [], wedges: OrderWedge[] = [], annotationBoxes:AnnotationRect[]=[];
  const fits=(box:AnnotationRect)=>box.x>=4&&box.y>=4&&box.x+box.width<=width-4&&box.y+box.height<=height-4;
  const overlaps = (box: HitBox) => !fits(box)||occupied.some(other=>annotationRectsOverlap(box,other,4));
  const growth=options.growth,progress=growth?Math.max(0,Math.min(1,Number.isFinite(growth.progress)?growth.progress:1)):1;
  const allPlans = options.radialPortraits.map(point => ({
    point, x: point.x * k + tx - point.width * k / 2, y: point.y * k + ty - point.height * k / 2,
    width: point.width * k, height: point.height * k, artwork: artworkResolver.select(point.taxon, Math.max(point.width, point.height) * k, dpr),
  }));
  const onScreen=(p:typeof allPlans[number])=>p.x+p.width>=0&&p.y+p.height>=0&&p.x<=width&&p.y<=height;
  const opacity=(point:RadialPortrait)=>growth?.newCodes.has(point.code)?growthPortraitOpacity(growth.branchPlan,point.tip.id,progress):1;
  const radialPlans=allPlans.filter(p=>onScreen(p)&&(!growth||growth.revealedCodes.has(p.point.code))&&opacity(p.point)>0)
    .sort((a, b) => Number(a.point.code === selectedCode) - Number(b.point.code === selectedCode));
  for (const plan of radialPlans) occupied.push({ x: plan.x, y: plan.y, width: plan.width, height: plan.height });
  const portraitBoxes=radialPlans.map(({x,y,width,height})=>({x,y,width,height}));
  const countRadius=options.centerRadius??.36,centerHalf=k*countRadius*.7;
  const centerCountBox={x:tx-centerHalf,y:ty-centerHalf,width:centerHalf*2,height:centerHalf*2};
  if(!showTree)occupied.push(centerCountBox);
  const activePlans = radialPlans.filter(p => p.point.code === selectedCode || p.point.code === options.hoveredCode);
  const requests: ArtworkRequest[] = (growth?allPlans:radialPlans).flatMap(plan => {
    const shown=!growth||growth.revealedCodes.has(plan.point.code);
    const artwork=growth&&(!shown||!onScreen(plan))?overviewArtwork(plan.artwork):plan.artwork;
    return artworkRequests(cache,artwork,shown&&plan.point.code===selectedCode?1200:shown&&plan.point.code===options.hoveredCode?1100:growth?(growth.newCodes.has(plan.point.code)?1000:shown?600:100):300);
  });
  cache.setWanted(requests);
  const ringStep = ageRingStep(layout.maxDistance);
  ctx.save(); ctx.fillStyle = colors.paper; ctx.fillRect(0, 0, width, height);
  ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
  if (showTree) {
    ctx.save(); ctx.translate(tx, ty); ctx.scale(k, k);
    ctx.lineCap='round';ctx.lineJoin='round';
    if (layout.mode === 'true-distance') {
      ctx.strokeStyle = colors.ring; ctx.lineWidth = Math.min(.65 / k,.07); ctx.setLineDash([2 / k, 5 / k]);
      for (let age = 0; age < layout.maxDistance; age += ringStep) {
        ctx.beginPath(); ctx.arc(0, 0, (layout.maxDistance - age) / layout.maxDistance, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // Wedges remain attached to source geometry; only their hover band expands.
    if (relativeZoom < 2.2) for (const order of orders) {
      if (!order.verified) continue;
      const hover = options.hoveredOrder === order.name, focused = options.focusedOrder === order.name;
      const inner = hover || focused ? .90 : .965, outer = hover || focused ? 1.09 : 1.035;
      ctx.beginPath(); ctx.arc(0, 0, outer, order.start, order.end); ctx.arc(0, 0, inner, order.end, order.start, true); ctx.closePath();
      ctx.fillStyle = colorWithAlpha(hover || focused ? colors.accent : colors.line, hover || focused ? .085 : .04); ctx.fill();
      ctx.strokeStyle = colorWithAlpha(hover || focused ? colors.accent : colors.line, hover || focused ? .45 : .22); ctx.lineWidth = Math.min((hover ? 1.1 : .6) / k,.05); ctx.stroke();
      if(!growth)wedges.push({ order: order.name, start: order.start, end: order.end, inner: .88, outer: 1.12 });
    }
    if (options.backgroundPath) { ctx.strokeStyle = colors.muted; ctx.lineWidth = Math.min(.65 / k,.1); ctx.stroke(options.backgroundPath); }
    ctx.strokeStyle = colors.observed; ctx.lineWidth = Math.min((relativeZoom > 4 ? 1.7 : 1.35) / k,.1); ctx.lineCap = 'round'; ctx.stroke(options.observedPath);
    if(growth&&progress>0){ctx.strokeStyle=colors.accent;ctx.stroke(growth.newPath);}
    if (options.selectedPath && (!growth || selectedCode && growth.revealedCodes.has(selectedCode) && (!growth.newCodes.has(selectedCode)||progress>=1))) { ctx.strokeStyle = colors.accent; ctx.lineWidth = Math.min(2.2 / k,.1); ctx.stroke(options.selectedPath); }
    ctx.restore();
    let cladeLabelCount=0;
    if (!overview) for (const group of clades) {
      if(cladeLabelCount>=12)break;
      if (relativeZoom < 3.5 ? group.rank !== 'family' : group.rank !== 'genus') continue;
      const point = layout.nodes[group.node], angle = group.angle ?? point.angle;
      const x = Math.cos(angle) * k * 1.025 + tx, y = Math.sin(angle) * k * 1.025 + ty;
      if (!inside({ x, y })) continue;
      const label = group.rank === 'family' ? FAMILY_LABELS[group.name] || group.name : group.name;
      ctx.font = `${group.rank === 'genus' ? 'italic ' : ''}11px ${FONT}`;
      const labelWidth = ctx.measureText(label).width;
      const box=placeAnnotation({width,height,anchor:{x:x-1,y:y-1,width:2,height:2},boxWidth:labelWidth+12,boxHeight:30,occupied,exclusionCircle:{x:tx,y:ty,radius:k*1.12}});
      if(!box)continue;
      occupied.push(box); ctx.fillStyle = colors.paper; ctx.fillRect(box.x, box.y, box.width, box.height);
      cladeLabelCount++;
      annotationBoxes.push(box);
      ctx.fillStyle = colors.label; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label,box.x+box.width/2,box.y+9);
      ctx.font = `9px ${FONT}`; ctx.fillStyle = colors.line; ctx.fillText(`${group.recordedCount} recorded`,box.x+box.width/2,box.y+22);
    }
    for (const point of points) {
      if(growth&&!growth.revealedCodes.has(point.code))continue;
      if (!observedCodes.has(point.code) && point.code !== selectedCode && relativeZoom < 4.5) continue;
      const pos = project(point); if (!inside(pos, 10)) continue;
      const pointAlpha=growth?.newTipIds.has(point.id)?growthPortraitOpacity(growth.branchPlan,point.id,progress):1;if(pointAlpha<=0)continue;
      if(pointAlpha<1){ctx.save();ctx.globalAlpha=pointAlpha;}
      ctx.fillStyle = point.code === selectedCode || growth?.newTipIds.has(point.id) ? colors.accent : observedCodes.has(point.code) ? colors.observed : colors.line;
      ctx.beginPath(); ctx.arc(pos.x, pos.y,Math.min(point.code === selectedCode ? 3.8 : 1.9,k*.055),0,Math.PI*2);ctx.fill();
      if(pointAlpha<1)ctx.restore();
    }
    if (relativeZoom < 2.2) for (const order of orders) {
      if (!order.verified) continue;
      const hover = options.hoveredOrder === order.name;
      ctx.font = `600 9px ${FONT}`;
      const textWidth = ctx.measureText(order.name).width;
      if (!hover && (order.end - order.start) * k < textWidth + 18) continue;
      const angle = (order.start + order.end) / 2, radius = hover ? 1.055 : 1.005;
      const x = tx + Math.cos(angle) * k * radius, y = ty + Math.sin(angle) * k * radius;
      if (!inside({ x, y })) continue;
      const rotation=angle+Math.PI/2,bw=Math.abs(Math.cos(rotation))*(textWidth+10)+Math.abs(Math.sin(rotation))*16,bh=Math.abs(Math.sin(rotation))*(textWidth+10)+Math.abs(Math.cos(rotation))*16;
      const labelBox={x:x-bw/2,y:y-bh/2,width:bw,height:bh};
      if(overlaps(labelBox))continue;occupied.push(labelBox);annotationBoxes.push(labelBox);
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle + Math.PI / 2); if (Math.sin(angle) > 0) ctx.rotate(Math.PI);
      ctx.fillStyle = colors.paper; ctx.globalAlpha = .94; ctx.fillRect(-textWidth / 2 - 5, -8, textWidth + 10, 16); ctx.globalAlpha = 1;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = hover ? colors.accent : colors.label; ctx.fillText(order.name, 0, 0); ctx.restore();
    }
    // A source-tip leader appears only for the active portrait.
    for (const plan of activePlans) {
      const source = project(plan.point.tip),end={x:plan.x+plan.width/2,y:plan.y+plan.height/2};
      ctx.strokeStyle = plan.point.code === selectedCode ? colors.accent : colors.line; ctx.lineWidth = Math.min(1,k*.07);ctx.setLineDash([3,3]);ctx.beginPath();
      for(const segment of leaderSegments(source,end,[...portraitBoxes,...annotationBoxes],1)){ctx.moveTo(segment.start.x,segment.start.y);ctx.lineTo(segment.end.x,segment.end.y);}
      ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(source.x,source.y,Math.min(2.8,k*.055),0,Math.PI*2);ctx.stroke();
    }
  }
  const readySpecies = new Set<string>();
  for (const plan of radialPlans) {
    const alpha=opacity(plan.point);if(alpha<1){ctx.save();ctx.globalAlpha=alpha;}
    if (paintPortrait(ctx, cache, plan.artwork, plan.x, plan.y, plan.width, plan.height, colors)) readySpecies.add(plan.point.code);
    if(alpha<1)ctx.restore();
    hitBoxes.push({ x: plan.x, y: plan.y, width: plan.width, height: plan.height, code: plan.point.code });
  }
  for (const plan of activePlans) {
    const selected = plan.point.code === selectedCode;
    const stroke=Math.min(selected?1.3:.8,plan.width/4,plan.height/4),inset=stroke/2;
    ctx.strokeStyle=selected?colors.accent:colors.line;ctx.lineWidth=stroke;ctx.beginPath();ctx.roundRect(plan.x+inset,plan.y+inset,plan.width-stroke,plan.height-stroke,Math.min(4,plan.width/4,plan.height/4));ctx.stroke();
  }
  const uniqueLabels=[...new Map(activePlans.map(plan=>[plan.point.code,plan])).values()].sort((a,b)=>Number(b.point.code===selectedCode)-Number(a.point.code===selectedCode));
  for(const plan of uniqueLabels){
    const selected=plan.point.code===selectedCode;ctx.font=`${selected?'600 ':''}12px ${FONT}`;
    const name=plan.point.taxon.commonName,tw=Math.min(width-24,ctx.measureText(name).width+16);
    const box=placeAnnotation({width,height,anchor:plan,boxWidth:tw,boxHeight:25,occupied,exclusionCircle:showTree?{x:tx,y:ty,radius:k*1.12}:undefined});
    if(!box)continue;occupied.push(box);annotationBoxes.push(box);
    ctx.fillStyle=colors.paper;ctx.fillRect(box.x,box.y,box.width,box.height);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=selected?colors.accent:colors.ink;ctx.fillText(name,box.x+box.width/2,box.y+box.height/2,box.width-12);
    hitBoxes.push({...box,code:plan.point.code});
  }
  if (!showTree && inside({ x: tx, y: ty })) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = colors.ink;
    ctx.font = `500 ${Math.min(36,k*countRadius*.85)}px ${FONT}`;ctx.fillText(options.speciesCount.toLocaleString(),tx,ty-k*countRadius*.24,centerCountBox.width);
    ctx.font = `${Math.min(11,k*countRadius*.45)}px ${FONT}`;ctx.fillStyle=colors.label;ctx.fillText('species',tx,ty+k*countRadius*.45,centerCountBox.width);
  }
  // Mode, root age and the calibrated scale live in the footer, clear of branches.
  ctx.restore();
  return { visibleCount: new Set(radialPlans.map(p => p.point.code)).size, readyPortraitCount: readySpecies.size, hitBoxes, wedges, speciesStickerCount: radialPlans.length, requestedArtwork: requests.length, radialPortraitCount: radialPlans.length,annotationBoxes };
}
