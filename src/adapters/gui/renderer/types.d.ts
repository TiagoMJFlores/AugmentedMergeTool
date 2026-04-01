import type { RendererApi } from '../contracts.js';

declare global {
  interface Window {
    mergeGuiApi: RendererApi;
  }
}

export {};
