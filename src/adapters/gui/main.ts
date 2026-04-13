import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import simpleGit from 'simple-git';
import { GuiSession } from './session.js';
import type { ApplyResolutionInput, GuiSessionState, GuiMultiFileState, MergeAgentConfig, ResolveAndStoreInput } from './contracts.js';
import { parseMergeToolArgs, type ParsedArgs } from './args.js';

// --- Config (loads before dotenv so it takes priority) ---
const CONFIG_DIR = path.join(os.homedir(), '.mergeagent');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function loadConfig(): MergeAgentConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { aiProvider: 'anthropic', anthropicApiKey: '', ticketProvider: 'none' };
  }
}

function saveConfigToDisk(config: MergeAgentConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function applyConfigToEnv(config: MergeAgentConfig): void {
  if (config.aiProvider) process.env.AI_PROVIDER = config.aiProvider;
  if (config.anthropicApiKey) process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
  if (config.openaiApiKey) process.env.OPENAI_API_KEY = config.openaiApiKey;
  if (config.openaiModel) process.env.OPENAI_MODEL = config.openaiModel;
  if (config.ticketProvider) process.env.TICKET_PROVIDER = config.ticketProvider;
  if (config.linearApiKey) process.env.LINEAR_API_KEY = config.linearApiKey;
  if (config.jiraApiKey) process.env.JIRA_API_KEY = config.jiraApiKey;
  if (config.jiraBaseUrl) process.env.JIRA_BASE_URL = config.jiraBaseUrl;
  if (config.githubToken) process.env.GITHUB_TOKEN = config.githubToken;
  if (config.githubRepo) process.env.GITHUB_REPO = config.githubRepo;
}

applyConfigToEnv(loadConfig());

let activeSession: GuiSession | null = null;
const sessions = new Map<string, GuiSession>();
let multiFileMode = false;
let userResolved = false;

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
    title: 'AugmentedMergeTool',
    width: 1400,
    height: 900,
    icon: path.join(__dirname, '..', '..', '..', 'assets', 'icon.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.MERGEAGENT_GUI_DEBUG === '1') {
    mainWindow.webContents.openDevTools({ mode: 'bottom' });
  }

  const menu = Menu.buildFromTemplate([
    {
      label: 'AugmentedMergeTool',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Navigate',
      submenu: [
        {
          label: 'Previous Conflict',
          accelerator: 'CmdOrCtrl+Up',
          click: () => mainWindow.webContents.send('shortcut', 'previous'),
        },
        {
          label: 'Next Conflict',
          accelerator: 'CmdOrCtrl+Down',
          click: () => mainWindow.webContents.send('shortcut', 'next'),
        },
        { type: 'separator' },
        {
          label: 'Resolve File',
          accelerator: 'CmdOrCtrl+Enter',
          click: () => mainWindow.webContents.send('shortcut', 'resolve'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  try {
    console.log('argv:', process.argv);
    const parsed = parseMergeToolArgs(process.argv.slice(2));
    console.log('parsed:', JSON.stringify(parsed));

    // Detect repo dir — from explicit dir arg or from file path
    let repoDir: string;
    if (parsed.mode === 'multi-file') {
      repoDir = parsed.repoDir;
    } else {
      // Single-file: find repo root from the file's directory
      // Walk up if the nearest repo has no conflicts (may be a submodule)
      const fileDir = path.dirname(parsed.args.merged);
      let dir = fileDir;
      repoDir = '';
      while (dir !== path.dirname(dir)) {
        try {
          const g = simpleGit(dir);
          const top = (await g.revparse(['--show-toplevel'])).trim();
          const s = await simpleGit(top).status();
          if (s.conflicted.length > 0) {
            repoDir = top;
            break;
          }
          // No conflicts here — try parent of this repo root
          dir = path.dirname(top);
        } catch {
          break;
        }
      }
      if (!repoDir) repoDir = fileDir;
    }

    // Always open in multi-file mode with all conflicted files
    console.log('repoDir:', repoDir);
    const git = simpleGit(repoDir);
    const status = await git.status();
    const conflictedFiles = status.conflicted;
    console.log('conflicted:', conflictedFiles);

    if (conflictedFiles.length === 0) {
      console.error('No conflicted files found. Run this from a repo with merge conflicts.');
      app.exit(1);
      return;
    }

    multiFileMode = conflictedFiles.length > 1;

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
  userResolved = true;

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

ipcMain.handle('gui:get-config', async () => loadConfig());

ipcMain.handle('gui:save-config', async (_event, config: MergeAgentConfig) => {
  saveConfigToDisk(config);
  applyConfigToEnv(config);
});

app.on('window-all-closed', () => {
  // Exit code 1 if user closed without resolving — tells git mergetool
  // the merge was NOT completed, so it won't auto-stage the file
  app.exit(userResolved ? 0 : 1);
});
