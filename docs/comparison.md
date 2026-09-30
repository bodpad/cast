# How cast compares

| | cast | Playwright MCP alone | Auth-state plugins (`storageState`) | playwright-cli sessions |
|---|---|---|---|---|
| Several users logged in **at the same time** | yes, one window per person | one browser per server | one browser, roles switched | yes, by session name |
| Full Chrome profile (IndexedDB, service workers, "trusted device" for MFA) | yes | yes, one profile | cookies and localStorage only | yes, with `--persistent` |
| Corporate SSO with bot checks at login | yes: you log in in a plain Chrome | may be blocked | varies by plugin | may be blocked |
| Claude knows who is who (name, email, role, sites) at session start | yes | no | per role name | no |
| Claude never logs in; asks you when a session expires | yes | — | — | — |
| Team slots in the repo, credentials stay personal | yes | no | no | no |

Use plain [Playwright MCP](https://github.com/microsoft/playwright-mcp) for single-user browsing. Use cast when a test involves several people, or accounts behind SSO.
