# Privacy

cast is a Claude Code plugin that runs only on your computer. It has no server, no account and no telemetry, and it sends nothing anywhere by itself.

## What cast stores, and where

- **Profile lists** in `~/.config/cast/` (and `.claude/cast.yaml` for team slots): a name, an optional email, a description and the sites you confirmed. Team slots in `.claude/cast.yaml` hold only names and descriptions.
- **Chrome profiles** in `~/.local/share/cast/`, readable only by your user: everything Chrome keeps for a browser you log in to, such as cookies, history and open tabs. Chrome writes them, not cast.
- **Playwright output** (page snapshots, screenshots) in `~/.local/share/cast/output/`, for Claude to read.

Everything stays until you delete it: `/cast:remove <name>` deletes a profile, and [Uninstall](README.md#uninstall) shows how to delete all of it.

## What cast reads

- After a login window closes, cast reads that profile's own Chrome history for the visits made while it was open: hosts, the path and title of the last page on each site, no query strings. It never reads your personal Chrome profile.
- Nothing else: cast does not read cookies, passwords, Claude's memory, chat history or your files.

## What reaches Claude

Claude works in the browsers through your Claude Code session, so what Claude reads there (page snapshots, screenshots, the profile list and the sites read from history) is sent to the model like any other tool result, under the terms of your Claude plan. Pages can include email and chat; prefer test accounts. cast never sends passwords, cookies or tokens to Claude.

## Network

cast itself makes no network requests. Chrome loads the sites you and Claude open, and talks to Google as any Chrome does. Claude Code installs cast's npm dependencies (listed in `package-lock.json`) when you install the plugin.

## Contact

Questions: [GitHub Discussions](https://github.com/bodpad/cast/discussions). Security issues: see [SECURITY.md](SECURITY.md).
