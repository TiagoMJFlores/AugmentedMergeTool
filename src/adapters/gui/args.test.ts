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

  it('uses the last positional arg when extra launch args exist', () => {
    expect(parseMergeToolArgs(['dist/adapters/gui/main.js', 'merged.ts'])).toEqual({
      local: 'merged.ts',
      base: 'merged.ts',
      remote: 'merged.ts',
      merged: 'merged.ts',
    });
  });

  it('accepts two positional paths by using the last one as merged', () => {
    expect(parseMergeToolArgs(['local.ts', 'merged.ts'])).toEqual({
      local: 'merged.ts',
      base: 'merged.ts',
      remote: 'merged.ts',
      merged: 'merged.ts',
    });
  });

  it('ignores cli flags when parsing positional paths', () => {
    expect(parseMergeToolArgs(['--inspect=9229', 'local.ts', 'base.ts', 'remote.ts', 'merged.ts'])).toEqual({
      local: 'local.ts',
      base: 'base.ts',
      remote: 'remote.ts',
      merged: 'merged.ts',
    });
  });

  it('returns null when no positional paths are provided', () => {
    expect(parseMergeToolArgs(['--inspect=9229'])).toBeNull();
  });

  it('returns null when called with empty args', () => {
    expect(parseMergeToolArgs([])).toBeNull();
  });
});
