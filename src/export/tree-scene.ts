import type { Taxon, TreeData } from '../types';
import type { StickerGeometryData, StickerSizeMode } from '../embedding/sticker-types';
import { buildLayout, computeTreeVisibility, mappedTipIds, recordedOrderGroups, type LayoutMode } from '../tree/geometry';
import { radialPortraitSizes, radialStickerLayout, radialViewportFit } from '../tree/radial-sticker-placement';
import { appendRoundedBranch, buildBranchGrowthPlan, traceBranchGrowth } from '../tree/branch-growth';
import { drawTreeScene, treeGrowthBranches, treeGrowthPoints, type RadialPortrait, type RendererOrder, type RendererTip } from '../tree/renderer';
import { ArtworkResolver } from '../tree/artwork-resolution';
import type { ArtworkClient } from '../tree/shared-artwork';
import type { ColorPalette } from '../tree/visual-theme';

export interface ExportTreeGeometryOptions {
  tree: TreeData;
  taxa: readonly Taxon[];
  finalCodes: ReadonlySet<string>;
  geometry?: StickerGeometryData;
  sizeMode: StickerSizeMode;
  layoutMode: LayoutMode;
  width: number;
  height: number;
}

function validateSize(width:number,height:number) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Export tree dimensions must be finite and positive.');
}

/** Prepare the same final-scope geometry as TreeCanvas without any DOM or timers. */
export function prepareExportTreeGeometry(options: ExportTreeGeometryOptions) {
  const {tree,taxa,sizeMode,layoutMode,width,height}=options;
  validateSize(width,height);
  const taxaByCode=new Map(taxa.map(taxon=>[taxon.code,taxon]));
  const finalCodes=new Set([...options.finalCodes].filter(code=>taxaByCode.get(code)?.category==='species'));
  const referenceCodes=[...finalCodes];
  const sizing=radialPortraitSizes(referenceCodes,options.geometry,sizeMode);
  const tipWeights=new Map<number,number>();
  for(const code of referenceCodes){
    const taxon=taxaByCode.get(code),dimensions=sizing.sizes.get(code);
    if(!taxon||!dimensions)continue;
    const footprint=Math.pow(dimensions.width*dimensions.height,.625);
    for(const tip of mappedTipIds(taxon))tipWeights.set(tip,Math.max(tipWeights.get(tip)||0,footprint));
  }
  const visibility=computeTreeVisibility(tree,taxa,finalCodes,null,false);
  const layout=buildLayout(tree,{mode:layoutMode,visibleTips:visibility.tipIds,tipWeights});
  const tipTaxa=new Map<number,Taxon[]>();
  for(const taxon of taxa){
    if(taxon.category!=='species')continue;
    for(const tip of mappedTipIds(taxon)){
      const members=tipTaxa.get(tip)||[];members.push(taxon);tipTaxa.set(tip,members);
    }
  }
  const points:RendererTip[]=tree.tips.flatMap(id=>{
    if(!visibility.tipIds.has(id))return [];
    const candidates=tipTaxa.get(id)||[];
    const taxon=candidates.find(candidate=>finalCodes.has(candidate.code))||candidates[0];
    return taxon?[{...layout.nodes[id],code:taxon.code,taxon}]:[];
  });
  const sources=[...finalCodes].sort().flatMap(code=>{
    const taxon=taxaByCode.get(code)!,dimensions=sizing.sizes.get(code);
    if(!dimensions)return [];
    return mappedTipIds(taxon).flatMap(id=>layout.nodes[id]?[{id:`${code}:${id}`,code,taxon,angle:layout.nodes[id].angle,...dimensions,tip:{...layout.nodes[id],code,taxon}}]:[]);
  });
  const radialLayout=radialStickerLayout(sources);
  const sourcesById=new Map(sources.map(source=>[source.id,source]));
  const portraits:RadialPortrait[]=radialLayout.points.map(point=>({...sourcesById.get(point.id)!,...point}));
  const transform=radialViewportFit(radialLayout.bounds,width,height);
  let hash=2166136261;
  for(const portrait of portraits)for(const character of `${portrait.id}:${portrait.x},${portrait.y},${portrait.width},${portrait.height};`)hash=Math.imul(hash^character.charCodeAt(0),16777619);
  const signature=`${portraits.length}:${(hash>>>0).toString(16)}`;
  const orders:RendererOrder[]=[...recordedOrderGroups(taxa,finalCodes)].flatMap(([name,members])=>{
    const mappedMembers=members.filter(member=>mappedTipIds(member).length);
    if(!mappedMembers.length)return [];
    const source=tree.sourceClades?.find(clade=>clade.rank==='order'&&clade.name===name);
    const step=Math.PI*2/Math.max(1,layout.tipCount);
    const tipNodes=[...new Set(mappedMembers.flatMap(mappedTipIds))].map(id=>layout.nodes[id]);
    let start=Math.min(...tipNodes.map(node=>node.angularStart??node.angle-step/2)),end=Math.max(...tipNodes.map(node=>node.angularEnd??node.angle+step/2));
    if(source){
      const node=tree.nodes[source.nodeId];
      start=layout.nodes[source.nodeId].angularStart??node.leafStart/tree.tips.length*Math.PI*2-Math.PI/2;
      end=layout.nodes[source.nodeId].angularEnd??node.leafEnd/tree.tips.length*Math.PI*2-Math.PI/2;
    }
    return [{name,count:members.length,start,end,verified:Boolean(source)}];
  }).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
  return {tree,width,height,taxaByCode,finalCodes,layout,visibility,sizing,tipWeights,tipTaxa,points,portraits,radialLayout,transform,signature,orders};
}

export interface ExportTreeFrame {
  revealedCodes: ReadonlySet<string>;
  newCodes: ReadonlySet<string>;
  /** Already-eased animation fraction; one represents a completed date frame. */
  progress: number;
  date: string|null;
}

/** Injection is useful for pure tests; browsers use native Path2D by default. */
export type ExportPathFactory=()=>Path2D;
export interface PrepareExportTreeOptions extends ExportTreeGeometryOptions {
  cache: ArtworkClient;
  colors: Readonly<ColorPalette>;
  pathFactory?: ExportPathFactory;
}
export type ExportTreeDrawResult=ReturnType<typeof drawTreeScene>&{speciesCount:number;signature:string};

function abortError(){return new DOMException('Animation export cancelled.','AbortError');}
async function abortable<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return promise;
  if(signal.aborted)throw abortError();
  return new Promise<T>((resolve,reject)=>{
    const aborted=()=>{signal.removeEventListener('abort',aborted);reject(abortError());};
    signal.addEventListener('abort',aborted,{once:true});
    promise.then(value=>{signal.removeEventListener('abort',aborted);resolve(value);},error=>{signal.removeEventListener('abort',aborted);reject(error);});
  });
}

/**
 * A fixed camera/layout, with explicit frame input for offline GIF frames and
 * video recording. The supplied artwork client belongs to this scene and is
 * released by dispose; other clients in a SharedArtworkPool remain unaffected.
 */
export function prepareExportTree(options:PrepareExportTreeOptions) {
  const geometry=prepareExportTreeGeometry(options);
  const {cache}=options,colors=Object.freeze({...options.colors});
  const makePath=options.pathFactory??(()=>new Path2D());
  const resolver=new ArtworkResolver();
  let disposed=false;
  const pathsFor=(ids:ReadonlySet<number>)=>{
    const path=makePath();
    for(const id of ids){const node=geometry.tree.nodes[id];if(node?.parent!==null&&node?.parent!==undefined)appendRoundedBranch(path,geometry.layout.nodes[node.parent],geometry.layout.nodes[id]);}
    return path;
  };
  const prepareFrame=(frame:ExportTreeFrame)=>{
    const state=treeGrowthBranches(geometry.tree,geometry.taxaByCode,geometry.finalCodes,frame);
    const orderCounts=new Map<string,number>();
    for(const code of state.codes){const order=geometry.taxaByCode.get(code)?.order;if(order)orderCounts.set(order,(orderCounts.get(order)||0)+1);}
    return {
      state,prior:pathsFor(state.priorNodeIds),fresh:pathsFor(state.newNodeIds),
      plan:buildBranchGrowthPlan(geometry.tree,geometry.layout,state.newNodeIds),
      points:treeGrowthPoints(geometry.points,geometry.tipTaxa,state,null),
      orders:geometry.orders.flatMap(order=>orderCounts.has(order.name)?[{...order,count:orderCounts.get(order.name)!}]:[]),
    };
  };
  let current:ReturnType<typeof prepareFrame>|undefined;
  let lastDate:string|null|undefined,lastRevealed:ReadonlySet<string>|undefined,lastNew:ReadonlySet<string>|undefined;
  const draw=(ctx:CanvasRenderingContext2D,frame:ExportTreeFrame):ExportTreeDrawResult=>{
    if(disposed)throw new Error('Export tree scene has been disposed.');
    if(!current||frame.date!==lastDate||frame.revealedCodes!==lastRevealed||frame.newCodes!==lastNew){
      current=prepareFrame(frame);lastDate=frame.date;lastRevealed=frame.revealedCodes;lastNew=frame.newCodes;
    }
    const progress=Number.isFinite(frame.progress)?Math.max(0,Math.min(1,frame.progress)):1;
    const branchProgress=Math.min(1,progress/.8);
    let newPath=current.fresh;
    if(branchProgress<1){newPath=makePath();traceBranchGrowth(newPath,current.plan,branchProgress);}
    const result=drawTreeScene(ctx,{
      width:geometry.width,height:geometry.height,transform:geometry.transform,baseScale:geometry.transform.k,
      layout:geometry.layout,points:current.points,clades:[],orders:current.orders,
      observedCodes:geometry.finalCodes,selectedCode:null,backgroundPath:null,observedPath:current.prior,selectedPath:null,
      cache,radialPortraits:geometry.portraits,showTree:true,speciesCount:current.state.codes.size,colors,artworkResolver:resolver,pixelRatio:1,
      growth:{revealedCodes:current.state.codes,newCodes:current.state.newCodes,newTipIds:current.state.newTipIds,progress,newPath,branchPlan:current.plan},
    });
    return {...result,speciesCount:current.state.codes.size,signature:geometry.signature};
  };
  const finalFrame:ExportTreeFrame={revealedCodes:geometry.finalCodes,newCodes:new Set(),progress:1,date:null};
  return {
    geometry,draw,
    /** Warm both the overview and any sharper tiers required by the export size. */
    async preload(ctx:CanvasRenderingContext2D,timeoutMs=15000,signal?:AbortSignal):Promise<ExportTreeDrawResult>{
      if(signal?.aborted)throw abortError();
      const deadline=Date.now()+Math.max(0,Number.isFinite(timeoutMs)?timeoutMs:15000);
      let result=draw(ctx,finalFrame);
      for(let pass=0;pass<4;pass++){
        if(signal?.aborted)throw abortError();
        await abortable(cache.settleVisible(Math.max(0,deadline-Date.now())),signal);
        if(signal?.aborted)throw abortError();
        result=draw(ctx,finalFrame);
        const metrics=cache.metrics();
        if((!metrics.visibleQueued&&!metrics.visibleActive)||Date.now()>=deadline)break;
      }
      const pending=cache.metrics();
      if(pending.visibleQueued||pending.visibleActive)throw new Error('Bird illustrations did not finish loading for the animation. Try exporting again.');
      return result;
    },
    dispose(){if(disposed)return;disposed=true;current=undefined;cache.dispose();},
  };
}
