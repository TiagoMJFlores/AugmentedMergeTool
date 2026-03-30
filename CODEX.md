# CODEX.md

## Codex Quick Context

This project is a TypeScript CLI merge-conflict assistant. It enriches conflicts with ticket context and asks Claude for suggested resolutions.

### High-signal files

- Entrypoint: `src/index.ts`
- Conflict extraction: `src/core/buildConflictBlocks.ts`
- Ticket providers: `src/core/providers/`
- AI conflict resolver: `src/core/resolveConflict.ts`
- CLI I/O: `src/adapters/cli/`
- Tests: `src/core/**/*.test.ts`

### Current provider model

- Interface: `TicketProvider.fetchTicket(ticketId)`
- Implementations:
  - `LinearProvider`
  - `JiraProvider`
  - `GitHubIssuesProvider`
  - `NullProvider`
- Factory: `createProvider({ provider })`
- Selection order: `--provider` CLI flag > `TICKET_PROVIDER` env > `none`

### Environment vars

Check `.env.example` for canonical list. Required vars depend on selected provider.

### Implementation expectations

- Keep `buildConflictBlocks.ts` provider-agnostic.
- New provider integrations should live under `src/core/providers/`.
- Prefer small, testable pure functions.
- Run:
  - `npm run build`
  - `npm test`

