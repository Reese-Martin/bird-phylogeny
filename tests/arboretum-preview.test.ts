import {describe,expect,it} from 'vitest';
import type {TreeData} from '../src/types';
import {buildLayout} from '../src/tree/geometry';
import {ancestryPreview} from '../src/arboretum/preview';

const tree:TreeData={version:'test',root:0,maxDistance:10,tips:[3,4,5,6],nodes:[
  {id:0,parent:null,children:[1,2],length:0,distance:0,age:10,leafStart:0,leafEnd:4},
  {id:1,parent:0,children:[3,4],length:4,distance:4,age:6,leafStart:0,leafEnd:2},
  {id:2,parent:0,children:[5,6],length:5,distance:5,age:5,leafStart:2,leafEnd:4},
  ...[3,4,5,6].map((id,index)=>({id,parent:id<5?1:2,children:[],length:id<5?6:5,distance:10,age:0,leafStart:index,leafEnd:index+1})),
]};

describe('Arboretum source ancestry previews',()=>{
  it('includes only unique tip-to-root paths and retains one shared source branch',()=>{
    const layout=buildLayout(tree),before=JSON.stringify({tree,layout});
    const preview=ancestryPreview(tree,layout,[3,4,3]);
    expect(preview.sourceTips).toBe(2);expect(preview.branches).toBe(3);
    expect(preview.path.match(/M/g)).toHaveLength(3);expect(preview.path.match(/L/g)).toHaveLength(3);
    expect(preview.path).not.toMatch(/NaN|Infinity/);
    expect(JSON.stringify({tree,layout})).toBe(before);
  });
  it('supports empty or unmapped previews without inventing placement and keeps the full source layout reusable',()=>{
    const layout=buildLayout(tree);
    expect(ancestryPreview(tree,layout,[999,1])).toEqual({path:'',sourceTips:0,branches:0});
    expect(ancestryPreview(tree,layout,[])).toEqual({path:'',sourceTips:0,branches:0});
    expect(ancestryPreview(tree,layout,tree.tips).branches).toBe(6);
    expect(ancestryPreview(tree,layout,[3])).toEqual(ancestryPreview(tree,layout,[3]));
  });
});
