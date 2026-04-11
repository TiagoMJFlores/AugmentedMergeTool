import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app, BrowserWindow, ipcMain } from 'electron';
import simpleGit from 'simple-git';
import { GuiSession } from './session.js';
import type { ApplyResolutionInput, GuiSessionState, GuiMultiFileState, MergeAgentConfig, ResolveAndStoreInput } from './contracts.js';
import { parseMergeToolArgs, type ParsedArgs } from './args.js';

// --- Config Management ---

const CONFIG_DIR = path.join(os.homedir(), '.mergeagent');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function loadConfig(): MergeAgentConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { anthropicApiKey: '', ticketProvider: 'none' };
  }
}

function saveConfig(config: MergeAgentConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function applyConfigToEnv(config: MergeAgentConfig): void {
  if (config.anthropicApiKey) process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
  if (config.ticketProvider) process.env.TICKET_PROVIDER = config.ticketProvider;
  if (config.linearApiKey) process.env.LINEAR_API_KEY = config.linearApiKey;
  if (config.jiraApiKey) process.env.JIRA_API_KEY = config.jiraApiKey;
  if (config.jiraBaseUrl) process.env.JIRA_BASE_URL = config.jiraBaseUrl;
  if (config.githubToken) process.env.GITHUB_TOKEN = config.githubToken;
  if (config.githubRepo) process.env.GITHUB_REPO = config.githubRepo;
}

// Load config on startup
applyConfigToEnv(loadConfig());

let activeSession: GuiSession | null = null;
const sessions = new Map<string, GuiSession>();
let multiFileMode = false;

function getActiveSession(): GuiSession {
  if (!activeSession) throw new Error('No session — check Settings');
  return activeSession;
}

// Re-initialize sessions after config changes
async function reinitSessions(): Promise<void> {
  applyConfigToEnv(loadConfig());
  activeSession = null;
  sessions.clear();
  multiFileMode = false;
  await initSessions();
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

let mainWindow: BrowserWindow | null = null;

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
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

let parsedArgs: ParsedArgs | null = null;

async function initSessions(): Promise<void> {
  if (!parsedArgs) return;

  if (parsedArgs.mode === 'single-file') {
    activeSession = await GuiSession.create(parsedArgs.args);
  } else {
    const repoDir = parsedArgs.repoDir;
    const git = simpleGit(repoDir);
    const status = await git.status();
    const conflictedFiles = status.conflicted;

    if (conflictedFiles.length === 0) {
      return;
    }

    multiFileMode = true;
    sessions.clear();

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
}

app.whenReady().then(async () => {
  try {
    parsedArgs = parseMergeToolArgs(process.argv.slice(2));

    // Try to create sessions before opening window
    try {
      await initSessions();
    } catch (error) {
      console.error('Session init failed:', error);
      // Continue — window will open, user can fix config via settings
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

ipcMain.handle('gui:get-config', async () => {
  return loadConfig();
});

ipcMain.handle('gui:save-config', async (_event, config: MergeAgentConfig) => {
  saveConfig(config);
  applyConfigToEnv(config);
  // Re-create sessions with new config
  try {
    await reinitSessions();
  } catch { /* renderer will handle */ }
  mainWindow?.webContents.send('sessions-ready');
});

app.on('window-all-closed', () => {
  app.quit();
});
