import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import type { TicketProvider } from './providers/TicketProvider.js';
import type { TicketContext, ConflictBlock } from './types.js';

interface ParsedConflict {
  oursContent: string;
  theirsContent: string;
  range: { start: number; end: number };
  surroundingContext: string;
}

interface CommitInfo {
  hash: string;
  message: string;
  date: string | null;
}

/**
 * Parse all conflict blocks from a file's contents.
 */
export function parseConflictMarkers(fileContent: string): ParsedConflict[] {
  const lines = fileContent.split('\n');
  const conflicts: ParsedConflict[] = [];

  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      const startIdx = i;
      let separatorIdx = -1;
      let depth = 1;
      let endIdx = -1;

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
        i = startIdx + 1;
        continue;
      }

      const startLine = startIdx + 1; // 1-indexed
      const endLine = endIdx + 1; // 1-indexed
      const oursLines = lines.slice(startIdx + 1, separatorIdx);
      const theirsLines = lines.slice(separatorIdx + 1, endIdx);

      const contextStart = Math.max(0, startLine - 1 - 20);
      const contextEnd = Math.min(lines.length, endLine + 20);
      const surroundingContext = lines.slice(contextStart, contextEnd).join('\n');

      conflicts.push({
        oursContent: oursLines.join('\n'),
        theirsContent: theirsLines.join('\n'),
        range: { start: startLine, end: endLine },
        surroundingContext,
      });

      i = endIdx + 1;
      continue;
    }
    i++;
  }

  return conflicts;
}

/**
 * Split a conflict block at runs of identical lines between ours and theirs.
 *
 * Git sometimes groups multiple independent changes into one big
 * <<<<<<< ... >>>>>>> block. This function finds shared line runs in the
 * middle and splits the block into smaller, more precise sub-conflicts.
 *
 * Uses a greedy matching approach: walk both sides, when trimmed lines
 * match advance both, when they don't scan ahead for the next match.
 */
export function splitConflict(conflict: ParsedConflict, fileLines: string[]): ParsedConflict[] {
  const oursLines = conflict.oursContent.split('\n');
  const theirsLines = conflict.theirsContent.split('\n');

  // Align the two sides using greedy LCS-like matching
  type AlignedPair = { type: 'shared'; line: string } | { type: 'diff'; ours: string[]; theirs: string[] };
  const aligned: AlignedPair[] = [];
  let oi = 0;
  let ti = 0;

  while (oi < oursLines.length || ti < theirsLines.length) {
    // Check if current lines match
    if (oi < oursLines.length && ti < theirsLines.length && oursLines[oi].trim() === theirsLines[ti].trim()) {
      aligned.push({ type: 'shared', line: oursLines[oi] });
      oi++;
      ti++;
      continue;
    }

    // Lines differ — collect diff region until we find the next match
    const diffOurs: string[] = [];
    const diffTheirs: string[] = [];

    // Look ahead for the next shared line
    let foundMatch = false;
    const maxLook = Math.max(oursLines.length - oi, theirsLines.length - ti);
    for (let look = 1; look <= maxLook && !foundMatch; look++) {
      // Check if ours[oi + look] matches theirs[ti + look]
      if (oi + look < oursLines.length && ti + look < theirsLines.length &&
          oursLines[oi + look].trim() === theirsLines[ti + look].trim()) {
        // Collect everything before the match as diff
        for (let k = 0; k < look; k++) {
          if (oi + k < oursLines.length) diffOurs.push(oursLines[oi + k]);
          if (ti + k < theirsLines.length) diffTheirs.push(theirsLines[ti + k]);
        }
        oi += look;
        ti += look;
        foundMatch = true;
      }
      // Check if ours[oi] matches theirs[ti + look] (insertion in theirs)
      if (!foundMatch && ti + look < theirsLines.length &&
          oi < oursLines.length && oursLines[oi].trim() === theirsLines[ti + look].trim()) {
        for (let k = 0; k < look; k++) {
          if (ti + k < theirsLines.length) diffTheirs.push(theirsLines[ti + k]);
        }
        ti += look;
        foundMatch = true;
      }
      // Check if ours[oi + look] matches theirs[ti] (insertion in ours)
      if (!foundMatch && oi + look < oursLines.length &&
          ti < theirsLines.length && oursLines[oi + look].trim() === theirsLines[ti].trim()) {
        for (let k = 0; k < look; k++) {
          if (oi + k < oursLines.length) diffOurs.push(oursLines[oi + k]);
        }
        oi += look;
        foundMatch = true;
      }
    }

    if (!foundMatch) {
      // No more matches — dump remaining lines as one diff
      while (oi < oursLines.length) diffOurs.push(oursLines[oi++]);
      while (ti < theirsLines.length) diffTheirs.push(theirsLines[ti++]);
    }

    if (diffOurs.length > 0 || diffTheirs.length > 0) {
      aligned.push({ type: 'diff', ours: diffOurs, theirs: diffTheirs });
    }
  }

  // Count diff regions
  const diffRegions = aligned.filter((a) => a.type === 'diff');
  if (diffRegions.length <= 1) return [conflict];

  // Split into sub-conflicts
  const results: ParsedConflict[] = [];
  for (const entry of aligned) {
    if (entry.type === 'diff') {
      const contextStart = Math.max(0, conflict.range.start - 1 - 20);
      const contextEnd = Math.min(fileLines.length, conflict.range.end + 20);
      results.push({
        oursContent: entry.ours.join('\n'),
        theirsContent: entry.theirs.join('\n'),
        range: conflict.range, // keep original range for git context
        surroundingContext: fileLines.slice(contextStart, contextEnd).join('\n'),
      });
    }
  }

  return results;
}

/**
 * Extract a Linear ticket ID from a commit message.
 */
export function commitToTicketId(message: string): string | null {
  const match = message.match(/([A-Z]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Parse commit hashes and messages from `git log -L` output.
 */
export function parseGitLogOutput(output: string): CommitInfo[] {
  const commits: CommitInfo[] = [];
  const commitRegex = /^commit\s+([0-9a-f]{7,40})/gm;
  let commitMatch: RegExpExecArray | null;

  while ((commitMatch = commitRegex.exec(output)) !== null) {
    const hash = commitMatch[1];
    const restOfOutput = output.slice(commitMatch.index + commitMatch[0].length);
    const messageLines = restOfOutput.split('\n');

    let message = '';
    let date: string | null = null;
    let seenHeader = false;
    let foundBlank = false;
    for (const line of messageLines) {
      if (!seenHeader) {
        const dateLine = line.match(/^Date:\s+(.+)/);
        if (dateLine) date = dateLine[1].trim();
        if (line.trim() !== '') {
          seenHeader = true;
        }
        continue;
      }
      if (!foundBlank) {
        if (line.trim() === '') {
          foundBlank = true;
        }
        continue;
      }
      if (line.trim() !== '') {
        message = line.trim();
        break;
      }
    }

    if (hash && message) {
      commits.push({ hash, message, date });
    }
  }

  return commits;
}

async function fetchCommitsForSide(
  repoDir: string,
  relativeFilePath: string,
  startLine: number,
  endLine: number,
  ref: string,
  excludeRef: string
): Promise<CommitInfo[]> {
  const git = simpleGit(repoDir);
  try {
    const result = await git.raw([
      'log',
      `-L`,
      `${startLine},${endLine}:${relativeFilePath}`,
      ref,
      '--not',
      excludeRef,
      '--no-merges',
      '--max-count=3',
    ]);
    return parseGitLogOutput(result);
  } catch {
    return [];
  }
}

function findTicketId(commits: CommitInfo[]): string | null {
  for (const commit of commits) {
    const ticketId = commitToTicketId(commit.message);
    if (ticketId) return ticketId;
  }
  return null;
}

async function fetchTicketContext(
  provider: TicketProvider,
  ticketId: string | null
): Promise<TicketContext | null> {
  if (!ticketId) return null;

  return provider.fetchTicket(ticketId);
}

/**
 * Build enriched ConflictBlock[] from a file containing Git conflict markers.
 *
 * @param filePath - Absolute path to the file with conflict markers
 * @returns Array of ConflictBlock, one per conflict in the file
 */
export async function buildConflictBlocks(
  filePath: string,
  provider: TicketProvider,
  basePath?: string
): Promise<ConflictBlock[]> {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const parsed = parseConflictMarkers(fileContent);

  let baseLines: string[] | null = null;
  if (basePath && basePath !== filePath && fs.existsSync(basePath)) {
    baseLines = fs.readFileSync(basePath, 'utf-8').split('\n');
  }

  if (parsed.length === 0) return [];

  const repoDir = path.dirname(filePath);
  const git = simpleGit(repoDir);
  const topLevel = (await git.revparse(['--show-toplevel'])).trim();
  const relativeFilePath = path.relative(topLevel, filePath);

  const results: ConflictBlock[] = [];

  for (const conflict of parsed) {
    const [oursCommits, theirsCommits] = await Promise.all([
      fetchCommitsForSide(
        topLevel,
        relativeFilePath,
        conflict.range.start,
        conflict.range.end,
        'HEAD',
        'MERGE_HEAD'
      ),
      fetchCommitsForSide(
        topLevel,
        relativeFilePath,
        conflict.range.start,
        conflict.range.end,
        'MERGE_HEAD',
        'HEAD'
      ),
    ]);

    const oursTicketId = findTicketId(oursCommits);
    const theirsTicketId = findTicketId(theirsCommits);

    const [oursTicket, theirsTicket] = await Promise.all([
      fetchTicketContext(provider, oursTicketId),
      fetchTicketContext(provider, theirsTicketId),
    ]);

    let baseContent = '';
    if (baseLines) {
      // The merged file's line numbers include conflict markers, so they don't
      // map directly to the base file.  Instead, find the base region by
      // looking for the lines immediately before and after the conflict in the
      // merged file (which are non-conflict lines present in all three versions)
      // and locating those anchors in the base.
      const mergedLines = fileContent.split('\n');
      const anchorBefore = conflict.range.start > 1
        ? mergedLines[conflict.range.start - 2]  // line before <<<<<<<
        : null;
      const anchorAfter = conflict.range.end < mergedLines.length
        ? mergedLines[conflict.range.end]  // line after >>>>>>>
        : null;

      let baseStart = 0;
      let baseEnd = baseLines.length;

      if (anchorBefore !== null) {
        for (let bi = 0; bi < baseLines.length; bi++) {
          if (baseLines[bi] === anchorBefore) {
            baseStart = bi + 1;
            break;
          }
        }
      }
      if (anchorAfter !== null) {
        for (let bi = baseStart; bi < baseLines.length; bi++) {
          if (baseLines[bi] === anchorAfter) {
            baseEnd = bi;
            break;
          }
        }
      }

      baseContent = baseLines.slice(baseStart, baseEnd).join('\n');
    }

    results.push({
      ours: {
        content: conflict.oursContent,
        ticket: oursTicket,
        latestCommitDate: oursCommits[0]?.date ?? null,
      },
      theirs: {
        content: conflict.theirsContent,
        ticket: theirsTicket,
        latestCommitDate: theirsCommits[0]?.date ?? null,
      },
      range: conflict.range,
      surroundingContext: conflict.surroundingContext,
      baseContent,
    });
  }

  return results;
}
