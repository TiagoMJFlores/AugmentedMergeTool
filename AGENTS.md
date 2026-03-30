# AGENTS.md

## Project Overview

**AugmentedMergeTool** is a Node.js + TypeScript CLI that helps resolve Git merge conflicts by:
1. Parsing conflict blocks from conflicted files.
2. Looking up ticket context based on commit messages.
3. Generating AI-assisted resolution suggestions.
4. Letting users choose whether to apply each suggested resolution.

This repository now contains active application code (not greenfield anymore).

## Runtime & Tooling

- Node.js: v22
- TypeScript target: ES2022
- Module system: Node16 ESM-style imports (`.js` in TS import specifiers)
- Package manager in use: **npm** (`package-lock.json` present)
- Test runner: **Vitest**

Useful commands:

```bash
npm run build
npm test
npm run test:watch
npm run start
```

## Current Architecture

- `src/index.ts`
  - CLI entrypoint
  - Finds conflicted files
  - Selects ticket provider (`--provider` > `TICKET_PROVIDER` > `none`)
  - Orchestrates prompting, AI resolution, and file updates

- `src/core/buildConflictBlocks.ts`
  - Parses conflict markers
  - Finds likely ticket IDs from nearby commit history
  - Asks a `TicketProvider` for ticket context (provider injection)

- `src/core/providers/*`
  - Provider abstraction for PM/ticket systems
  - `LinearProvider`, `JiraProvider`, `GitHubIssuesProvider`, `NullProvider`
  - `createProvider` factory and provider normalization

- `src/core/resolveConflict.ts`
  - Uses Anthropic to produce conflict resolution/explanation

- `src/adapters/cli/*`
  - Terminal output and user prompt handling

## Provider Configuration

Provider precedence:
1. CLI flag `--provider=<linear|jira|github|none>` (or `--provider value`)
2. `.env` variable `TICKET_PROVIDER`
3. Default: `none`

When provider requires credentials, missing env vars should throw clear errors.

Expected env vars (see `.env.example`):
- Common: `ANTHROPIC_API_KEY`
- Linear: `LINEAR_API_KEY`
- Jira: `JIRA_API_KEY`, `JIRA_BASE_URL`
- GitHub Issues: `GITHUB_TOKEN`, `GITHUB_REPO`

## Conventions

- Keep domain logic in `src/core/*`, I/O adapters in `src/adapters/*`.
- Prefer dependency injection for external systems.
- Preserve strict TypeScript typing.
- Add or update Vitest tests when changing behavior.
- Keep functions focused and side effects explicit.

## Guidance for Future Agents

- Before modifying provider behavior, inspect `src/core/providers/index.ts` and `src/core/buildConflictBlocks.ts` together.
- If adding another provider, implement `TicketProvider`, add env checks in factory, and update `.env.example`.
- If modifying summarization prompts, ensure tone remains concise and conflict-resolution-focused.
- Use `npm test` and `npm run build` before finalizing.
