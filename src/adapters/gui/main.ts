import 'dotenv/config';
import * as path from 'path';
import { app, BrowserWindow, ipcMain } from 'electron';
import simpleGit from 'simple-git';
import { GuiSession } from './session.js';
import type { ApplyResolutionInput, GuiSessionState, GuiMultiFileState, ResolveAndStoreInput } from './contracts.js';
import { parseMergeToolArgs, type ParsedArgs } from './args.js';

let activeSession: GuiSession | null = null;
const sessions = new Map<string, GuiSession>();
let multiFileMode = false;

function getActiveSession(): GuiSession {
  if (!activeSession) throw new Error('Session not initialized');
  return activeSession;
}

function buildMultiFileState(): GuiMultiFileState | null {
  if (!multiFileMode) return null;
  return {
    files: [...sessions.entries()].map(([filePath, session]) => {
      const s = session.getState();
      return {
        path: filePath,
        conflictCount: s.total,
        allResolved: s.complete,
      };
    }),
    activeFilePath: getActiveSession().getState().mergedPath,
  };
}

function injectMultiFile(state: GuiSessionState): GuiSessionState {
  return { ...state, multiFile: buildMultiFileState() };
}

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

  if (process.env.MERGEAGENT_GUI_DEBUG === '1') {
    mainWindow.webContents.openDevTools({ mode: 'bottom' });
  }

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  try {
    const parsed = parseMergeToolArgs(process.argv.slice(2));

    if (parsed.mode === 'single-file') {
      activeSession = await GuiSession.create(parsed.args);
    } else {
      // Multi-file mode — auto-detect from git status
      const repoDir = parsed.repoDir;
      const git = simpleGit(repoDir);
      const status = await git.status();
      const conflictedFiles = status.conflicted;

      if (conflictedFiles.length === 0) {
        console.error('No conflicted files found. Run this from a repo with merge conflicts.');
        app.exit(1);
        return;
      }

      multiFileMode = true;

      for (const relPath of conflictedFiles) {
        const absPath = path.resolve(repoDir, relPath);
        const session = await GuiSession.create({
          local: absPath,
          base: absPath,
          remote: absPath,
          merged: absPath,
          repoDir,
        });
        sessions.set(relPath, session);
      }

      activeSession = sessions.values().next().value!;
    }

    await createMainWindow();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

// --- IPC Handlers ---

ipcMain.handle('gui:get-state', async () => {
  return injectMultiFile(getActiveSession().getState());
});

ipcMain.handle('gui:resolve', async (_event, input: ResolveAndStoreInput) => {
  return injectMultiFile(await getActiveSession().generateAiResolution(input));
});

ipcMain.handle('gui:resolve-all', async () => {
  return injectMultiFile(await getActiveSession().generateAllAiResolutions());
});

ipcMain.handle('gui:apply', async (_event, input: ApplyResolutionInput) => {
  return injectMultiFile(getActiveSession().applyResolution(input));
});

ipcMain.handle('gui:navigate', async (_event, index: number) => {
  return injectMultiFile(getActiveSession().navigateTo(index));
});

ipcMain.handle('gui:finish', async (_event, finalContent?: string) => {
  const session = getActiveSession();
  await session.finish(finalContent);

  if (!multiFileMode) {
    return;
  }

  // Multi-file: advance to next unresolved file
  for (const [, s] of sessions) {
    if (!s.getState().complete) {
      activeSession = s;
      return injectMultiFile(s.getState());
    }
  }
  // All done
  setTimeout(() => app.quit(), 200);
});

ipcMain.handle('gui:switch-file', async (_event, filePath: string) => {
  const session = sessions.get(filePath);
  if (!session) throw new Error(`No session for file: ${filePath}`);
  activeSession = session;
  return injectMultiFile(session.getState());
});

ipcMain.handle('gui:finish-all', async () => {
  // Write all resolved files and exit — unresolved files are left as-is
  for (const [, session] of sessions) {
    if (session.getState().complete) {
      await session.finish();
    }
  }
  setTimeout(() => app.quit(), 200);
});

app.on('window-all-closed', () => {
  app.quit();
});
