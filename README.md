# AugmentedMergeTool

### AI-powered merge conflict resolver with **full ticket context**



🚀 **Resolve merge conflicts with intent, not guesswork**
:::

------------------------------------------------------------------------

## ⚡ Why this exists

Merge conflicts aren't just annoying --- they're ambiguous.

By the time you're resolving them, you've lost:
- ❌ the context
- ❌ the intent
- ❌ the reason behind each change

------------------------------------------------------------------------

## Augmented AI (not automation)

Most tools try to automatically fix conflicts.

This tool augments the developer instead: 
- brings ticket context
- explains intent
- suggests resolutions
- keeps you in control

------------------------------------------------------------------------

## Human ↔ AI collaboration

> The developer defines intent.
> The AI handles complexity.

------------------------------------------------------------------------

## 🔎 How it works

For each conflict block, AugmentedMergeTool:

1. detects the conflicting lines
2. reads the git history for those exact lines
3. identifies the commits that introduced each side of the conflict
4. extracts the ticket/card ID from the commit message
5. fetches the ticket context from your configured provider
6. asks AI to explain the intent and suggest a resolution

This means the tool is not guessing from current code alone — it uses the line-level Git history plus the referenced ticket/card to understand **why** each side changed.

## Demo

    $ npx mergeagent

    📄 src/api/UserService.ts  [1/3]

    ⚡ Conflict block — lines 42–58

    LEFT  (HEAD)   · PROJ-21: Add caching layer
    RIGHT (theirs) · PROJ-23: Migrate to async/await

    ── AI explanation ───────────────────
    PROJ-21 added caching; PROJ-23 migrated to async.
    Final solution preserves async behavior and caching.

    ── Suggested resolution ─────────────
    async getUserById(id: string): Promise<User> {
      return this.cache.get(id) ?? await this.db.find(id);
    }

    [U] Use suggestion   [S] Skip

------------------------------------------------------------------------

## ⚡ Quick Start

``` bash
npx mergeagent
```

------------------------------------------------------------------------

## 🛠 Requirements

-   Node.js ≥ 18
-   Git
-   Anthropic API key


### Optional (recommended)

- API key for your ticket provider (Linear, Jira, or GitHub)
- include ticket ID in commits (Optional)

To get full context, your commits must include the ticket/card ID. The tool extracts the ticket ID directly from commit messages.

Example:

```bash
git commit -m "#21: add caching layer"
git commit -m "#23: migrate service to async/await"
```
------------------------------------------------------------------------

## Works with existing projects
No need to rewrite your Git history.
From now on, just add the ticket ID to your commits.
The tool will use ticket context where it exists, and fall back to code + git history for older commits.

------------------------------------------------------------------------

## ⚙️ Environment Setup

``` env
ANTHROPIC_API_KEY=your_key_here

# Optional providers
TICKET_PROVIDER=linear
LINEAR_API_KEY=lin_api_...

TICKET_PROVIDER=jira
JIRA_API_KEY=...
JIRA_BASE_URL=https://your-org.atlassian.net

TICKET_PROVIDER=github
GITHUB_TOKEN=ghp_...
GITHUB_REPO=owner/repo
```

👉 No tickets:

``` env
TICKET_PROVIDER=none
```

------------------------------------------------------------------------

## 🧪 Usage

``` bash
npx mergeagent
npx mergeagent --provider=linear
npx mergeagent --provider=jira
npx mergeagent --provider=github
npx mergeagent --provider=none
```

### Electron GUI merge tool (MVP)

This repo now includes an Electron-based GUI adapter that reuses the same `src/core/*` merge engine.

Build first:

```bash
npm run build
```

Launch GUI with Git mergetool-style positional args:

```bash
node dist/adapters/gui/main.js \"$LOCAL\" \"$BASE\" \"$REMOTE\" \"$MERGED\"
```

For quick local testing, you can also pass only the conflicted `MERGED` file:

```bash
node dist/adapters/gui/main.js \"/path/to/MERGED\"
```

The GUI provides:
- LOCAL panel
- REMOTE panel
- editable AI RESULT editor
- actions: Apply, Skip, Use LOCAL, Use REMOTE
- conflict navigation + progress
- final write to `MERGED` when finished


------------------------------------------------------------------------

## 🔌 Supported Providers

  Provider           Status
  ------------------ --------
  🔵 Linear          ✅
  
  🟠 Jira            ✅
  
  ⚫ GitHub Issues   ✅
  

------------------------------------------------------------------------

## 🗺 Roadmap

-   [ ] VS Code extension
-   [ ] More providers


------------------------------------------------------------------------

## ⭐ If this helped you

Give it a star 🙌

------------------------------------------------------------------------

## 📄 License

MIT
