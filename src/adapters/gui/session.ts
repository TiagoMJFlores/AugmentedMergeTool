import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import simpleGit from 'simple-git';
import { buildConflictBlocks } from '../../core/buildConflictBlocks.js';
import { resolveConflict, resolveAllConflicts } from '../../core/resolveConflict.js';
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

/**
 * Fetch the real LOCAL/REMOTE/BASE content from git's staging area.
 * During a merge conflict, git stores three versions:
 *   :1:file = base (common ancestor)
 *   :2:file = ours (LOCAL / HEAD)
 *   :3:file = theirs (REMOTE / incoming)
 */
async function fetchGitSideVersions(
  filePath: string
): Promise<{ local: string; remote: string; base: string } | null> {
  try {
    const dir = path.dirname(filePath);
    const git = simpleGit(dir);
    const topLevel = (await git.revparse(['--show-toplevel'])).trim();
    const relPath = path.relative(topLevel, filePath);

    const showRef = async (ref: string): Promise<string> => {
      try {
        return await git.raw(['show', `${ref}:${relPath}`]);
      } catch {
        return '';
      }
    };

    // Try index stages first (:2: ours, :3: theirs, :1: base)
    let [local, remote, base] = await Promise.all([
      showRef(':2'),
      showRef(':3'),
      showRef(':1'),
    ]);

    // Fallback to branch refs if stages are unavailable
    if (!local || !remote) {
      const [headLocal, mergeRemote] = await Promise.all([
        showRef('HEAD'),
        showRef('MERGE_HEAD'),
      ]);
      if (!local && headLocal) local = headLocal;
      if (!remote && mergeRemote) remote = mergeRemote;

      if (!base) {
        try {
          const mergeBase = (await git.raw(['merge-base', 'HEAD', 'MERGE_HEAD'])).trim();
          if (mergeBase) base = await showRef(mergeBase);
        } catch { /* no merge base available */ }
      }
    }

    if (!local && !remote) {
      console.warn('fetchGitSideVersions: could not load ours/theirs for', relPath);
      return null;
    }

    console.log(`fetchGitSideVersions: loaded for ${relPath} (base: ${base.length}b, local: ${local.length}b, remote: ${remote.length}b)`);
    return { local, remote, base };
  } catch (error) {
    console.warn('fetchGitSideVersions failed:', error);
    return null;
  }
}

/**
 * Compute conflict ranges by finding which lines in the full side content
 * correspond to each conflict block's ours/theirs content.
 */
function computeRangesFromContent(
  fullContent: string,
  blocks: ConflictBlock[],
  side: 'ours' | 'theirs'
): Array<{ start: number; end: number }> {
  const fullLines = fullContent.split('\n');
  const ranges: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;

  for (const block of blocks) {
    const conflictLines = (side === 'ours' ? block.ours.content : block.theirs.content).split('\n');
    if (conflictLines.length === 0 || (conflictLines.length === 1 && conflictLines[0] === '')) {
      // Empty conflict content — use a zero-width range that won't highlight anything
      ranges.push({ start: 0, end: 0 });
      continue;
    }

    // Find the first line of this conflict in fullContent starting from searchFrom
    let foundAt = -1;
    for (let i = searchFrom; i <= fullLines.length - conflictLines.length; i++) {
      if (fullLines[i].trim() === conflictLines[0].trim()) {
        // Check if all conflict lines match
        let allMatch = true;
        for (let j = 1; j < conflictLines.length; j++) {
          if (fullLines[i + j]?.trim() !== conflictLines[j].trim()) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          foundAt = i;
          break;
        }
      }
    }

    if (foundAt >= 0) {
      ranges.push({
        start: foundAt + 1,  // 1-indexed
        end: foundAt + conflictLines.length,
      });
      searchFrom = foundAt + conflictLines.length;
    } else {
      // Content not found in full file — use zero-width range (no highlight)
      ranges.push({ start: 0, end: 0 });
    }
  }

  return ranges;
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

    // Try to get the real LOCAL/REMOTE/BASE from git's staging area
    const gitVersions = await fetchGitSideVersions(args.merged);

    let localFullContent: string;
    let remoteFullContent: string;
    let basePath = args.base;

    if (gitVersions) {
      localFullContent = gitVersions.local;
      remoteFullContent = gitVersions.remote;
      // Write base to a temp path for buildConflictBlocks if it needs it
      if (gitVersions.base) {
        const tmpBase = args.merged + '.base.tmp';
        fs.writeFileSync(tmpBase, gitVersions.base, 'utf-8');
        basePath = tmpBase;
      }
    } else {
      // Fallback: reconstruct from conflict markers
      const sideViews = buildSideViews(originalMergedContent);
      localFullContent = sideViews.localContent;
      remoteFullContent = sideViews.remoteContent;
    }

    const sourceBlocks = await buildConflictBlocks(args.merged, ticketProvider, basePath);

    // Clean up temp base file
    if (gitVersions?.base) {
      try { fs.unlinkSync(args.merged + '.base.tmp'); } catch { /* ignore */ }
    }

    // Compute ranges: find where each conflict's content appears in the real files
    let localRanges: Array<{ start: number; end: number }>;
    let remoteRanges: Array<{ start: number; end: number }>;

    if (gitVersions) {
      localRanges = computeRangesFromContent(localFullContent, sourceBlocks, 'ours');
      remoteRanges = computeRangesFromContent(remoteFullContent, sourceBlocks, 'theirs');
    } else {
      const sideViews = buildSideViews(originalMergedContent);
      localRanges = sideViews.ranges.map((r) => r.localRange);
      remoteRanges = sideViews.ranges.map((r) => r.remoteRange);
    }

    const blocks = sourceBlocks.map((block, index) => {
      // Default side: the side with the most recent commit
      let defaultSide: 'local' | 'remote' | null = null;
      const oursDate = block.ours.latestCommitDate ? new Date(block.ours.latestCommitDate).getTime() : 0;
      const theirsDate = block.theirs.latestCommitDate ? new Date(block.theirs.latestCommitDate).getTime() : 0;
      if (oursDate > 0 || theirsDate > 0) {
        defaultSide = theirsDate > oursDate ? 'remote' : 'local';
      }

      return {
        id: `conflict-${index + 1}`,
        index,
        range: block.range,
        localRange: localRanges[index] ?? { start: 1, end: 1 },
        remoteRange: remoteRanges[index] ?? { start: 1, end: 1 },
        previewRange: localRanges[index] ?? { start: 1, end: 1 },
        ours: block.ours.content,
        theirs: block.theirs.content,
        aiResult: '',
        explanation: '',
        appliedResolution: null,
        actionTaken: false,
        selectedSide: null,
        selectedAction: null,
        defaultSide,
      };
    });

    return new GuiSession({
      args,
      originalMergedContent,
      localFullContent,
      remoteFullContent,
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
    target.selectedAction = 'choose-ai';
    target.selectedSide = null;
    target.actionTaken = true;

    return this.getState();
  }

  async generateAllAiResolutions(): Promise<GuiSessionState> {
    const results = await resolveAllConflicts(this.data.sourceBlocks);
    for (let i = 0; i < results.length; i++) {
      const target = this.data.blocks[i];
      if (!target) continue;
      target.aiResult = results[i].resolution;
      target.explanation = results[i].explanation;
      target.appliedResolution = results[i].resolution;
      target.selectedAction = 'choose-ai';
      target.selectedSide = null;
      target.actionTaken = true;
    }
    return this.getState();
  }

  applyResolution(input: ApplyResolutionInput): GuiSessionState {
    const target = this.data.blocks[input.conflictIndex];
    if (!target) {
      throw new Error(`Invalid conflict index: ${input.conflictIndex}`);
    }

    if (input.mode === 'apply-ai') {
      target.appliedResolution = target.aiResult || null;
      target.selectedSide = null;
      target.selectedAction = 'choose-ai';
    } else if (input.mode === 'use-local') {
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

  async finish(finalContent?: string): Promise<void> {
    const filePath = this.data.args.merged;

    if (typeof finalContent === 'string') {
      fs.writeFileSync(filePath, finalContent, 'utf-8');
    } else {
      const decisions: ResolutionDecision[] = this.data.blocks.map((block) => ({
        range: block.range,
        resolution: block.appliedResolution,
      }));
      const { content } = applyResolutionsToContent(this.data.originalMergedContent, decisions);
      fs.writeFileSync(filePath, content, 'utf-8');
    }

    // Stage the resolved file so git marks it as no longer conflicting
    // Use repoDir (where git status found the conflicts) to ensure we
    // hit the correct git repo root, not a nested submodule
    const cwd = this.data.args.repoDir || path.dirname(filePath);
    const addResult = spawnSync('git', ['add', '--', filePath], {
      cwd,
      encoding: 'utf-8',
    });
    if (addResult.status !== 0) {
      throw new Error(`git add failed: ${addResult.stderr?.trim()}`);
    }
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
      multiFile: null,
    };
  }
}
