# AugmentedMergeTool

### AI-powered merge conflict resolver with **full ticket context**



🚀 **Resolve merge conflicts with intent, not guesswork**
:::

------------------------------------------------------------------------

## ⚡ Why this exists

Merge conflicts aren't just annoying --- they're ambiguous.

By the time you're resolving them, you've lost:
- ❌ the context\
- ❌ the intent\
- ❌ the reason behind each change

------------------------------------------------------------------------

## Augmented AI (not automation)

Most tools try to automatically fix conflicts.

This tool augments the developer instead: 
- brings ticket context\
- explains intent\
- suggests resolutions\
- keeps you in control

------------------------------------------------------------------------

## Human ↔ AI collaboration

> The developer defines intent.\
> The AI handles complexity.

------------------------------------------------------------------------

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
    >

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
