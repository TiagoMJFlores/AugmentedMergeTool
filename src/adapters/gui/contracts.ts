export interface MergeToolArgs {
  local: string;
  base: string;
  remote: string;
  merged: string;
  repoDir?: string;
}

export interface GuiConflictBlock {
  id: string;
  index: number;
  range: { start: number; end: number };
  localRange: { start: number; end: number };
  remoteRange: { start: number; end: number };
  previewRange: { start: number; end: number };
  ours: string;
  theirs: string;
  aiResult: string;
  explanation: string;
  appliedResolution: string | null;
  actionTaken: boolean;
  selectedSide: 'local' | 'remote' | 'both' | null;
  selectedAction:
    | 'choose-ai'
    | 'choose-left'
    | 'choose-right'
    | 'choose-both-left-first'
    | 'choose-both-right-first'
    | null;
  defaultSide: 'local' | 'remote' | null;
}

export interface GuiFileEntry {
  path: string;
  conflictCount: number;
  allResolved: boolean;
}

export interface GuiMultiFileState {
  files: GuiFileEntry[];
  activeFilePath: string;
}

export interface GuiSessionState {
  mergedPath: string;
  total: number;
  currentIndex: number;
  complete: boolean;
  localFullContent: string;
  remoteFullContent: string;
  previewContent: string;
  previewLineOwners: number[];
  blocks: GuiConflictBlock[];
  multiFile: GuiMultiFileState | null;
}

export type ResolutionMode =
  | 'apply-ai'
  | 'use-local'
  | 'use-remote'
  | 'accept-both'
  | 'accept-both-right-first';

export interface ResolveAndStoreInput {
  conflictIndex: number;
}

export interface ApplyResolutionInput {
  conflictIndex: number;
  mode: ResolutionMode;
  editedResolution?: string;
}

export interface MergeAgentConfig {
  aiProvider: 'anthropic' | 'openai';
  anthropicApiKey: string;
  openaiApiKey?: string;
  openaiModel?: string;
  ticketProvider: 'none' | 'linear' | 'jira' | 'github';
  linearApiKey?: string;
  jiraApiKey?: string;
  jiraBaseUrl?: string;
  githubToken?: string;
  githubRepo?: string;
}

export interface RendererApi {
  getState: () => Promise<GuiSessionState>;
  generateAiResolution: (input: ResolveAndStoreInput) => Promise<GuiSessionState>;
  generateAllAiResolutions: () => Promise<GuiSessionState>;
  applyResolution: (input: ApplyResolutionInput) => Promise<GuiSessionState>;
  navigateTo: (index: number) => Promise<GuiSessionState>;
  finish: (finalContent?: string) => Promise<void>;
  switchFile: (filePath: string) => Promise<GuiSessionState>;
  finishAll: () => Promise<void>;
  getConfig: () => Promise<MergeAgentConfig>;
  saveConfig: (config: MergeAgentConfig) => Promise<void>;
}
