# AugmentedMergeTool

### AI-powered merge conflict resolver with **full ticket context**

Resolve merge conflicts with intent, not guesswork.

<img width="1380" height="801" alt="image" src="https://github.com/user-attachments/assets/ab7a63ef-1908-47c7-ae43-1c857e9922b5" />


------------------------------------------------------------------------

## How it works

For each conflict, AugmentedMergeTool:

1. Detects conflicting lines
2. Reads git history for those exact lines
3. Extracts ticket/card IDs from commit messages
4. Fetches ticket context from your provider (Linear, Jira, GitHub)
5. AI explains intent and suggests a resolution
6. You review, edit, or pick a side

------------------------------------------------------------------------

## Install

```bash
git clone https://github.com/TiagoMJFlores/AugmentedMergeTool.git
cd AugmentedMergeTool
npm install
npm run setup
```

`npm run setup` builds the project and registers it as your default git merge tool. After setup, `mergeagent` is available globally.

------------------------------------------------------------------------

## Usage

### From terminal

```bash
# Open all conflicted files in current repo
mergeagent

# Open all conflicted files in a specific repo
mergeagent "/path/to/repo"

# Open from a specific file (detects repo and shows all conflicts)
mergeagent "/path/to/conflicted/file.swift"
```

### From SourceTree

1. Go to **Settings > Diff > Merge Tool > Custom**
2. **Merge Command:** `mergeagent`
3. **Arguments:** `$MERGED`
4. Click a conflicted file > **Launch External Merge Tool**

### From GitKraken

1. Go to **Preferences > General > Merge Tool > Custom**
2. **Merge Command:** `mergeagent`
3. **Arguments:** `$MERGED`
4. Right-click a conflicted file > **Launch Merge Tool**

### From any git client

After `npm run setup`, run `git mergetool` in any repo with conflicts:

```bash
git merge feature-branch
# conflicts appear
git mergetool
# mergeagent opens with all conflicted files
```

------------------------------------------------------------------------

## Configuration

Click the **gear icon** in the top-right corner of the app to configure:

- **AI Provider** — Anthropic (Claude) or OpenAI (GPT)
- **API Key** — for the selected provider
- **Ticket Provider** (optional) — Linear, Jira, or GitHub for ticket context

Config is saved to `~/.mergeagent/config.json` and persists between runs.

Without an API key, the tool still works for manual conflict resolution (Choose left/right/both). AI features require a key.

------------------------------------------------------------------------

## Requirements

- Node.js >= 18
- Git
- Anthropic or OpenAI API key (for AI features)

### Optional

- Ticket provider API key (Linear, Jira, or GitHub)
- Include ticket IDs in commit messages for full context:

```bash
git commit -m "LIN-42: add caching layer"
git commit -m "PROJ-23: migrate to async/await"
```

------------------------------------------------------------------------

## Supported Providers

| Provider | Status |
|----------|--------|
| Linear | Supported |
| Jira | Supported |
| GitHub Issues | Supported |

------------------------------------------------------------------------

## License

MIT
