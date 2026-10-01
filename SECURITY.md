# Security

cast keeps real, logged-in browser sessions on your machine and lets Claude use them. Please read what it protects and what it does not.

## What cast does

- **Never types, asks for or stores passwords.** A human logs in in a plain Chrome window. Claude is instructed never to fill login forms and to ask for `/cast:login <name>` when a session expires.
- **Never prints cookies or tokens.** After login it reads, from the profile's own browsing history, the hosts visited and the path and title of the last page on each site (no query string, which may carry tokens). It shows them to Claude to suggest sites and a description, and saves only the hosts and description you confirm.
- **Keeps profiles private to your user.** Chrome data folders are created with mode `0700`. `.claude/cast.yaml` (committed team slots) holds only names and descriptions, never emails or credentials.
- **Acts as the person, in the person's own session.** A human logs in; Claude then works in that session on the user's behalf. Like Playwright MCP by default, cast starts Claude's window with `--disable-blink-features=AutomationControlled` (and `--test-type`, which only hides Chrome's warning bar about that flag), so pages see `navigator.webdriver = false`. The login window needs neither: it has no DevTools port. It does nothing more: no fingerprint spoofing, no CAPTCHA solving, no automated logins. You are responsible for following the terms of the services you use through cast.

## What cast does not protect against

- **Claude sees what the profile sees.** Pages, including email and chat, are read by Claude and sent to the model as part of your Claude Code session. Prefer test accounts; add only accounts you are fine with Claude reading.
- **While Claude works in a profile, its Chrome listens on a DevTools port on 127.0.0.1.** Any program running under your user can connect to that port and control the browser for as long as the window is open. The login window has no such port.
- **Anyone with access to your user account can use the sessions.** On Linux Chrome is started with `--password-store=basic`, so cookies are not protected by the system keyring; on macOS and Windows they are encrypted for your user account only. Treat cast's data folder (`~/.local/share/cast`, `%LOCALAPPDATA%\cast` on Windows) like a set of logged-in browsers.
- **Claude can act as that person.** Within a profile Claude can do whatever the person can do on those sites. Review what you ask for, and watch the visible windows.
- Playwright MCP exposes `browser_run_code_unsafe`, which runs arbitrary Playwright code in the page and could read cookies. The `cast` skill tells Claude not to print cookies or storage, but this is an instruction, not a technical barrier.

## Reporting a vulnerability

Please do not open a public issue. Use [GitHub private vulnerability reporting](https://github.com/bodpad/cast/security/advisories/new) for this repository (Security tab → Report a vulnerability).
