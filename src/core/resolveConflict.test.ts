import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPrompt, resolveConflict, buildBatchPrompt, resolveAllConflicts } from './resolveConflict.js';
import type { ConflictBlock } from './types.js';

function makeBlock(overrides?: Partial<ConflictBlock>): ConflictBlock {
  return {
    ours: {
      content: 'const x = 1;',
      ticket: null,
    },
    theirs: {
      content: 'const x = 2;',
      ticket: null,
    },
    range: { start: 10, end: 15 },
    surroundingContext: 'function foo() {\n  // ...\n}',
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
      },
      theirs: {
        content: 'const x = 2;',
        ticket: {
          ticketId: 'NOV-11',
          intentSummary: 'Add environment variable overrides',
        },
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

describe('resolveConflict', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('should return parsed resolution and explanation from Claude', async () => {
    const mockResponse = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            resolution: 'const x = 3;',
            explanation:
              'Our side set x to 1, theirs set it to 2. Merging to 3 combines both intents.',
          }),
        },
      ],
    };

    const mockCreate = vi.fn().mockResolvedValue(mockResponse);

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create: mockCreate };
      },
    }));

    process.env.ANTHROPIC_API_KEY = 'test-key';

    const { resolveConflict: resolve } = await import('./resolveConflict.js');
    const block = makeBlock();
    const result = await resolve(block);

    expect(result.resolution).toBe('const x = 3;');
    expect(result.explanation).toBe(
      'Our side set x to 1, theirs set it to 2. Merging to 3 combines both intents.'
    );
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('should throw on non-JSON Claude response', async () => {
    const mockResponse = {
      content: [
        {
          type: 'text',
          text: 'Sorry, I cannot help with that.',
        },
      ],
    };

    const mockCreate = vi.fn().mockResolvedValue(mockResponse);

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create: mockCreate };
      },
    }));

    process.env.ANTHROPIC_API_KEY = 'test-key';

    const { resolveConflict: resolve } = await import('./resolveConflict.js');
    const block = makeBlock();

    await expect(resolve(block)).rejects.toThrow(
      'Failed to parse Claude response as JSON'
    );
  });

  it('should handle response with extra whitespace around JSON', async () => {
    const json = JSON.stringify({
      resolution: 'merged code',
      explanation: 'Combined both changes.',
    });
    const mockResponse = {
      content: [{ type: 'text', text: `  \n${json}\n  ` }],
    };

    const mockCreate = vi.fn().mockResolvedValue(mockResponse);

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create: mockCreate };
      },
    }));

    process.env.ANTHROPIC_API_KEY = 'test-key';

    const { resolveConflict: resolve } = await import('./resolveConflict.js');
    const result = await resolve(makeBlock());

    expect(result.resolution).toBe('merged code');
    expect(result.explanation).toBe('Combined both changes.');
  });

  it('should pass correct model and max_tokens to Anthropic', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ resolution: 'ok', explanation: 'ok' }),
        },
      ],
    });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create: mockCreate };
      },
    }));

    process.env.ANTHROPIC_API_KEY = 'test-key';

    const { resolveConflict: resolve } = await import('./resolveConflict.js');
    await resolve(makeBlock());

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
      })
    );
  });
});

describe('buildBatchPrompt', () => {
  it('should include all conflicts numbered', () => {
    const blocks = [makeBlock(), makeBlock({ ours: { content: 'const y = 1;', ticket: null } })];
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
        ours: { content: 'a', ticket: { ticketId: 'LIN-1', intentSummary: 'Add feature' } },
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
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ resolution: 'ok', explanation: 'single' }) }],
    });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create: mockCreate };
      },
    }));

    process.env.ANTHROPIC_API_KEY = 'test-key';

    const { resolveAllConflicts: resolveAll } = await import('./resolveConflict.js');
    const results = await resolveAll([makeBlock()]);

    expect(results).toHaveLength(1);
    expect(results[0].resolution).toBe('ok');
    // Single block uses resolveConflict which sends max_tokens 4096
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 4096 }));
  });

  it('should parse batch JSON array for multiple blocks', async () => {
    const batchResponse = [
      { resolution: 'const x = 3;', explanation: 'merged x' },
      { resolution: 'const y = 4;', explanation: 'merged y' },
    ];
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(batchResponse) }],
    });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create: mockCreate };
      },
    }));

    process.env.ANTHROPIC_API_KEY = 'test-key';

    const { resolveAllConflicts: resolveAll } = await import('./resolveConflict.js');
    const results = await resolveAll([makeBlock(), makeBlock()]);

    expect(results).toHaveLength(2);
    expect(results[0].resolution).toBe('const x = 3;');
    expect(results[1].explanation).toBe('merged y');
  });

  it('should scale max_tokens with number of blocks', async () => {
    const batchResponse = Array.from({ length: 3 }, (_, i) => ({
      resolution: `res${i}`,
      explanation: `exp${i}`,
    }));
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(batchResponse) }],
    });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create: mockCreate };
      },
    }));

    process.env.ANTHROPIC_API_KEY = 'test-key';

    const { resolveAllConflicts: resolveAll } = await import('./resolveConflict.js');
    await resolveAll([makeBlock(), makeBlock(), makeBlock()]);

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 12288 }));
  });

  it('should throw on array length mismatch', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([{ resolution: 'a', explanation: 'b' }]) }],
    });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create: mockCreate };
      },
    }));

    process.env.ANTHROPIC_API_KEY = 'test-key';

    const { resolveAllConflicts: resolveAll } = await import('./resolveConflict.js');
    await expect(resolveAll([makeBlock(), makeBlock()])).rejects.toThrow('Expected JSON array of 2 results, got 1');
  });

  it('should throw on non-JSON response', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'not json' }],
    });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create: mockCreate };
      },
    }));

    process.env.ANTHROPIC_API_KEY = 'test-key';

    const { resolveAllConflicts: resolveAll } = await import('./resolveConflict.js');
    await expect(resolveAll([makeBlock(), makeBlock()])).rejects.toThrow('Failed to parse batch Claude response');
  });
});
