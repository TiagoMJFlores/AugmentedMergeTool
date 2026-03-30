import type { TicketContext } from '../types.js';
import type { TicketProvider } from './TicketProvider.js';
import { summariseTicketIntent } from './summariseTicketIntent.js';

interface GitHubIssueResponse {
  number: number;
  title?: string;
  body?: string | null;
}

function parseIssueNumber(ticketId: string): number | null {
  const exact = /^\d+$/.exec(ticketId);
  if (exact) return Number(exact[0]);

  const genericKey = /^[A-Z]+-(\d+)$/i.exec(ticketId);
  if (genericKey) return Number(genericKey[1]);

  return null;
}

export class GitHubIssuesProvider implements TicketProvider {
  constructor(
    private readonly token: string,
    private readonly repo: string
  ) {}

  async fetchTicket(ticketId: string): Promise<TicketContext | null> {
    try {
      const issueNumber = parseIssueNumber(ticketId);
      if (!issueNumber) return null;

      const response = await fetch(
        `https://api.github.com/repos/${this.repo}/issues/${issueNumber}`,
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const issue = (await response.json()) as GitHubIssueResponse;
      const issueId = String(issue.number ?? issueNumber);
      const title = issue.title ?? `Issue #${issueId}`;
      const description = issue.body ?? '';

      const intentSummary = await summariseTicketIntent({
        provider: 'github',
        id: issueId,
        title,
        description,
      });

      return {
        ticketId: issueId,
        intentSummary,
      };
    } catch {
      return null;
    }
  }
}
