import {describe,expect,it} from 'vitest';
import type {TreeData} from '../src/types';
import {buildLayout,type LayoutNode,type TreeLayout} from '../src/tree/geometry';
import {appendRoundedBranch,roundedBranchCorner,branchTipProgress,buildBranchGrowthPlan,traceBranchGrowth,type BranchGrowthPath} from '../src/tree/branch-growth';

const tree:TreeData = {version:'growth fixture',root:0,maxDistance:100,tips:[2,3],nodes:[
  {id:0,parent:null,children:[1,3],length:0,distance:0,age:100,leafStart:0,leafEnd:2},
  {id:1,parent:0,children:[2],length:40,distance:40,age:60,leafStart:0,leafEnd:1},
  {id:2,parent:1,children:[],length:60,distance:100,age:0,leafStart:0,leafEnd:1},
  {id:3,parent:0,children:[],length:100,distance:100,age:0,leafStart:1,leafEnd:2},
]};
const node=(id:number,radius:number,angle:number):LayoutNode=>({id,radius,angle,x:Math.cos(angle)*radius,y:Math.sin(angle)*radius});
const layout:TreeLayout={nodes:[node(0,0,0),node(1,.4,0),node(2,.8,Math.PI/2),node(3,1,Math.PI)],tipCount:2,maxDistance:100,mode:'true-distance'};
type Call = {method:string;args:Array<number|boolean>};
function recorder(){
  const calls:Call[]=[];
  const path:BranchGrowthPath={moveTo:(...args)=>{calls.push({method:'moveTo',args});},arc:(...args)=>{calls.push({method:'arc',args:args.filter(value=>value!==undefined)});},lineTo:(...args)=>{calls.push({method:'lineTo',args});},quadraticCurveTo:(...args)=>{calls.push({method:'quadraticCurveTo',args});}};
  return{path,calls};
}
const close=(actual:number,expected:number)=>expect(actual).toBeCloseTo(expected,12);

describe('continuous radial branch growth',()=>{
  it('starts connected descendants after their parents, irrespective of input order',()=>{
    const plan=buildBranchGrowthPlan(tree,layout,new Set([2,3,1,0]));
    expect(plan.segments.map(segment=>segment.id)).toEqual([2,3,1]);
    close(plan.byId.get(1)!.startDistance,0);
    close(plan.byId.get(1)!.endDistance,.4);
    close(plan.byId.get(2)!.startDistance,.4);
    close(plan.byId.get(2)!.arcLength,.4*Math.PI/2);
    close(plan.byId.get(2)!.lineLength,.4);
    close(plan.byId.get(3)!.startDistance,0);
    close(plan.totalLength,.8+.4*Math.PI/2);
    const progress=.2,frame=recorder();traceBranchGrowth(frame.path,plan,progress);
    expect(branchTipProgress(plan,2,progress)).toBe(0);
    expect(frame.calls.filter(call=>call.method==='arc')).toEqual([]);
    expect(frame.calls.filter(call=>call.method==='lineTo')).toHaveLength(2);
    close(Number(frame.calls.find(call=>call.method==='lineTo')!.args[0]),-plan.totalLength*progress);
  });

  it('traces a partial angular connector before drawing its radial branch',()=>{
    const plan=buildBranchGrowthPlan(tree,layout,new Set([2])),segment=plan.byId.get(2)!;
    const frame=recorder();traceBranchGrowth(frame.path,plan,segment.drawing.arcLength/2/segment.drawing.length);
    expect(frame.calls.map(call=>call.method)).toEqual(['moveTo','arc']);
    const arc=frame.calls[1].args;
    expect(arc.slice(0,4)).toEqual([0,0,.4,0]);close(Number(arc[4]),segment.drawing.arcEndAngle/2);expect(arc[5]).toBe(false);
  });

  it('extends the radial part from the end of the completed angular connector',()=>{
    const plan=buildBranchGrowthPlan(tree,layout,new Set([2])),segment=plan.byId.get(2)!;
    const drawing=segment.drawing;
    const frame=recorder();traceBranchGrowth(frame.path,plan,(drawing.arcLength+drawing.corner!.length+drawing.lineLength/2)/drawing.length);
    expect(frame.calls.map(call=>call.method)).toEqual(['moveTo','arc','quadraticCurveTo','lineTo']);
    expect(frame.calls[1].args).toEqual([0,0,.4,0,drawing.arcEndAngle,false]);
    close(Number(frame.calls[3].args[0]),0);close(Number(frame.calls[3].args[1]),(drawing.lineStart.y+.8)/2);
  });

  it('does not consume time on old ancestry and leaves shared source anchors complete',()=>{
    const plan=buildBranchGrowthPlan(tree,layout,new Set([2]));
    expect(plan.byId.get(2)!.startDistance).toBe(0);
    expect(plan.byId.has(1)).toBe(false);
    expect(branchTipProgress(plan,1,0)).toBe(1);
    expect(branchTipProgress(plan,1,.4)).toBe(1);
    const empty=buildBranchGrowthPlan(tree,layout,new Set());
    const frame=recorder();traceBranchGrowth(frame.path,empty,.5);
    expect(frame.calls).toEqual([]);expect(empty.totalLength).toBe(0);
  });

  it('ends with the same rounded paths as static rendering and unchanged source endpoints',()=>{
    const ids=new Set([2,1,3]),plan=buildBranchGrowthPlan(tree,layout,ids),actual=recorder(),expected=recorder();
    traceBranchGrowth(actual.path,plan,1);
    for(const id of ids){
      const parent=layout.nodes[tree.nodes[id].parent!],child=layout.nodes[id];
      appendRoundedBranch(expected.path,parent,child);
      expect(branchTipProgress(plan,id,1)).toBe(1);
      expect(actual.calls.filter(call=>call.method==='lineTo').some(call=>call.args[0]===child.x&&call.args[1]===child.y)).toBe(true);
    }
    expect(actual.calls).toEqual(expected.calls);
  });

  it('handles zero-length edges and clamps progress without nonfinite geometry',()=>{
    const zeroLayout:TreeLayout={...layout,nodes:layout.nodes.map(current=>({...current,x:0,y:0,radius:0,angle:0}))};
    const plan=buildBranchGrowthPlan(tree,zeroLayout,new Set([1,2,3]));
    expect(plan.totalLength).toBe(0);
    for(const progress of [0,-1,-Infinity,NaN]){
      const frame=recorder();traceBranchGrowth(frame.path,plan,progress);expect(frame.calls).toEqual([]);expect(branchTipProgress(plan,2,progress)).toBe(0);
    }
    for(const progress of [.1,1,2,Infinity]){
      const frame=recorder();traceBranchGrowth(frame.path,plan,progress);expect(frame.calls).toHaveLength(6);expect(branchTipProgress(plan,2,progress)).toBe(1);
      expect(frame.calls.flatMap(call=>call.args).every(value=>typeof value==='boolean'||Number.isFinite(value))).toBe(true);
    }
  });

  it('keeps edge completion monotonic and never reaches a descendant before its new parent',()=>{
    const plan=buildBranchGrowthPlan(tree,layout,new Set([2,1,3]));
    const previous=new Map<number,number>();
    for(let step=0;step<=100;step++)for(const segment of plan.segments){
      const progress=branchTipProgress(plan,segment.id,step/100);
      expect(progress).toBeGreaterThanOrEqual(previous.get(segment.id)||0);expect(progress).toBeGreaterThanOrEqual(0);expect(progress).toBeLessThanOrEqual(1);
      if(segment.id===2&&progress>0)expect(branchTipProgress(plan,1,step/100)).toBe(1);
      previous.set(segment.id,progress);
    }
  });

  it('preserves source data and handles both compact fans and true-distance fans',()=>{
    const source=structuredClone(tree);
    for(const mode of ['compact','true-distance'] as const){
      const fan=buildLayout(tree,{mode,visibleTips:tree.tips,angularTips:tree.tips,fanAngle:4*Math.PI/3}),before=structuredClone(fan);
      const plan=buildBranchGrowthPlan(tree,fan,new Set([1,2,3]));
      expect(plan.totalLength).toBeGreaterThan(0);
      for(const progress of [0,.2,.5,.8,1]){
        const frame=recorder();traceBranchGrowth(frame.path,plan,progress);
        expect(frame.calls.flatMap(call=>call.args).every(value=>typeof value==='boolean'||Number.isFinite(value))).toBe(true);
        for(const segment of plan.segments)expect(branchTipProgress(plan,segment.id,1)).toBe(1);
      }
      expect(fan).toEqual(before);
    }
    expect(tree).toEqual(source);
  });

  it('uses clockwise and counterclockwise arc lengths that match Canvas for wide angular domains',()=>{
    for(const angle of [-Math.PI/2,5*Math.PI]){
      const wide={...layout,nodes:[...layout.nodes.slice(0,2),node(2,.8,angle),layout.nodes[3]]};
      const plan=buildBranchGrowthPlan(tree,wide,new Set([2])),segment=plan.byId.get(2)!;
      close(segment.arcLength,.4*Math.min(Math.abs(angle),2*Math.PI));
      const frame=recorder();traceBranchGrowth(frame.path,plan,segment.drawing.arcLength/2/segment.drawing.length);
      const arc=frame.calls.find(call=>call.method==='arc')!;
      expect(arc.args[5]).toBe(angle<0);close(Number(arc.args[4]),Math.sign(angle)*segment.drawing.arcLength/.4/2);
      const final=recorder();traceBranchGrowth(final.path,plan,1);expect(final.calls[1].args[4]).toBe(segment.drawing.arcEndAngle);
    }
  });

  it('eases the right-angle turn tangentially while preserving radial and angular anchors',()=>{
    for(const angle of [Math.PI/2,-Math.PI/2,.0001]){
      const parent=node(1,.4,0),child=node(2,.8,angle),before=structuredClone({parent,child});
      const corner=roundedBranchCorner(parent,child)!;
      expect(corner).toBeDefined();
      close(Math.hypot(corner.from.x,corner.from.y),parent.radius);
      const tangent={x:corner.control.x-corner.from.x,y:corner.control.y-corner.from.y};
      close(tangent.x*corner.from.x+tangent.y*corner.from.y,0);
      const radial={x:corner.to.x-corner.control.x,y:corner.to.y-corner.control.y};
      close(radial.x*Math.sin(angle)-radial.y*Math.cos(angle),0);
      expect(Math.hypot(corner.to.x,corner.to.y)).toBeLessThan(child.radius);
      const complete=recorder();appendRoundedBranch(complete.path,parent,child);
      expect(complete.calls.at(-1)).toEqual({method:'lineTo',args:[child.x,child.y]});
      expect({parent,child}).toEqual(before);
    }
  });

  it('grows continuously through the bend using the same curve as the final path',()=>{
    const plan=buildBranchGrowthPlan(tree,layout,new Set([2])),drawing=plan.byId.get(2)!.drawing,corner=drawing.corner!;
    const half=recorder();traceBranchGrowth(half.path,plan,(drawing.arcLength+corner.length/2)/drawing.length);
    expect(half.calls.map(call=>call.method)).toEqual(['moveTo','arc','quadraticCurveTo']);
    const end=half.calls.at(-1)!.args;
    const radius=Math.hypot(Number(end[2]),Number(end[3]));
    expect(radius).toBeGreaterThan(.4);expect(radius).toBeLessThan(Math.hypot(corner.to.x,corner.to.y));
    expect(end.slice(2)).not.toEqual([corner.to.x,corner.to.y]);
  });
});
