import { contextBridge, ipcRenderer } from 'electron';
import type { RendererApi } from './contracts.js';

const api: RendererApi = {
  getState: () => ipcRenderer.invoke('gui:get-state'),
  generateAiResolution: (input) => ipcRenderer.invoke('gui:resolve', input),
  generateAllAiResolutions: () => ipcRenderer.invoke('gui:resolve-all'),
  applyResolution: (input) => ipcRenderer.invoke('gui:apply', input),
  navigateTo: (index) => ipcRenderer.invoke('gui:navigate', index),
  finish: (finalContent) => ipcRenderer.invoke('gui:finish', finalContent),
  switchFile: (filePath) => ipcRenderer.invoke('gui:switch-file', filePath),
  finishAll: () => ipcRenderer.invoke('gui:finish-all'),
};

contextBridge.exposeInMainWorld('mergeGuiApi', api);
