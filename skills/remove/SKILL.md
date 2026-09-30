---
description: Delete a cast browser profile and its logins
argument-hint: <name>
disable-model-invocation: true
allowed-tools: mcp__plugin_cast_cast__cast_remove, mcp__plugin_cast_cast__cast_list
---

The user wants to remove cast profile `$0`.

1. If no name was given, call `cast_list`, show the names and ask which one.
2. Ask for a short confirmation: this deletes the profile's Chrome data, so all its logins are lost.
3. Call `cast_remove` with `name` and report the result.
