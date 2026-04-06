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
  ours: string;
  theirs: string;
  aiResult: string;
  explanation: string;
  appliedResolution: string | null;
  actionTaken: boolean;
}

export interface GuiSessionState {
  mergedPath: string;
  total: number;
  currentIndex: number;
  complete: boolean;
  blocks: GuiConflictBlock[];
}

export type ResolutionMode = 'apply-ai' | 'use-local' | 'use-remote';

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
