---
description: Change the email or description (who this person is in tests) of a cast browser profile
argument-hint: <name> [email] ["description"]
disable-model-invocation: true
allowed-tools: mcp__plugin_cast_cast__cast_update, mcp__plugin_cast_cast__cast_list
---

The user wants to change cast profile details. Arguments: `$ARGUMENTS`

1. Parse the arguments: the first word is the profile name, then an optional email (contains `@`) and an optional description (the rest, usually quoted). If there is no name, call `cast_list`, show the names with their descriptions and ask which one.
2. If neither an email nor a description was given, show the current values from `cast_list` and ask what to change in one short question.
3. Call `cast_update` with `name` and only the fields the user gave. An empty string clears a field.
4. Confirm the new values in one line.

Logins are not touched; there is no need to log in again.
