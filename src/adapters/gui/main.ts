import 'dotenv/config';
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { GuiSession } from './session.js';
import type { ApplyResolutionInput, ResolveAndStoreInput } from './contracts.js';
import { parseMergeToolArgs } from './args.js';

let session: GuiSession | null = null;

async function createMainWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const shouldOpenDevTools = process.env.MERGEAGENT_GUI_DEBUG === '1' || !app.isPackaged;
  if (shouldOpenDevTools) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  try {
    const args = parseMergeToolArgs(process.argv.slice(2));
    session = await GuiSession.create(args);
    await createMainWindow();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

ipcMain.handle('gui:get-state', async () => {
  if (!session) {
    throw new Error('Session not initialized');
  }
  return session.getState();
});

ipcMain.handle('gui:resolve', async (_event, input: ResolveAndStoreInput) => {
  if (!session) {
    throw new Error('Session not initialized');
  }
  return session.generateAiResolution(input);
});

ipcMain.handle('gui:apply', async (_event, input: ApplyResolutionInput) => {
  if (!session) {
    throw new Error('Session not initialized');
  }
  return session.applyResolution(input);
});

ipcMain.handle('gui:navigate', async (_event, index: number) => {
  if (!session) {
    throw new Error('Session not initialized');
  }
  return session.navigateTo(index);
});

ipcMain.handle('gui:finish', async (_event, finalContent?: string) => {
  if (!session) {
    throw new Error('Session not initialized');
  }
  session.finish(finalContent);
  app.exit(0);
});

app.on('window-all-closed', () => {
  app.quit();
});
