# Troubleshooting

**No window opens, or Chrome is not found.**
Check that `google-chrome --version` works. cast uses the installed Google Chrome; set `CAST_CHROME` to its path if it lives elsewhere.

**The window does not appear.**
Start Claude Code from a desktop session where `DISPLAY` is set (`echo $DISPLAY`). Over plain SSH there is no screen for the window.

**"This profile is already open in another Chrome window".**
A profile can be used by one Chrome at a time. Close the other window: a `/cast:login` window, or the same profile opened by another Claude Code session.

**SSO blocks the login ("your browser behaves strangely").**
Log in in the `/cast:add` or `/cast:login` window: it is a plain Chrome that nothing controls. When Claude works, the window reports `navigator.webdriver = false`, like Playwright MCP by default, but a site may still detect automation in other ways.

**Claude says a session expired.**
Run `/cast:login <name>`, log in, close the window. Choose "Stay signed in" to keep sessions longer.

**The login window was cancelled.**
Keep the Claude Code session open until you close the window. After about two minutes Claude Code moves the call to the background; quitting the session cancels it.

**Profiles do not appear in a session.**
Run `/cast:list`. Local profiles belong to one project folder; use `--scope user` for profiles you need everywhere.

**Start over with a profile.**
`/cast:remove <name>`, then `/cast:add <name>`.
