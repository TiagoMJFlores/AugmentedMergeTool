import { afterEach, describe, expect, it, vi } from 'vitest';

describe('CLI apply behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('applies only accepted conflict ranges when a file has two conflict blocks', async () => {
    const filePath = `${process.cwd()}/conflicted.ts`;
    const originalContent = [
      'A',
      '<<<<<<< HEAD',
      'ours1',
      '=======',
      'theirs1',
      '>>>>>>> branch',
      'B',
      '<<<<<<< HEAD',
      'ours2',
      '=======',
      'theirs2',
      '>>>>>>> branch',
      'C',
    ].join('\n');

    const readFileSync = vi.fn().mockReturnValue(originalContent);
    const writeFileSync = vi.fn();

    vi.doMock('fs', () => ({
      readFileSync,
      writeFileSync,
    }));

    const status = vi.fn().mockResolvedValue({ conflicted: ['conflicted.ts'] });
    const add = vi.fn().mockResolvedValue(undefined);

    vi.doMock('simple-git', () => ({
      default: vi.fn(() => ({ status, add })),
    }));

    vi.doMock('./core/providers/index.js', () => ({
      normalizeProvider: vi.fn(() => 'none'),
      createProvider: vi.fn(() => ({ fetchTicket: vi.fn() })),
    }));

    vi.doMock('./core/buildConflictBlocks.js', () => ({
      buildConflictBlocks: vi.fn().mockResolvedValue([
        {
          ours: { content: 'ours1', ticket: null },
          theirs: { content: 'theirs1', ticket: null },
          range: { start: 2, end: 6 },
          surroundingContext: '',
          baseContent: '',
        },
        {
          ours: { content: 'ours2', ticket: null },
          theirs: { content: 'theirs2', ticket: null },
          range: { start: 8, end: 12 },
          surroundingContext: '',
          baseContent: '',
        },
      ]),
    }));

    vi.doMock('./core/resolveConflict.js', () => ({
      resolveConflict: vi
        .fn()
        .mockResolvedValueOnce({ resolution: 'RESOLUTION_1', explanation: 'x' })
        .mockResolvedValueOnce({ resolution: 'RESOLUTION_2', explanation: 'y' }),
    }));

    vi.doMock('./adapters/cli/prompt.js', () => ({
      askUserAction: vi.fn().mockResolvedValueOnce('s').mockResolvedValueOnce('u'),
    }));

    vi.doMock('./adapters/cli/display.js', () => ({
      printHeader: vi.fn(),
      printConflictBlock: vi.fn(),
      printResolveResult: vi.fn(),
      printApplied: vi.fn(),
      printSkipped: vi.fn(),
      printSummary: vi.fn(),
      printNoConflicts: vi.fn(),
      printError: vi.fn(),
    }));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await import('./index.js');
    await new Promise((resolve) => setImmediate(resolve));

    expect(readFileSync).toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalledWith(
      filePath,
      [
        'A',
        '<<<<<<< HEAD',
        'ours1',
        '=======',
        'theirs1',
        '>>>>>>> branch',
        'B',
        'RESOLUTION_2',
        'C',
      ].join('\n'),
      'utf-8'
    );
    expect(add).toHaveBeenCalledWith(filePath);
    expect(add).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('applies all three conflict blocks when all are accepted', async () => {
    const filePath = `${process.cwd()}/conflicted.ts`;
    const originalContent = [
      'start',
      '<<<<<<< HEAD',
      'ours1',
      '=======',
      'theirs1',
      '>>>>>>> branch',
      'middle-1',
      '<<<<<<< HEAD',
      'ours2',
      '=======',
      'theirs2',
      '>>>>>>> branch',
      'middle-2',
      '<<<<<<< HEAD',
      'ours3',
      '=======',
      'theirs3',
      '>>>>>>> branch',
      'end',
    ].join('\n');

    const readFileSync = vi.fn().mockReturnValue(originalContent);
    const writeFileSync = vi.fn();

    vi.doMock('fs', () => ({
      readFileSync,
      writeFileSync,
    }));

    const status = vi.fn().mockResolvedValue({ conflicted: ['conflicted.ts'] });
    const add = vi.fn().mockResolvedValue(undefined);

    vi.doMock('simple-git', () => ({
      default: vi.fn(() => ({ status, add })),
    }));

    vi.doMock('./core/providers/index.js', () => ({
      normalizeProvider: vi.fn(() => 'none'),
      createProvider: vi.fn(() => ({ fetchTicket: vi.fn() })),
    }));

    vi.doMock('./core/buildConflictBlocks.js', () => ({
      buildConflictBlocks: vi.fn().mockResolvedValue([
        {
          ours: { content: 'ours1', ticket: null },
          theirs: { content: 'theirs1', ticket: null },
          range: { start: 2, end: 6 },
          surroundingContext: '',
          baseContent: '',
        },
        {
          ours: { content: 'ours2', ticket: null },
          theirs: { content: 'theirs2', ticket: null },
          range: { start: 8, end: 12 },
          surroundingContext: '',
          baseContent: '',
        },
        {
          ours: { content: 'ours3', ticket: null },
          theirs: { content: 'theirs3', ticket: null },
          range: { start: 14, end: 18 },
          surroundingContext: '',
          baseContent: '',
        },
      ]),
    }));

    vi.doMock('./core/resolveConflict.js', () => ({
      resolveConflict: vi
        .fn()
        .mockResolvedValueOnce({ resolution: 'RESOLUTION_1', explanation: 'x' })
        .mockResolvedValueOnce({ resolution: 'RESOLUTION_2', explanation: 'y' })
        .mockResolvedValueOnce({ resolution: 'RESOLUTION_3', explanation: 'z' }),
    }));

    vi.doMock('./adapters/cli/prompt.js', () => ({
      askUserAction: vi
        .fn()
        .mockResolvedValueOnce('u')
        .mockResolvedValueOnce('u')
        .mockResolvedValueOnce('u'),
    }));

    vi.doMock('./adapters/cli/display.js', () => ({
      printHeader: vi.fn(),
      printConflictBlock: vi.fn(),
      printResolveResult: vi.fn(),
      printApplied: vi.fn(),
      printSkipped: vi.fn(),
      printSummary: vi.fn(),
      printNoConflicts: vi.fn(),
      printError: vi.fn(),
    }));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await import('./index.js');
    await new Promise((resolve) => setImmediate(resolve));

    expect(writeFileSync).toHaveBeenCalledWith(
      filePath,
      ['start', 'RESOLUTION_1', 'middle-1', 'RESOLUTION_2', 'middle-2', 'RESOLUTION_3', 'end'].join(
        '\n'
      ),
      'utf-8'
    );
    expect(add).toHaveBeenCalledWith(filePath);
    expect(add).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('applies only the middle block and preserves markers for skipped blocks', async () => {
    const filePath = `${process.cwd()}/conflicted.ts`;
    const originalContent = [
      'start',
      '<<<<<<< HEAD',
      'ours1',
      '=======',
      'theirs1',
      '>>>>>>> branch',
      'middle-1',
      '<<<<<<< HEAD',
      'ours2',
      '=======',
      'theirs2',
      '>>>>>>> branch',
      'middle-2',
      '<<<<<<< HEAD',
      'ours3',
      '=======',
      'theirs3',
      '>>>>>>> branch',
      'end',
    ].join('\n');

    const readFileSync = vi.fn().mockReturnValue(originalContent);
    const writeFileSync = vi.fn();

    vi.doMock('fs', () => ({
      readFileSync,
      writeFileSync,
    }));

    const status = vi.fn().mockResolvedValue({ conflicted: ['conflicted.ts'] });
    const add = vi.fn().mockResolvedValue(undefined);

    vi.doMock('simple-git', () => ({
      default: vi.fn(() => ({ status, add })),
    }));

    vi.doMock('./core/providers/index.js', () => ({
      normalizeProvider: vi.fn(() => 'none'),
      createProvider: vi.fn(() => ({ fetchTicket: vi.fn() })),
    }));

    vi.doMock('./core/buildConflictBlocks.js', () => ({
      buildConflictBlocks: vi.fn().mockResolvedValue([
        {
          ours: { content: 'ours1', ticket: null },
          theirs: { content: 'theirs1', ticket: null },
          range: { start: 2, end: 6 },
          surroundingContext: '',
          baseContent: '',
        },
        {
          ours: { content: 'ours2', ticket: null },
          theirs: { content: 'theirs2', ticket: null },
          range: { start: 8, end: 12 },
          surroundingContext: '',
          baseContent: '',
        },
        {
          ours: { content: 'ours3', ticket: null },
          theirs: { content: 'theirs3', ticket: null },
          range: { start: 14, end: 18 },
          surroundingContext: '',
          baseContent: '',
        },
      ]),
    }));

    vi.doMock('./core/resolveConflict.js', () => ({
      resolveConflict: vi
        .fn()
        .mockResolvedValueOnce({ resolution: 'RESOLUTION_1', explanation: 'x' })
        .mockResolvedValueOnce({ resolution: 'RESOLUTION_2', explanation: 'y' })
        .mockResolvedValueOnce({ resolution: 'RESOLUTION_3', explanation: 'z' }),
    }));

    vi.doMock('./adapters/cli/prompt.js', () => ({
      askUserAction: vi
        .fn()
        .mockResolvedValueOnce('s')
        .mockResolvedValueOnce('u')
        .mockResolvedValueOnce('s'),
    }));

    vi.doMock('./adapters/cli/display.js', () => ({
      printHeader: vi.fn(),
      printConflictBlock: vi.fn(),
      printResolveResult: vi.fn(),
      printApplied: vi.fn(),
      printSkipped: vi.fn(),
      printSummary: vi.fn(),
      printNoConflicts: vi.fn(),
      printError: vi.fn(),
    }));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await import('./index.js');
    await new Promise((resolve) => setImmediate(resolve));

    expect(writeFileSync).toHaveBeenCalledWith(
      filePath,
      [
        'start',
        '<<<<<<< HEAD',
        'ours1',
        '=======',
        'theirs1',
        '>>>>>>> branch',
        'middle-1',
        'RESOLUTION_2',
        'middle-2',
        '<<<<<<< HEAD',
        'ours3',
        '=======',
        'theirs3',
        '>>>>>>> branch',
        'end',
      ].join('\n'),
      'utf-8'
    );
    expect(add).toHaveBeenCalledWith(filePath);
    expect(add).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
