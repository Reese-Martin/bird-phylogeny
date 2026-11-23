/// <reference lib="webworker" />
import { packStickers, type StickerPackingInput, type StickerPackingOptions } from '../embedding/sticker-packing';
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<{ input: StickerPackingInput[]; options?: Omit<StickerPackingOptions, 'checkCancelled' | 'onProgress'> }>) => {
  try {
    const result = packStickers(event.data.input, { ...event.data.options, onProgress: (completed, total) => scope.postMessage({ type: 'progress', completed, total }) });
    scope.postMessage({ type: 'complete', result });
  } catch (error) { scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Could not pack the bird stickers.' }); }
};
