import * as fs from 'fs';
import type { MergeToolArgs } from './contracts.js';

export type ParsedArgs = {
  mode: 'single-file';
  args: MergeToolArgs;
} | {
  mode: 'multi-file';
  repoDir: string;
}

export function parseMergeToolArgs(argv: string[]): ParsedArgs {
  const positional = argv.filter((arg) => !arg.startsWith('-'));

  if (positional.length >= 4) {
    const [local, base, remote, merged] = positional.slice(-4);
    return { mode: 'single-file', args: { local, base, remote, merged } };
  }

  if (positional.length >= 1) {
    const last = positional[positional.length - 1];
    // If the argument is a directory, use it as repo path for multi-file mode
    try {
      if (fs.statSync(last).isDirectory()) {
        return { mode: 'multi-file', repoDir: last };
      }
    } catch { /* not a directory — treat as file */ }
    return { mode: 'single-file', args: { local: last, base: last, remote: last, merged: last } };
  }

  return { mode: 'multi-file', repoDir: process.cwd() };
}
