import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import { getLinearClient } from '../linear/linearClient';
import { summariseIntent } from '../linear/intentSummarizer';

export interface TicketContext {
  ticketId: string;
  intentSummary: string;
}

export interface ConflictSide {
  content: string;
  ticket: TicketContext | null;
}

export interface ConflictBlock {
  ours: ConflictSide;
  theirs: ConflictSide;
  range: { start: number; end: number };
  surroundingContext: string;
}

interface ParsedConflict {
  oursContent: string;
  theirsContent: string;
  range: { start: number; end: number };
  surroundingContext: string;
}

interface CommitInfo {
  hash: string;
  message: string;
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
      const startLine = i + 1; // 1-indexed
      const oursLines: string[] = [];
      const theirsLines: string[] = [];

      i++;
      while (i < lines.length && !lines[i].startsWith('=======')) {
        oursLines.push(lines[i]);
        i++;
      }

      // skip =======
      i++;
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
        theirsLines.push(lines[i]);
        i++;
      }

      const endLine = i + 1; // 1-indexed

      const contextStart = Math.max(0, startLine - 1 - 20);
      const contextEnd = Math.min(lines.length, endLine + 20);
      const surroundingContext = lines.slice(contextStart, contextEnd).join('\n');

      conflicts.push({
        oursContent: oursLines.join('\n'),
        theirsContent: theirsLines.join('\n'),
        range: { start: startLine, end: endLine },
        surroundingContext,
      });
    }
    i++;
  }

  return conflicts;
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
    let seenHeader = false;
    let foundBlank = false;
    for (const line of messageLines) {
      if (!seenHeader) {
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
      commits.push({ hash, message });
    }
  }

  return commits;
}

/**
 * Fetch commits that introduced changes for a given side of a conflict.
 */
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

/**
 * Find the first ticket ID across a list of commits.
 */
function findTicketId(commits: CommitInfo[]): string | null {
  for (const commit of commits) {
    const ticketId = commitToTicketId(commit.message);
    if (ticketId) return ticketId;
  }
  return null;
}

/**
 * Fetch a Linear ticket and summarise its intent. Returns null on any failure.
 */
async function fetchTicketContext(
  ticketId: string | null
): Promise<TicketContext | null> {
  if (!ticketId) return null;

  try {
    const issue = await getLinearClient().issue(ticketId);
    const intentSummary = await summariseIntent({
      id: issue.identifier,
      title: issue.title,
      description: issue.description ?? '',
    });
    return { ticketId: issue.identifier, intentSummary };
  } catch {
    return null;
  }
}

/**
 * Build enriched ConflictBlock[] from a file containing Git conflict markers.
 *
 * @param filePath - Absolute path to the file with conflict markers
 * @returns Array of ConflictBlock, one per conflict in the file
 */
export async function buildConflictBlocks(
  filePath: string
): Promise<ConflictBlock[]> {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const parsed = parseConflictMarkers(fileContent);

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
      fetchTicketContext(oursTicketId),
      fetchTicketContext(theirsTicketId),
    ]);

    results.push({
      ours: {
        content: conflict.oursContent,
        ticket: oursTicket,
      },
      theirs: {
        content: conflict.theirsContent,
        ticket: theirsTicket,
      },
      range: conflict.range,
      surroundingContext: conflict.surroundingContext,
    });
  }

  return results;
}
