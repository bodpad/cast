# cast

**Several logged-in browser users for [Claude Code](https://claude.com/claude-code).**

A Claude Code plugin for **multi-user browser testing**: one persistent Chrome profile per person, several logged-in sessions open at once, driven by Claude through [Playwright MCP](https://github.com/microsoft/playwright-mcp). Works with corporate SSO (Microsoft Entra, Okta, Google) because you log in yourself in a regular Chrome.

You are building an app where people interact: a chat, a marketplace, an approval flow. To test it, you need a browser per person, each logged in to that person's accounts. cast gives Claude exactly that: one persistent Chrome profile per person. You log in once, and Claude opens those browsers itself, several at a time, and works in them.

```
You:    /cast:add Sam
        (Chrome opens, you log in as Sam, close the window)
You:    /cast:add Elon
        (same for Elon)
You:    Send "hi" from Sam to Elon in the chat and check that Elon gets it.
Claude: opens Sam's and Elon's windows (already logged in), sends as Sam, checks as Elon.
```

---

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Asking Claude to use profiles](#asking-claude-to-use-profiles)
- [Sharing profiles with your team](#sharing-profiles-with-your-team)
- [How cast compares](#how-cast-compares)
- [Where cast keeps data](#where-cast-keeps-data)
- [Privacy and safety](#privacy-and-safety)
- [Troubleshooting](#troubleshooting)
- [Update and uninstall](#update-and-uninstall)
- [Contributing](#contributing)

## Requirements

- **Linux** with a desktop session (windows are always visible). macOS and Windows are planned.
- **Google Chrome** installed as `google-chrome` (the regular Chrome, not Chromium).
- **Node.js 20** or newer.
- **Claude Code** with plugin support.

## Install

In Claude Code:

```
/plugin marketplace add bodpad/cast
/plugin install cast@bodpad
```

The first command registers the `bodpad` marketplace (this GitHub repository). The second installs the `cast` plugin from it. Claude Code installs the npm dependencies itself. Restart Claude Code or run `/reload-plugins`.

Check that it works:

```
/cast:list
```

It should say there are no profiles yet.

## Quick start

**1. Create a profile for each person.**

```
/cast:add Sam sam@example.com "sends messages"
```

Email and description are optional; they help Claude pick the right person ("the sender"). If you leave them out, Claude asks once and you can skip.

**2. Log in.** A clean Chrome window opens with a short instruction page. It is a regular Chrome that nothing controls, so corporate SSO with bot protection (Okta, GoDaddy, Entra…) works as usual.

- Open new tabs and log in everywhere Sam needs: your app, SSO (Microsoft, Google…), email, chat.
- On MFA prompts choose **"Stay signed in"**, otherwise the session expires quickly.
- **Close the window** when you are done. That is the signal for cast. Keep the Claude Code session open until then.

**3. Confirm the sites.** cast suggests the sites where you landed (e.g. `localhost:3000`, `teams.microsoft.com`) and lists sign-in pages and redirects (`login.microsoftonline.com`, `sso.…`) separately, without suggesting them. Claude uses the saved list to know where each person works.

**4. Repeat for everyone else** (`/cast:add Elon …`).

**5. Ask Claude to do something.** From now on, every Claude Code session in this project starts knowing the profiles:

```
cast: browser users available (open with cast_open / browser_* tools with profile=<name>):
- Elon (local) elon@example.com — receives messages. Sites: localhost:3000
- Sam (local) sam@example.com — sends messages. Sites: localhost:3000, outlook.office.com
```

## Commands

| Command | What it does |
|---|---|
| `/cast:add <name> [email] ["description"] [--scope local\|project\|user]` | Create a profile and log in to it in a fresh Chrome. |
| `/cast:login <name>` | Open an existing profile to log in again (expired session) or add sites. Known sites open in tabs. |
| `/cast:list` | Show profiles: scope, email, description, sites, whether each is open now. |
| `/cast:remove <name>` | Delete a profile and its Chrome data (all its logins). Asks for confirmation. |

Profile names: letters, digits, `-` and `_`, up to 40 characters. Case does not matter (`sam` = `Sam`).

## Asking Claude to use profiles

Talk about people, not browsers. Claude picks profiles by name or description and opens them without asking.

- *"Check Sam's inbox for the invitation email and open the link."*
- *"Sam creates an order, Elon (the admin) approves it; check that Sam sees the status change."*
- *"Open the app as the sender and as the receiver side by side and test typing indicators."*

What to expect:

- **Windows are visible** and are regular Chrome windows: you can watch, take over (for example, solve a captcha) or close them; Claude reopens a window when it needs it again.
- **Profiles stay logged in and keep their tabs** between sessions, like your own Chrome.
- **Claude never logs in.** If a site shows a login page instead of the app, Claude stops and asks you to run `/cast:login <name>`.
- **Dialogs** (`alert`, `confirm`, `prompt`) are handled by Claude.
- Claude closes the windows when the task is done. Your logins remain.

## Sharing profiles with your team

A profile holds *your* logins, so it is never shared. What can be shared is a **slot**: a profile name plus description, committed to the repository.

```
/cast:add sender --scope project
```

This writes `.claude/cast.yaml` (name and description only, no emails, no cookies):

```yaml
version: 1
profiles:
  sender:
    description: sends messages
```

Commit it. A teammate who pulls the repository sees `sender` in Claude's list marked *not set up on this machine*; Claude asks them to run `/cast:add sender`, and they log in with their own test account.

### Scopes

| Scope | Who sees the profile | Use it for |
|---|---|---|
| `local` (default) | you, in this project only | most cases |
| `project` | slot in the repository; each developer logs in with their own account | shared test scenarios |
| `user` | you, in all your projects | a personal account you use everywhere, e.g. your work mailbox |

If the same name exists in several scopes, **local wins over project, project over user**.

## How cast compares

| | cast | Playwright MCP alone | Auth-state plugins (`storageState`) | playwright-cli sessions |
|---|---|---|---|---|
| Several users logged in **at the same time** | yes, one window per person | one browser per server | one browser, roles switched | yes, by session name |
| Full Chrome profile (IndexedDB, service workers, "trusted device" for MFA) | yes | yes, one profile | cookies and localStorage only | yes, with `--persistent` |
| Corporate SSO with bot checks at login | yes: you log in in a plain, non-automated Chrome | may be blocked (automated browser) | varies by plugin | may be blocked (automated browser) |
| Claude knows who is who (name, email, role, sites) at session start | yes | no | per role name | no |
| Claude never logs in; asks you when a session expires | yes | — | — | — |
| Team slots committed to the repo, credentials stay personal | yes | no | no | no |

Use plain Playwright MCP for single-user browsing. Use cast when a test involves several people, or accounts behind SSO.

## Where cast keeps data

| What | Where |
|---|---|
| Your profile list for a project | `~/.config/cast/projects/<project-id>.yaml` |
| Your profile list for all projects | `~/.config/cast/profiles.yaml` |
| Team slots | `.claude/cast.yaml` in the repository |
| Chrome data (cookies, logins), mode `0700` | `~/.local/share/cast/projects/<project-id>/<name>/` or `~/.local/share/cast/user/<name>/` |
| Page snapshots and screenshots | `~/.local/share/cast/output/<project-id>/<name>/` |

`<project-id>` is the project folder name plus a short hash of its path, e.g. `shop-3fa2c1d0`. `XDG_CONFIG_HOME` and `XDG_DATA_HOME` are honoured.

The profile list is plain YAML: you can edit sites or descriptions by hand.

## Privacy and safety

- **Claude can read everything visible in these browsers, including email.** Use test accounts where you can, and add only accounts you are fine with Claude seeing.
- cast **never types or stores passwords**. You log in yourself; Claude is instructed never to fill login forms.
- cast **never prints cookies or tokens**. From your login session it records only host names of visited sites.
- Chrome data folders are readable only by you (`0700`). Deleting a profile with `/cast:remove` deletes its data.
- cast does not disguise automation: the login window is a plain Chrome because a human uses it; when Claude works, sites can see an automated browser.
- See [SECURITY.md](SECURITY.md) for details and how to report a vulnerability.

## Troubleshooting

**`/cast:add` does not open a window, or Chrome is not found.**
Check that `google-chrome --version` works in your terminal. cast uses the installed Google Chrome, not a bundled browser.

**The window opens but you can't see it / it runs headless.**
Claude Code must be started from a desktop session where `DISPLAY` is set (`echo $DISPLAY`). Over plain SSH there is no screen to show the window on.

**"profile is already open in another Chrome".**
One Chrome profile can be used by one browser at a time. Close the other window: a `/cast:login` window, or the same profile opened by another Claude Code session.

**SSO says "your browser behaves strangely" or blocks the login.**
Make sure you log in in the `/cast:add` or `/cast:login` window: it is a plain Chrome and passes such checks. Claude's own work runs under Playwright, which sites can recognise as automation; if a site refuses automated browsers even after login, that is its policy and cast does not try to hide automation.

**Claude says a session expired.**
Run `/cast:login <name>`, log in again, close the window. Choose "Stay signed in" to keep sessions longer.

**Profiles do not appear at the start of a session.**
Run `/cast:list`. If it is empty, the profiles may be in another project (local scope is per project folder) — use `--scope user` for profiles you need everywhere.

**Start over with a profile.**
`/cast:remove <name>`, then `/cast:add <name>`.

## Update and uninstall

```
/plugin marketplace update bodpad   # refresh the marketplace
/plugin update cast@bodpad         # install the latest version of cast
/plugin uninstall cast@bodpad      # remove the plugin
```

Uninstalling keeps your profiles and logins. To delete them too, remove `~/.config/cast` and `~/.local/share/cast`.

## Contributing

### How it works

- `src/mcp.ts` — the `cast` MCP server. It exposes `cast_*` tools and all Playwright browser tools (`browser_click`, `browser_snapshot`, …) with an extra required `profile` parameter.
- `src/chrome.ts` — starts a regular Google Chrome on a profile (restoring the last session), optionally with a DevTools port.
- `src/gateway.ts` — for each open profile, starts Chrome with a DevTools port and a [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp) child attached to it (`--cdp-endpoint`), and routes each `browser_*` call to it.
- `src/login-window.ts` — the login window for `/cast:add` and `/cast:login`: the same Chrome but without a DevTools port, because a port makes pages see an automated browser and SSO bot checks refuse to log in. It waits for the window to close and reads visited hosts from the profile's History.
- `src/registry.ts`, `src/paths.ts` — profile lists in the three scopes and where files go.
- `src/cli.ts` — `list --brief`, printed by the `SessionStart` hook (`hooks/hooks.json`) so Claude knows the profiles.
- `skills/` — the `/cast:*` commands and the `cast` skill that tells Claude how to work with profiles.

See [PLAN.md](PLAN.md) for design decisions and known Playwright MCP quirks.

### Develop

```bash
git clone https://github.com/bodpad/cast && cd cast
npm install
npm test                          # build + unit tests + integration tests (real Chrome, headless)
claude --plugin-dir .             # run Claude Code with your working copy of the plugin
claude plugin validate --strict . # check the manifests
```

- Tests use `node:test`; integration tests start a tiny local site and a real Chrome, headless by default. `CAST_TEST_HEADED=1 npm test` runs them with visible windows and also checks that the login window is not flagged as automated.
- `CAST_CONFIG_DIR`, `CAST_DATA_DIR` and `CAST_PROJECT_DIR` redirect all cast files, handy for experiments.
- `dist/src` is committed so the plugin works without a build step after install. Run `npm run build` and commit `dist/` together with source changes.

## License

MIT
