import type { TreeData } from '../types';
import type { LayoutNode, TreeLayout } from './geometry';

/** Both CanvasRenderingContext2D and Path2D satisfy this small drawing surface. */
export interface BranchGrowthPath {
  moveTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(controlX:number,controlY:number,x:number,y:number):void;
}

interface Point {x:number;y:number}
export interface RoundedBranchCorner {
  arcEndAngle:number;
  from:Point;
  control:Point;
  to:Point;
}
export interface BranchDrawing {
  arcEndAngle:number;
  arcLength:number;
  corner?:RoundedBranchCorner&{length:number;sampleLengths:readonly number[]};
  lineStart:Point;
  lineLength:number;
  length:number;
}

export interface BranchGrowthSegment {
  id: number;
  parent: LayoutNode;
  child: LayoutNode;
  arcLength: number;
  lineLength: number;
  length: number;
  startDistance: number;
  endDistance: number;
  /** Canvas clamps an arc to one turn when its requested sweep exceeds a turn. */
  sweep: number;
  lineStartX: number;
  lineStartY: number;
  /** Smoothed drawing only; original arc/line lengths above still schedule ancestry. */
  drawing:BranchDrawing;
}

export interface BranchGrowthPlan {
  segments: readonly BranchGrowthSegment[];
  byId: ReadonlyMap<number, BranchGrowthSegment>;
  /** Longest new path from any attachment to the already visible ancestry. */
  totalLength: number;
}

const tau = Math.PI * 2;
const clampProgress = (progress: number) => Number.isNaN(progress) ? 0 : Math.min(1, Math.max(0, progress));

/** A small tangent bend changes only the stroke around its turn, never source endpoints. */
export function roundedBranchCorner(parent:LayoutNode,child:LayoutNode):RoundedBranchCorner|undefined {
  const difference=child.angle-parent.angle,radial=child.radius-parent.radius;
  if(parent.radius<=1e-8||radial<=1e-8||Math.abs(difference)>tau||Math.abs(difference)<=1e-8)return undefined;
  const arcLength=Math.abs(difference)*parent.radius;
  const trim=Math.min(.025,parent.radius*.12,arcLength*.35,radial*.35);
  if(trim<=1e-8)return undefined;
  const delta=trim/parent.radius,arcEndAngle=child.angle-Math.sign(difference)*delta;
  const ux=Math.cos(child.angle),uy=Math.sin(child.angle);
  // Intersection of the shortened arc tangent and the unchanged radial line.
  const controlRadius=parent.radius/Math.cos(delta);
  return {arcEndAngle,from:{x:Math.cos(arcEndAngle)*parent.radius,y:Math.sin(arcEndAngle)*parent.radius},control:{x:ux*controlRadius,y:uy*controlRadius},to:{x:ux*(parent.radius+trim),y:uy*(parent.radius+trim)}};
}

/** Shared complete-path construction for the live tree, PNGs and animation export. */
export function appendRoundedBranch(path:BranchGrowthPath,parent:LayoutNode,child:LayoutNode):void {
  const corner=roundedBranchCorner(parent,child);
  path.moveTo(parent.x,parent.y);
  if(parent.radius>0)path.arc(0,0,parent.radius,parent.angle,corner?.arcEndAngle??child.angle,child.angle<parent.angle);
  if(corner)path.quadraticCurveTo(corner.control.x,corner.control.y,corner.to.x,corner.to.y);
  path.lineTo(child.x,child.y);
}

function quadraticPoint(corner:RoundedBranchCorner,t:number):Point {
  const inverse=1-t;
  return {x:inverse*inverse*corner.from.x+2*inverse*t*corner.control.x+t*t*corner.to.x,y:inverse*inverse*corner.from.y+2*inverse*t*corner.control.y+t*t*corner.to.y};
}

function measureCorner(corner:RoundedBranchCorner) {
  const sampleLengths=[0];let previous=corner.from,length=0;
  for(let index=1;index<=16;index++){
    const point=quadraticPoint(corner,index/16);length+=Math.hypot(point.x-previous.x,point.y-previous.y);sampleLengths.push(length);previous=point;
  }
  return {...corner,length,sampleLengths};
}

function cornerParameter(corner:NonNullable<BranchDrawing['corner']>,distance:number):number {
  if(distance<=0)return 0;if(distance>=corner.length)return 1;
  for(let index=1;index<corner.sampleLengths.length;index++)if(corner.sampleLengths[index]>=distance){
    const start=corner.sampleLengths[index-1],end=corner.sampleLengths[index];
    return (index-1+(end>start?(distance-start)/(end-start):0))/(corner.sampleLengths.length-1);
  }
  return 1;
}

/**
 * Prepare once per sighting date, independently of animation frames. New edges
 * start only after their new parent edge finishes. Separate attachments grow
 * together; existing branches consume no animation time and are never redrawn
 * by this plan. All geometry is copied, leaving the source tree/layout intact.
 */
export function buildBranchGrowthPlan(tree: TreeData, layout: TreeLayout, newNodeIds: ReadonlySet<number>): BranchGrowthPlan {
  const byId = new Map<number, BranchGrowthSegment>();
  for (const id of newNodeIds) {
    const node = tree.nodes[id];
    if (!node || node.parent === null) continue;
    const sourceParent = layout.nodes[node.parent], sourceChild = layout.nodes[id];
    if (!sourceParent || !sourceChild) continue;
    const parent = {...sourceParent}, child = {...sourceChild};
    const difference = child.angle - parent.angle;
    const sweep = Math.sign(difference) * Math.min(tau, Math.abs(difference));
    const arcLength = parent.radius > 0 ? Math.abs(sweep) * parent.radius : 0;
    const endAngle = parent.angle + sweep;
    const lineStartX = parent.radius > 0 ? Math.cos(endAngle) * parent.radius : parent.x;
    const lineStartY = parent.radius > 0 ? Math.sin(endAngle) * parent.radius : parent.y;
    const lineLength = Math.hypot(child.x - lineStartX, child.y - lineStartY);
    const bend=roundedBranchCorner(parent,child),corner=bend?measureCorner(bend):undefined;
    const drawingArcLength=corner?Math.abs(corner.arcEndAngle-parent.angle)*parent.radius:arcLength;
    const drawingStart=corner?.to||{x:lineStartX,y:lineStartY};
    const drawingLineLength=Math.hypot(child.x-drawingStart.x,child.y-drawingStart.y);
    const drawing:BranchDrawing={arcEndAngle:corner?.arcEndAngle??child.angle,arcLength:drawingArcLength,corner,lineStart:drawingStart,lineLength:drawingLineLength,length:drawingArcLength+(corner?.length||0)+drawingLineLength};
    byId.set(id, {id,parent,child,sweep,arcLength,lineLength,length:arcLength+lineLength,lineStartX,lineStartY,drawing,startDistance:0,endDistance:0});
  }

  // Resolve parents iteratively so neither node numbering nor set order matters.
  const resolved = new Set<number>();
  let totalLength = 0;
  for (const segment of byId.values()) {
    const pending: BranchGrowthSegment[] = [], visited = new Set<number>();
    let next: BranchGrowthSegment | undefined = segment;
    while (next && !resolved.has(next.id) && !visited.has(next.id)) {
      pending.push(next); visited.add(next.id);
      const parentId: number | null = tree.nodes[next.id].parent;
      next = parentId === null ? undefined : byId.get(parentId);
    }
    while (pending.length) {
      const current = pending.pop()!;
      const parentId = tree.nodes[current.id].parent;
      current.startDistance = parentId === null ? 0 : byId.get(parentId)?.endDistance || 0;
      current.endDistance = current.startDistance + current.length;
      totalLength = Math.max(totalLength, current.endDistance);
      resolved.add(current.id);
    }
  }
  return {segments:[...byId.values()],byId,totalLength};
}

/** Local completion of an edge; anchors outside the new plan already exist. */
export function branchTipProgress(plan: BranchGrowthPlan, id: number, progress: number): number {
  const segment = plan.byId.get(id);
  if (!segment) return 1;
  const fraction = clampProgress(progress);
  if (fraction === 0) return 0;
  if (fraction === 1) return 1;
  const distance = fraction * plan.totalLength;
  return segment.length === 0 ? Number(distance >= segment.endDistance) : clampProgress((distance - segment.startDistance) / segment.length);
}

/** Append fully reached edges and a continuous partial arc or radial line. */
export function traceBranchGrowth(path: BranchGrowthPath, plan: BranchGrowthPlan, progress: number): void {
  const fraction = clampProgress(progress);
  if (fraction <= 0) return;
  for (const segment of plan.segments) {
    const local = branchTipProgress(plan, segment.id, fraction);
    if (local <= 0) continue;
    const {parent,child,drawing} = segment;
    if (local === 1) {
      appendRoundedBranch(path,parent,child);
      continue;
    }
    path.moveTo(parent.x,parent.y);
    const reached=local*drawing.length;
    if (reached < drawing.arcLength) {
      const angle = parent.angle + Math.sign(segment.sweep) * reached / parent.radius;
      path.arc(0,0,parent.radius,parent.angle,angle,segment.sweep < 0);
    } else {
      if (parent.radius > 0) path.arc(0,0,parent.radius,parent.angle,drawing.arcEndAngle,child.angle < parent.angle);
      let radialDistance=reached-drawing.arcLength;
      if(drawing.corner){
        const corner=drawing.corner;
        if(radialDistance<=0)continue;
        if(radialDistance<corner.length){
          const t=cornerParameter(corner,radialDistance),point=quadraticPoint(corner,t);
          path.quadraticCurveTo(corner.from.x+(corner.control.x-corner.from.x)*t,corner.from.y+(corner.control.y-corner.from.y)*t,point.x,point.y);
          continue;
        }
        path.quadraticCurveTo(corner.control.x,corner.control.y,corner.to.x,corner.to.y);
        radialDistance-=corner.length;
      }
      const radial=drawing.lineLength>0?Math.min(1,radialDistance/drawing.lineLength):1;
      path.lineTo(drawing.lineStart.x+(child.x-drawing.lineStart.x)*radial,drawing.lineStart.y+(child.y-drawing.lineStart.y)*radial);
    }
  }
}
