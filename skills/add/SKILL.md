---
description: Create a browser profile for a person and log in to their accounts in a fresh Chrome window
argument-hint: <name> [email] ["description"] [--scope local|project|user]
disable-model-invocation: true
allowed-tools: mcp__plugin_cast_cast__cast_add, mcp__plugin_cast_cast__cast_set_sites
---

The user wants a new cast browser profile. Arguments: `$ARGUMENTS`

1. Parse the arguments: the first word is the profile name (letters, digits, `-`, `_`). Then an optional email (contains `@`), an optional description (the rest, usually quoted, e.g. "sender"), and an optional `--scope local|project|user` (default `local`: this project only; `project`: a shared team slot in `.claude/cast.yaml` without credentials; `user`: all projects). If there is no name, ask for it and stop.
2. If the email or the description is missing, ask for both in ONE short question and say they can be skipped. Do not ask anything else.
3. Tell the user: a clean Chrome window opens now; log in everywhere this person needs (the app, email, SSO…), choose "Stay signed in" on MFA prompts, and **close the window when done**.
4. Call `cast_add` with `name`, `email`, `description`, `scope`. It returns when the window is closed.
5. Show the visited domains as a short list and ask which to keep (default: all of them; drop obvious noise like SSO redirects only if the user agrees). Then call `cast_set_sites` with the chosen hosts.
6. Confirm in one line: the profile is ready and Claude can now use it by name.

Never type or ask for passwords. If `cast_add` returns an error, show it as is.
