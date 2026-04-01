import { contextBridge, ipcRenderer } from 'electron';
import type { RendererApi } from './contracts.js';

const api: RendererApi = {
  getState: () => ipcRenderer.invoke('gui:get-state'),
  generateAiResolution: (input) => ipcRenderer.invoke('gui:resolve', input),
  applyResolution: (input) => ipcRenderer.invoke('gui:apply', input),
  navigateTo: (index) => ipcRenderer.invoke('gui:navigate', index),
  finish: () => ipcRenderer.invoke('gui:finish'),
};

contextBridge.exposeInMainWorld('mergeGuiApi', api);
