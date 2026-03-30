import type { ConflictBlock, ResolveResult, ConflictSummaryEntry } from '../../core/types.js';

export function printHeader(totalConflicts: number, totalFiles: number): void {
  console.log(`\n🔍 AugmentedMergeTool — Conflict Review`);
  console.log(`${'═'.repeat(40)}\n`);
  console.log(
    `Found ${totalConflicts} conflict(s) in ${totalFiles} file(s).\n`
  );
}

export function printConflictBlock(
  block: ConflictBlock,
  index: number,
  total: number,
  filePath: string
): void {
  console.log(`${'─'.repeat(40)}`);
  console.log(`📄 ${filePath}  [${index + 1}/${total}]`);
  console.log(`${'─'.repeat(40)}\n`);
  console.log(
    `⚡ Conflict block — lines ${block.range.start}–${block.range.end}\n`
  );

  const oursTicket = block.ours.ticket;
  const theirsTicket = block.theirs.ticket;

  if (oursTicket)
    console.log(`  LEFT  (HEAD)   · ${oursTicket.ticketId}: ${oursTicket.intentSummary}`);
  if (theirsTicket)
    console.log(`  RIGHT (theirs) · ${theirsTicket.ticketId}: ${theirsTicket.intentSummary}`);

  console.log(`\n  ── Left ${'─'.repeat(32)}`);
  console.log(block.ours.content);
  console.log(`\n  ── Right ${'─'.repeat(31)}`);
  console.log(block.theirs.content);
}

export function printResolveResult(result: ResolveResult): void {
  console.log(`\n  ── Context ${'─'.repeat(29)}`);
  console.log(result.explanation);
  console.log(`\n  ── Suggested resolution ${'─'.repeat(16)}`);
  console.log(result.resolution);
}

export function printApplied(): void {
  console.log('  ✅ Applied.\n');
}

export function printSkipped(): void {
  console.log('  ⏭️  Skipped.\n');
}

export function printSummary(entries: ConflictSummaryEntry[]): void {
  console.log(`\n${'═'.repeat(40)}`);
  console.log('✅ Summary');
  for (const entry of entries) {
    const actionLabel = entry.action === 'applied' ? 'Applied' : 'Skipped';
    console.log(`  ${entry.label.padEnd(50)} → ${actionLabel}`);
  }
  if (entries.some((e) => e.action === 'skipped')) {
    console.log(
      '\n  Files with skipped conflicts still need manual resolution before committing.'
    );
  }
  console.log(`${'═'.repeat(40)}\n`);
}

export function printNoConflicts(): void {
  console.log('No conflicts found.');
}

export function printError(message: string): void {
  console.error('AugmentedMergeTool failed:', message);
}
