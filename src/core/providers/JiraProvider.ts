import type { TicketContext } from '../types.js';
import type { TicketProvider } from './TicketProvider.js';
import { summariseTicketIntent } from './summariseTicketIntent.js';

interface JiraIssueResponse {
  key: string;
  fields?: {
    summary?: string;
    description?: unknown;
  };
}

function toTextDescription(description: unknown): string {
  if (!description) return '';
  if (typeof description === 'string') return description;

  if (typeof description === 'object') {
    return JSON.stringify(description);
  }

  return String(description);
}

export class JiraProvider implements TicketProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string
  ) {}

  async fetchTicket(ticketId: string): Promise<TicketContext | null> {
    try {
      const response = await fetch(
        `${this.baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(ticketId)}`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const issue = (await response.json()) as JiraIssueResponse;
      const issueKey = issue.key ?? ticketId;
      const title = issue.fields?.summary ?? issueKey;
      const description = toTextDescription(issue.fields?.description);

      const intentSummary = await summariseTicketIntent({
        provider: 'jira',
        id: issueKey,
        title,
        description,
      });

      return {
        ticketId: issueKey,
        intentSummary,
      };
    } catch {
      return null;
    }
  }
}
