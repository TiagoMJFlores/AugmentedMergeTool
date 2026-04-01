import type { MergeToolArgs } from './contracts.js';

export function parseMergeToolArgs(argv: string[]): MergeToolArgs {
  if (argv.length === 1 && argv[0]) {
    const merged = argv[0];
    return { local: merged, base: merged, remote: merged, merged };
  }

  const [local, base, remote, merged] = argv;

  if (!local || !base || !remote || !merged) {
    throw new Error(
      'Expected either 1 arg (MERGED) or 4 args (LOCAL BASE REMOTE MERGED)'
    );
  }

  return { local, base, remote, merged };
}
