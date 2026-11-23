import {GIFEncoder,quantize,applyPalette,type GIFWriter,type Palette} from 'gifenc';
import type {GifRequest,GifResponse} from './encode-gif';

const scope=self as unknown as DedicatedWorkerGlobalScope;
let encoder:GIFWriter|undefined,palette:Palette|undefined;
let width=0,height=0,frames=0,maxBytes=64*1024*1024;
const reply=(message:GifResponse,transfer:Transferable[]=[])=>scope.postMessage(message,transfer);
const withinLimit=()=>{
  if(encoder&&encoder.bytesView().byteLength>maxBytes)throw new Error('The GIF exceeded 64 MB. Choose a shorter duration.');
};

scope.onmessage=(event:MessageEvent<GifRequest>)=>{
  const message=event.data;
  try{
    if(message.type==='init'){
      width=message.width||0;height=message.height||0;maxBytes=Math.min(message.maxBytes||maxBytes,64*1024*1024);
      if(width<1||height<1||width>4096||height>4096||!message.rgba||message.rgba.byteLength!==width*height*4)throw new Error('Invalid GIF dimensions or palette frame.');
      encoder=GIFEncoder();frames=0;
      palette=quantize(new Uint8Array(message.rgba),256,{format:'rgb565'});
      if(!palette.length)throw new Error('The GIF palette could not be prepared.');
      reply({type:'ready',id:message.id});
    }else if(message.type==='frame'){
      if(!encoder||!palette||!message.rgba||message.rgba.byteLength!==width*height*4)throw new Error('Invalid GIF frame.');
      if(!Number.isFinite(message.delayMs)||message.delayMs! <10||message.delayMs! >655350)throw new Error('Invalid GIF frame duration.');
      const indexed=applyPalette(new Uint8Array(message.rgba),palette,'rgb565');
      encoder.writeFrame(indexed,width,height,{palette:frames===0?palette:undefined,delay:message.delayMs,repeat:0,dispose:1});
      frames++;withinLimit();reply({type:'frame',id:message.id});
    }else if(message.type==='finish'){
      if(!encoder||!frames)throw new Error('No GIF frames were encoded.');
      encoder.finish();withinLimit();
      const bytes=encoder.bytes(),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
      encoder=undefined;palette=undefined;
      reply({type:'done',id:message.id,bytes:buffer},[buffer]);
      scope.close();
    }
  }catch(error){
    reply({type:'error',id:message.id,message:error instanceof Error?error.message:'GIF encoding failed.'});
    encoder=undefined;palette=undefined;scope.close();
  }
};
