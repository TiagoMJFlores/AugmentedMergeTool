# CLAUDE.md

## Claude Agent Context

AugmentedMergeTool resolves merge conflicts with AI and optional ticket context.

### Core flow

1. Detect conflicted files (`git status`).
2. Parse conflict markers into blocks.
3. Use git history to infer ticket IDs from commit messages.
4. Fetch ticket context through a provider abstraction.
5. Generate a proposed resolution via Anthropic.
6. Ask user whether to apply each resolution.

### Provider abstraction

Providers are under `src/core/providers/` and implement `TicketProvider`.

Configured providers:
- `linear`
- `jira`
- `github`
- `none`

Selection priority:
1. CLI `--provider`
2. `.env` `TICKET_PROVIDER`
3. `none`

### Important constraints

- Keep core conflict logic independent from provider-specific SDK/API code.
- Ensure clear errors when provider is configured without required env vars.
- Maintain concise ticket intent summaries for merge-context usage.

### Validation checklist

- Type-check/build passes (`npm run build`)
- Tests pass (`npm test`)
- `.env.example` updated when env surface changes
- New behavior covered by at least one test where practical
