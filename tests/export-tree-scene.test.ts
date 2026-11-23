import {describe,expect,it,vi} from 'vitest';
import type {Taxon,TreeData} from '../src/types';
import type {ArtworkRequest,ArtworkMetrics} from '../src/tree/artwork-cache';
import type {ArtworkClient} from '../src/tree/shared-artwork';
import type {StickerGeometryData} from '../src/embedding/sticker-types';
import {DARK_COLORS} from '../src/tree/visual-theme';
import {mappedTipIds} from '../src/tree/geometry';
import {prepareExportTree,prepareExportTreeGeometry,type ExportTreeFrame} from '../src/export/tree-scene';

const tree:TreeData={version:'Test dated tree',root:0,maxDistance:100,tips:[2,3,4],nodes:[
  {id:0,parent:null,children:[1,4],length:0,distance:0,age:100,leafStart:0,leafEnd:3},
  {id:1,parent:0,children:[2,3],length:40,distance:40,age:60,leafStart:0,leafEnd:2},
  {id:2,parent:1,children:[],length:60,distance:100,age:0,leafStart:0,leafEnd:1},
  {id:3,parent:1,children:[],length:60,distance:100,age:0,leafStart:1,leafEnd:2},
  {id:4,parent:0,children:[],length:100,distance:100,age:0,leafStart:2,leafEnd:3},
]};
const bird=(code:string,source:Partial<Taxon>):Taxon=>({code,category:'species',commonName:`Bird ${code}`,scientificName:`Genus ${code}`,mappingStatus:'exact',order:'Testiformes',stickerSmall:`/stickers/128/${code}.webp`,...source});
const taxa=[bird('b',{treeTip:2,mappingStatus:'broader'}),bird('a',{treeTip:2,mappingStatus:'broader'}),bird('c',{treeTip:3}),bird('d',{treeTips:[3,4],mappingStatus:'narrower'}),bird('unplaced',{mappingStatus:'unresolved'}),bird('outside',{treeTip:4}),bird('slash',{category:'slash',treeTip:4})];
const finalCodes=new Set(['a','b','c','d','unplaced']);
const measurements:StickerGeometryData={version:1,maskLongSide:24,alphaThreshold:40,shapeRef:.4,exponents:{even:.2,true:1/3},species:Object.fromEntries(['a','b','c','d','unplaced'].map((code,index)=>[code,{massG:10*Math.pow(4,index),massSource:'fixture',aspect:1,imageWidth:128,imageHeight:128,mask:[24,24,''],shape:.4}]))};
const base={tree,taxa,finalCodes,geometry:measurements,sizeMode:'even' as const,layoutMode:'true-distance' as const,width:800,height:700};
const frame=(codes:string[],newCodes:string[]=codes,progress=1,date='2024-01-01'):ExportTreeFrame=>({revealedCodes:new Set(codes),newCodes:new Set(newCodes),progress,date});

class TestPath {
  calls:Array<{command:string;args:Array<number|boolean|undefined>}>=[];
  moveTo(x:number,y:number){this.calls.push({command:'moveTo',args:[x,y]});}
  arc(x:number,y:number,radius:number,start:number,end:number,anticlockwise?:boolean){this.calls.push({command:'arc',args:[x,y,radius,start,end,anticlockwise]});}
  lineTo(x:number,y:number){this.calls.push({command:'lineTo',args:[x,y]});}
  quadraticCurveTo(cx:number,cy:number,x:number,y:number){this.calls.push({command:'quadraticCurveTo',args:[cx,cy,x,y]});}
}
function context(){
  const calls:Array<{method:string;args:any[];alpha:number}>=[],state:Record<string,any>={globalAlpha:1},stack:Record<string,any>[]=[];
  const ctx=new Proxy({},{get:(_target,key)=>key==='measureText'?(value:string)=>({width:value.length*5}):(...args:any[])=>{
    if(key==='save')stack.push({...state});
    if(key==='restore'){Object.keys(state).forEach(key=>delete state[key]);Object.assign(state,stack.pop());}
    calls.push({method:String(key),args,alpha:state.globalAlpha});
  },set:(_target,key,value)=>{state[String(key)]=value;return true;}}) as CanvasRenderingContext2D;
  return{ctx,calls,stack};
}
function cache(){
  const image={naturalWidth:128,naturalHeight:128},requests:ArtworkRequest[][]=[];
  const metrics={visibleQueued:0,visibleActive:0} as ArtworkMetrics;
  const client:ArtworkClient={
    setWanted:wanted=>requests.push(wanted),getReady:keys=>keys.length?{key:keys[0],value:image as HTMLImageElement}:undefined,
    peek:()=>({state:'ready'}),metrics:()=>metrics,settleVisible:vi.fn(async()=>{}),dispose:vi.fn(),
  };
  return{client,requests};
}

describe('fixed export tree geometry',()=>{
  it.each(['true-distance','compact'] as const)('retains source sequence, footprint sizing and geometry through %s preparation',mode=>{
    const before=structuredClone({tree,taxa,measurements,codes:[...finalCodes]});
    const prepared=prepareExportTreeGeometry({...base,layoutMode:mode});
    expect(prepared.radialLayout.overlapCount).toBe(0);expect(prepared.radialLayout.maxAngleError).toBeLessThan(1e-12);
    expect(prepared.portraits).toHaveLength(5);
    expect(new Set(prepared.portraits.map(p=>p.code))).toEqual(new Set(['a','b','c','d']));
    for(const portrait of prepared.portraits){
      expect(portrait.angle).toBe(prepared.layout.nodes[portrait.tip.id].angle);
      expect({width:portrait.width,height:portrait.height}).toEqual(prepared.sizing.sizes.get(portrait.code));
    }
    const sharedWeights=['a','b'].map(code=>{const size=prepared.sizing.sizes.get(code)!;return Math.pow(size.width*size.height,.625);});
    expect(prepared.tipWeights.get(2)).toBe(Math.max(...sharedWeights));
    if(mode==='true-distance')for(const id of tree.tips)expect(prepared.layout.nodes[id].radius).toBe(tree.nodes[id].distance/tree.maxDistance);
    expect({tree,taxa,measurements,codes:[...finalCodes]}).toEqual(before);
  });

  it('only changes the camera when output size changes and excludes non-species identities',()=>{
    const prepared=prepareExportTreeGeometry({...base,finalCodes:new Set([...finalCodes,'slash','unknown'])});
    const small=prepareExportTreeGeometry({...base,width:320,height:220});
    expect(prepared.finalCodes).toEqual(finalCodes);expect(prepared.finalCodes.size).toBe(5);
    expect(prepared.portraits).toEqual(small.portraits);expect(prepared.signature).toBe(small.signature);
    expect(prepared.layout).toEqual(small.layout);expect(prepared.transform.k).toBeGreaterThan(small.transform.k);
    expect(prepared.points.map(point=>point.id)).toEqual(tree.tips);
    for(const point of prepared.points)expect(mappedTipIds(point.taxon)).toContain(point.id);
  });

  it('handles an empty scope without Path2D and rejects invalid viewport sizes',()=>{
    const empty=prepareExportTreeGeometry({...base,finalCodes:new Set()});
    expect(empty.portraits).toEqual([]);expect(empty.points).toEqual([]);expect(empty.signature).toBe('0:811c9dc5');
    expect(Number.isFinite(empty.transform.k)).toBe(true);
    for(const value of [0,-1,NaN,Infinity]){
      expect(()=>prepareExportTreeGeometry({...base,width:value})).toThrow('finite and positive');
      expect(()=>prepareExportTreeGeometry({...base,height:value})).toThrow('finite and positive');
    }
  });
});

describe('explicit deterministic export frames',()=>{
  it('draws partial branches at full opacity, delays fresh birds until arrival and keeps old positions fixed',()=>{
    const {client}=cache(),paths:TestPath[]=[];
    const prepared=prepareExportTree({...base,cache:client,colors:DARK_COLORS,pathFactory:()=>{const path=new TestPath();paths.push(path);return path as unknown as Path2D;}});
    const {ctx,calls,stack}=context();
    const current=frame(['a','c'],['c'],.3);
    const first=prepared.draw(ctx,current);
    expect(first.speciesCount).toBe(2);expect(first.visibleCount).toBe(1);expect(first.readyPortraitCount).toBe(1);
    expect(first.hitBoxes.map(hit=>hit.code)).toEqual(['a']);
    const oldImage=calls.find(call=>call.method==='drawImage')!.args;
    const stroked=calls.filter(call=>call.method==='stroke'&&call.args[0] instanceof TestPath);
    expect(stroked).toHaveLength(2);expect(stroked.every(call=>call.alpha===1)).toBe(true);
    expect(paths).toHaveLength(3);
    const partial=paths[2].calls.at(-1)!;expect(partial.command==='lineTo'||partial.command==='arc').toBe(true);
    calls.length=0;
    const middle=prepared.draw(ctx,{...current,progress:.5});
    expect(paths).toHaveLength(4);expect(middle.signature).toBe(first.signature);
    expect(calls.find(call=>call.method==='drawImage')!.args).toEqual(oldImage);
    calls.length=0;
    const arrival=prepared.draw(ctx,{...current,progress:.9});
    expect(paths).toHaveLength(4);expect(arrival.visibleCount).toBe(2);
    expect(calls.filter(call=>call.method==='drawImage').map(call=>call.alpha).sort()[0]).toBeCloseTo(.5);
    calls.length=0;
    const complete=prepared.draw(ctx,{...current,progress:1});
    expect(complete.readyPortraitCount).toBe(2);expect(paths).toHaveLength(4);
    expect(calls.filter(call=>call.method==='drawImage').every(call=>call.alpha===1)).toBe(true);
    expect(stack).toEqual([]);
  });

  it('supports forward and backward seeks, shared historical anchors and explicit membership clamping',()=>{
    const {client}=cache(),{ctx}=context();
    const prepared=prepareExportTree({...base,cache:client,colors:DARK_COLORS,pathFactory:()=>new TestPath() as unknown as Path2D});
    const original=structuredClone(prepared.geometry.portraits);
    const early=prepared.draw(ctx,frame(['a','outside'],['a']));
    expect(early.speciesCount).toBe(1);expect(early.visibleCount).toBe(1);
    const later=prepared.draw(ctx,frame(['a','b'],['b']));
    expect(later.speciesCount).toBe(2);expect(later.visibleCount).toBe(2);
    const complete=prepared.draw(ctx,frame([...finalCodes],[],1,'2026-01-01'));
    expect(complete.speciesCount).toBe(5);expect(complete.readyPortraitCount).toBe(4);
    const rewind=prepared.draw(ctx,frame([],[],1,'2020-01-01'));
    expect(rewind.visibleCount).toBe(0);expect(rewind.speciesCount).toBe(0);
    expect(prepared.geometry.portraits).toEqual(original);expect(rewind.signature).toBe(complete.signature);
  });

  it('warms only the supplied scope and owns only its provided shared-cache client',async()=>{
    const {client,requests}=cache(),{ctx}=context();
    const prepared=prepareExportTree({...base,cache:client,colors:DARK_COLORS,pathFactory:()=>new TestPath() as unknown as Path2D});
    expect(requests).toHaveLength(0);
    const loaded=await prepared.preload(ctx);
    expect(loaded.readyPortraitCount).toBe(4);expect(loaded.speciesCount).toBe(5);expect(client.settleVisible).toHaveBeenCalled();
    expect(requests.at(-1)?.every(request=>!request.key.includes('outside')&&!request.key.includes('slash'))).toBe(true);
    expect(client.dispose).not.toHaveBeenCalled();prepared.dispose();prepared.dispose();expect(client.dispose).toHaveBeenCalledOnce();
    expect(()=>prepared.draw(ctx,frame(['a']))).toThrow('disposed');
  });

  it('can cancel both before and while waiting for artwork',async()=>{
    const {client}=cache(),{ctx}=context();
    const prepared=prepareExportTree({...base,cache:client,colors:DARK_COLORS,pathFactory:()=>new TestPath() as unknown as Path2D});
    const before=new AbortController();before.abort();
    await expect(prepared.preload(ctx,15000,before.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(client.settleVisible).not.toHaveBeenCalled();
    vi.mocked(client.settleVisible).mockImplementation(()=>new Promise(()=>{}));
    const during=new AbortController(),loading=prepared.preload(ctx,15000,during.signal);during.abort();
    await expect(loading).rejects.toMatchObject({name:'AbortError'});
    prepared.dispose();
  });

  it('reports a finite loading deadline instead of silently recording queued placeholders',async()=>{
    const {client}=cache(),{ctx}=context();
    client.metrics=()=>({visibleQueued:1,visibleActive:0} as ArtworkMetrics);
    const prepared=prepareExportTree({...base,cache:client,colors:DARK_COLORS,pathFactory:()=>new TestPath() as unknown as Path2D});
    await expect(prepared.preload(ctx,0)).rejects.toThrow('did not finish loading');
    prepared.dispose();
  });

  it('snapshots its palette while the normal page can change appearance',()=>{
    const {client}=cache(),colors={...DARK_COLORS},fills:string[]=[];
    const ctx=new Proxy(context().ctx,{set:(target,key,value)=>{if(key==='fillStyle')fills.push(value);return Reflect.set(target,key,value);}});
    const prepared=prepareExportTree({...base,cache:client,colors,pathFactory:()=>new TestPath() as unknown as Path2D});
    colors.paper='#ffffff';
    prepared.draw(ctx,frame([]));
    expect(fills[0]).toBe(DARK_COLORS.paper);
    prepared.dispose();
  });
});
