import Anthropic from '@anthropic-ai/sdk';

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

export async function summariseIntent(ticket: {
  id: string;
  title: string;
  description: string;
}): Promise<string> {
  const anthropic = getAnthropicClient();
  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `Summarise the intent of this Linear ticket in 2-3 sentences.
Focus on WHAT change was made and WHY — not implementation details.
Be concise: this summary will be used to resolve a Git merge conflict.

Ticket: ${ticket.id} — ${ticket.title}

${ticket.description}`,
      },
    ],
  });
  return (msg.content[0] as { type: 'text'; text: string }).text;
}
