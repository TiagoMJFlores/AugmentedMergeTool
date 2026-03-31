#!/usr/bin/env node
import 'dotenv/config';
import simpleGit from 'simple-git';
import * as fs from 'fs';
import { buildConflictBlocks } from './core/buildConflictBlocks.js';
import { createProvider, normalizeProvider } from './core/providers/index.js';
import { resolveConflict } from './core/resolveConflict.js';
import {
  printHeader,
  printConflictBlock,
  printResolveResult,
  printApplied,
  printSkipped,
  printSummary,
  printNoConflicts,
  printError,
} from './adapters/cli/display.js';
import { askUserAction } from './adapters/cli/prompt.js';
import type { ConflictSummaryEntry } from './core/types.js';

const git = simpleGit();

function getProviderArg(argv: string[]): string | undefined {
  const direct = argv.find((arg) => arg.startsWith('--provider='));
  if (direct) return direct.split('=')[1];

  const index = argv.indexOf('--provider');
  if (index >= 0) return argv[index + 1];

  return undefined;
}


async function run(): Promise<void> {
  const providerFromArg = getProviderArg(process.argv.slice(2));
  const providerName = normalizeProvider(providerFromArg ?? process.env.TICKET_PROVIDER);
  const ticketProvider = createProvider({ provider: providerName });

  const status = await git.status();
  const conflictingFiles = status.conflicted;

  if (conflictingFiles.length === 0) {
    printNoConflicts();
    return;
  }

  let totalConflicts = 0;
  for (const relPath of conflictingFiles) {
    const absPath = `${process.cwd()}/${relPath}`;
    const content = fs.readFileSync(absPath, 'utf-8');
    const markerCount = (content.match(/^<{7} /gm) || []).length;
    totalConflicts += markerCount;
  }

  printHeader(totalConflicts, conflictingFiles.length);

  const summary: ConflictSummaryEntry[] = [];

  for (const relPath of conflictingFiles) {
    const absPath = `${process.cwd()}/${relPath}`;
    const blocks = await buildConflictBlocks(absPath, ticketProvider);

    const decisions: {
      range: { start: number; end: number };
      resolution: string;
      action: ConflictSummaryEntry['action'];
    }[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const label = `${relPath}:${block.range.start}`;

      printConflictBlock(block, i, blocks.length, relPath);

      const result = await resolveConflict(block);
      printResolveResult(result);

      const answer = await askUserAction();

      const oursTicket = block.ours.ticket;
      const theirsTicket = block.theirs.ticket;
      const ticketPrefix = [oursTicket?.ticketId, theirsTicket?.ticketId]
        .filter(Boolean)
        .join(' / ');
      const summaryLabel = ticketPrefix ? `${ticketPrefix} · ${label}` : label;

      if (answer === 'u') {
        decisions.push({ range: block.range, resolution: result.resolution, action: 'applied' });
        summary.push({ label: summaryLabel, action: 'applied' });
        printApplied();
      } else {
        decisions.push({ range: block.range, resolution: '', action: 'skipped' });
        summary.push({ label: summaryLabel, action: 'skipped' });
        printSkipped();
      }
    }

    const toApply = decisions
      .filter((d) => d.action === 'applied')
      .sort((a, b) => b.range.start - a.range.start);

    if (toApply.length > 0) {
      const fileContent = fs.readFileSync(absPath, 'utf-8');
      const lines = fileContent.split('\n');

      for (const d of toApply) {
        const startIdx = d.range.start - 1;
        const endIdx = d.range.end - 1;
        const resolutionLines = d.resolution.split('\n');
        lines.splice(startIdx, endIdx - startIdx + 1, ...resolutionLines);
      }

      fs.writeFileSync(absPath, lines.join('\n'), 'utf-8');
      await git.add(absPath);
    }
  }

  printSummary(summary);
}

run().catch((err: Error) => {
  printError(err.message);
  process.exit(1);
});
