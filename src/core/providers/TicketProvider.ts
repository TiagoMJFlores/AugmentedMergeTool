import type { TicketContext } from '../types.js';

export interface TicketProvider {
  /**
   * Given a ticket ID extracted from a commit message (e.g. "NOV-28", "PROJ-123"),
   * returns the ticket context or null if not found / not applicable.
   */
  fetchTicket(ticketId: string): Promise<TicketContext | null>;
}
