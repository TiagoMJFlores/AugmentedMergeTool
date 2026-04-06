import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import type { ConflictBlock, ResolveResult } from './types.js';
import { ResolutionCache } from './cache.js';

let _anthropic: Anthropic | null = null;
let _cache: ResolutionCache | null = null;

function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Add it to your .env file.'
      );
    }
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

function getCache(): ResolutionCache | null {
  if (process.env.MERGE_CACHE_DISABLED === '1') return null;
  if (!_cache) {
    const cacheDir = process.env.MERGE_CACHE_DIR || '.mergeagent-cache';
    const ttl = Number(process.env.CACHE_TTL_HOURS) || 24;
    _cache = new ResolutionCache(cacheDir, ttl, 500);
  }
  return _cache;
}

// --- Feature 1: Output Validation ---

const CONFLICT_MARKER_PATTERN = /^(<{7}|={7}|>{7})\s?/m;

export function validateResolution(resolution: string, index?: number): void {
  if (CONFLICT_MARKER_PATTERN.test(resolution)) {
    const label = index !== undefined ? `Conflict ${index + 1} resolution` : 'Resolution';
    throw new Error(
      `${label} contains leftover conflict markers. This indicates the AI did not fully resolve the conflict.`
    );
  }
}

// --- Feature 4: Whitespace-Only Fast Path ---

export function isWhitespaceOnlyDiff(a: string, b: string): boolean {
  const normalize = (s: string): string =>
    s.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return normalize(a) === normalize(b);
}

// --- Feature 5: Token Windowing ---

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function windowContent(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;

  const lines = text.split('\n');
  const maxChars = maxTokens * 4;
  const keepLines = Math.max(4, Math.floor(lines.length * (maxChars / text.length)));
  const half = Math.floor(keepLines / 2);

  const head = lines.slice(0, half);
  const tail = lines.slice(-half);
  return [...head, `\n... [${lines.length - keepLines} lines truncated] ...\n`, ...tail].join('\n');
}

/**
 * Smart-window conflict sides: compare ours vs theirs line-by-line, keep all
 * lines that actually differ plus `contextLines` identical lines around each
 * diff region.  Long stretches of identical lines in between are collapsed
 * with a truncation marker.  This preserves every meaningful difference while
 * cutting boilerplate that is the same on both sides.
 */
export function windowConflictSides(
  ours: string,
  theirs: string,
  contextLines = 5,
  maxTokens = 3000
): { ours: string; theirs: string } {
  // Skip if both sides are small enough
  if (estimateTokens(ours) + estimateTokens(theirs) <= maxTokens * 2) {
    return { ours, theirs };
  }

  const oursLines = ours.split('\n');
  const theirsLines = theirs.split('\n');
  const maxLen = Math.max(oursLines.length, theirsLines.length);

  // Mark which lines differ
  const isDiff: boolean[] = [];
  for (let i = 0; i < maxLen; i++) {
    isDiff[i] = (oursLines[i] ?? '') !== (theirsLines[i] ?? '');
  }

  // Expand diff regions by contextLines in each direction
  const keep = new Set<number>();
  // Always keep first and last few lines for structural context
  for (let i = 0; i < Math.min(contextLines, maxLen); i++) keep.add(i);
  for (let i = Math.max(0, maxLen - contextLines); i < maxLen; i++) keep.add(i);

  for (let i = 0; i < maxLen; i++) {
    if (isDiff[i]) {
      for (let j = Math.max(0, i - contextLines); j <= Math.min(maxLen - 1, i + contextLines); j++) {
        keep.add(j);
      }
    }
  }

  // If everything is kept, return as-is
  if (keep.size >= maxLen) return { ours, theirs };

  // Build windowed output
  const sortedKeep = [...keep].sort((a, b) => a - b);
  const buildWindowed = (lines: string[]): string => {
    const result: string[] = [];
    let lastIdx = -1;
    for (const idx of sortedKeep) {
      if (lastIdx >= 0 && idx - lastIdx > 1) {
        const skipped = idx - lastIdx - 1;
        result.push(`... [${skipped} identical lines truncated] ...`);
      }
      result.push(lines[idx] ?? '');
      lastIdx = idx;
    }
    return result.join('\n');
  };

  return {
    ours: buildWindowed(oursLines),
    theirs: buildWindowed(theirsLines),
  };
}

function applyWindowing(block: ConflictBlock): ConflictBlock {
  const maxTokens = Number(process.env.MAX_CONFLICT_TOKENS) || 3000;
  const { ours: windowedOurs, theirs: windowedTheirs } = windowConflictSides(
    block.ours.content,
    block.theirs.content,
    5,
    maxTokens
  );
  return {
    ...block,
    ours: { ...block.ours, content: windowedOurs },
    theirs: { ...block.theirs, content: windowedTheirs },
    surroundingContext: windowContent(block.surroundingContext, maxTokens),
    baseContent: windowContent(block.baseContent, maxTokens),
  };
}

// --- Feature 2: Base 3-Way Context in Prompts ---

function buildBaseSection(baseContent: string): string {
  if (!baseContent) return '';
  return `
### Base version (common ancestor):
\`\`\`
${baseContent}
\`\`\`
`;
}

export function buildPrompt(block: ConflictBlock): string {
  const windowed = applyWindowing(block);

  const oursTicket = windowed.ours.ticket
    ? `Ticket ${windowed.ours.ticket.ticketId}: ${windowed.ours.ticket.intentSummary}`
    : 'No ticket associated.';

  const theirsTicket = windowed.theirs.ticket
    ? `Ticket ${windowed.theirs.ticket.ticketId}: ${windowed.theirs.ticket.intentSummary}`
    : 'No ticket associated.';

  const baseSection = buildBaseSection(windowed.baseContent);
  const baseInstruction = windowed.baseContent
    ? ' Compare each side against the base version to understand what each branch changed.'
    : '';

  return `You are an expert software engineer resolving a Git merge conflict.${baseInstruction}

Return ONLY a JSON object with exactly two fields:
- "resolution": the resolved code with no conflict markers, no explanation, no markdown
- "explanation": 2-3 sentences in plain English explaining what each side was trying to do and why your resolution makes sense. This will be rendered directly in the CLI output.

${windowed.ours.ticket || windowed.theirs.ticket ? `## Why each side made this change

### Our side (HEAD):
${oursTicket}

### Their side (incoming):
${theirsTicket}

Use these intents as the primary signal for your decision.
` : '## No ticket context available — resolve based on the code alone.\n'}
---

## Conflict to resolve
${baseSection}
### Our version (HEAD):
\`\`\`
${windowed.ours.content}
\`\`\`

### Their version (incoming):
\`\`\`
${windowed.theirs.content}
\`\`\`

### Surrounding context:
\`\`\`
${windowed.surroundingContext}
\`\`\`

---

Respond with ONLY the JSON object. No markdown, no code fences, no preamble.`;
}

export async function resolveConflict(
  block: ConflictBlock
): Promise<ResolveResult> {
  // Feature 4: Whitespace fast path
  if (isWhitespaceOnlyDiff(block.ours.content, block.theirs.content)) {
    return {
      resolution: block.ours.content,
      explanation: 'Whitespace-only difference — kept ours version.',
    };
  }

  // Feature 3: Cache lookup
  const cache = getCache();
  if (cache) {
    const key = cache.computeKey(block.baseContent, block.ours.content, block.theirs.content);
    const cached = cache.get(key);
    if (cached) return cached;
  }

  const prompt = buildPrompt(block);
  const anthropic = getAnthropicClient();

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = (message.content[0] as { type: 'text'; text: string }).text.trim();

  let result: ResolveResult;
  try {
    const parsed = JSON.parse(raw);
    result = {
      resolution: parsed.resolution,
      explanation: parsed.explanation,
    };
  } catch {
    throw new Error(
      `Failed to parse Claude response as JSON. Raw response:\n${raw}`
    );
  }

  // Feature 1: Validate output
  validateResolution(result.resolution);

  // Feature 3: Cache store
  if (cache) {
    const key = cache.computeKey(block.baseContent, block.ours.content, block.theirs.content);
    cache.set(key, result);
  }

  return result;
}

export function buildBatchPrompt(blocks: ConflictBlock[]): string {
  const conflictSections = blocks.map((block, index) => {
    const windowed = applyWindowing(block);

    const oursTicket = windowed.ours.ticket
      ? `Ticket ${windowed.ours.ticket.ticketId}: ${windowed.ours.ticket.intentSummary}`
      : 'No ticket associated.';

    const theirsTicket = windowed.theirs.ticket
      ? `Ticket ${windowed.theirs.ticket.ticketId}: ${windowed.theirs.ticket.intentSummary}`
      : 'No ticket associated.';

    const ticketSection = windowed.ours.ticket || windowed.theirs.ticket
      ? `#### Our side intent:\n${oursTicket}\n\n#### Their side intent:\n${theirsTicket}`
      : 'No ticket context available — resolve based on the code alone.';

    const baseSection = buildBaseSection(windowed.baseContent);

    return `## Conflict ${index + 1} of ${blocks.length}

${ticketSection}
${baseSection}
### Our version (HEAD):
\`\`\`
${windowed.ours.content}
\`\`\`

### Their version (incoming):
\`\`\`
${windowed.theirs.content}
\`\`\`

### Surrounding context:
\`\`\`
${windowed.surroundingContext}
\`\`\``;
  });

  const hasBase = blocks.some((b) => b.baseContent);
  const baseInstruction = hasBase
    ? ' Compare each side against the base version to understand what each branch changed.'
    : '';

  return `You are an expert software engineer resolving Git merge conflicts.${baseInstruction}

This file has ${blocks.length} conflict(s). Resolve ALL of them.

Return ONLY a JSON array with exactly ${blocks.length} object(s), one per conflict in order.
Each object must have exactly two fields:
- "resolution": the resolved code with no conflict markers, no explanation, no markdown
- "explanation": 2-3 sentences explaining what each side was trying to do and why your resolution makes sense

Consider all conflicts together — they are in the same file and may be related.

---

${conflictSections.join('\n\n---\n\n')}

---

Respond with ONLY the JSON array. No markdown, no code fences, no preamble.`;
}

export async function resolveAllConflicts(
  blocks: ConflictBlock[]
): Promise<ResolveResult[]> {
  if (blocks.length === 0) return [];
  if (blocks.length === 1) return [await resolveConflict(blocks[0])];

  const cache = getCache();
  const results: (ResolveResult | null)[] = new Array(blocks.length).fill(null);
  const uncachedBlocks: ConflictBlock[] = [];
  const uncachedIndexes: number[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Feature 4: Whitespace fast path
    if (isWhitespaceOnlyDiff(block.ours.content, block.theirs.content)) {
      results[i] = {
        resolution: block.ours.content,
        explanation: 'Whitespace-only difference — kept ours version.',
      };
      continue;
    }

    // Feature 3: Cache lookup
    if (cache) {
      const key = cache.computeKey(block.baseContent, block.ours.content, block.theirs.content);
      const cached = cache.get(key);
      if (cached) {
        results[i] = cached;
        continue;
      }
    }

    uncachedBlocks.push(block);
    uncachedIndexes.push(i);
  }

  // All resolved from cache/whitespace
  if (uncachedBlocks.length === 0) {
    return results as ResolveResult[];
  }

  // Single uncached block — use single resolve
  if (uncachedBlocks.length === 1) {
    const result = await resolveConflict(uncachedBlocks[0]);
    results[uncachedIndexes[0]] = result;
    return results as ResolveResult[];
  }

  // Batch resolve uncached blocks
  const prompt = buildBatchPrompt(uncachedBlocks);
  const anthropic = getAnthropicClient();

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: Math.min(4096 * uncachedBlocks.length, 16384),
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = (message.content[0] as { type: 'text'; text: string }).text.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Failed to parse batch Claude response as JSON. Raw response:\n${raw}`
    );
  }

  if (!Array.isArray(parsed) || parsed.length !== uncachedBlocks.length) {
    throw new Error(
      `Expected JSON array of ${uncachedBlocks.length} results, got ${Array.isArray(parsed) ? parsed.length : typeof parsed}. Raw response:\n${raw}`
    );
  }

  for (let j = 0; j < parsed.length; j++) {
    const item = parsed[j] as { resolution: string; explanation: string };
    if (!item.resolution || !item.explanation) {
      throw new Error(
        `Conflict ${uncachedIndexes[j] + 1} response missing resolution or explanation. Got: ${JSON.stringify(item)}`
      );
    }

    // Feature 1: Validate output
    validateResolution(item.resolution, uncachedIndexes[j]);

    const result: ResolveResult = {
      resolution: item.resolution,
      explanation: item.explanation,
    };

    results[uncachedIndexes[j]] = result;

    // Feature 3: Cache store
    if (cache) {
      const block = uncachedBlocks[j];
      const key = cache.computeKey(block.baseContent, block.ours.content, block.theirs.content);
      cache.set(key, result);
    }
  }

  return results as ResolveResult[];
}
