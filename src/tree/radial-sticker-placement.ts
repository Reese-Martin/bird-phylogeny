import type { StickerGeometryData, StickerSizeMode } from '../embedding/sticker-types';
import { colorOrderedWithinGroups, type StickerColorTable } from './color-order';

/** A decorative portrait halo. Only radius may change; source angles are fixed. */
export interface RadialStickerInput { id: string; angle: number; width: number; height: number }
export interface RadialStickerPlacement extends RadialStickerInput { x: number; y: number; radius: number }
export interface RadialStickerBounds { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number }
export interface RadialStickerLayout {
  points: RadialStickerPlacement[];
  bounds: RadialStickerBounds;
  maxRadius: number;
  maxAngleError: number;
  overlapCount: number;
}

export interface AnnotationRect { x:number; y:number; width:number; height:number }
export interface AnnotationCircle { x:number; y:number; radius:number }
export const annotationRectsOverlap=(a:AnnotationRect,b:AnnotationRect,gap=0)=>a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;
export function annotationCircleOverlap(box:AnnotationRect,circle:AnnotationCircle,gap=0){
  return Math.hypot(Math.max(box.x-circle.x,0,circle.x-box.x-box.width),Math.max(box.y-circle.y,0,circle.y-box.y-box.height))<circle.radius+gap;
}

/** Prefer nearby whitespace, then a free viewport edge. Never cover a bird to show its name. */
export function placeAnnotation(options:{width:number;height:number;anchor:AnnotationRect;boxWidth:number;boxHeight:number;occupied:readonly AnnotationRect[];exclusionCircle?:AnnotationCircle;margin?:number;gap?:number}):AnnotationRect|null {
  const {width,height,anchor,boxWidth:w,boxHeight:h,occupied,exclusionCircle}=options,margin=options.margin??8,gap=options.gap??5;
  if(w<=0||h<=0||w>width-margin*2||h>height-margin*2)return null;
  const midX=anchor.x+anchor.width/2,midY=anchor.y+anchor.height/2;
  const candidates=[
    [midX-w/2,anchor.y+anchor.height+gap],[midX-w/2,anchor.y-h-gap],
    [anchor.x+anchor.width+gap,midY-h/2],[anchor.x-w-gap,midY-h/2],
    [anchor.x+anchor.width+gap,anchor.y+anchor.height+gap],[anchor.x-w-gap,anchor.y-h-gap],
    [margin,margin],[width-w-margin,margin],[width-w-margin,height-h-margin],[margin,height-h-margin],
    [(width-w)/2,margin],[(width-w)/2,height-h-margin],[margin,(height-h)/2],[width-w-margin,(height-h)/2],
  ];
  // Edge slots also find whitespace between controls when all four corners are busy.
  for(let x=margin;x+w<=width-margin;x+=Math.max(24,w/2))candidates.push([x,margin],[x,height-h-margin]);
  for(let y=margin;y+h<=height-margin;y+=Math.max(20,h))candidates.push([margin,y],[width-w-margin,y]);
  for(const [x,y]of candidates){
    const rect={x,y,width:w,height:h};
    if(x<margin||y<margin||x+w>width-margin||y+h>height-margin)continue;
    if(exclusionCircle&&annotationCircleOverlap(rect,exclusionCircle,gap))continue;
    if(occupied.some(other=>annotationRectsOverlap(rect,other,gap)))continue;
    return rect;
  }
  return null;
}

/** Visible pieces of a leader, excluding complete image tiles including transparent pixels. */
export function leaderSegments(start:{x:number;y:number},end:{x:number;y:number},rects:readonly AnnotationRect[],padding=1){
  const dx=end.x-start.x,dy=end.y-start.y,blocked:Array<[number,number]>=[];
  if(Math.hypot(dx,dy)<1e-9)return [];
  for(const rect of rects){
    let lo=0,hi=1;
    for(const [origin,direction,min,max]of [[start.x,dx,rect.x-padding,rect.x+rect.width+padding],[start.y,dy,rect.y-padding,rect.y+rect.height+padding]]){
      if(Math.abs(direction)<1e-12){if(origin<min||origin>max){hi=-1;break;}}
      else{const a=(min-origin)/direction,b=(max-origin)/direction;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}
    }
    if(lo<hi&&hi>0&&lo<1)blocked.push([Math.max(0,lo),Math.min(1,hi)]);
  }
  blocked.sort((a,b)=>a[0]-b[0]);
  const result:Array<{start:{x:number;y:number};end:{x:number;y:number}}>=[];
  const point=(t:number)=>({x:start.x+dx*t,y:start.y+dy*t});let cursor=0;
  for(const [lo,hi]of blocked){if(lo>cursor+1e-9)result.push({start:point(cursor),end:point(lo)});cursor=Math.max(cursor,hi);}
  if(cursor<1-1e-9)result.push({start:point(cursor),end:point(1)});
  return result;
}

/** A separate decorative arrangement: source order sequence, illustration colors within each order. */
export function colorRadialAngles(members:readonly {code:string;order:string;sourceOrder:number}[],colors:StickerColorTable,fanAngle?:number){
  const groups=new Map<string,{rank:number;members:typeof members[number][]}>();
  for(const member of members){const group=groups.get(member.order)||{rank:Infinity,members:[]};group.rank=Math.min(group.rank,member.sourceOrder);group.members.push(member);groups.set(member.order,group);}
  const sortedGroups=[...groups.entries()].sort((a,b)=>a[1].rank-b[1].rank||a[0].localeCompare(b[0],'en'));
  const ordered=colorOrderedWithinGroups(sortedGroups.flatMap(([,group])=>group.members),member=>member.code,member=>member.order,colors);
  const span=fanAngle??Math.PI*2,full=fanAngle===undefined,gap=groups.size>1?Math.min(.025,span/(groups.size*12)):0;
  const step=(span-gap*(full?groups.size:Math.max(0,groups.size-1)))/Math.max(1,ordered.length);
  let cursor=full?-Math.PI/2+gap/2:-Math.PI/2-span/2,previous:string|undefined;
  const angles=new Map<string,number>();
  for(const member of ordered){if(previous!==undefined&&member.order!==previous)cursor+=gap;angles.set(member.code,cursor+step/2);cursor+=step;previous=member.order;}
  return angles;
}

/** Birds-only slots keep source sequence; optional footprint weights allocate angular room. */
export function compactRadialAngles(members:readonly {id:string;angle:number;weight?:number}[],fanAngle?:number):Map<string,number>{
  const span=fanAngle??Math.PI*2;
  if(!Number.isFinite(span)||span<=0||span>Math.PI*2)throw new Error('Invalid birds-only angular span.');
  const ids=new Set<string>();
  for(const member of members){
    if(!member.id||ids.has(member.id)||!Number.isFinite(member.angle))throw new Error('Invalid birds-only portrait identity or angle.');
    if(!Number.isFinite(member.weight??1)||(member.weight??1)<=0)throw new Error('Invalid birds-only angular weight.');
    ids.add(member.id);
  }
  const ordered=[...members].sort((a,b)=>a.angle-b.angle||a.id.localeCompare(b.id,'en'));
  // Normalize before summing so individually valid large weights cannot overflow.
  const maximum=ordered.reduce((value,member)=>Math.max(value,member.weight??1),0)||1;
  const weights=ordered.map(member=>(member.weight??1)/maximum),total=weights.reduce((sum,weight)=>sum+weight,0)||1;
  const start=fanAngle===undefined?-Math.PI/2:-Math.PI/2-span/2;
  let prefix=0;
  return new Map(ordered.map((member,index)=>{const angle=start+(prefix+weights[index]/2)/total*span;prefix+=weights[index];return [member.id,angle];}));
}

/**
 * Everybird's mass and painted-area normalization, at one common world scale.
 * Only the complete country collection sets the mass reference and median;
 * taxonomy filters and an extra selected species cannot change these anchors.
 */
export function radialPortraitSizes(referenceCodes:readonly string[],geometry:StickerGeometryData|undefined,sizeMode:StickerSizeMode='even',extraCodes:readonly string[]=[]){
  const reference=[...new Set(referenceCodes)],codes=[...new Set([...reference,...extraCodes])];
  const masses=reference.map(code=>geometry?.species[code]?.massG).filter((mass):mass is number=>typeof mass==='number'&&Number.isFinite(mass)&&mass>0);
  const lightestMass=masses.length?Math.max(.1,Math.min(...masses)):20;
  const exponent=sizeMode==='true'?1/3:.2,shapeRef=geometry?.shapeRef||215/576;
  const raw=new Map(codes.map(code=>{
    const source=geometry?.species[code],mass=source?.massG&&source.massG>0?Math.max(.1,source.massG):20;
    const L=Math.pow(mass/lightestMass,exponent)*Math.sqrt(shapeRef/Math.max(.05,source?.shape??shapeRef));
    const width=L*(source?.mask[0]||24)/24,height=L*(source?.mask[1]||24)/24;
    return [code,{width,height}] as const;
  }));
  const longSides=reference.map(code=>Math.max(raw.get(code)!.width,raw.get(code)!.height)).sort((a,b)=>a-b);
  const worldScale=.14/(longSides[Math.floor(longSides.length/2)]||1);
  const sizes=new Map([...raw].map(([code,size])=>[code,{width:size.width*worldScale,height:size.height*worldScale}]));
  return {sizes,lightestMass,worldScale,missingGeometry:reference.filter(code=>!geometry?.species[code]).length};
}

/** Fit complete portraits; page controls and selected details occupy separate columns. */
export function radialViewportFit(bounds:RadialStickerBounds,width:number,height:number){
  const k=Math.max(1e-6,Math.min(Math.max(1,width-32)/Math.max(1e-6,bounds.width),Math.max(1,height-40)/Math.max(1e-6,bounds.height)));
  return {k,x:width/2-(bounds.minX+bounds.maxX)/2*k,y:height/2-(bounds.minY+bounds.maxY)/2*k};
}

const box = (p: {x:number;y:number;width:number;height:number}) => ({ left:p.x-p.width/2,right:p.x+p.width/2,top:p.y-p.height/2,bottom:p.y+p.height/2 });
export function radialStickersOverlap(a: {x:number;y:number;width:number;height:number}, b: {x:number;y:number;width:number;height:number}, gap = 0) {
  const aa=box(a),bb=box(b);
  return aa.left < bb.right+gap && aa.right+gap > bb.left && aa.top < bb.bottom+gap && aa.bottom+gap > bb.top;
}

class Grid {
  private cells = new Map<string,number[]>();
  constructor(private side:number) {}
  private range(p:{x:number;y:number;width:number;height:number},gap=0) { const b=box(p);return [Math.floor((b.left-gap)/this.side),Math.floor((b.right+gap)/this.side),Math.floor((b.top-gap)/this.side),Math.floor((b.bottom+gap)/this.side)]; }
  add(p:RadialStickerPlacement,index:number) { const [x0,x1,y0,y1]=this.range(p); for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const key=`${x},${y}`,current=this.cells.get(key);if(current)current.push(index);else this.cells.set(key,[index]);} }
  nearby(p:RadialStickerPlacement,gap:number) { const [x0,x1,y0,y1]=this.range(p,gap),found=new Set<number>();for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(const index of this.cells.get(`${x},${y}`)||[])found.add(index);return found; }
}

function axisInterval(center:number,direction:number,extent:number):[number,number]|null {
  if(Math.abs(direction)<1e-12)return Math.abs(center)<extent?[-Infinity,Infinity]:null;
  const first=(center-extent)/direction,second=(center+extent)/direction;
  return first<second?[first,second]:[second,first];
}

function packRadialOrder(sorted:readonly RadialStickerInput[],exclusionRadius:number,gap:number,median:number):RadialStickerLayout {
  const grid=new Grid(median*1.1),placed:RadialStickerPlacement[]=[];
  let maxRadius=exclusionRadius,maxAngleError=0;
  for(const p of sorted){
    const ux=Math.cos(p.angle),uy=Math.sin(p.angle);
    let radius=exclusionRadius+Math.hypot(p.width,p.height)/2+gap;
    const current:RadialStickerPlacement={...p,x:ux*radius,y:uy*radius,radius};
    for(let jumps=0;;jumps++){
      if(jumps>placed.length)throw new Error('Could not resolve radial portrait spacing.');
      let nextRadius=radius;
      for(const index of grid.nearby(current,gap)){
        const other=placed[index];if(!radialStickersOverlap(current,other,gap))continue;
        const xi=axisInterval(other.x,ux,(p.width+other.width)/2+gap),yi=axisInterval(other.y,uy,(p.height+other.height)/2+gap);
        if(!xi||!yi)continue;
        const exit=Math.min(xi[1],yi[1]);
        if(!Number.isFinite(exit))throw new Error('Invalid radial collision interval.');
        nextRadius=Math.max(nextRadius,exit+1e-9*Math.max(1,Math.abs(exit)));
      }
      if(nextRadius===radius)break;
      radius=nextRadius;current.radius=radius;current.x=ux*radius;current.y=uy*radius;
    }
    maxRadius=Math.max(maxRadius,radius+Math.hypot(p.width,p.height)/2);
    maxAngleError=Math.max(maxAngleError,Math.abs(Math.atan2(Math.sin(Math.atan2(current.y,current.x)-p.angle),Math.cos(Math.atan2(current.y,current.x)-p.angle))));
    grid.add(current,placed.length);placed.push(current);
  }
  let minX=-exclusionRadius,minY=-exclusionRadius,maxX=exclusionRadius,maxY=exclusionRadius;
  for(const p of placed){const b=box(p);minX=Math.min(minX,b.left);minY=Math.min(minY,b.top);maxX=Math.max(maxX,b.right);maxY=Math.max(maxY,b.bottom);}
  return {points:placed,bounds:{minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY},maxRadius,maxAngleError,overlapCount:0};
}

/**
 * Each greedy pass keeps every portrait on its exact source-tip ray, jumping
 * over complete colliding rectangles. Comparing two angular directions and a
 * large-first pass avoids the long staircase a single sweep can create beside
 * large birds. This bounded search never increases the original maximum radius.
 * Angles, dimensions, branch geometry and the tree exclusion disk never change.
 */
export function radialStickerLayout(input:readonly RadialStickerInput[],options:{exclusionRadius?:number;gap?:number}={}):RadialStickerLayout {
  const exclusionRadius=options.exclusionRadius??1.14,gap=options.gap??0.008;
  if(!Number.isFinite(exclusionRadius)||exclusionRadius<0||!Number.isFinite(gap)||gap<0)throw new Error('Invalid radial portrait spacing.');
  const ids=new Set<string>();
  for(const p of input){if(!p.id||ids.has(p.id))throw new Error('Radial portrait IDs must be unique.');ids.add(p.id);if(![p.angle,p.width,p.height].every(Number.isFinite)||p.width<=0||p.height<=0)throw new Error('Invalid radial portrait geometry.');}
  const compare=(a:RadialStickerInput,b:RadialStickerInput)=>a.angle-b.angle||a.id.localeCompare(b.id,'en');
  const sorted=[...input].sort(compare);
  const median=[...input].map(p=>Math.max(p.width,p.height)).sort((a,b)=>a-b)[Math.floor(input.length/2)]||0.1;
  let best=packRadialOrder(sorted,exclusionRadius,gap,median);
  if(sorted.length>1)for(const order of [[...sorted].reverse(),[...sorted].sort((a,b)=>b.width*b.height-a.width*a.height||compare(a,b))]){
    const candidate=packRadialOrder(order,exclusionRadius,gap,median);
    // Floating-point tie noise must not rearrange otherwise equivalent results.
    if(candidate.maxRadius<best.maxRadius-Math.max(1,best.maxRadius)*1e-9)best=candidate;
  }
  best.points.sort(compare);
  return best;
}
