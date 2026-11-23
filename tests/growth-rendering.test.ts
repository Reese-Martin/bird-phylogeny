import {describe,expect,it} from 'vitest';
import type {Taxon,TreeData} from '../src/types';
import {buildLayout,computeTreeVisibility,mappedTipIds} from '../src/tree/geometry';
import {drawTreeScene,treeGrowthBranches,treeGrowthPoints,type RadialPortrait,type RendererTip,type TreeGrowthReveal} from '../src/tree/renderer';
import {radialPortraitSizes,radialStickerLayout,radialViewportFit} from '../src/tree/radial-sticker-placement';
import {buildBranchGrowthPlan} from '../src/tree/branch-growth';
import type {ArtworkCache,ArtworkRequest} from '../src/tree/artwork-cache';
import {COLORS} from '../src/tree/visual-theme';

const tree:TreeData={version:'Test dated tree',root:0,maxDistance:100,tips:[2,3,4],nodes:[
  {id:0,parent:null,children:[1,4],length:0,distance:0,age:100,leafStart:0,leafEnd:3},
  {id:1,parent:0,children:[2,3],length:40,distance:40,age:60,leafStart:0,leafEnd:2},
  {id:2,parent:1,children:[],length:60,distance:100,age:0,leafStart:0,leafEnd:1},
  {id:3,parent:1,children:[],length:60,distance:100,age:0,leafStart:1,leafEnd:2},
  {id:4,parent:0,children:[],length:100,distance:100,age:0,leafStart:2,leafEnd:3},
]};
const species=(code:string,source:Partial<Taxon>):Taxon=>({code,commonName:`Bird ${code}`,scientificName:`Genus ${code}`,category:'species',mappingStatus:'exact',order:'Testiformes',stickerSmall:`/stickers/128/${code}.webp`,...source});
// The full source-tip representative b arrives after a, and d covers two historical tips.
const taxa=[species('b',{treeTip:2,mappingStatus:'broader'}),species('a',{treeTip:2,mappingStatus:'broader'}),species('c',{treeTip:3}),species('d',{treeTips:[3,4],mappingStatus:'narrower'}),species('unplaced',{mappingStatus:'unresolved'}),species('outside',{treeTip:4}),species('not-species',{category:'slash',treeTip:4})];
const taxaByCode=new Map(taxa.map(taxon=>[taxon.code,taxon]));
const finalCodes=new Set(['a','b','c','d','unplaced']);
const reveal=(codes:string[],newCodes:string[]=codes):TreeGrowthReveal=>({revealedCodes:new Set(codes),newCodes:new Set(newCodes),date:'2020-01-01'});

describe('growing recorded ancestry',()=>{
  it('starts empty and clamps incoming membership to known species in the final scope',()=>{
    const empty=treeGrowthBranches(tree,taxaByCode,finalCodes,reveal([]));
    expect([...empty.nodeIds]).toEqual([]);expect([...empty.tipIds]).toEqual([]);expect([...empty.codes]).toEqual([]);
    const result=treeGrowthBranches(tree,taxaByCode,finalCodes,reveal(['a','outside','not-species','unknown'],['a','outside','unknown']));
    expect([...result.codes]).toEqual(['a']);expect([...result.newCodes]).toEqual(['a']);expect([...result.nodeIds].sort()).toEqual([0,1,2]);
  });

  it('adds only required ancestry, retaining old connecting branches as new dates arrive',()=>{
    const first=treeGrowthBranches(tree,taxaByCode,finalCodes,reveal(['a']));
    const next=treeGrowthBranches(tree,taxaByCode,finalCodes,reveal(['a','c'],['c']));
    expect([...next.priorNodeIds]).toEqual([...first.nodeIds]);expect([...next.newNodeIds]).toEqual([3]);
    for(const id of first.nodeIds)expect(next.nodeIds.has(id)).toBe(true);
    expect([...next.nodeIds].sort()).toEqual([0,1,2,3]);expect(next.nodeIds.has(4)).toBe(false);
    const last=treeGrowthBranches(tree,taxaByCode,finalCodes,reveal([...finalCodes],['d','unplaced']));
    const normal=computeTreeVisibility(tree,taxa,new Set(finalCodes),null);
    expect([...last.nodeIds].sort()).toEqual([...normal.recordedNodeIds].sort());
    expect([...last.newNodeIds]).toEqual([4]);expect(last.codes.size).toBe(5);expect(last.tipIds.size).toBe(3);
  });

  it('shares historical tips without regrowing branches or hiding an earlier split species',()=>{
    const fixedPoints=[{...buildLayout(tree).nodes[2],code:'b',taxon:taxaByCode.get('b')!}];
    const tipTaxa=new Map([[2,[taxaByCode.get('b')!,taxaByCode.get('a')!]]]);
    const first=treeGrowthBranches(tree,taxaByCode,finalCodes,reveal(['a']));
    const firstPoints=treeGrowthPoints(fixedPoints,tipTaxa,first,'b');
    expect(firstPoints.map(point=>point.code)).toEqual(['a']);expect(firstPoints[0].taxon.mappingStatus).toBe('broader');
    const next=treeGrowthBranches(tree,taxaByCode,finalCodes,reveal(['a','b'],['b']));
    expect([...next.newNodeIds]).toEqual([]);expect([...next.newTipIds]).toEqual([]);expect(next.codes.size).toBe(2);
    expect(treeGrowthPoints(fixedPoints,tipTaxa,next,null)[0].code).toBe('a');
    expect(treeGrowthPoints(fixedPoints,tipTaxa,next,'b')[0].code).toBe('b');
    expect(treeGrowthPoints(fixedPoints,tipTaxa,treeGrowthBranches(tree,taxaByCode,finalCodes,reveal([])),null)).toEqual([]);
  });

  it('can scrub backwards and never rewrites source nodes, dates, input sets or final coordinates',()=>{
    const source=structuredClone(tree),input=reveal(['a','b','c'],['c']),before=[...input.revealedCodes];
    const full=treeGrowthBranches(tree,taxaByCode,finalCodes,input),back=treeGrowthBranches(tree,taxaByCode,finalCodes,reveal(['a'],[]));
    expect(back.nodeIds.size).toBeLessThan(full.nodeIds.size);expect(back.newNodeIds.size).toBe(0);
    expect(tree).toEqual(source);expect([...input.revealedCodes]).toEqual(before);
    const layout=buildLayout(tree,{visibleTips:full.tipIds});
    for(const tip of tree.tips)expect(layout.nodes[tip].radius).toBe(tree.nodes[tip].distance/tree.maxDistance);
  });
});

const visibility=computeTreeVisibility(tree,taxa,finalCodes,null);
const sizing=radialPortraitSizes([...finalCodes],undefined,'even');
const weights=new Map<number,number>();
for(const code of finalCodes)for(const tip of mappedTipIds(taxaByCode.get(code)))weights.set(tip,.02);
const layout=buildLayout(tree,{visibleTips:visibility.tipIds,tipWeights:weights});
const tipTaxa=new Map(tree.tips.map(id=>[id,taxa.filter(taxon=>mappedTipIds(taxon).includes(id))]));
const points:RendererTip[]=tree.tips.map(id=>({...layout.nodes[id],code:tipTaxa.get(id)![0].code,taxon:tipTaxa.get(id)![0]}));
const sources=[...finalCodes].flatMap(code=>{const taxon=taxaByCode.get(code)!;return mappedTipIds(taxon).map(id=>({id:`${code}:${id}`,code,taxon,angle:layout.nodes[id].angle,...sizing.sizes.get(code)!,tip:{...layout.nodes[id],code,taxon}}));});
const packed=radialStickerLayout(sources);
const portraits:RadialPortrait[]=packed.points.map(point=>({...sources.find(source=>source.id===point.id)!,...point}));
const transform=radialViewportFit(packed.bounds,800,700);
const normalPath={label:'all recorded'} as unknown as Path2D;
const priorPath={label:'old ancestry'} as unknown as Path2D;
const freshPath={label:'new ancestry'} as unknown as Path2D;
const selectedPath={label:'selection'} as unknown as Path2D;

function render(growth?:TreeGrowthReveal,progress=1,selectedCode:string|null=null,ready=true,view=transform){
  const calls:Array<{method:string;args:any[];alpha:number;stroke?:string;fill?:string;join?:string;cap?:string}>=[],state:Record<string,any>={globalAlpha:1},stack:Record<string,any>[]=[];
  const ctx=new Proxy({},{
    get:(_target,key)=>key==='measureText'?(value:string)=>({width:value.length*5}):(...args:any[])=>{
      if(key==='save')stack.push({...state});
      if(key==='restore'){Object.keys(state).forEach(key=>delete state[key]);Object.assign(state,stack.pop());}
      calls.push({method:String(key),args,alpha:state.globalAlpha,stroke:state.strokeStyle,fill:state.fillStyle,join:state.lineJoin,cap:state.lineCap});
    },
    set:(_target,key,value)=>{state[String(key)]=value;return true;},
  }) as CanvasRenderingContext2D;
  let requests:ArtworkRequest[]=[];
  const image={naturalWidth:128,naturalHeight:128};
  const cache={peek:()=>({state:ready?'ready':'queued'}),getReady:(keys:readonly string[])=>ready&&keys.length?{key:keys[0],value:image}:undefined,setWanted:(wanted:ArtworkRequest[])=>{requests=wanted;}} as unknown as ArtworkCache<HTMLImageElement>;
  const stateForGrowth=growth?treeGrowthBranches(tree,taxaByCode,finalCodes,growth):null;
  const scenePoints=stateForGrowth?treeGrowthPoints(points,tipTaxa,stateForGrowth,selectedCode):points;
  const result=drawTreeScene(ctx,{
    width:800,height:700,transform:view,baseScale:transform.k,layout,points:scenePoints,clades:[],orders:[],observedCodes:finalCodes,selectedCode,
    backgroundPath:null,observedPath:stateForGrowth?priorPath:normalPath,selectedPath:selectedCode?selectedPath:null,cache,radialPortraits:portraits,showTree:true,speciesCount:stateForGrowth?.codes.size??finalCodes.size,
    growth:stateForGrowth?{revealedCodes:stateForGrowth.codes,newCodes:stateForGrowth.newCodes,newTipIds:stateForGrowth.newTipIds,progress,newPath:freshPath,branchPlan:buildBranchGrowthPlan(tree,layout,stateForGrowth.newNodeIds)}:undefined,
  });
  return{result,calls,requests,stack,stateForGrowth};
}

describe('fixed-geometry growth scene',()=>{
  it('prefetches the complete final overview from an empty frame without drawing or exposing future birds',()=>{
    const frame=render(reveal([]),1,'b',false);
    expect(frame.result.hitBoxes).toEqual([]);expect(frame.result.radialPortraitCount).toBe(0);expect(frame.result.visibleCount).toBe(0);
    expect(frame.calls.filter(call=>call.method==='drawImage'||call.method==='fillText'||call.method==='roundRect')).toEqual([]);
    expect(frame.calls.some(call=>call.method==='stroke'&&call.args[0]===selectedPath)).toBe(false);
    expect(new Set(frame.requests.map(request=>request.key))).toEqual(new Set(['a','b','c','d'].map(code=>`/stickers/32/${code}.webp`)));
    expect(frame.requests.every(request=>request.priority===100)).toBe(true);
  });

  it('prioritizes fresh and revealed birds before future overview requests, including outside the viewport',()=>{
    const frame=render(reveal(['a','c'],['c']),.5,null,false,{...transform,x:-10000});
    const priority=(code:string)=>frame.requests.find(request=>request.key.endsWith(`/${code}.webp`))?.priority;
    expect(priority('c')).toBeGreaterThan(priority('a')!);expect(priority('a')).toBeGreaterThan(priority('b')!);
    expect(frame.requests.every(request=>request.key.startsWith('/stickers/32/'))).toBe(true);
    expect(frame.result.hitBoxes).toEqual([]);expect(frame.result.visibleCount).toBe(0);
  });

  it('keeps growing paths opaque and reveals portraits only after their own branches arrive',()=>{
    const growing=render(reveal(['a','c'],['c']),.5,'c');
    expect(growing.result.hitBoxes.map(box=>box.code)).toEqual(['a']);
    expect(growing.calls.filter(call=>call.method==='drawImage')).toHaveLength(1);
    expect(growing.calls.some(call=>call.method==='stroke'&&call.args[0]===selectedPath)).toBe(false);
    const frame=render(reveal(['a','c'],['c']),.9);
    expect(frame.calls.find(call=>call.method==='stroke'&&call.args[0]===priorPath)?.alpha).toBe(1);
    expect(frame.calls.find(call=>call.method==='stroke'&&call.args[0]===freshPath)?.alpha).toBe(1);
    expect(frame.calls.find(call=>call.method==='stroke'&&call.args[0]===priorPath)?.stroke).toBe(COLORS.observed);
    expect(frame.calls.find(call=>call.method==='stroke'&&call.args[0]===freshPath)).toMatchObject({stroke:COLORS.accent,join:'round',cap:'round'});
    const draws=frame.calls.filter(call=>call.method==='drawImage');
    expect(draws).toHaveLength(2);expect(draws.map(call=>call.alpha).sort()[0]).toBeCloseTo(.5);expect(draws.map(call=>call.alpha).sort()[1]).toBe(1);
    expect(new Set(frame.result.hitBoxes.map(box=>box.code))).toEqual(new Set(['a','c']));expect(frame.stack).toEqual([]);
    const hidden=render(reveal(['a','c'],['c']),0);
    expect(hidden.result.hitBoxes.map(box=>box.code)).toEqual(['a']);
    expect(hidden.calls.some(call=>call.method==='stroke'&&call.args[0]===freshPath)).toBe(false);
    expect(hidden.calls.filter(call=>call.method==='drawImage')).toHaveLength(1);
  });

  it('adds a shared-tip portrait without fading or removing the preexisting source anchor',()=>{
    const frame=render(reveal(['a','b'],['b']),.4);
    expect(frame.stateForGrowth?.newTipIds.size).toBe(0);expect(frame.stateForGrowth?.newNodeIds.size).toBe(0);
    const anchor=layout.nodes[2];
    const dots=frame.calls.filter(call=>call.method==='arc'&&call.args[0]===anchor.x*transform.k+transform.x&&call.args[1]===anchor.y*transform.k+transform.y);
    expect(dots).toHaveLength(1);expect(dots[0].alpha).toBe(1);
    expect(frame.result.hitBoxes).toHaveLength(2);expect(frame.result.visibleCount).toBe(2);
  });

  it('uses ordinary tip dots for changed source concepts without extra flags or diamonds',()=>{
    const frame=render(reveal([...finalCodes],[]));
    expect(frame.calls.some(call=>call.method==='closePath')).toBe(false);
    expect(frame.calls.filter(call=>call.method==='stroke'&&call.args.length===0&&call.stroke===COLORS.accent)).toHaveLength(0);
    expect(taxaByCode.get('a')?.mappingStatus).toBe('broader');expect(taxaByCode.get('d')?.mappingStatus).toBe('narrower');
  });

  it('has exactly the normal final portrait positions and dimensions, including for reduced motion',()=>{
    const snapshot=structuredClone({tree,layout,portraits,transform});
    expect(packed.overlapCount).toBe(0);expect(packed.maxAngleError).toBeLessThan(1e-12);
    const normal=render(),final=render(reveal([...finalCodes],['d']),1);
    const images=(calls:typeof final.calls)=>calls.filter(call=>call.method==='drawImage').map(({args,alpha})=>({args,alpha}));
    expect(images(final.calls)).toEqual(images(normal.calls));
    expect(final.result.hitBoxes).toEqual(normal.result.hitBoxes);expect(final.result.visibleCount).toBe(4);expect(final.result.readyPortraitCount).toBe(4);
    expect([...final.stateForGrowth!.nodeIds].sort()).toEqual([...visibility.recordedNodeIds].sort());
    const early=render(reveal(['a']),1),later=render(reveal(['a','c'],['c']),1);
    expect(early.calls.filter(call=>call.method==='drawImage')[0].args).toEqual(later.calls.filter(call=>call.method==='drawImage')[0].args);
    expect({tree,layout,portraits,transform}).toEqual(snapshot);
    expect(final.calls.every(call=>call.alpha===1)).toBe(true);expect(final.stack).toEqual([]);
  });
});
