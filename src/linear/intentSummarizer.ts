import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

function getModel() {
  if (process.env.AI_PROVIDER === 'openai') {
    if (!process.env.OPENAI_API_KEY) return null;
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openai(process.env.OPENAI_MODEL || 'gpt-4o');
  }
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic('claude-opus-4-5');
}

export async function summariseIntent(ticket: {
  id: string;
  title: string;
  description: string;
}): Promise<string> {
  const model = getModel();
  if (!model) return `${ticket.title}`;

  const { text } = await generateText({
    model,
    maxOutputTokens: 256,
    prompt: `Summarise the intent of this Linear ticket in 2-3 sentences.
Focus on WHAT change was made and WHY — not implementation details.
Be concise: this summary will be used to resolve a Git merge conflict.

Ticket: ${ticket.id} — ${ticket.title}

${ticket.description}`,
  });

  return text;
}
