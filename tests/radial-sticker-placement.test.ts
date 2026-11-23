import {describe,expect,it} from 'vitest';
import {annotationCircleOverlap,annotationRectsOverlap,colorRadialAngles,compactRadialAngles,leaderSegments,placeAnnotation,radialPortraitSizes,radialStickerLayout,radialStickersOverlap,radialViewportFit} from '../src/tree/radial-sticker-placement';
import type {StickerGeometryData,StickerGeometry} from '../src/embedding/sticker-types';
import {drawTreeScene,type RadialPortrait,type RendererTip} from '../src/tree/renderer';
import type {ArtworkCache} from '../src/tree/artwork-cache';
import type {TreeLayout} from '../src/tree/geometry';
import type {StickerColorTable} from '../src/tree/color-order';

describe('radial portrait stacking',()=>{
  it('retains every exact source ray and keeps complete portraits outside the tree',()=>{
    const input=Array.from({length:700},(_,i)=>({id:`bird-${i}`,angle:i<320?-1.3+i*.0008:i/700*Math.PI*2-Math.PI/2,width:i%4===0?.065:.11,height:.11}));
    const result=radialStickerLayout(input);
    expect(result.points).toHaveLength(input.length);expect(result.maxAngleError).toBeLessThan(1e-12);
    for(const p of result.points){
      expect(p.angle).toBe(input.find(q=>q.id===p.id)!.angle);
      const nearest=Math.hypot(Math.max(0,Math.abs(p.x)-p.width/2),Math.max(0,Math.abs(p.y)-p.height/2));
      expect(nearest).toBeGreaterThanOrEqual(1.14);
      expect(p.x-p.width/2).toBeGreaterThanOrEqual(result.bounds.minX);expect(p.y+p.height/2).toBeLessThanOrEqual(result.bounds.maxY);
    }
    for(let i=0;i<result.points.length;i++)for(let j=i+1;j<result.points.length;j++)expect(radialStickersOverlap(result.points[i],result.points[j],.008)).toBe(false);
  });
  it('stacks coincident concepts along the same ray without overlap or omission',()=>{
    for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2,Math.PI*4]){
      const input=Array.from({length:45},(_,i)=>({id:`shared-${i}`,angle,width:.1,height:.15}));
      const result=radialStickerLayout(input);
      expect(result.points).toHaveLength(45);expect(result.maxAngleError).toBeLessThan(1e-12);
      for(let i=1;i<result.points.length;i++){expect(result.points[i].radius).toBeGreaterThan(result.points[i-1].radius);expect(radialStickersOverlap(result.points[i],result.points[i-1],.008)).toBe(false);}
    }
  });
  it('is deterministic and independent of input iteration order',()=>{
    const input=Array.from({length:90},(_,i)=>({id:`bird-${i}`,angle:i*.025,width:.08,height:.12}));
    expect(radialStickerLayout(input)).toEqual(radialStickerLayout(input.reverse()));
  });
  it('avoids a long one-direction staircase beside large portraits without changing their rays or dimensions',()=>{
    const input=Array.from({length:18},(_,i)=>({id:`synthetic-${i.toString().padStart(2,'0')}`,angle:3.6+i*.005,width:i===8?.5:.2+(i%3)*.1,height:i===8?.5:.18+(i%4)*.05}));
    const result=radialStickerLayout(input);
    // The original single ascending sweep reaches radius7.4485 for this fixture.
    expect(result.maxRadius).toBeLessThan(5.8);
    expect(result.maxAngleError).toBeLessThan(1e-12);
    expect(result.points.map(p=>p.id)).toEqual(input.map(p=>p.id));
    for(let i=0;i<result.points.length;i++){
      expect({angle:result.points[i].angle,width:result.points[i].width,height:result.points[i].height}).toEqual({angle:input[i].angle,width:input[i].width,height:input[i].height});
      for(let j=i+1;j<result.points.length;j++)expect(radialStickersOverlap(result.points[i],result.points[j],.008)).toBe(false);
    }
    expect(radialStickerLayout([...input].reverse())).toEqual(result);
  });
  it('fits every portrait and the central tree into desktop and narrow viewports',()=>{
    const layout=radialStickerLayout(Array.from({length:700},(_,i)=>({id:`bird-${i}`,angle:i<420?-.7+i*.0012:i/700*Math.PI*2,width:.08,height:.14})));
    for(const [width,height] of [[968,360],[904,900],[390,321]]){
      const view=radialViewportFit(layout.bounds,width,height);
      expect(view.k).toBeGreaterThan(0);
      for(const p of layout.points){
        expect((p.x-p.width/2)*view.k+view.x).toBeGreaterThan(0);
        expect((p.x+p.width/2)*view.k+view.x).toBeLessThan(width);
        expect((p.y-p.height/2)*view.k+view.y).toBeGreaterThan(0);
        expect((p.y+p.height/2)*view.k+view.y).toBeLessThan(height);
      }
    }
  });
  it('handles empty input and rejects invalid identities or geometry',()=>{
    expect(radialStickerLayout([]).points).toEqual([]);
    expect(()=>radialStickerLayout([{id:'x',angle:NaN,width:1,height:1}])).toThrow();
    expect(()=>radialStickerLayout([{id:'x',angle:0,width:1,height:1},{id:'x',angle:1,width:1,height:1}])).toThrow();
    expect(()=>radialStickerLayout([{id:'x',angle:0,width:-1,height:1}])).toThrow();
  });
});

describe('compact birds-only angular slots',()=>{
  it('keeps every source sequence and deterministic equal-angle ties while closing unused full-circle gaps',()=>{
    const input=[{id:'later',angle:4.1},{id:'tie-b',angle:-1.2},{id:'middle',angle:.3},{id:'tie-a',angle:-1.2}];
    const angles=compactRadialAngles(input),values=[...angles.values()];
    expect([...angles.keys()]).toEqual(['tie-a','tie-b','middle','later']);
    for(let i=1;i<values.length;i++)expect(values[i]-values[i-1]).toBeCloseTo(Math.PI/2,12);
    expect(values[0]+Math.PI*2-values[3]).toBeCloseTo(Math.PI/2,12);
    expect(compactRadialAngles([...input].reverse())).toEqual(angles);
    expect(input[0].angle).toBe(4.1);
  });
  it('places unequal footprint slots at their weighted midpoints without changing source order',()=>{
    const input=[{id:'last',angle:4,weight:3},{id:'first',angle:-1,weight:1},{id:'middle',angle:2,weight:2}];
    const angles=compactRadialAngles(input),start=-Math.PI/2,tau=Math.PI*2;
    expect([...angles.keys()]).toEqual(['first','middle','last']);
    expect(angles.get('first')).toBeCloseTo(start+(.5/6)*tau,12);
    expect(angles.get('middle')).toBeCloseTo(start+(2/6)*tau,12);
    expect(angles.get('last')).toBeCloseTo(start+(4.5/6)*tau,12);
    expect(compactRadialAngles([...input].reverse())).toEqual(angles);
    const span=Math.PI*4/3,fanStart=-Math.PI/2-span/2,fan=compactRadialAngles(input,span);
    expect(fan.get('middle')).toBeCloseTo(fanStart+(2/6)*span,12);
  });
  it('normalizes large positive weights before their sum can overflow and defaults omitted weights to one',()=>{
    const weighted=compactRadialAngles([{id:'a',angle:0,weight:1e308},{id:'b',angle:1,weight:1e308}]);
    const equal=compactRadialAngles([{id:'a',angle:0},{id:'b',angle:1,weight:1}]);
    expect(weighted).toEqual(equal);
    expect([...weighted.values()].every(Number.isFinite)).toBe(true);
  });
  it('keeps a focused fan centered above the count and packs complete birds around a smaller center disk',()=>{
    const input=Array.from({length:30},(_,i)=>({id:String(i).padStart(2,'0'),angle:i<20?1+i*.001:3+i*.02,width:.09,height:.14}));
    const span=Math.PI*4/3,angles=compactRadialAngles(input,span),values=[...angles.values()];
    expect(values[0]).toBeGreaterThan(-Math.PI/2-span/2);expect(values.at(-1)).toBeLessThan(-Math.PI/2+span/2);
    expect((values[0]+values.at(-1)!)/2).toBeCloseTo(-Math.PI/2,12);
    const packed=radialStickerLayout(input.map(p=>({...p,angle:angles.get(p.id)!})),{exclusionRadius:.36});
    expect(packed.points).toHaveLength(input.length);
    for(const p of packed.points){
      expect(Math.hypot(Math.max(0,Math.abs(p.x)-p.width/2),Math.max(0,Math.abs(p.y)-p.height/2))).toBeGreaterThanOrEqual(.36);
      expect(p.width).toBe(.09);expect(p.height).toBe(.14);
    }
    for(let i=0;i<packed.points.length;i++)for(let j=i+1;j<packed.points.length;j++)expect(radialStickersOverlap(packed.points[i],packed.points[j],.008)).toBe(false);
  });
  it('handles no birds and rejects ambiguous IDs, nonfinite source angles or invalid spans',()=>{
    expect(compactRadialAngles([])).toEqual(new Map());
    expect(()=>compactRadialAngles([{id:'x',angle:0},{id:'x',angle:1}])).toThrow();
    expect(()=>compactRadialAngles([{id:'x',angle:Infinity}])).toThrow();
    expect(()=>compactRadialAngles([{id:'x',angle:0}],0)).toThrow();
    expect(()=>compactRadialAngles([],Math.PI*3)).toThrow();
    for(const weight of [0,-1,NaN,Infinity])expect(()=>compactRadialAngles([{id:'x',angle:0,weight}])).toThrow();
  });
});

const geometry=(species:Record<string,Partial<StickerGeometry>>):StickerGeometryData=>({version:1,maskLongSide:24,alphaThreshold:40,shapeRef:.4,exponents:{even:.2,true:1/3},species:Object.fromEntries(Object.entries(species).map(([code,source])=>[code,{massG:1,massSource:'measured',aspect:2,imageWidth:384,imageHeight:192,mask:[24,12,''],shape:.4,...source}]))});

describe('Everybird radial portrait sizes',()=>{
  it('uses mass exponent 0.2 for averaged sizes and cube root for true sizes',()=>{
    const source=geometry({small:{massG:1},large:{massG:64}});
    const even=radialPortraitSizes(['small','large'],source,'even').sizes,trueSizes=radialPortraitSizes(['small','large'],source,'true').sizes;
    expect(even.get('large')!.width/even.get('small')!.width).toBeCloseTo(64**.2,12);
    expect(trueSizes.get('large')!.width/trueSizes.get('small')!.width).toBeCloseTo(4,12);
    expect(trueSizes.get('large')!.width).toBeCloseTo(.14,12);
    expect(trueSizes.get('large')!.width/trueSizes.get('large')!.height).toBe(2);
  });
  it('normalizes painted area and anchors reference mass and scale to the full country collection',()=>{
    const source=geometry({small:{massG:1},solid:{massG:64,shape:.4},sparse:{massG:64,shape:.1},outside:{massG:.001}});
    const full=radialPortraitSizes(['small','solid','sparse'],source,'true');
    const withContext=radialPortraitSizes(['small','solid','sparse'],source,'true',['outside']);
    expect(full.sizes.get('sparse')!.width/full.sizes.get('solid')!.width).toBeCloseTo(2,12);
    expect(withContext.lightestMass).toBe(1);expect(withContext.worldScale).toBe(full.worldScale);
    for(const code of ['small','solid','sparse'])expect(withContext.sizes.get(code)).toEqual(full.sizes.get(code));
    // Selecting a taxonomy subset reads these collection sizes without renormalizing.
    const input=['solid','sparse'].map((code,i)=>({id:code,angle:.01*i,...full.sizes.get(code)!}));
    const placed=radialStickerLayout(input);
    for(const p of placed.points){expect(p.angle).toBe(input.find(q=>q.id===p.id)!.angle);expect({width:p.width,height:p.height}).toEqual(full.sizes.get(p.id));}
    expect(radialStickersOverlap(placed.points[0],placed.points[1])).toBe(false);
  });
});

describe('radial tree visibility',()=>{
  const tip={id:1,x:1,y:0,radius:1,angle:0,code:'recorded',taxon:{code:'recorded',commonName:'Recorded bird',stickerSmall:'bird.webp',category:'species'}} as RendererTip;
  const portraits:RadialPortrait[]=[{id:'recorded:1',code:'recorded',taxon:tip.taxon,tip,angle:0,radius:1.4,x:1.4,y:0,width:.2,height:.1},{id:'recorded:2',code:'recorded',taxon:tip.taxon,tip,angle:0,radius:1.7,x:1.7,y:0,width:.2,height:.1}];
  function render(showTree:boolean,selectedCode:string|null=null,imageSize={width:200,height:100}){
    const calls:Array<{method:string;args:unknown[]}>=[];
    const ctx=new Proxy({},{get:(_target,key)=>key==='measureText'?()=>({width:40}):(...args:unknown[])=>calls.push({method:String(key),args}),set:()=>true}) as CanvasRenderingContext2D;
    const cache={get:()=>({state:'ready',value:{naturalWidth:imageSize.width,naturalHeight:imageSize.height}}),peek:()=>({state:'ready'}),getReady:(keys:string[])=>keys.length?{key:keys[0],value:{naturalWidth:imageSize.width,naturalHeight:imageSize.height}}:undefined,setWanted:()=>{}} as unknown as ArtworkCache<HTMLImageElement>;
    const layout:TreeLayout={nodes:[tip,tip],tipCount:1,maxDistance:100,mode:'true-distance'};
    const result=drawTreeScene(ctx,{width:800,height:700,transform:{x:350,y:350,k:100},baseScale:100,layout,points:[tip],clades:[],orders:[{name:'Order',count:1,start:-.4,end:.4,verified:true}],observedCodes:new Set(['recorded']),selectedCode,backgroundPath:{} as Path2D,observedPath:{} as Path2D,selectedPath:{} as Path2D,cache,radialPortraits:portraits,showTree,speciesCount:1});
    return {calls,result};
  }
  it('hides all branch, ring, wedge and date overlays while preserving portrait coordinates and hit boxes',()=>{
    const shown=render(true),hidden=render(false);
    expect(shown.result.wedges).toHaveLength(1);expect(hidden.result.wedges).toEqual([]);
    expect(hidden.calls.filter(c=>['stroke','arc','lineTo'].includes(c.method))).toEqual([]);
    expect(hidden.calls.filter(c=>c.method==='fillText').map(c=>c.args[0])).toEqual(['1','species']);
    expect(hidden.calls.filter(c=>c.method==='drawImage')).toEqual(shown.calls.filter(c=>c.method==='drawImage'));
    expect(hidden.result.hitBoxes).toEqual(shown.result.hitBoxes);
    expect(hidden.result.radialPortraitCount).toBe(2);expect(hidden.result.visibleCount).toBe(1);
  });
  it('retains selection and names while suppressing source leaders when the tree is hidden',()=>{
    const hidden=render(false,'recorded');
    expect(hidden.calls.filter(c=>c.method==='lineTo'||c.method==='moveTo'||c.method==='arc')).toEqual([]);
    expect(hidden.calls.filter(c=>c.method==='roundRect')).toHaveLength(2);
    expect(hidden.calls.filter(c=>c.method==='fillText').map(c=>c.args[0])).toContain('Recorded bird');
    expect(hidden.calls.filter(c=>c.method==='fillText'&&c.args[0]==='Recorded bird')).toHaveLength(1);
    for(const call of hidden.calls.filter(c=>c.method==='roundRect')){
      const [x,y,w,h]=call.args as number[];
      expect(portraits.some(p=>x>=p.x*100+350-p.width*50&&y>=350-p.height*50&&x+w<=p.x*100+350+p.width*50&&y+h<=350+p.height*50)).toBe(true);
    }
  });
  it('keeps every annotation clear of full image tiles, even when labels and a dated scale are active',()=>{
    for(const showTree of [true,false]){
      const rendered=render(showTree,'recorded'),tiles=portraits.map(p=>({x:p.x*100+350-p.width*50,y:350-p.height*50,width:p.width*100,height:p.height*100}));
      for(const annotation of rendered.result.annotationBoxes)for(const tile of tiles)expect(annotationRectsOverlap(annotation,tile)).toBe(false);
      for(const call of rendered.calls.filter(c=>c.method==='drawImage')){
        const [,x,y,w,h]=call.args as [unknown,number,number,number,number];
        expect(tiles.some(tile=>x>=tile.x&&y>=tile.y&&x+w<=tile.x+tile.width&&y+h<=tile.y+tile.height)).toBe(true);
      }
    }
  });
  it('contains complete artwork even when native image aspect differs greatly from the rounded mask tile',()=>{
    const tiles=portraits.map(p=>({x:p.x*100+350-p.width*50,y:350-p.height*50,width:p.width*100,height:p.height*100}));
    for(const [width,height]of [[384,29],[29,384],[384,383]])for(const call of render(false,null,{width,height}).calls.filter(c=>c.method==='drawImage')){
      const [,x,y,w,h]=call.args as [unknown,number,number,number,number];
      expect(w/h).toBeCloseTo(width/height,12);
      expect(tiles.some(tile=>x>=tile.x-1e-10&&y>=tile.y-1e-10&&x+w<=tile.x+tile.width+1e-10&&y+h<=tile.y+tile.height+1e-10)).toBe(true);
    }
  });
});

describe('collision-safe annotations and source leaders',()=>{
  it('uses free whitespace instead of covering a portrait or the tree disk, and suppresses impossible labels',()=>{
    const tile={x:100,y:100,width:60,height:50},neighbor={x:80,y:155,width:160,height:35},circle={x:150,y:50,radius:35};
    const result=placeAnnotation({width:320,height:240,anchor:tile,boxWidth:140,boxHeight:28,occupied:[tile,neighbor],exclusionCircle:circle});
    expect(result).not.toBeNull();expect(annotationRectsOverlap(result!,tile)).toBe(false);expect(annotationRectsOverlap(result!,neighbor)).toBe(false);expect(annotationCircleOverlap(result!,circle)).toBe(false);
    expect(placeAnnotation({width:320,height:240,anchor:tile,boxWidth:140,boxHeight:28,occupied:[{x:0,y:0,width:320,height:240}]})).toBeNull();
  });
  it('keeps tooltip, scale and protected center separate from all700 portrait tiles at desktop and phone sizes',()=>{
    const halo=radialStickerLayout(Array.from({length:700},(_,i)=>({id:String(i),angle:i<310?-.7+i*.0007:i/700*Math.PI*2,width:i%8===0?.28:.09,height:.13})));
    for(const [width,height]of [[968,360],[904,900],[390,321]]){
      const t=radialViewportFit(halo.bounds,width,height),tiles=halo.points.map(p=>({x:p.x*t.k+t.x-p.width*t.k/2,y:p.y*t.k+t.y-p.height*t.k/2,width:p.width*t.k,height:p.height*t.k}));
      const center={x:t.x-t.k*.6,y:t.y-t.k*.6,width:t.k*1.2,height:t.k*1.2};
      for(const tile of tiles)expect(annotationRectsOverlap(tile,center)).toBe(false);
      const occupied=[...tiles,center],circle={x:t.x,y:t.y,radius:t.k*1.12};
      for(const [w,h]of [[150,25],[235,36]]){
        const label=placeAnnotation({width,height,anchor:tiles[0],boxWidth:w,boxHeight:h,occupied,exclusionCircle:circle});
        expect(label).not.toBeNull();
        for(const obstacle of occupied)expect(annotationRectsOverlap(label!,obstacle)).toBe(false);
        expect(annotationCircleOverlap(label!,circle)).toBe(false);occupied.push(label!);
      }
    }
  });
  it('ends leaders before their target tile and skips all nearer tiles including alpha-transparent margins',()=>{
    const segments=leaderSegments({x:0,y:5},{x:35,y:5},[{x:10,y:0,width:10,height:10},{x:30,y:0,width:10,height:10}],1);
    expect(segments).toHaveLength(2);
    for(const [index,[a,b]]of [[0,9],[21,29]].entries()){expect(segments[index].start.x).toBeCloseTo(a,12);expect(segments[index].end.x).toBeCloseTo(b,12);expect(segments[index].start.y).toBe(5);expect(segments[index].end.y).toBe(5);}
    expect(leaderSegments({x:0,y:0},{x:0,y:0},[])).toEqual([]);
    const diagonal=leaderSegments({x:0,y:0},{x:20,y:20},[{x:8,y:8,width:4,height:4}],0);
    expect(diagonal).toEqual([{start:{x:0,y:0},end:{x:8,y:8}},{start:{x:12,y:12},end:{x:20,y:20}}]);
  });
});

describe('optional birds-only illustration-color arrangement',()=>{
  const colors={red:{family:'red',neutralClass:'chromatic',hue:30,lightness:.5,chroma:.1},blue:{family:'blue',neutralClass:'chromatic',hue:250,lightness:.5,chroma:.1},black:{family:'black',neutralClass:'black',hue:0,lightness:.1,chroma:0}} as unknown as StickerColorTable;
  it('retains source order-group sequence, sorts colors only inside groups, and includes a species with no source placement',()=>{
    const members=[{code:'black',order:'Second',sourceOrder:20},{code:'blue',order:'First',sourceOrder:2},{code:'red',order:'First',sourceOrder:1},{code:'unmapped',order:'Third',sourceOrder:Infinity}];
    const angles=colorRadialAngles(members,colors);
    expect(angles.size).toBe(4);
    expect([...angles.keys()]).toEqual(['red','blue','black','unmapped']);
    expect(colorRadialAngles([...members].reverse(),colors)).toEqual(angles);
    const packed=radialStickerLayout([...angles].map(([id,angle])=>({id,angle,width:.1,height:.1})));
    expect(packed.points).toHaveLength(4);expect(packed.maxAngleError).toBeLessThan(1e-12);
  });
  it('fits all700 unique species into full-circle and240-degree decorative slots without angle changes during packing',()=>{
    const members=Array.from({length:700},(_,i)=>({code:`species-${i}`,order:`Order-${Math.floor(i/35)}`,sourceOrder:i}));
    for(const fan of [undefined,Math.PI*4/3]){
      const angles=colorRadialAngles(members,{},fan),packed=radialStickerLayout([...angles].map(([id,angle])=>({id,angle,width:.09,height:.13})));
      expect(angles.size).toBe(700);expect(packed.points).toHaveLength(700);expect(packed.maxAngleError).toBeLessThan(1e-12);
      if(fan)for(const angle of angles.values()){expect(angle).toBeGreaterThan(-Math.PI/2-fan/2);expect(angle).toBeLessThan(-Math.PI/2+fan/2);}
      for(let i=0;i<packed.points.length;i++)for(let j=i+1;j<packed.points.length;j++)expect(radialStickersOverlap(packed.points[i],packed.points[j])).toBe(false);
    }
  },30000);
});
