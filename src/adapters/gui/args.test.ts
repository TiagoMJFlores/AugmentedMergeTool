import { describe, expect, it } from 'vitest';
import { parseMergeToolArgs } from './args.js';

describe('parseMergeToolArgs', () => {
  it('accepts a single MERGED path for local preview/debug runs', () => {
    expect(parseMergeToolArgs(['merged.ts'])).toEqual({
      local: 'merged.ts',
      base: 'merged.ts',
      remote: 'merged.ts',
      merged: 'merged.ts',
    });
  });

  it('parses LOCAL BASE REMOTE MERGED positional args', () => {
    expect(parseMergeToolArgs(['local.ts', 'base.ts', 'remote.ts', 'merged.ts'])).toEqual({
      local: 'local.ts',
      base: 'base.ts',
      remote: 'remote.ts',
      merged: 'merged.ts',
    });
  });

  it('throws if required args are missing', () => {
    expect(() => parseMergeToolArgs(['local.ts', 'base.ts'])).toThrow('Expected either 1 arg');
  });
});
