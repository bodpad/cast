---
description: Change the email, description (who this person is in tests) or sites of a cast browser profile
argument-hint: <name> [email] ["description"] [+site -site]
disable-model-invocation: true
allowed-tools: mcp__plugin_cast_cast__cast_update, mcp__plugin_cast_cast__cast_set_sites, mcp__plugin_cast_cast__cast_list
---

The user wants to change cast profile details. Arguments: `$ARGUMENTS`

1. Parse the arguments: the first word is the profile name, then an optional email (contains `@`), sites to add (`+host`) or remove (`-host`), and an optional description (the rest, usually quoted). If there is no name, call `cast_list`, show the names with their descriptions and ask which one.
2. If nothing to change was given, show the current email, description and sites from `cast_list` and ask what to change in one short question.
3. Call `cast_update` with `name` and only the email or description the user gave. An empty email clears it. A description cannot be cleared, only replaced: if the user wants it gone, ask what to write instead. For sites, call `cast_set_sites` with the current sites from `cast_list` plus the added and minus the removed ones.
4. Confirm the new values in one line.

Logins are not touched; there is no need to log in again.
