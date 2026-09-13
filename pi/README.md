# pi

Config for [pi](https://pi.dev), a terminal coding agent.

Run `~/.dotfiles/pi/setup` to symlink the theme and extensions into `~/.pi/agent/`.

## What's here

- `themes/dark-github.json` — GitHub dark theme, ported from [oh-my-pi](https://github.com/can1357/oh-my-pi). Carries pi's 51 required colour tokens plus the optional four, and keeps oh-my-pi's non-standard `statusLine*` tokens. Pi's schema ignores unknown tokens but still compiles them into its colour map, so an extension can read them via `theme.fg("statusLineModel", …)`. They land in the *foreground* map only — for a background, rewrite the SGR parameter: `getFgAnsi(t).replace("\x1b[38;", "\x1b[48;")`.
- `extensions/bash-box.ts` — draws a rounded box around bash tool calls, with an `── Output` divider and a wall-time footer. Uses `renderShell: "self"` plus `renderCall`/`renderResult`; execution delegates to the built-in bash tool. Configurable under `bashBox` in settings (`enabled`, `border`, `previewLines`).
- `extensions/permission-gate.ts` — confirms before running dangerous bash commands.

## Not here, on purpose

**`settings.json`** — pi rewrites it on every `pi install` and version bump, so it would churn; and it names internal repos, which don't belong in a public repo. Packages worth reinstalling on a new machine:

```bash
pi install npm:pi-web-access          # web search, fetch, GitHub repos, PDFs
pi install npm:pi-lens                # LSP diagnostics, linters, ast-grep
pi install npm:pi-hashline-edit-pro   # anchor-based read/replace/insert
pi install npm:pi-powerline-footer    # powerline status bar
pi install npm:pi-auto-session-name   # names sessions automatically
```

Then set `"theme": "dark-github"` (or pick it in `/settings`).

**`cmux-session.ts`** — installed and upgraded in place by `cmux hooks pi install`; it's cmux's artifact, not config.

**`auth.json`, `models-store.json`, `sessions/`, `npm/`, `git/`, `cache/`** — credentials and local state.
