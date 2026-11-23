import {describe,expect,it} from 'vitest';
import {mapCountReserve,projectCountReserve} from '../src/components/map-count-layout';

describe('central species count geometry',()=>{
  it('retains placed-map geometry and reserves proportional space for a wholly unplaced tray',()=>{
    const base={x:0,y:0,width:.88,height:.72},unplaced=Array.from({length:6},()=>({width:8,height:4}));
    expect(mapCountReserve(base,700,unplaced)).toBe(base);
    expect(mapCountReserve(base,0,[])).toBe(base);expect(mapCountReserve(undefined,0,unplaced)).toBeUndefined();
    const reserve=mapCountReserve(base,0,unplaced)!;
    expect(reserve.width).toBeGreaterThan(6);expect(reserve.height).toBeGreaterThan(5);
  });
  it('anchors the count to map coordinates and shrinks the entire count footprint on zoom-out',()=>{
    const reserve={x:0,y:0,width:20,height:16};
    const normal=projectCountReserve(reserve,{x:200,y:150,k:3}),small=projectCountReserve(reserve,{x:120,y:90,k:.3});
    expect(normal).toEqual({x:170,y:126,width:60,height:48});expect(small).toEqual({x:117,y:87.6,width:6,height:4.8});
    for(const box of [normal,small]){
      const numberFont=Math.min(32,box.height*.48),baseline=box.height*.5-box.height*.16;
      expect(baseline-numberFont/2).toBeGreaterThanOrEqual(0);expect(baseline+numberFont/2).toBeLessThanOrEqual(box.height);
      const labelFont=Math.min(9,box.height*.14),highlightBaseline=box.height*.5+box.height*.39;
      expect(highlightBaseline+labelFont/2).toBeLessThanOrEqual(box.height);
    }
  });
});
