import { describe, expect, it } from 'vitest';
import { parseMergeToolArgs } from './args.js';

describe('parseMergeToolArgs', () => {
  it('accepts a single file path as single-file mode', () => {
    const result = parseMergeToolArgs(['merged.ts']);
    expect(result.mode).toBe('single-file');
    if (result.mode === 'single-file') {
      expect(result.args).toEqual({
        local: 'merged.ts',
        base: 'merged.ts',
        remote: 'merged.ts',
        merged: 'merged.ts',
      });
    }
  });

  it('parses LOCAL BASE REMOTE MERGED positional args', () => {
    const result = parseMergeToolArgs(['local.ts', 'base.ts', 'remote.ts', 'merged.ts']);
    expect(result.mode).toBe('single-file');
    if (result.mode === 'single-file') {
      expect(result.args).toEqual({
        local: 'local.ts',
        base: 'base.ts',
        remote: 'remote.ts',
        merged: 'merged.ts',
      });
    }
  });

  it('uses the last positional arg when extra launch args exist', () => {
    const result = parseMergeToolArgs(['dist/adapters/gui/main.js', 'merged.ts']);
    expect(result.mode).toBe('single-file');
    if (result.mode === 'single-file') {
      expect(result.args.merged).toBe('merged.ts');
    }
  });

  it('ignores cli flags when parsing positional paths', () => {
    const result = parseMergeToolArgs(['--inspect=9229', 'local.ts', 'base.ts', 'remote.ts', 'merged.ts']);
    expect(result.mode).toBe('single-file');
    if (result.mode === 'single-file') {
      expect(result.args).toEqual({
        local: 'local.ts',
        base: 'base.ts',
        remote: 'remote.ts',
        merged: 'merged.ts',
      });
    }
  });

  it('returns multi-file mode with cwd when no args', () => {
    const result = parseMergeToolArgs([]);
    expect(result.mode).toBe('multi-file');
    if (result.mode === 'multi-file') {
      expect(result.repoDir).toBe(process.cwd());
    }
  });

  it('returns multi-file mode when only flags provided', () => {
    const result = parseMergeToolArgs(['--inspect=9229']);
    expect(result.mode).toBe('multi-file');
  });

  it('returns multi-file mode when arg is a directory', () => {
    const result = parseMergeToolArgs(['/tmp']);
    expect(result.mode).toBe('multi-file');
    if (result.mode === 'multi-file') {
      expect(result.repoDir).toBe('/tmp');
    }
  });
});
