# Profiles

A cast profile is one person: a Chrome profile with that person's logins, plus a name, an optional email and description, and the sites they use.

## Scopes

`/cast:add` takes `--scope local|project|user`:

| Scope | Who sees the profile | Use it for |
|---|---|---|
| `local` (default) | you, in this project only | most cases |
| `user` | you, in all your projects | an account you use everywhere, e.g. your work mailbox |
| `project` | a slot in the repository; each developer logs in with their own account | shared test scenarios |

If the same name exists in several scopes, local wins over project, project over user.

## Sharing with a team

A profile holds *your* logins, so it is never shared. What can be shared is a **slot**: a name and a description.

```
/cast:add sender --scope project
```

This writes `.claude/cast.yaml` (no emails, no cookies):

```yaml
version: 1
profiles:
  sender:
    description: sends messages
```

Commit it. A teammate sees `sender` marked *not set up on this machine*; Claude asks them to run `/cast:add sender`, and they log in with their own test account.

## Sites

After you log in, cast suggests the sites where you landed (e.g. `localhost:3000`, `teams.microsoft.com`). Sign-in pages and redirects (`login.microsoftonline.com`, `sso.…`) are listed separately and not suggested: Claude never logs in itself. `/cast:login` can add more sites later.

## What Claude sees at session start

```
cast: browser users available (open with cast_open / browser_* tools with profile=<name>):
- Elon (local) elon@example.com — receives messages. Sites: localhost:3000
- Sam (local) sam@example.com — sends messages. Sites: localhost:3000, outlook.office.com
```

## Where data lives

| What | Where |
|---|---|
| Profile list for a project | `~/.config/cast/projects/<project-id>.yaml` |
| Profile list for all projects | `~/.config/cast/profiles.yaml` |
| Team slots | `.claude/cast.yaml` in the repository |
| Chrome data (logins), mode `0700` | `~/.local/share/cast/projects/<project-id>/<name>/` or `~/.local/share/cast/user/<name>/` |
| Page snapshots and screenshots | `~/.local/share/cast/output/<project-id>/<name>/` |

`<project-id>` is the project folder name plus a short hash of its path, e.g. `shop-3fa2c1d0`. `XDG_CONFIG_HOME` and `XDG_DATA_HOME` are honoured. The lists are plain YAML; you can edit sites and descriptions by hand.

Uninstalling the plugin keeps profiles. To delete everything, remove `~/.config/cast` and `~/.local/share/cast`.
