import type { ArtworkCache, ArtworkRequest } from './artwork-cache';
import type { ArtworkImage } from './artwork-image-loader';
import { createArtworkCache } from './sticker-delivery';

export type ArtworkClient = Pick<ArtworkCache<ArtworkImage>, 'setWanted'|'getReady'|'peek'|'metrics'|'settleVisible'|'dispose'>;
export type ArtworkFactory = (onChange:()=>void)=>ArtworkClient;

interface Subscription {
  onChange:()=>void;
  input:ArtworkRequest[];
  requests:ArtworkRequest[];
  active:boolean;
}

const sameStrings=(a:readonly string[]|undefined,b:readonly string[]|undefined)=>
  (a?.length||0)===(b?.length||0)&&(!a||a.every((value,index)=>value===b?.[index]));

const sameRequests=(a:readonly ArtworkRequest[],b:readonly ArtworkRequest[])=>a.length===b.length&&a.every((request,index)=>{
  const other=b[index];
  return request.key===other.key&&(request.priority||0)===(other.priority||0)
    &&sameStrings(request.fallbackKeys,other.fallbackKeys)&&sameStrings(request.variants,other.variants);
});

const copyRequests=(requests:readonly ArtworkRequest[]):ArtworkRequest[]=>requests.map(request=>({
  key:request.key,priority:request.priority||0,
  fallbackKeys:[...(request.fallbackKeys||[])],variants:[...(request.variants||[])],
}));

/** One request protects every version/variant wanted by any mounted tree. */
function unionRequests(groups:Iterable<readonly ArtworkRequest[]>):ArtworkRequest[] {
  const merged=new Map<string,ArtworkRequest>();
  for(const requests of groups)for(const request of requests){
    const previous=merged.get(request.key);
    merged.set(request.key,{
      key:request.key,priority:Math.max(previous?.priority||0,request.priority||0),
      fallbackKeys:[...new Set([...(previous?.fallbackKeys||[]),...(request.fallbackKeys||[])])],
      variants:[...new Set([...(previous?.variants||[]),...(request.variants||[])])].sort(),
    });
  }
  return [...merged.values()].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
}

/**
 * Several canvases share one decode/delivery queue and cache without replacing
 * one another's wanted images. Ownership ends when the final canvas disconnects.
 */
export class SharedArtworkPool {
  private cache?:ArtworkClient;
  private subscriptions=new Set<Subscription>();
  private wanted:ArtworkRequest[]=[];
  private generation=0;

  constructor(private factory:ArtworkFactory=createArtworkCache){}

  connect(onChange:()=>void):ArtworkClient {
    if(!this.cache){
      const generation=++this.generation;
      this.cache=this.factory(()=>{
        if(generation!==this.generation)return;
        for(const subscription of [...this.subscriptions]){
          if(generation!==this.generation)break;
          if(!subscription.active)continue;
          // An unmounting observer cannot prevent the remaining trees redrawing.
          try{subscription.onChange();}catch{/* Each canvas owns its callback. */}
        }
      });
    }
    const cache=this.cache;
    const subscription:Subscription={onChange,input:[],requests:[],active:true};
    this.subscriptions.add(subscription);
    return{
      setWanted:requests=>{
        if(!subscription.active||sameRequests(subscription.input,requests))return;
        // The common RAF path compares only; copies and unions happen on change.
        subscription.input=copyRequests(requests);
        const normalized=unionRequests([subscription.input]);
        if(sameRequests(subscription.requests,normalized))return;
        subscription.requests=normalized;
        this.refresh();
      },
      getReady:keys=>subscription.active?cache.getReady(keys):undefined,
      peek:key=>subscription.active?cache.peek(key):undefined,
      metrics:()=>cache.metrics(),
      settleVisible:timeout=>subscription.active?cache.settleVisible(timeout):Promise.resolve(),
      dispose:()=>{
        if(!subscription.active)return;
        subscription.active=false;
        subscription.input=[];subscription.requests=[];
        this.subscriptions.delete(subscription);
        if(this.subscriptions.size)this.refresh();
        else{
          this.cache=undefined;this.wanted=[];this.generation++;
          cache.dispose();
        }
      },
    };
  }

  private refresh(){
    const wanted=unionRequests([...this.subscriptions].map(subscription=>subscription.requests));
    if(sameRequests(this.wanted,wanted))return;
    this.wanted=wanted;
    this.cache?.setWanted(wanted);
  }
}
