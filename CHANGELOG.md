# Changelog

## 0.6.3 — 2026-09-30

### Changed
- With no profiles yet, the session start tells Claude how people are added, so it suggests `/cast:add <name>` from its first answer.

## 0.6.2 — 2026-09-30

### Fixed
- The person's name in the window title now shows in restored windows too: profiles made before 0.5.0 showed the page title, and a profile first opened for login kept "· log in ·" in Claude's window.
- No more "You are using an unsupported command-line flag" bar at the top of cast windows.

## 0.6.1 — 2026-09-30

### Changed
- Clear errors when Chrome cannot start, each with what to do: Chrome not installed, no display (e.g. plain SSH), display not reachable, profile already open, not Linux. Otherwise the error quotes Chrome's last message; its full output is in `cast-chrome.log` in the profile folder.
- A login window whose Chrome exits right away is reported as an error instead of an empty login.

## 0.6.0 — 2026-09-30

### Changed
- `/cast:add` and `/cast:login` no longer keep Claude waiting while the login window is open. Log in, close the window and tell Claude; you may also leave the Claude Code session meanwhile. cast saves the visited sites when the window closes, or at the next session start.
- While a profile's login window is open, Claude does not use that profile and says so.

### Added
- The `cast_login_result` tool: whether the login window is closed, and what was saved from it.

## 0.5.0 — 2026-09-30

### Added
- Each profile's Chrome window has its own theme color and shows the person in the title bar, e.g. `Sam (sends messages) · cast` (`· log in ·` in the login window). New profiles get a color no other profile uses; existing ones get one the next time they open.

## 0.4.0 — 2026-09-30

### Changed
- `/cast:add` and `/cast:login` save the sites where you landed without asking; Claude says in one line what was saved. It asks for the app's address only when you visited nothing but sign-in pages.
- `/cast:edit <name> +site -site` adds or removes sites.

## 0.3.1 — 2026-09-30

### Changed
- Examples in the skills and tool descriptions use neutral names (`alex-qa`, `app.example.com`).
- README says what cast reads from a profile's browser history after login: URLs and page titles of that profile only.

## 0.3.0 — 2026-09-30

### Added
- `/cast:edit <name>` and the `cast_update` tool change a profile's email or description without deleting it or logging in again.
- After `/cast:add` and `/cast:login`, cast reports the last page you saw on each site (path and title, no query string). If the profile has no description, Claude suggests one from it (e.g. "vendor on app.example.com (/vendor)") and saves it only when you confirm.

### Changed
- Claude picks profiles by their description and no longer guesses a role from a profile name, email or sites. When no profile or several match, it asks once and saves your answer in the description.
- `/cast:add` asks who the person is in your tests instead of offering to skip the description.
- The session start list marks profiles without a description as "role unknown".

## 0.2.1 — 2026-09-30

### Changed
- Chrome is started with `--disable-blink-features=AutomationControlled`, the same default as Playwright MCP, so pages see `navigator.webdriver = false` while Claude works on the user's behalf. Nothing else is masked.

### Fixed
- Actions could hang when Chrome activated another tab while restoring the session; cast now waits for the restore to finish and brings the working tab to the front.
- The login instruction tab no longer turns into an error page after restore, and it is closed when Claude opens the profile.
- Background tabs keep rendering in Claude's window.

## 0.2.0 — 2026-09-30

### Changed
- Claude works in a regular Chrome that cast starts itself; Playwright MCP attaches to it over a local DevTools port instead of launching its own browser. Windows reopen the tabs from last time and behave like the person's normal Chrome; the user can take over or close them, and the next call reopens the window.
- `/cast:login` also reopens the previous session's tabs.

### Security
- While Claude works in a profile, its Chrome listens on a DevTools port on 127.0.0.1 (see SECURITY.md).

## 0.1.3 — 2026-09-30

### Changed
- The marketplace is renamed from `netmate` to `bodpad`: install with `/plugin install cast@bodpad`. If you installed `cast@netmate`, run `/plugin marketplace remove netmate`, then add `bodpad/cast` again. Profiles and logins are kept.

## 0.1.2 — 2026-09-30

### Changed
- After login, cast suggests the sites where you landed and lists sign-in pages and redirect hops (`login.microsoftonline.com`, `sso.…`, Okta, Google…) separately instead of suggesting them.
- `cast_list` shows each profile's Chrome folder.
- `/cast:add` hint shows the name rule; invalid names get a suggested valid one.
- README: keywords and a comparison with similar tools.

## 0.1.1 — 2026-09-30

### Fixed
- `/cast:add` and `/cast:login` open a plain Chrome instead of a Playwright-controlled one. Corporate SSO with bot checks (e.g. GoDaddy-federated Microsoft 365) refused to log in because the window reported `navigator.webdriver = true`.
- Visited domains are read from the profile's History after the window closes (no DevTools connection while you log in).
- A login window that times out is closed with a clean shutdown, so cookies are not lost.

### Added
- Clear error when a profile is already open in another Chrome window.
- `SECURITY.md`; README troubleshooting for SSO bot checks.

## 0.1.0 — 2026-09-30

First version: persistent Chrome profile per person, `/cast:add`, `/cast:login`, `/cast:list`, `/cast:remove`, local/project/user scopes, gateway over `@playwright/mcp`.
