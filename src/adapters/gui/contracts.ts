export interface MergeToolArgs {
  local: string;
  base: string;
  remote: string;
  merged: string;
}

export interface GuiConflictBlock {
  id: string;
  index: number;
  range: { start: number; end: number };
  localRange: { start: number; end: number };
  remoteRange: { start: number; end: number };
  ours: string;
  theirs: string;
  aiResult: string;
  explanation: string;
  appliedResolution: string | null;
  actionTaken: boolean;
  selectedSide: 'local' | 'remote' | 'both' | null;
}

export interface GuiSessionState {
  mergedPath: string;
  total: number;
  currentIndex: number;
  complete: boolean;
  localFullContent: string;
  remoteFullContent: string;
  blocks: GuiConflictBlock[];
}

export type ResolutionMode = 'apply-ai' | 'skip' | 'use-local' | 'use-remote' | 'accept-both';

export interface ResolveAndStoreInput {
  conflictIndex: number;
}

export interface ApplyResolutionInput {
  conflictIndex: number;
  mode: ResolutionMode;
  editedResolution?: string;
}

export interface RendererApi {
  getState: () => Promise<GuiSessionState>;
  generateAiResolution: (input: ResolveAndStoreInput) => Promise<GuiSessionState>;
  applyResolution: (input: ApplyResolutionInput) => Promise<GuiSessionState>;
  navigateTo: (index: number) => Promise<GuiSessionState>;
  finish: () => Promise<void>;
}
