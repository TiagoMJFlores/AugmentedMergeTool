declare module 'electron' {
  export const app: {
    whenReady: () => Promise<void>;
    on: (event: string, callback: () => void) => void;
    quit: () => void;
    exit: (code?: number) => void;
  };

  export class BrowserWindow {
    constructor(options: Record<string, unknown>);
    loadFile(filePath: string): Promise<void>;
  }

  export const ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) => void;
  };

  export const contextBridge: {
    exposeInMainWorld: (apiKey: string, api: unknown) => void;
  };

  export const ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<any>;
  };
}
