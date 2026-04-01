import * as fs from 'fs';
import { buildConflictBlocks } from '../../core/buildConflictBlocks.js';
import { resolveConflict } from '../../core/resolveConflict.js';
import { createProvider, normalizeProvider } from '../../core/providers/index.js';
import { applyResolutionsToContent, type ResolutionDecision } from '../../core/applyResolutions.js';
import type { ConflictBlock } from '../../core/types.js';
import type {
  ApplyResolutionInput,
  GuiConflictBlock,
  GuiSessionState,
  MergeToolArgs,
  ResolveAndStoreInput,
} from './contracts.js';

interface SessionData {
  args: MergeToolArgs;
  originalMergedContent: string;
  sourceBlocks: ConflictBlock[];
  blocks: GuiConflictBlock[];
  currentIndex: number;
}

export class GuiSession {
  private constructor(private readonly data: SessionData) {}

  static async create(args: MergeToolArgs): Promise<GuiSession> {
    const providerName = normalizeProvider(process.env.TICKET_PROVIDER);
    const ticketProvider = createProvider({ provider: providerName });

    const originalMergedContent = fs.readFileSync(args.merged, 'utf-8');
    const sourceBlocks = await buildConflictBlocks(args.merged, ticketProvider);
    const blocks = sourceBlocks.map((block, index) => ({
      id: `conflict-${index + 1}`,
      index,
      range: block.range,
      ours: block.ours.content,
      theirs: block.theirs.content,
      aiResult: '',
      explanation: '',
      appliedResolution: null,
      actionTaken: false,
    }));

    return new GuiSession({
      args,
      originalMergedContent,
      sourceBlocks,
      blocks,
      currentIndex: 0,
    });
  }

  async generateAiResolution(input: ResolveAndStoreInput): Promise<GuiSessionState> {
    const source = this.data.sourceBlocks[input.conflictIndex];
    if (!source) {
      throw new Error(`Invalid conflict index: ${input.conflictIndex}`);
    }

    const result = await resolveConflict(source);
    const target = this.data.blocks[input.conflictIndex];
    target.aiResult = result.resolution;
    target.explanation = result.explanation;

    return this.getState();
  }

  applyResolution(input: ApplyResolutionInput): GuiSessionState {
    const target = this.data.blocks[input.conflictIndex];
    if (!target) {
      throw new Error(`Invalid conflict index: ${input.conflictIndex}`);
    }

    if (input.mode === 'skip') {
      target.appliedResolution = null;
    } else if (input.mode === 'use-local') {
      target.appliedResolution = target.ours;
    } else if (input.mode === 'use-remote') {
      target.appliedResolution = target.theirs;
    } else {
      target.appliedResolution = input.editedResolution ?? target.aiResult;
    }
    target.actionTaken = true;

    return this.getState();
  }

  navigateTo(index: number): GuiSessionState {
    if (index < 0 || index >= this.data.blocks.length) {
      throw new Error(`Invalid navigation index: ${index}`);
    }
    this.data.currentIndex = index;
    return this.getState();
  }

  finish(): void {
    const decisions: ResolutionDecision[] = this.data.blocks.map((block) => ({
      range: block.range,
      resolution: block.appliedResolution,
    }));

    const { content } = applyResolutionsToContent(this.data.originalMergedContent, decisions);
    fs.writeFileSync(this.data.args.merged, content, 'utf-8');
  }

  getState(): GuiSessionState {
    const complete = this.data.blocks.every((block) => block.actionTaken);

    return {
      mergedPath: this.data.args.merged,
      total: this.data.blocks.length,
      currentIndex: this.data.currentIndex,
      complete,
      blocks: this.data.blocks,
    };
  }
}
