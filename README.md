# cast

**Several logged-in browser users for [Claude Code](https://claude.com/claude-code).**

Testing an app where people interact — a chat, a marketplace, an approval flow — needs a browser per person, each logged in to that person's accounts. cast gives Claude exactly that: one Chrome profile per person. You log in once; Claude opens the browsers itself, several at a time.

```
You:    /cast:add Sam       → Chrome opens, you log in as Sam, close the window
You:    /cast:add Elon      → same for Elon
You:    Send "hi" from Sam to Elon and check that Elon gets it.
Claude: opens both windows, already logged in, sends as Sam, checks as Elon.
```

Works with corporate SSO (Microsoft Entra, Okta, Google): you log in yourself, in a regular Chrome.

## Install

Requirements: Linux with a desktop, Google Chrome, Node.js 20+.

```
/plugin marketplace add bodpad/cast
/plugin install cast@bodpad
/reload-plugins
```

## Get started

**1. Add a person.** Email and description are optional; they help Claude pick the right person.

```
/cast:add Sam sam@example.com "sends messages"
```

**2. Log in.** A Chrome window opens. Log in everywhere Sam needs (your app, SSO, email), choose **"Stay signed in"** on MFA prompts, then **close the window**.

**3. Confirm the sites** cast suggests (where you landed, e.g. `localhost:3000`).

That's it. Every new Claude Code session in this project knows Sam. Just ask:

- *"Check Sam's inbox for the invitation email and open the link."*
- *"Sam creates an order, Elon approves it; check that Sam sees the new status."*

## Commands

| Command | What it does |
|---|---|
| `/cast:add <name> [email] ["description"]` | Add a person and log in |
| `/cast:login <name>` | Log in again or add sites |
| `/cast:list` | Show profiles |
| `/cast:remove <name>` | Delete a profile and its logins |

Names use latin letters, digits, `-` and `_`.

## Good to know

- **Windows are visible** regular Chrome windows. Watch, take over, or close them; Claude reopens a window when it needs it.
- **Logins and tabs are kept** between sessions.
- **Claude never logs in.** When a session expires, it asks you to run `/cast:login <name>`.
- **Claude sees what the person sees, including email.** Prefer test accounts. cast never stores passwords and never shows cookies. See [SECURITY.md](SECURITY.md).

## More

- [Profiles for a team, all projects, and where data lives](docs/profiles.md)
- [Troubleshooting](docs/troubleshooting.md)
- [How cast compares to similar tools](docs/comparison.md)
- [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

Update: `/plugin marketplace update bodpad`, then `/plugin update cast@bodpad`.

## License

MIT
