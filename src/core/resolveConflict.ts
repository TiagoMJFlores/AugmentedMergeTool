import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { ConflictBlock, ResolveResult } from './types.js';

function getModel() {
  if (process.env.AI_PROVIDER === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured. Open Settings to add it.');
    }
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openai(process.env.OPENAI_MODEL || 'gpt-4o');
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Anthropic API key not configured. Open Settings to add it.');
  }
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic('claude-opus-4-5');
}

async function callAI(prompt: string, maxTokens: number): Promise<string> {
  const { text } = await generateText({
    model: getModel(),
    maxOutputTokens: maxTokens,
    prompt,
  });
  return text.trim();
}

// --- Output Validation ---

// Match actual Git conflict markers: <<<<<<< and >>>>>>> are always followed
// by a space and branch/ref name.  ======= stands alone on its line.
// This avoids false positives on markdown headings that use =======.
const CONFLICT_MARKER_PATTERN = /^<{7} .+|^>{7} .+|^={7}$/m;

export function validateResolution(resolution: string, index?: number): void {
  if (CONFLICT_MARKER_PATTERN.test(resolution)) {
    const label = index !== undefined ? `Conflict ${index + 1} resolution` : 'Resolution';
    throw new Error(
      `${label} contains leftover conflict markers. This indicates the AI did not fully resolve the conflict.`
    );
  }
}

// --- Whitespace-Only Fast Path ---

export function isWhitespaceOnlyDiff(a: string, b: string): boolean {
  const normalize = (s: string): string =>
    s.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return normalize(a) === normalize(b);
}

// --- Token Windowing ---

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

// --- Base 3-Way Context in Prompts ---

function buildBaseSection(baseContent: string): string {
  if (!baseContent) return '';
  return `
### Base version (common ancestor):
\`\`\`
${baseContent}
\`\`\`
`;
}

function buildPromptFromWindowed(windowed: ConflictBlock): string {
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
- "explanation": a structured summary in exactly this format:
  Ours: [what our side changed, e.g. "renamed completion → onCompletion and added postalCode parameter"]
  Theirs: [what their side changed, e.g. "kept original signature, added guard for nil error"]
  Resolution: [what you chose and why, e.g. "kept theirs' naming + ours' postal code addition"]
  Missing: [ONLY if the AI lacks context to be fully confident — e.g. "business rules for balance threshold (>5 vs >0) not documented" or "no ticket context — unclear if changes were coordinated". Omit this line entirely if no concerns.]
  Keep each line concise (under 100 chars). This will be rendered directly in the UI.

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

export function buildPrompt(block: ConflictBlock): string {
  return buildPromptFromWindowed(applyWindowing(block));
}

/**
 * Check if a conflict can be resolved trivially without calling the LLM.
 * Returns a ResolveResult if trivial, or null if the LLM is needed.
 */
export function tryTrivialResolve(block: ConflictBlock): ResolveResult | null {
  const ours = block.ours.content;
  const theirs = block.theirs.content;

  // Identical sides — no real conflict
  if (ours === theirs) {
    return { resolution: ours, explanation: 'Both sides are identical — no conflict.' };
  }

  // One side is empty — keep the side that has content
  if (ours.trim() === '' && theirs.trim() !== '') {
    return { resolution: theirs, explanation: 'Our side is empty — kept theirs.' };
  }
  if (theirs.trim() === '' && ours.trim() !== '') {
    return { resolution: ours, explanation: 'Their side is empty — kept ours.' };
  }
  if (ours.trim() === '' && theirs.trim() === '') {
    return { resolution: '', explanation: 'Both sides are empty.' };
  }

  // Trailing newline difference only
  if (ours.replace(/\n+$/, '') === theirs.replace(/\n+$/, '')) {
    return { resolution: ours, explanation: 'Trailing newline difference only — kept ours version.' };
  }

  // Whitespace-only difference (indentation, spaces, blank lines)
  if (isWhitespaceOnlyDiff(ours, theirs)) {
    return { resolution: ours, explanation: 'Whitespace-only difference — kept ours version.' };
  }

  return null;
}

export async function resolveConflict(
  block: ConflictBlock
): Promise<ResolveResult> {
  const trivial = tryTrivialResolve(block);
  if (trivial) return trivial;

  const prompt = buildPrompt(block);
  const raw = await callAI(prompt, 4096);

  let result: ResolveResult;
  try {
    const parsed = JSON.parse(raw);
    result = {
      resolution: parsed.resolution,
      explanation: parsed.explanation,
    };
  } catch {
    throw new Error(
      `Failed to parse AI response as JSON. Raw response:\n${raw}`
    );
  }

  validateResolution(result.resolution);

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
- "explanation": a structured summary with line breaks: "Ours: [what changed]\nTheirs: [what changed]\nResolution: [what you chose and why]\nMissing: [ONLY if lacking context, omit if none]". Keep each part concise.

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

  const results: (ResolveResult | null)[] = new Array(blocks.length).fill(null);
  const uncachedBlocks: ConflictBlock[] = [];
  const uncachedIndexes: number[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const trivial = tryTrivialResolve(blocks[i]);
    if (trivial) {
      results[i] = trivial;
      continue;
    }

    uncachedBlocks.push(blocks[i]);
    uncachedIndexes.push(i);
  }

  if (uncachedBlocks.length === 0) {
    return results as ResolveResult[];
  }

  if (uncachedBlocks.length === 1) {
    results[uncachedIndexes[0]] = await resolveConflict(uncachedBlocks[0]);
    return results as ResolveResult[];
  }

  const prompt = buildBatchPrompt(uncachedBlocks);
  const raw = await callAI(prompt, Math.min(4096 * uncachedBlocks.length, 16384));

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

    validateResolution(item.resolution, uncachedIndexes[j]);

    results[uncachedIndexes[j]] = {
      resolution: item.resolution,
      explanation: item.explanation,
    };
  }

  return results as ResolveResult[];
}
