import type { TicketProvider } from './TicketProvider.js';

export class NullProvider implements TicketProvider {
  async fetchTicket(_ticketId: string): Promise<null> {
    return null;
  }
}
