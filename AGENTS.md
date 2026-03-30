# AGENTS.md

## Cursor Cloud specific instructions

This is a greenfield Node.js repository called **AugmentedMergeTool**. As of initial setup, the repo contains only a `README.md` and a `.gitignore` (Node.js template). There is no application code, `package.json`, or dependency lockfile yet.

### Environment

- **Node.js**: v22 (managed via nvm)
- **Available package managers**: npm, pnpm, yarn (prefer pnpm or npm once a lockfile is established)
- The `.gitignore` covers patterns for Next.js, Nuxt, Vite, SvelteKit, Gatsby, and others — the framework choice is not yet determined.

### Development

- No build, lint, test, or dev server commands exist yet. Once a `package.json` is added, follow its `scripts` section.
- No databases or external services are required at this time.
- No Docker/docker-compose configuration exists.

### Notes for future agents

- When a `package.json` and lockfile are committed, install dependencies using the matching package manager (`package-lock.json` → `npm install`, `pnpm-lock.yaml` → `pnpm install`, `yarn.lock` → `yarn install`).
- Check for new scripts in `package.json` before assuming how to build/test/lint.
