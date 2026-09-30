---
description: Use when a task needs a real browser logged in as a specific person, or several people at once (e.g. Sam sends a chat message and Elon must receive it, checking a user's email or Teams). Explains cast profiles and the browser_* tools with a profile parameter.
---

# Working with cast browser profiles

cast gives you several visible Chrome windows, one per person, each already logged in to that person's accounts (the app, SSO, email…). The session start message and `cast_list` show the available profiles: name, email, description (role) and known sites.

## Choosing and opening profiles
- Pick profiles by name or by description ("the sender", "admin"). If unsure, call `cast_list`.
- Open profiles without asking: `cast_open {profile, url?}`, or just call any `browser_*` tool with `profile` — the profile opens automatically.
- Every `browser_*` tool takes a required `profile`. Calls for different profiles go to different browsers and can be interleaved freely.
- A profile marked not ready is a team slot not set up on this machine: ask the user to run `/cast:add <name>`.

## Reading pages
- Action tools (`browser_navigate`, `browser_click`, `browser_type`…) return a link `[Snapshot](/abs/path.yml)` instead of the page. Call `browser_snapshot {profile}` to get the page with element refs, or read that file.
- Use refs from the latest snapshot of the **same profile** as `target` in `browser_click`/`browser_type`.

## Multi-person scenario
1. Open both profiles (e.g. Sam and Elon) on the relevant site.
2. Act in one (Sam sends a message).
3. Verify in the other (Elon's chat shows it; use `browser_wait_for {profile, text}` for real-time updates). Check email the same way in the person's mail site.
4. Report what each person saw.

## Dialogs
If a response contains `### Modal state` (e.g. a `confirm` dialog), other tools will fail until you call `browser_handle_dialog {profile, accept: true|false}`.

## Expired sessions — do not log in yourself
If a site shows a login page instead of the app, stop working with that profile and ask the user to run `/cast:login <name>`. Never type passwords, never fill login forms, never call `cast_add` or `cast_login` on your own.

## Privacy
Profiles hold real sessions (mail included). Look only at what the task needs. Never print cookies, tokens or storage contents.

## Finishing
When the task is done, close the profiles you opened with `cast_close {profile}`. Logins are kept.
