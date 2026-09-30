---
description: Reopen a browser profile so the user can log in again (expired session) or add more sites
argument-hint: <profile name>
disable-model-invocation: true
allowed-tools: mcp__plugin_cast_cast__cast_login, mcp__plugin_cast_cast__cast_login_result, mcp__plugin_cast_cast__cast_set_sites, mcp__plugin_cast_cast__cast_list, mcp__plugin_cast_cast__cast_update
---

The user wants to log in again with cast profile `$0`.

1. If no name was given, call `cast_list`, show the profile names and ask which one.
2. Call `cast_login` with `name`. It opens the profile's Chrome with its known sites and returns at once.
3. Tell the user: log in where needed, **close the window when done** and tell you. They may also leave this session: cast saves the visited sites when the window closes. Then stop and wait for their answer.
4. When the user says they are done, call `cast_login_result` with `name`. If the window is still open, say so and wait again. Otherwise say in one line which sites were added, if any, and that `/cast:edit <name>` changes them. Do not ask about the sites. If the profile has no saved sites at all, ask for the app's address and call `cast_set_sites` with it.
5. If the profile has no description, ask in the same message who this person is in the tests, suggesting one from the last pages the user saw (e.g. "Looks like a vendor on app.example.com (/vendor). Save that as the description?"). Call `cast_update` only with what the user gave or confirmed.
6. If there is nothing to ask, just say the profile is updated.

Never type or ask for passwords.
