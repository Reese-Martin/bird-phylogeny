import type { CenterReserve } from '../embedding/sticker-packing';

/** A map without placed species still needs readable count space above its tray. */
export function mapCountReserve(base: CenterReserve | undefined, mappedCount: number, unplaced: Array<{width:number;height:number}>): CenterReserve | undefined {
  if(!base || mappedCount || !unplaced.length)return base;
  const extent=Math.sqrt(unplaced.reduce((sum,shape)=>sum+shape.width*shape.height,0)/.42);
  return{...base,width:Math.max(base.width,extent*.3),height:Math.max(base.height,extent*.25)};
}

export function projectCountReserve(reserve: CenterReserve, transform:{x:number;y:number;k:number}) {
  return{x:reserve.x*transform.k+transform.x-reserve.width*transform.k/2,y:reserve.y*transform.k+transform.y-reserve.height*transform.k/2,width:reserve.width*transform.k,height:reserve.height*transform.k};
}
