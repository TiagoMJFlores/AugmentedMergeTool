import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import type { ConflictBlock, ResolveResult } from './types.js';

let _anthropic: Anthropic | null = null;

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

export function buildPrompt(block: ConflictBlock): string {
  const oursTicket = block.ours.ticket
    ? `Ticket ${block.ours.ticket.ticketId}: ${block.ours.ticket.intentSummary}`
    : 'No ticket associated.';

  const theirsTicket = block.theirs.ticket
    ? `Ticket ${block.theirs.ticket.ticketId}: ${block.theirs.ticket.intentSummary}`
    : 'No ticket associated.';

  return `You are an expert software engineer resolving a Git merge conflict.

Return ONLY a JSON object with exactly two fields:
- "resolution": the resolved code with no conflict markers, no explanation, no markdown
- "explanation": 2-3 sentences in plain English explaining what each side was trying to do and why your resolution makes sense. This will be rendered directly in the CLI output.

${block.ours.ticket || block.theirs.ticket ? `## Why each side made this change

### Our side (HEAD):
${oursTicket}

### Their side (incoming):
${theirsTicket}

Use these intents as the primary signal for your decision.
` : '## No ticket context available — resolve based on the code alone.\n'}
---

## Conflict to resolve

### Our version (HEAD):
\`\`\`
${block.ours.content}
\`\`\`

### Their version (incoming):
\`\`\`
${block.theirs.content}
\`\`\`

### Surrounding context:
\`\`\`
${block.surroundingContext}
\`\`\`

---

Respond with ONLY the JSON object. No markdown, no code fences, no preamble.`;
}

export async function resolveConflict(
  block: ConflictBlock
): Promise<ResolveResult> {
  const prompt = buildPrompt(block);
  const anthropic = getAnthropicClient();

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = (message.content[0] as { type: 'text'; text: string }).text.trim();

  try {
    const parsed = JSON.parse(raw);
    return {
      resolution: parsed.resolution,
      explanation: parsed.explanation,
    };
  } catch {
    throw new Error(
      `Failed to parse Claude response as JSON. Raw response:\n${raw}`
    );
  }
}

export function buildBatchPrompt(blocks: ConflictBlock[]): string {
  const conflictSections = blocks.map((block, index) => {
    const oursTicket = block.ours.ticket
      ? `Ticket ${block.ours.ticket.ticketId}: ${block.ours.ticket.intentSummary}`
      : 'No ticket associated.';

    const theirsTicket = block.theirs.ticket
      ? `Ticket ${block.theirs.ticket.ticketId}: ${block.theirs.ticket.intentSummary}`
      : 'No ticket associated.';

    const ticketSection = block.ours.ticket || block.theirs.ticket
      ? `#### Our side intent:\n${oursTicket}\n\n#### Their side intent:\n${theirsTicket}`
      : 'No ticket context available — resolve based on the code alone.';

    return `## Conflict ${index + 1} of ${blocks.length}

${ticketSection}

### Our version (HEAD):
\`\`\`
${block.ours.content}
\`\`\`

### Their version (incoming):
\`\`\`
${block.theirs.content}
\`\`\`

### Surrounding context:
\`\`\`
${block.surroundingContext}
\`\`\``;
  });

  return `You are an expert software engineer resolving Git merge conflicts.

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

  const prompt = buildBatchPrompt(blocks);
  const anthropic = getAnthropicClient();

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: Math.min(4096 * blocks.length, 16384),
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

  if (!Array.isArray(parsed) || parsed.length !== blocks.length) {
    throw new Error(
      `Expected JSON array of ${blocks.length} results, got ${Array.isArray(parsed) ? parsed.length : typeof parsed}. Raw response:\n${raw}`
    );
  }

  return parsed.map((item: { resolution: string; explanation: string }, index: number) => {
    if (!item.resolution || !item.explanation) {
      throw new Error(
        `Conflict ${index + 1} response missing resolution or explanation. Got: ${JSON.stringify(item)}`
      );
    }
    return {
      resolution: item.resolution,
      explanation: item.explanation,
    };
  });
}
