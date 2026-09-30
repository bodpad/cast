---
description: Reopen a browser profile so the user can log in again (expired session) or add more sites
argument-hint: <name>
disable-model-invocation: true
allowed-tools: mcp__plugin_cast_cast__cast_login, mcp__plugin_cast_cast__cast_set_sites, mcp__plugin_cast_cast__cast_list
---

The user wants to log in again with cast profile `$0`.

1. If no name was given, call `cast_list`, show the profile names and ask which one.
2. Tell the user: the profile's Chrome opens now with its known sites; log in where needed and **close the window when done**. Keep this Claude Code session open until then.
3. Call `cast_login` with `name`. It returns when the window is closed.
4. If there are new domains, ask whether to add them, then call `cast_set_sites` with the saved sites plus the accepted new ones. If there are none, just say the profile is updated.

Never type or ask for passwords.
