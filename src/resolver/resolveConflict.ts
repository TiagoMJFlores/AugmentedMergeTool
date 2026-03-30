import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ConflictBlock,
  TicketContext,
} from '../context/buildConflictBlocks';

export interface ResolveResult {
  resolution: string;
  explanation: string;
}

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
