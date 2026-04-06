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
  localFullContent: string;
  remoteFullContent: string;
  sourceBlocks: ConflictBlock[];
  blocks: GuiConflictBlock[];
  currentIndex: number;
}

interface SideViews {
  localContent: string;
  remoteContent: string;
  ranges: Array<{
    localRange: { start: number; end: number };
    remoteRange: { start: number; end: number };
  }>;
}

interface PreviewBuildResult {
  content: string;
  ranges: Array<{ start: number; end: number }>;
  lineOwners: number[];
}

function buildSideViews(mergedContent: string): SideViews {
  const lines = mergedContent.split('\n');
  const localOutput: string[] = [];
  const remoteOutput: string[] = [];
  const ranges: SideViews['ranges'] = [];

  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<<')) {
      localOutput.push(lines[i]);
      remoteOutput.push(lines[i]);
      i++;
      continue;
    }

    i++;
    const localLines: string[] = [];
    const remoteLines: string[] = [];
    let depth = 1;
    let readingRemote = false;

    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith('<<<<<<<')) {
        depth++;
        if (readingRemote) {
          remoteLines.push(line);
        } else {
          localLines.push(line);
        }
      } else if (line.startsWith('=======') && depth === 1) {
        readingRemote = true;
      } else if (line.startsWith('>>>>>>>')) {
        depth--;
        if (depth === 0) {
          break;
        }
        if (readingRemote) {
          remoteLines.push(line);
        } else {
          localLines.push(line);
        }
      } else if (readingRemote) {
        remoteLines.push(line);
      } else {
        localLines.push(line);
      }
      i++;
    }

    const localStart = localOutput.length + 1;
    const remoteStart = remoteOutput.length + 1;
    localOutput.push(...localLines);
    remoteOutput.push(...remoteLines);
    ranges.push({
      localRange: {
        start: localStart,
        end: Math.max(localStart, localOutput.length),
      },
      remoteRange: {
        start: remoteStart,
        end: Math.max(remoteStart, remoteOutput.length),
      },
    });
    i++;
  }

  return {
    localContent: localOutput.join('\n'),
    remoteContent: remoteOutput.join('\n'),
    ranges,
  };
}

function buildPreviewContentAndRanges(
  mergedContent: string,
  blocks: GuiConflictBlock[]
): PreviewBuildResult {
  const lines = mergedContent.split('\n');
  const outputWithMarkers: string[] = [];
  const rawRanges: Array<{ start: number; end: number } | null> = blocks.map(() => null);
  const lineOwners: number[] = [];
  const output: string[] = [];
  let i = 0;
  let conflictIndex = 0;

  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<<')) {
      outputWithMarkers.push(lines[i]);
      i++;
      continue;
    }

    const startIdx = i;
    let separatorIdx = -1;
    let endIdx = -1;
    let depth = 1;
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith('<<<<<<<')) {
        depth++;
      } else if (line.startsWith('=======') && depth === 1 && separatorIdx === -1) {
        separatorIdx = i;
      } else if (line.startsWith('>>>>>>>')) {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
      i++;
    }

    if (separatorIdx === -1 || endIdx === -1) {
      outputWithMarkers.push(lines[startIdx]);
      i = startIdx + 1;
      continue;
    }

    const conflictLines = lines.slice(startIdx, endIdx + 1);
    const block = blocks[conflictIndex];
    let replacementLines: string[] = conflictLines;
    if (block) {
      if (block.appliedResolution !== null && block.appliedResolution !== undefined) {
        replacementLines = block.appliedResolution.split('\n');
      } else if (block.selectedAction === 'choose-both-right-first') {
        replacementLines = [block.theirs, block.ours].filter(Boolean).join('\n').split('\n');
      } else if (block.selectedAction === 'choose-both-left-first' || block.selectedSide === 'both') {
        replacementLines = [block.ours, block.theirs].filter(Boolean).join('\n').split('\n');
      } else if (block.selectedSide === 'remote') {
        replacementLines = block.theirs.split('\n');
      } else {
        replacementLines = block.ours.split('\n');
      }
    }
    outputWithMarkers.push(`__MERGE_CONFLICT_${conflictIndex}_START__`);
    outputWithMarkers.push(...replacementLines);
    outputWithMarkers.push(`__MERGE_CONFLICT_${conflictIndex}_END__`);
    conflictIndex++;
    i = endIdx + 1;
  }

  let activeOwner = -1;
  const markerRegex = /^__MERGE_CONFLICT_(\d+)_(START|END)__$/;
  for (const line of outputWithMarkers) {
    const markerMatch = line.match(markerRegex);
    if (markerMatch) {
      const ownerId = Number(markerMatch[1]);
      const markerType = markerMatch[2];
      activeOwner = markerType === 'START' ? ownerId : -1;
      continue;
    }

    output.push(line);
    lineOwners.push(activeOwner);
    if (activeOwner >= 0 && activeOwner < rawRanges.length) {
      const currentLine = output.length;
      const existing = rawRanges[activeOwner];
      if (!existing) {
        rawRanges[activeOwner] = { start: currentLine, end: currentLine };
      } else {
        existing.start = Math.min(existing.start, currentLine);
        existing.end = Math.max(existing.end, currentLine);
      }
    }
  }

  const ranges: Array<{ start: number; end: number }> = rawRanges.map((range) => range ?? { start: 1, end: 1 });
  return { content: output.join('\n'), ranges, lineOwners };
}

export class GuiSession {
  private constructor(private readonly data: SessionData) {}

  static async create(args: MergeToolArgs): Promise<GuiSession> {
    const providerName = normalizeProvider(process.env.TICKET_PROVIDER);
    const ticketProvider = createProvider({ provider: providerName });

    const originalMergedContent = fs.readFileSync(args.merged, 'utf-8');
    const sideViews = buildSideViews(originalMergedContent);
    const sourceBlocks = await buildConflictBlocks(args.merged, ticketProvider);
    const blocks = sourceBlocks.map((block, index) => ({
      id: `conflict-${index + 1}`,
      index,
      range: block.range,
      localRange: sideViews.ranges[index]?.localRange ?? { start: 1, end: 1 },
      remoteRange: sideViews.ranges[index]?.remoteRange ?? { start: 1, end: 1 },
      previewRange: sideViews.ranges[index]?.localRange ?? { start: 1, end: 1 },
      ours: block.ours.content,
      theirs: block.theirs.content,
      aiResult: '',
      explanation: '',
      appliedResolution: null,
      actionTaken: false,
      selectedSide: null,
      selectedAction: null,
    }));

    return new GuiSession({
      args,
      originalMergedContent,
      localFullContent: sideViews.localContent,
      remoteFullContent: sideViews.remoteContent,
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
    target.appliedResolution = result.resolution;
    target.actionTaken = true;

    return this.getState();
  }

  applyResolution(input: ApplyResolutionInput): GuiSessionState {
    const target = this.data.blocks[input.conflictIndex];
    if (!target) {
      throw new Error(`Invalid conflict index: ${input.conflictIndex}`);
    }

    if (input.mode === 'use-local') {
      target.appliedResolution = target.ours;
      target.selectedSide = 'local';
      target.selectedAction = 'choose-left';
    } else if (input.mode === 'use-remote') {
      target.appliedResolution = target.theirs;
      target.selectedSide = 'remote';
      target.selectedAction = 'choose-right';
    } else if (input.mode === 'accept-both') {
      target.appliedResolution = [target.ours, target.theirs].filter(Boolean).join('\n');
      target.selectedSide = 'both';
      target.selectedAction = 'choose-both-left-first';
    } else if (input.mode === 'accept-both-right-first') {
      target.appliedResolution = [target.theirs, target.ours].filter(Boolean).join('\n');
      target.selectedSide = 'both';
      target.selectedAction = 'choose-both-right-first';
    } else {
      target.appliedResolution = input.editedResolution ?? target.aiResult;
      target.selectedSide = null;
      target.selectedAction = null;
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

  finish(finalContent?: string): void {
    if (typeof finalContent === 'string') {
      fs.writeFileSync(this.data.args.merged, finalContent, 'utf-8');
      return;
    }
    const decisions: ResolutionDecision[] = this.data.blocks.map((block) => ({
      range: block.range,
      resolution: block.appliedResolution,
    }));

    const { content } = applyResolutionsToContent(this.data.originalMergedContent, decisions);
    fs.writeFileSync(this.data.args.merged, content, 'utf-8');
  }

  getState(): GuiSessionState {
    const complete = this.data.blocks.every((block) => block.actionTaken);
    const preview = buildPreviewContentAndRanges(this.data.originalMergedContent, this.data.blocks);
    for (let index = 0; index < this.data.blocks.length; index++) {
      const block = this.data.blocks[index];
      block.previewRange = preview.ranges[index] ?? block.previewRange;
    }

    return {
      mergedPath: this.data.args.merged,
      total: this.data.blocks.length,
      currentIndex: this.data.currentIndex,
      complete,
      localFullContent: this.data.localFullContent,
      remoteFullContent: this.data.remoteFullContent,
      previewContent: preview.content,
      previewLineOwners: preview.lineOwners,
      blocks: this.data.blocks,
    };
  }
}
