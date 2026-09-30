# Changelog

## 0.1.3 — 2026-09-30

### Changed
- The marketplace is renamed from `netmate` to `bodpad`: install with `/plugin install cast@bodpad`. If you installed `cast@netmate`, run `/plugin marketplace remove netmate`, then add `bodpad/cast` again. Profiles and logins are kept.

## 0.1.2 — 2026-09-30

### Changed
- After login, cast suggests the sites where you landed and lists sign-in pages and redirect hops (`login.microsoftonline.com`, `sso.…`, Okta, Google…) separately instead of suggesting them.
- `cast_list` shows each profile's Chrome folder.
- `/cast:add` hint shows the name rule; invalid names get a suggested valid one.
- README: keywords and a comparison with similar tools.

## 0.1.1 — 2026-09-30

### Fixed
- `/cast:add` and `/cast:login` open a plain Chrome instead of a Playwright-controlled one. Corporate SSO with bot checks (e.g. GoDaddy-federated Microsoft 365) refused to log in because the window reported `navigator.webdriver = true`.
- Visited domains are read from the profile's History after the window closes (no DevTools connection while you log in).
- A login window that times out is closed with a clean shutdown, so cookies are not lost.

### Added
- Clear error when a profile is already open in another Chrome window.
- `SECURITY.md`; README troubleshooting for SSO bot checks.

## 0.1.0 — 2026-09-30

First version: persistent Chrome profile per person, `/cast:add`, `/cast:login`, `/cast:list`, `/cast:remove`, local/project/user scopes, gateway over `@playwright/mcp`.
