---
description: Create a browser profile for a person and log in to their accounts in a fresh Chrome window
argument-hint: <name: latin letters, digits, - _> [email] ["description"] [--scope local|project|user]
disable-model-invocation: true
allowed-tools: mcp__plugin_cast_cast__cast_add, mcp__plugin_cast_cast__cast_set_sites, mcp__plugin_cast_cast__cast_update
---

The user wants a new cast browser profile. Arguments: `$ARGUMENTS`

1. Parse the arguments: the first word is the profile name (letters, digits, `-`, `_`). Then an optional email (contains `@`), an optional description (the rest, usually quoted, e.g. "sender"), and an optional `--scope local|project|user` (default `local`: this project only; `project`: a shared team slot in `.claude/cast.yaml` without credentials; `user`: all projects). If there is no name, ask for it and stop. If the name has other characters (spaces, Cyrillic…), suggest a valid one (e.g. `alex-qa`) instead of calling the tool.
2. If the description is missing, ask in ONE short question who this person is in the tests (e.g. "sender", "vendor", "approver") and, if missing, their email. If the user does not know yet, go on: after login you will suggest a description from the page where they landed. Do not ask anything else.
3. Tell the user: a clean Chrome window opens now; log in everywhere this person needs (the app, email, SSO…), choose "Stay signed in" on MFA prompts, and **close the window when done**. Keep this Claude Code session open until then: if the call moves to the background, that is expected, but quitting the session cancels it.
4. Call `cast_add` with `name`, `email`, `description`, `scope`. It returns when the window is closed.
5. In ONE message:
   - show the suggested sites and ask which to keep (default: all suggested). Mention the sign-in pages only briefly: they are not needed, because Claude never logs in itself. If the app the user logged in to is missing (e.g. only SSO pages were visited), ask for its address;
   - if the profile has no description, ask who this person is in the tests, suggesting one from the last pages the user saw (e.g. "Looks like a vendor on app.example.com (/vendor, “Vendor dashboard”). Save that as the description?"). If the pages show no role, ask without a suggestion.
6. Call `cast_set_sites` with the chosen hosts. Call `cast_update` with the description only if the user gave or confirmed one; never save your own guess.
7. Confirm in one line: the profile is ready and Claude can now use it by name.

Never type or ask for passwords. If `cast_add` returns an error, show it as is.
