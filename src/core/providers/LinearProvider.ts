import { LinearClient } from '@linear/sdk';
import type { TicketContext } from '../types.js';
import type { TicketProvider } from './TicketProvider.js';
import { summariseTicketIntent } from './summariseTicketIntent.js';

export class LinearProvider implements TicketProvider {
  private readonly client: LinearClient;

  constructor(apiKey: string) {
    this.client = new LinearClient({ apiKey });
  }

  async fetchTicket(ticketId: string): Promise<TicketContext | null> {
    try {
      const issue = await this.client.issue(ticketId);
      const intentSummary = await summariseTicketIntent({
        provider: 'linear',
        id: issue.identifier,
        title: issue.title,
        description: issue.description ?? '',
      });

      return {
        ticketId: issue.identifier,
        intentSummary,
      };
    } catch {
      return null;
    }
  }
}
