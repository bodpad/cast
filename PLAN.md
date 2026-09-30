# cast: implementation plan

## Why
A developer tests a web app where several people take part. Example: a chat like WhatsApp Web, where Sam writes and Elon receives. Claude should work in several browsers by itself, each logged in to its own account, including at the same time. Today this is done by hand: Chrome with `--remote-debugging-port` plus CDP scripts.

**How a person uses it:**
```
/cast:add Sam     → a clean Chrome opens, the person logs in everywhere Sam needs and closes the window
/cast:add Elon    → the same for Elon
```
After that Claude knows at startup: "there are browsers for Sam (sam@email.com: localhost:3000, outlook…) and Elon". It opens them by itself when needed and tests the conversation between them.

## Decisions (agreed with the user)
- **A profile is a person, not a site.** One persistent profile of real Google Chrome covers everything for that person: Microsoft → SSO into the app, mail, Teams and so on.
- `/cast:add <name>`:
  - Claude asks for an email and a description; both can be skipped. They can be passed at once: `/cast:add Sam sam@email.com "sender"`.
  - A visible clean Chrome opens with an instruction page: "log in everywhere you need; on MFA choose 'Stay signed in'; close the window when done".
  - Ready signal: the person closed the window.
  - cast shows the domains that were visited (only hosts of main-frame navigations, no cookies) and asks for confirmation. The list is saved as the profile's "sites".
- `/cast:login <name>` opens the same profile. The person completes logins, closes the window, the site list grows.
- `/cast:list`, `/cast:remove <name>`.
- Claude opens profiles **without asking**. If a session expired (a login page instead of the site), Claude **does not log in itself** and asks the person to run `/cast:login <name>`.
- cast **never** types or stores passwords and never prints cookies or tokens in responses or logs.
- Windows are **always visible**, so the developer sees what happens. No headless mode in the first version.
- No import of an existing profile (`--from`): profiles are created from scratch.
- **Linux only** in the first version. macOS and Windows come after a working solution.
- Repository `bodpad/cast`. The marketplace is called `bodpad` (renamed from `netmate` on 2026-09-30, before any users). Install: `/plugin marketplace add bodpad/cast`, then `/plugin install cast@bodpad`. Do not use the `claude-` prefix in names.
- The README warns about privacy: Claude reads what is visible in the profiles, mail included.

### Storage scopes (like Claude's local / project / user)
| Scope | Meaning | Profile list | Chrome data (mode 0700) |
|---|---|---|---|
| **local** (default) | my profile, this project only | `~/.config/cast/projects/<project-id>.yaml` | `~/.local/share/cast/projects/<project-id>/<name>/` |
| **project** | a team "slot" (name and description, no credentials), committed; each developer fills it with their own account via `/cast:add <name>` | `.claude/cast.yaml` in the repository; the personal part (email, sites) lives in the local file | same as local |
| **user** | my profile in all projects | `~/.config/cast/profiles.yaml` | `~/.local/share/cast/user/<name>/` |

- Precedence for equal names (case-insensitive): local > project > user.
- `project-id` = `<folder name>-<8 hex of sha256 of the project's realpath>`. The project is taken from `CAST_PROJECT_DIR`, then `CLAUDE_PROJECT_DIR`, then cwd. A value left as an unexpanded `${…}` placeholder is ignored.
- Claude sees an unfilled project slot marked "not set up on this machine, ask for /cast:add <name>".
- `XDG_CONFIG_HOME` and `XDG_DATA_HOME` are honoured. Tests override with `CAST_CONFIG_DIR` and `CAST_DATA_DIR`.

## Engine: a gateway over @playwright/mcp (chosen after a spike)
The `cast` MCP server in Node/TS. For each open profile it starts a child `@playwright/mcp` (stdio, via the `@modelcontextprotocol/sdk` Client) with that profile folder. Claude gets **one** set of Playwright MCP browser tools, each with an added required `profile` parameter, and the call is proxied to the right child. The login window for `/cast:add` and `/cast:login` is a **plain Chrome** started by cast without any automation (see "Login window" below); it shares `--password-store=basic` with Playwright, so both read the same cookies.

### Spike results (Linux, Chrome 151, @playwright/mcp 0.0.83, 2026-09-30)
Both candidates, a gateway over Playwright MCP and Vercel agent-browser 0.38.1, passed three tests in headed mode:
1. Sam and Elon open at the same time, each with their own login.
2. The login survives close and reopen (cookie with Max-Age).
3. `confirm()` does not hang the work.

Playwright MCP was chosen because `/cast:add` needs standard events: navigations (collecting domains) and window close. It also has no "I type passwords myself" feature, and it is lighter (about 19 MB vs 114 MB).

### Pitfalls found in the spike (must be handled)
- **`DISPLAY`:** `StdioClientTransport` passes the child a reduced environment without `DISPLAY` by default, and Chrome silently starts `--headless`. Pass `env: { ...process.env }`.
- **Page snapshots:** Playwright MCP writes snapshots to `.playwright-mcp/` in cwd. Pass `--output-dir ~/.local/share/cast/output/<project-id>/<name>` to keep the project clean.
- **Click parameter:** in 0.0.83 `browser_click` takes `target` (a ref from the snapshot or a selector) and `element` (a description); `ref` is not used. Take schemas from the child dynamically, do not hardcode them.
- **Dialogs:** after a click that opens a dialog the response contains `### Modal state - ["confirm" dialog with message "Sure?"]: can be handled by browser_handle_dialog`. Other tools return a "does not handle the modal state" error. `browser_handle_dialog {accept:true}` resolves it. This works as designed; the skill must mention it.
- **Chrome flags:** Playwright starts Chrome with `--password-store=basic --use-mock-keychain`, so cookies are not encrypted with the system keyring. That is fine, but the login window and Claude's work must use the same engine, otherwise the profile cannot be read.
- **Lazy start:** the browser starts on the first browser call, not when the child starts. The tool list can be fetched from a child without opening Chrome.
- **Entry point:** `@playwright/mcp` does not export `cli.js`. Path: `dirname(require.resolve('@playwright/mcp/package.json')) + '/cli.js'`, run with `process.execPath`.
- Child launch: `--browser chrome --user-data-dir <dir> --output-dir <dir>`.
- **Snapshots go to files (found during implementation):** in 0.0.83 action tools (`browser_navigate`, `browser_click`…) do not return the page; they write an automatic snapshot to a file and return `[Snapshot](<path relative to the child's cwd>)`. Only an explicit `browser_snapshot` returns the page inline. The gateway starts the child with `cwd = output-dir` and rewrites such links to absolute paths; the `cast` skill tells Claude to call `browser_snapshot` or read the file.

### Login window: why plain Chrome (found in the first manual e2e, 2026-09-30)
- A corporate tenant federated to GoDaddy SSO refused the login in the Playwright-launched window ("Dein Browser verhält sich etwas seltsam"). Playwright starts Chrome with `--enable-automation`, so pages see `navigator.webdriver = true`.
- In Chrome 151 **`--remote-debugging-port` alone also sets `navigator.webdriver = true`** (checked: a page reports `true` with the flag and `false` without it). So the login window cannot even be observed over CDP.
- Solution: `/cast:add` and `/cast:login` spawn `/opt/google/chrome/chrome --user-data-dir=<dir> --password-store=basic --no-first-run --no-default-browser-check --new-window <instructions> <sites>` and wait for the process to exit. cast does not hide automation anywhere; this window simply is not automated, because a human uses it.
- Visited domains come from the profile's `Default/History` (SQLite, read with `sql.js`, pure WebAssembly, no native build): visits since the window opened.
- **Shutdown matters:** closing the window (WM close) and `SIGINT`/`SIGHUP` flush History and cookies; **`SIGTERM` loses what is not flushed yet** (History commits every ~10 s, cookies every ~30 s). cast uses `SIGINT` on timeout.
- A second Chrome on a busy profile hands its URLs to the running one and exits; cast checks `SingletonLock` (host-pid) first and reports "already open".
- Tests: headless mode adds a test-only DevTools port to play the human. `CAST_TEST_HEADED=1` runs headed, opens URLs through a second `chrome` call and checks `navigator.webdriver === false`.
- Checked headed: a login made in the plain window is visible to Playwright MCP afterwards (same cookie encryption).
- Claude Code moves a tool call running longer than ~120 s to the background; quitting the session cancels it. The skills and the instruction page say to keep the session open.

## Claude Code plugin facts (checked on code.claude.com, 2026-09-29/30)
- `.claude-plugin/marketplace.json`: `{ "name": "bodpad", "owner": {...}, "description": "...", "plugins": [{ "name": "cast", "source": "./", "description": "..." }] }`. The install id is `<plugin>@<marketplace name>`.
- Plugins are distributed through marketplaces (git repositories). npm is only an optional plugin source type; cast does not need it.
- `.claude-plugin/plugin.json`: `{ "name": "cast", ... }`. All components get the `cast:` prefix.
- Slash commands are written as skills (`commands/` is the legacy format): `skills/<name>/SKILL.md` becomes `/cast:<name>`. Frontmatter: `description`, `argument-hint`, `disable-model-invocation: true` (human only), `allowed-tools`. Arguments: `$ARGUMENTS`, `$0`, `$1` (0-based).
- MCP: `.mcp.json` in the plugin root, `{"mcpServers":{"cast":{"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/dist/src/mcp.js"],"env":{"CAST_PROJECT_DIR":"${CLAUDE_PROJECT_DIR}"}}}}`. Tools are named `mcp__plugin_cast_cast__<tool>`.
- Hooks: `hooks/hooks.json`. The stdout of a SessionStart hook goes into Claude's context.
- Dependencies: on install from a marketplace Claude Code runs `npm ci --ignore-scripts` in the plugin cache if `package.json` and `package-lock.json` exist (60 s timeout). With `--plugin-dir` (local development) it does not, so a manual `npm install` is needed. `dist/` is committed so there is no build step. Keep `devDependencies` minimal: tests on `node:test`, no vitest.
- Validation: `claude plugin validate --strict .`
- npm name `@bodpad/cast`: the package name is free; whether the `bodpad` scope is available needs an npm login (publishing deferred, the package is `private`).

## Repository layout
```
.claude-plugin/marketplace.json
.claude-plugin/plugin.json
.mcp.json
hooks/hooks.json                 # SessionStart → node ${CLAUDE_PLUGIN_ROOT}/dist/src/cli.js list --brief
skills/add/SKILL.md              # /cast:add     (disable-model-invocation: true)
skills/login/SKILL.md            # /cast:login   (disable-model-invocation: true)
skills/list/SKILL.md             # /cast:list
skills/remove/SKILL.md           # /cast:remove  (disable-model-invocation: true)
skills/cast/SKILL.md             # for Claude: how to work with profiles
src/paths.ts                     # ✅ directories, project-id
src/registry.ts                  # ✅ three scopes, merging, zod + yaml; covered by tests
src/login-window.ts              # ✅ login window: launchPersistentContext, domain collection, wait for close
src/gateway.ts                   # ✅ @playwright/mcp children, tool proxy
src/mcp.ts                       # ✅ cast MCP server
src/cli.ts                       # ✅ list --brief for the hook
src/format.ts                    # ✅ the list --brief block
test/*.test.ts                   # ✅ node:test: unit + integration with real Chrome
dist/                            # tsc output; dist/src is committed, dist/test is ignored
package.json, tsconfig.json      # ✅ TS 7 needs "types": ["node"]
PLAN.md, README.md
```

## Implementation details

### src/login-window.ts
- `openLoginWindow(dir, opts)`: `mkdir(dir, 0o700)`, refuse if `SingletonLock` points to a live process, spawn plain Chrome (flags above). `CAST_CHROME` overrides the binary.
- The first tab is an instruction page (a temporary `file://` HTML) with the profile name and the text from "Decisions". For `/cast:login` also open tabs with the known sites.
- Wait for the Chrome process to exit, i.e. the person closing the window. Timeout 30 minutes; on timeout `SIGINT` and report.
- Domains: hosts of `visits` newer than the start time in `Default/History`. Keep the port: `localhost:3000` matters.
- If the profile is currently open in the gateway of the same process, close it there first (done in `mcp.ts`).
- For tests: `onReady({ endpoint?, close })`; `CAST_TEST_HEADLESS=1` enables headless plus a DevTools port, tests only.

### src/gateway.ts
- `Gateway`: `Map<profileName, { client, transport }>`.
- `open(profile)` starts a child (`env: {...process.env}`, flags above).
- `close(profile)`, `closeAll()`: call `browser_close`, then `client.close()`.
- `toolDefs()`: once, start a temporary child without a profile (Chrome does not start), take `listTools`, close it. Add `profile: {type:'string', description:'cast profile name, see cast_list'}` to every tool schema and to `required`. Exclude `browser_close` (use `cast_close`) and `browser_install` if present.
- `call(profile, tool, args)`: profile not open → open it automatically. Child crashed → a clear "open it again" error. Pass the child's answer through as is (except absolute snapshot links).
- Shutdown: on `SIGTERM`/`SIGINT` and stdin end → `closeAll()`.

### src/mcp.ts — cast server tools
- `cast_list()`: profiles — name, scope, email, description, sites, ready, open now.
- `cast_open(profile, url?)` and `cast_close(profile)`.
- `cast_add(name, email?, description?, scope?)`: blocks until the window is closed, returns the domains. The tool description says: "ONLY when the user explicitly asked (/cast:add); a human must log in".
- `cast_login(name)`: the same for an existing profile, returns new domains.
- `cast_set_sites(name, sites[])` and `cast_remove(name)`; `remove` deletes the entry and the profile folder.
- Proxied `browser_*` with a required `profile`.
- Errors are returned as text with `isError: true`.

### src/cli.ts
`list --brief` prints a compact block for the context if there are profiles, otherwise nothing. Example:
```
cast: browser users available (open with cast_open / browser_* tools with profile=<name>):
- Sam (local) sam@email.com — sender. Sites: localhost:3000, outlook.office.com
- sender (project) — NOT set up on this machine: ask the user to run /cast:add sender
```

### Skills
- `add`, `login`, `list`, `remove` — thin instructions for Claude. `add`: parse `$ARGUMENTS`; if email or description is missing, ask for both in one short question (skippable); tell the person a window is about to open; call `cast_add`; show the domains and ask which to keep; call `cast_set_sites`.
- `cast` (model-invoked):
  - choose a profile by name and description;
  - two-person scenario: open both, act in one, verify in the other, including in mail;
  - dialogs via `browser_handle_dialog`;
  - session expired → do not log in, ask for `/cast:login <name>`;
  - never type passwords and never call `cast_add`/`cast_login` on its own;
  - close profiles at the end (`cast_close`).

## Verification
- `npm test`, i.e. `tsc` and `node --test`. ✅ 27 tests pass.
  - **unit:** scope merging and precedence, filling a project slot, case-insensitive lookup, name validation, stable project-id, 0700 on the profile folder.
  - **integration** (`CAST_TEST_HEADLESS=1`, real Chrome): a local http server with `/login?user=X` (sets a cookie with Max-Age) and a `confirm()` button:
    - `openLoginWindow` collects domains and finishes when the window closes;
    - the gateway opens two profiles at the same time, each with its own user;
    - `confirm()` is resolved with `browser_handle_dialog`;
    - the login survives close and open;
    - `cast_list` and `browser_*` output does not contain cookie values.
- ✅ `claude plugin validate --strict .`
- ✅ Install from a local marketplace (`claude plugin marketplace add <path>`, `claude plugin install cast@bodpad`): 5 skills, 1 hook, 1 MCP server.
- ✅ `CAST_TEST_HEADED=1`: all integration tests pass with visible windows, including `navigator.webdriver === false` in the login window.
- **Manual e2e (in progress):** first run found the SSO bot-check problem above (fixed in 0.1.1).
  1. Install the plugin → `/cast:add Sam`, `/cast:add Elon` on a local test page.
  2. Restart Claude Code, then "check that Elon sees Sam's message": both windows open logged in.
  3. Delete Sam's cookie: Claude asks for `/cast:login Sam`.

## Deferred (improvements, to discuss at the end)
- One profile in two Claude sessions: a lock and a "Sam is already open in another Claude session" message. Today Chrome refuses a busy folder; the gateway adds a readable hint and the login window checks `SingletonLock`.
- Sites that reject automated browsers even after login (possible for Teams/Entra with strict policies): cast will not disguise automation; document per-site findings.
- Detecting logged-in / expired state (a rule by URL or selector), `/cast:check`, a `clean` profile for sign-up tests.
- Whether to hide `browser_run_code_unsafe` (it can read cookies).
- macOS and Windows, optional headless, TOTP via keychain, video or GIF recording, publishing to npm (`@bodpad/cast`) and to the Anthropic directory.
