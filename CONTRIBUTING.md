# Contributing

## How it works

- `src/mcp.ts` — the `cast` MCP server. It exposes `cast_*` tools and all Playwright browser tools (`browser_click`, `browser_snapshot`, …) with an extra required `profile` parameter.
- `src/chrome.ts` — starts a regular Google Chrome on a profile, restoring the last session, optionally with a DevTools port.
- `src/gateway.ts` — for each open profile, starts Chrome with a DevTools port and attaches a [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp) child to it (`--cdp-endpoint`); routes each `browser_*` call to it.
- `src/login-window.ts` — the `/cast:add` and `/cast:login` window: the same Chrome without a DevTools port, because a port makes SSO bot checks refuse the login. Waits for the window to close and reads visited hosts from the profile's History.
- `src/registry.ts`, `src/paths.ts` — profile lists in the three scopes and file locations.
- `src/cli.ts` — `list --brief`, printed by the `SessionStart` hook (`hooks/hooks.json`) so Claude knows the profiles.
- `skills/` — the `/cast:*` commands and the `cast` skill that tells Claude how to work with profiles.

[PLAN.md](PLAN.md) records design decisions and Chrome / Playwright MCP quirks found along the way.

## Develop

```bash
git clone https://github.com/bodpad/cast && cd cast
npm install
npm test                          # build + unit + integration tests (real Chrome, headless)
CAST_TEST_HEADED=1 npm test       # the same with visible windows
claude --plugin-dir .             # run Claude Code with your working copy
claude plugin validate --strict . # check the manifests
```

- Tests use `node:test`. Integration tests start a small local site and a real Chrome.
- `CAST_CONFIG_DIR`, `CAST_DATA_DIR` and `CAST_PROJECT_DIR` redirect all cast files.

## Rules

- Everything in the repository is in English.
- `dist/src` is committed so the plugin needs no build step after install: run `npm run build` and commit `dist/` with source changes.
- Releases: bump the version in `package.json` and `.claude-plugin/plugin.json`, add a `CHANGELOG.md` entry. Users get updates only when the version changes.
