import 'dotenv/config';
import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as readline from 'readline';
import { buildConflictBlocks } from './context/buildConflictBlocks.js';
import { resolveConflict } from './resolver/resolveConflict.js';

const git = simpleGit();

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase());
    })
  );
}

async function run(): Promise<void> {
  const status = await git.status();
  const conflictingFiles = status.conflicted;

  if (conflictingFiles.length === 0) {
    console.log('No conflicts found.');
    return;
  }

  console.log(`\n🔍 AugmentedMergeTool — Conflict Review`);
  console.log(`${'═'.repeat(40)}\n`);

  let totalConflicts = 0;
  const fileBlocks: { relPath: string; blockCount: number }[] = [];

  for (const relPath of conflictingFiles) {
    const absPath = `${process.cwd()}/${relPath}`;
    const content = fs.readFileSync(absPath, 'utf-8');
    const markerCount = (content.match(/^<{7} /gm) || []).length;
    totalConflicts += markerCount;
    fileBlocks.push({ relPath, blockCount: markerCount });
  }

  console.log(
    `Found ${totalConflicts} conflict(s) in ${conflictingFiles.length} file(s).\n`
  );

  const summary: { label: string; action: 'Applied' | 'Skipped' }[] = [];

  for (const relPath of conflictingFiles) {
    const absPath = `${process.cwd()}/${relPath}`;
    const blocks = await buildConflictBlocks(absPath);
    let fileContent = fs.readFileSync(absPath, 'utf-8');
    let fileModified = false;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const label = `${relPath}:${block.range.start}`;

      console.log(`${'─'.repeat(40)}`);
      console.log(`📄 ${relPath}  [${i + 1}/${blocks.length}]`);
      console.log(`${'─'.repeat(40)}\n`);
      console.log(
        `⚡ Conflict block — lines ${block.range.start}–${block.range.end}\n`
      );

      const oursTicket = block.ours.ticket;
      const theirsTicket = block.theirs.ticket;

      if (oursTicket)
        console.log(`  LEFT  (HEAD)   · ${oursTicket.ticketId}`);
      if (theirsTicket)
        console.log(`  RIGHT (theirs) · ${theirsTicket.ticketId}`);

      console.log(`\n  ── Left ${'─'.repeat(32)}`);
      console.log(block.ours.content);
      console.log(`\n  ── Right ${'─'.repeat(31)}`);
      console.log(block.theirs.content);

      const { resolution, explanation } = await resolveConflict(block);

      console.log(`\n  ── Context ${'─'.repeat(29)}`);
      console.log(explanation);
      console.log(`\n  ── Suggested resolution ${'─'.repeat(16)}`);
      console.log(resolution);

      let answer = '';
      while (answer !== 'u' && answer !== 's') {
        answer = await prompt('\n  [U] Use suggestion   [S] Skip\n> ');
      }

      if (answer === 'u') {
        const conflictMarkerRegex = /<<<<<<< HEAD[\s\S]*?>>>>>>> .+/;
        fileContent = fileContent.replace(conflictMarkerRegex, resolution);
        fileModified = true;
        summary.push({ label, action: 'Applied' });
        console.log('  ✅ Applied.\n');
      } else {
        summary.push({ label, action: 'Skipped' });
        console.log('  ⏭️  Skipped.\n');
      }
    }

    if (fileModified) {
      fs.writeFileSync(absPath, fileContent, 'utf-8');
      await git.add(absPath);
    }
  }

  console.log(`\n${'═'.repeat(40)}`);
  console.log('✅ Summary');
  for (const s of summary) {
    console.log(`  ${s.label.padEnd(50)} → ${s.action}`);
  }
  if (summary.some((s) => s.action === 'Skipped')) {
    console.log(
      '\n  Files with skipped conflicts still need manual resolution before committing.'
    );
  }
  console.log(`${'═'.repeat(40)}\n`);
}

run().catch((err: Error) => {
  console.error('AugmentedMergeTool failed:', err.message);
  process.exit(1);
});
