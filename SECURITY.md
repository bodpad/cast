# Security

cast keeps real, logged-in browser sessions on your machine and lets Claude use them. Please read what it protects and what it does not.

## What cast does

- **Never types, asks for or stores passwords.** A human logs in in a plain Chrome window. Claude is instructed never to fill login forms and to ask for `/cast:login <name>` when a session expires.
- **Never prints cookies or tokens.** It records only host names of sites visited during login (read from the profile's own browsing history after the window closes).
- **Keeps profiles private to your user.** Chrome data folders are created with mode `0700`. `.claude/cast.yaml` (committed team slots) holds only names and descriptions, never emails or credentials.
- **Does not disguise automation.** The login window is a plain Chrome because a human uses it. When Claude works, the browser is driven by Playwright and sites can recognise it as automated.

## What cast does not protect against

- **Claude sees what the profile sees.** Pages, including email and chat, are read by Claude and sent to the model as part of your Claude Code session. Prefer test accounts; add only accounts you are fine with Claude reading.
- **Anyone with access to your user account can use the sessions.** Chrome is started with `--password-store=basic` (as Playwright does), so cookies are not protected by the system keyring. Treat `~/.local/share/cast` like a set of logged-in browsers.
- **Claude can act as that person.** Within a profile Claude can do whatever the person can do on those sites. Review what you ask for, and watch the visible windows.
- Playwright MCP exposes `browser_run_code_unsafe`, which runs arbitrary Playwright code in the page and could read cookies. The `cast` skill tells Claude not to print cookies or storage, but this is an instruction, not a technical barrier.

## Reporting a vulnerability

Please do not open a public issue. Use [GitHub private vulnerability reporting](https://github.com/bodpad/cast/security/advisories/new) for this repository (Security tab → Report a vulnerability).
