import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildPrompt,
  resolveConflict,
  buildBatchPrompt,
  resolveAllConflicts,
  validateResolution,
  isWhitespaceOnlyDiff,
  estimateTokens,
  windowContent,
  windowConflictSides,
  tryTrivialResolve,
} from './resolveConflict.js';
import type { ConflictBlock } from './types.js';

function makeBlock(overrides?: Partial<ConflictBlock>): ConflictBlock {
  return {
    ours: {
      content: 'const x = 1;',
      ticket: null,
      latestCommitDate: null,
    },
    theirs: {
      content: 'const x = 2;',
      ticket: null,
      latestCommitDate: null,
    },
    range: { start: 10, end: 15 },
    surroundingContext: 'function foo() {\n  // ...\n}',
    baseContent: '',
    ...overrides,
  };
}

describe('buildPrompt', () => {
  it('should include ours and theirs content', () => {
    const block = makeBlock();
    const prompt = buildPrompt(block);

    expect(prompt).toContain('const x = 1;');
    expect(prompt).toContain('const x = 2;');
  });

  it('should include surrounding context', () => {
    const block = makeBlock();
    const prompt = buildPrompt(block);

    expect(prompt).toContain('function foo()');
  });

  it('should show "No ticket context" section when no tickets are present', () => {
    const block = makeBlock();
    const prompt = buildPrompt(block);

    expect(prompt).toContain(
      'No ticket context available — resolve based on the code alone.'
    );
    expect(prompt).not.toContain('Why each side made this change');
  });

  it('should include ticket info when both tickets are present', () => {
    const block = makeBlock({
      ours: {
        content: 'const x = 1;',
        ticket: {
          ticketId: 'NOV-10',
          intentSummary: 'Refactor config loading for clarity',
        },
        latestCommitDate: null,
      },
      theirs: {
        content: 'const x = 2;',
        ticket: {
          ticketId: 'NOV-11',
          intentSummary: 'Add environment variable overrides',
        },
        latestCommitDate: null,
      },
    });
    const prompt = buildPrompt(block);

    expect(prompt).toContain('Why each side made this change');
    expect(prompt).toContain('Ticket NOV-10: Refactor config loading for clarity');
    expect(prompt).toContain('Ticket NOV-11: Add environment variable overrides');
    expect(prompt).toContain('Use these intents as the primary signal');
  });

  it('should show ticket section when only ours has a ticket', () => {
    const block = makeBlock({
      ours: {
        content: 'const x = 1;',
        ticket: {
          ticketId: 'ENG-5',
          intentSummary: 'Performance improvement',
        },
        latestCommitDate: null,
      },
    });
    const prompt = buildPrompt(block);

    expect(prompt).toContain('Why each side made this change');
    expect(prompt).toContain('Ticket ENG-5: Performance improvement');
    expect(prompt).toContain('No ticket associated.');
  });

  it('should show ticket section when only theirs has a ticket', () => {
    const block = makeBlock({
      theirs: {
        content: 'const x = 2;',
        ticket: {
          ticketId: 'ENG-7',
          intentSummary: 'Bug fix for edge case',
        },
        latestCommitDate: null,
      },
    });
    const prompt = buildPrompt(block);

    expect(prompt).toContain('Why each side made this change');
    expect(prompt).toContain('Ticket ENG-7: Bug fix for edge case');
    expect(prompt).toContain('No ticket associated.');
  });

  it('should instruct Claude to return JSON only', () => {
    const block = makeBlock();
    const prompt = buildPrompt(block);

    expect(prompt).toContain('Return ONLY a JSON object');
    expect(prompt).toContain('"resolution"');
    expect(prompt).toContain('"explanation"');
    expect(prompt).toContain('No markdown, no code fences, no preamble');
  });
});

function mockAI(text: string) {
  vi.doMock('ai', () => ({
    generateText: vi.fn().mockResolvedValue({ text }),
  }));
  vi.doMock('@ai-sdk/anthropic', () => ({ createAnthropic: () => () => ({}) }));
  vi.doMock('@ai-sdk/openai', () => ({ createOpenAI: () => () => ({}) }));
  process.env.ANTHROPIC_API_KEY = 'test-key';
}

describe('resolveConflict', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('should return parsed resolution and explanation from AI', async () => {
    mockAI(JSON.stringify({
      resolution: 'const x = 3;',
      explanation: 'Our side set x to 1, theirs set it to 2. Merging to 3 combines both intents.',
    }));

    const { resolveConflict: resolve } = await import('./resolveConflict.js');
    const result = await resolve(makeBlock());

    expect(result.resolution).toBe('const x = 3;');
    expect(result.explanation).toBe(
      'Our side set x to 1, theirs set it to 2. Merging to 3 combines both intents.'
    );
  });

  it('should throw on non-JSON AI response', async () => {
    mockAI('Sorry, I cannot help with that.');

    const { resolveConflict: resolve } = await import('./resolveConflict.js');

    await expect(resolve(makeBlock())).rejects.toThrow(
      'Failed to parse AI response as JSON'
    );
  });

  it('should handle response with extra whitespace around JSON', async () => {
    const json = JSON.stringify({ resolution: 'merged code', explanation: 'Combined both changes.' });
    mockAI(`  \n${json}\n  `);

    const { resolveConflict: resolve } = await import('./resolveConflict.js');
    const result = await resolve(makeBlock());

    expect(result.resolution).toBe('merged code');
    expect(result.explanation).toBe('Combined both changes.');
  });
});

describe('buildBatchPrompt', () => {
  it('should include all conflicts numbered', () => {
    const blocks = [makeBlock(), makeBlock({ ours: { content: 'const y = 1;', ticket: null, latestCommitDate: null } })];
    const prompt = buildBatchPrompt(blocks);

    expect(prompt).toContain('Conflict 1 of 2');
    expect(prompt).toContain('Conflict 2 of 2');
    expect(prompt).toContain('const x = 1;');
    expect(prompt).toContain('const y = 1;');
  });

  it('should request a JSON array with correct count', () => {
    const blocks = [makeBlock(), makeBlock(), makeBlock()];
    const prompt = buildBatchPrompt(blocks);

    expect(prompt).toContain('JSON array with exactly 3 object(s)');
    expect(prompt).toContain('This file has 3 conflict(s)');
  });

  it('should include ticket info when available', () => {
    const blocks = [
      makeBlock({
        ours: { content: 'a', ticket: { ticketId: 'LIN-1', intentSummary: 'Add feature' }, latestCommitDate: null },
      }),
    ];
    const prompt = buildBatchPrompt(blocks);

    expect(prompt).toContain('Ticket LIN-1: Add feature');
  });

  it('should note when no ticket context exists', () => {
    const blocks = [makeBlock()];
    const prompt = buildBatchPrompt(blocks);

    expect(prompt).toContain('No ticket context available');
  });
});

describe('resolveAllConflicts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('should return empty array for no blocks', async () => {
    const { resolveAllConflicts: resolveAll } = await import('./resolveConflict.js');
    const results = await resolveAll([]);
    expect(results).toEqual([]);
  });

  it('should delegate to resolveConflict for single block', async () => {
    mockAI(JSON.stringify({ resolution: 'ok', explanation: 'single' }));

    const { resolveAllConflicts: resolveAll } = await import('./resolveConflict.js');
    const results = await resolveAll([makeBlock()]);

    expect(results).toHaveLength(1);
    expect(results[0].resolution).toBe('ok');
  });

  it('should parse batch JSON array for multiple blocks', async () => {
    const batchResponse = [
      { resolution: 'const x = 3;', explanation: 'merged x' },
      { resolution: 'const y = 4;', explanation: 'merged y' },
    ];
    mockAI(JSON.stringify(batchResponse));

    const { resolveAllConflicts: resolveAll } = await import('./resolveConflict.js');
    const results = await resolveAll([makeBlock(), makeBlock()]);

    expect(results).toHaveLength(2);
    expect(results[0].resolution).toBe('const x = 3;');
    expect(results[1].explanation).toBe('merged y');
  });

  it('should throw on array length mismatch', async () => {
    mockAI(JSON.stringify([{ resolution: 'a', explanation: 'b' }]));

    const { resolveAllConflicts: resolveAll } = await import('./resolveConflict.js');
    await expect(resolveAll([makeBlock(), makeBlock()])).rejects.toThrow('Expected JSON array of 2 results, got 1');
  });

  it('should throw on non-JSON response', async () => {
    mockAI('not json');

    const { resolveAllConflicts: resolveAll } = await import('./resolveConflict.js');
    await expect(resolveAll([makeBlock(), makeBlock()])).rejects.toThrow('Failed to parse batch');
  });
});

// --- Feature 1: Output Validation ---

describe('validateResolution', () => {
  it('should pass for clean resolution', () => {
    expect(() => validateResolution('const x = 3;')).not.toThrow();
  });

  it('should throw for resolution with <<<<<<< markers', () => {
    expect(() => validateResolution('<<<<<<< HEAD\nconst x = 1;')).toThrow('leftover conflict markers');
  });

  it('should throw for resolution with ======= markers', () => {
    expect(() => validateResolution('const x = 1;\n=======\nconst x = 2;')).toThrow('leftover conflict markers');
  });

  it('should throw for resolution with >>>>>>> markers', () => {
    expect(() => validateResolution('const x = 2;\n>>>>>>> branch')).toThrow('leftover conflict markers');
  });

  it('should NOT throw for markdown heading underlines with =======', () => {
    // Markdown uses ======= under headings but with text on the same line or content after
    expect(() => validateResolution('Title\n======= extra')).not.toThrow();
  });

  it('should include conflict index in error message when provided', () => {
    expect(() => validateResolution('<<<<<<< HEAD', 2)).toThrow('Conflict 3 resolution');
  });
});

// --- Feature 2: Base 3-Way Context ---

describe('base 3-way context in prompts', () => {
  it('should include base section in single prompt when baseContent is provided', () => {
    const block = makeBlock({ baseContent: 'const x = 0;' });
    const prompt = buildPrompt(block);

    expect(prompt).toContain('Base version (common ancestor)');
    expect(prompt).toContain('const x = 0;');
    expect(prompt).toContain('Compare each side against the base');
  });

  it('should omit base section when baseContent is empty', () => {
    const block = makeBlock({ baseContent: '' });
    const prompt = buildPrompt(block);

    expect(prompt).not.toContain('Base version');
    expect(prompt).not.toContain('Compare each side against the base');
  });

  it('should include base section in batch prompt', () => {
    const blocks = [
      makeBlock({ baseContent: 'const original = true;' }),
      makeBlock({ baseContent: '' }),
    ];
    const prompt = buildBatchPrompt(blocks);

    expect(prompt).toContain('const original = true;');
    expect(prompt).toContain('Compare each side against the base');
  });
});

// --- Feature 4: Whitespace-Only Fast Path ---

describe('isWhitespaceOnlyDiff', () => {
  it('should return true for identical strings', () => {
    expect(isWhitespaceOnlyDiff('const x = 1;', 'const x = 1;')).toBe(true);
  });

  it('should return true when only indentation differs', () => {
    expect(isWhitespaceOnlyDiff('  const x = 1;', '    const x = 1;')).toBe(true);
  });

  it('should return true when trailing whitespace differs', () => {
    expect(isWhitespaceOnlyDiff('const x = 1;  ', 'const x = 1;')).toBe(true);
  });

  it('should return true for tab vs space differences', () => {
    expect(isWhitespaceOnlyDiff('\tconst x = 1;', '  const x = 1;')).toBe(true);
  });

  it('should return false for actual content differences', () => {
    expect(isWhitespaceOnlyDiff('const x = 1;', 'const x = 2;')).toBe(false);
  });

  it('should return false for different line count with different content', () => {
    expect(isWhitespaceOnlyDiff('line1\nline2', 'line1\nline3')).toBe(false);
  });

  it('should return true when blank lines are added or removed', () => {
    expect(isWhitespaceOnlyDiff('line1\n\nline2', 'line1\nline2')).toBe(true);
  });
});

// --- Feature 5: Token Windowing ---

describe('token windowing', () => {
  it('should return text unchanged when under threshold', () => {
    const text = 'short text';
    expect(windowContent(text, 1000)).toBe(text);
  });

  it('should truncate large text with marker', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}: ${'x'.repeat(50)}`);
    const text = lines.join('\n');
    const result = windowContent(text, 500);

    expect(result).toContain('truncated');
    expect(result.length).toBeLessThan(text.length);
  });

  it('should preserve head and tail lines', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line-${i}`);
    const text = lines.join('\n');
    const result = windowContent(text, 200);

    expect(result).toContain('line-0');
    expect(result).toContain('line-99');
  });

  it('estimateTokens should approximate text length / 4', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});

describe('windowConflictSides', () => {
  it('should return small content unchanged', () => {
    const { ours, theirs } = windowConflictSides('line1\nline2', 'line1\nline3');
    expect(ours).toBe('line1\nline2');
    expect(theirs).toBe('line1\nline3');
  });

  it('should truncate identical stretches in large conflicts', () => {
    // 100 identical lines, then 1 diff, then 100 more identical lines
    const shared = Array.from({ length: 100 }, (_, i) => `shared-${i}`);
    const oursLines = [...shared, 'OURS CHANGE', ...shared];
    const theirsLines = [...shared, 'THEIRS CHANGE', ...shared];
    const ours = oursLines.join('\n');
    const theirs = theirsLines.join('\n');

    // Force windowing with low maxTokens
    const result = windowConflictSides(ours, theirs, 3, 50);

    expect(result.ours).toContain('OURS CHANGE');
    expect(result.theirs).toContain('THEIRS CHANGE');
    expect(result.ours).toContain('identical lines truncated');
    expect(result.ours.split('\n').length).toBeLessThan(oursLines.length);
  });

  it('should keep context lines around diff regions', () => {
    const shared = Array.from({ length: 50 }, (_, i) => `shared-${i}`);
    const oursLines = [...shared, 'DIFF-LINE', ...shared];
    const theirsLines = [...shared, 'OTHER-LINE', ...shared];

    const result = windowConflictSides(
      oursLines.join('\n'),
      theirsLines.join('\n'),
      3,
      50
    );

    // Lines adjacent to the diff should be preserved
    expect(result.ours).toContain('shared-47');
    expect(result.ours).toContain('shared-48');
    expect(result.ours).toContain('shared-49');
    expect(result.ours).toContain('DIFF-LINE');
  });

  it('should preserve all lines when everything differs', () => {
    const ours = Array.from({ length: 10 }, (_, i) => `ours-${i}`).join('\n');
    const theirs = Array.from({ length: 10 }, (_, i) => `theirs-${i}`).join('\n');

    const result = windowConflictSides(ours, theirs, 3, 50);

    // All lines differ, so nothing should be truncated
    expect(result.ours).not.toContain('truncated');
    expect(result.theirs).not.toContain('truncated');
  });
});

describe('tryTrivialResolve', () => {
  it('should resolve identical sides without LLM', () => {
    const result = tryTrivialResolve(makeBlock({ ours: { content: 'same', ticket: null, latestCommitDate: null }, theirs: { content: 'same', ticket: null, latestCommitDate: null } }));
    expect(result).not.toBeNull();
    expect(result!.resolution).toBe('same');
    expect(result!.explanation).toContain('identical');
  });

  it('should resolve whitespace-only diff without LLM', () => {
    const result = tryTrivialResolve(makeBlock({ ours: { content: '  code', ticket: null, latestCommitDate: null }, theirs: { content: 'code', ticket: null, latestCommitDate: null } }));
    expect(result).not.toBeNull();
    expect(result!.explanation).toContain('Whitespace');
  });

  it('should resolve empty ours — keep theirs', () => {
    const result = tryTrivialResolve(makeBlock({ ours: { content: '', ticket: null, latestCommitDate: null }, theirs: { content: 'real code', ticket: null, latestCommitDate: null } }));
    expect(result).not.toBeNull();
    expect(result!.resolution).toBe('real code');
    expect(result!.explanation).toContain('kept theirs');
  });

  it('should resolve empty theirs — keep ours', () => {
    const result = tryTrivialResolve(makeBlock({ ours: { content: 'real code', ticket: null, latestCommitDate: null }, theirs: { content: '', ticket: null, latestCommitDate: null } }));
    expect(result).not.toBeNull();
    expect(result!.resolution).toBe('real code');
    expect(result!.explanation).toContain('kept ours');
  });

  it('should resolve both empty', () => {
    const result = tryTrivialResolve(makeBlock({ ours: { content: '', ticket: null, latestCommitDate: null }, theirs: { content: '', ticket: null, latestCommitDate: null } }));
    expect(result).not.toBeNull();
    expect(result!.resolution).toBe('');
  });

  it('should resolve trailing newline difference only', () => {
    const result = tryTrivialResolve(makeBlock({ ours: { content: 'code\n', ticket: null, latestCommitDate: null }, theirs: { content: 'code', ticket: null, latestCommitDate: null } }));
    expect(result).not.toBeNull();
    expect(result!.explanation).toContain('Trailing newline');
  });

  it('should return null for real conflicts', () => {
    const result = tryTrivialResolve(makeBlock());
    expect(result).toBeNull();
  });
});
