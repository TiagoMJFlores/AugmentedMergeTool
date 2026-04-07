import type { MergeToolArgs } from './contracts.js';

export function parseMergeToolArgs(argv: string[]): MergeToolArgs | null {
  const positional = argv.filter((arg) => !arg.startsWith('-'));

  if (positional.length >= 4) {
    const [local, base, remote, merged] = positional.slice(-4);
    return { local, base, remote, merged };
  }

  if (positional.length >= 1) {
    const merged = positional[positional.length - 1];
    return { local: merged, base: merged, remote: merged, merged };
  }

  return null;
}
