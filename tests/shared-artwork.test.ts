import {describe,expect,it,vi} from 'vitest';
import {ArtworkCache,type ArtworkRequest} from '../src/tree/artwork-cache';
import type {ArtworkImage} from '../src/tree/artwork-image-loader';
import {SharedArtworkPool,type ArtworkFactory} from '../src/tree/shared-artwork';

const portrait=()=>({width:32,height:32}) as HTMLCanvasElement;

function fixture(){
  const load=vi.fn(async()=>portrait()),prepare=vi.fn(),release=vi.fn(),dispose=vi.fn();
  const backends:ArtworkCache<ArtworkImage>[]=[],changes:Array<()=>void>=[];
  const factory:ArtworkFactory=onChange=>{
    changes.push(onChange);
    const cache=new ArtworkCache<ArtworkImage>({load,prepare,release,dispose,onChange});
    backends.push(cache);return cache;
  };
  return{pool:new SharedArtworkPool(factory),load,prepare,release,dispose,backends,changes};
}

describe('shared comparison artwork ownership',()=>{
  it('loads and retains one decoded image shared by all mounted tree clients',async()=>{
    const f=fixture(),notifications=Array.from({length:8},()=>vi.fn());
    const clients=notifications.map(callback=>f.pool.connect(callback));
    clients.forEach(client=>client.setWanted([{key:'shared-bird',priority:10}]));
    await clients[0].settleVisible();
    expect(f.backends).toHaveLength(1);expect(f.load).toHaveBeenCalledOnce();
    const image=clients[0].getReady(['shared-bird'])?.value;
    expect(image).toBeDefined();
    clients.forEach(client=>expect(client.getReady(['shared-bird'])?.value).toBe(image));
    notifications.forEach(callback=>expect(callback).toHaveBeenCalledOnce());
    expect(clients[0].metrics().ready).toBe(1);
    clients.forEach(client=>client.dispose());expect(f.dispose).toHaveBeenCalledOnce();expect(f.release).toHaveBeenCalledExactlyOnceWith(image);
  });

  it('unions keys, highest priorities, fallbacks and variants without mutating requests',()=>{
    const f=fixture(),a=f.pool.connect(()=>{}),b=f.pool.connect(()=>{});
    const requests:ArtworkRequest[]=[{key:'shared',priority:1,fallbackKeys:['small'],variants:['grey']}];
    const before=structuredClone(requests);
    a.setWanted(requests);b.setWanted([{key:'shared',priority:900,fallbackKeys:['large','small'],variants:['grey','selected']},{key:'country-only',priority:2}]);
    expect(f.prepare.mock.lastCall?.[0]).toEqual([
      {key:'country-only',priority:2,fallbackKeys:[],variants:[]},
      {key:'shared',priority:900,fallbackKeys:['small','large'],variants:['grey','selected']},
    ]);
    expect(requests).toEqual(before);a.dispose();b.dispose();
  });

  it('skips repeated RAF submissions and equivalent duplicate/reordered requests',()=>{
    const f=fixture(),a=f.pool.connect(()=>{}),b=f.pool.connect(()=>{});
    a.setWanted([{key:'z',priority:2},{key:'a',priority:1}]);const submitted=f.prepare.mock.calls.length;
    for(let frame=0;frame<30;frame++)a.setWanted([{key:'z',priority:2},{key:'a',priority:1}]);
    a.setWanted([{key:'a',priority:1},{key:'z',priority:2},{key:'z',priority:1}]);
    b.setWanted([{key:'z',priority:1}]);
    expect(f.prepare).toHaveBeenCalledTimes(submitted);
    a.dispose();b.dispose();
  });

  it('unregisters only one clients wanted keys and keeps images protected for remaining trees',async()=>{
    const f=fixture(),a=f.pool.connect(()=>{}),b=f.pool.connect(()=>{});
    a.setWanted([{key:'main-only'},{key:'shared'}]);b.setWanted([{key:'country-only'},{key:'shared'}]);
    await a.settleVisible();a.dispose();
    expect(f.dispose).not.toHaveBeenCalled();expect(f.prepare.mock.lastCall?.[0].map((request:ArtworkRequest)=>request.key)).toEqual(['country-only','shared']);
    expect(b.getReady(['shared'])?.value).toBeDefined();expect(b.getReady(['country-only'])?.value).toBeDefined();
    a.setWanted([{key:'obsolete'}]);expect(f.prepare.mock.lastCall?.[0].map((request:ArtworkRequest)=>request.key)).toEqual(['country-only','shared']);
    a.dispose();b.dispose();expect(f.dispose).toHaveBeenCalledOnce();
  });

  it('recreates a fresh cache after a StrictMode-style last disconnect and ignores stale notifications',()=>{
    const f=fixture(),oldCallback=vi.fn(),old=f.pool.connect(oldCallback);
    old.setWanted([{key:'old'}]);old.dispose();
    const callback=vi.fn(),fresh=f.pool.connect(callback);fresh.setWanted([{key:'fresh'}]);
    expect(f.backends).toHaveLength(2);f.changes[0]();expect(callback).not.toHaveBeenCalled();expect(oldCallback).not.toHaveBeenCalled();
    f.changes[1]();expect(callback).toHaveBeenCalledOnce();expect(old.peek('fresh')).toBeUndefined();
    fresh.dispose();expect(f.dispose).toHaveBeenCalledTimes(2);
  });

  it('copies request inputs so later caller mutation cannot alter current ownership',()=>{
    const f=fixture(),client=f.pool.connect(()=>{});
    const input=[{key:'bird',priority:1,fallbackKeys:['fallback']}];client.setWanted(input);
    input[0].priority=20;input[0].fallbackKeys.push('extra');
    expect(f.prepare.mock.lastCall?.[0]).toEqual([{key:'bird',priority:1,fallbackKeys:['fallback'],variants:[]}]);
    client.setWanted(input);expect(f.prepare.mock.lastCall?.[0]).toEqual([{key:'bird',priority:20,fallbackKeys:['fallback','extra'],variants:[]}]);client.dispose();
  });

  it('lets healthy canvases receive readiness even if another observer throws',()=>{
    const f=fixture(),a=f.pool.connect(()=>{throw new Error('canvas unmounted');}),callback=vi.fn(),b=f.pool.connect(callback);
    f.changes[0]();expect(callback).toHaveBeenCalledOnce();a.dispose();b.dispose();
  });

  it('does not notify a fresh generation during disposal inside an old readiness callback',()=>{
    const f=fixture(),freshCallback=vi.fn();
    let fresh:ReturnType<SharedArtworkPool['connect']>|undefined;
    const old=f.pool.connect(()=>{old.dispose();fresh=f.pool.connect(freshCallback);});
    f.changes[0]();expect(freshCallback).not.toHaveBeenCalled();
    f.changes[1]();expect(freshCallback).toHaveBeenCalledOnce();fresh?.dispose();
  });
});
