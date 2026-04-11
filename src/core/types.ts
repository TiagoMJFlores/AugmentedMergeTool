export interface TicketContext {
  ticketId: string;
  intentSummary: string;
}

export interface ConflictSide {
  content: string;
  ticket: TicketContext | null;
  latestCommitDate: string | null;
}

export interface ConflictBlock {
  ours: ConflictSide;
  theirs: ConflictSide;
  range: { start: number; end: number };
  surroundingContext: string;
  baseContent: string;
}

export interface ResolveResult {
  resolution: string;
  explanation: string;
}

export type ConflictAction = 'applied' | 'skipped';

export interface ConflictSummaryEntry {
  label: string;
  action: ConflictAction;
}
