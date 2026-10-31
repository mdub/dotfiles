# pi

Config for [pi](https://pi.dev), a terminal coding agent.

This directory is a local [pi package](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md). Run `~/.dotfiles/pi/setup` to register it with `pi install`. Pi loads the theme and extensions in place, so edits take effect on the next `/reload`, and new extensions are picked up without re-running setup.

## What's here

- `themes/mw-dark.json` — GitHub dark theme, ported from [oh-my-pi](https://github.com/can1357/oh-my-pi). Carries only tokens in pi's [theme schema](https://pi.dev/schemas/theme.schema.json): since pi 1.2.0, unknown colour tokens (such as oh-my-pi's `statusLine*`) make the theme invalid.
- `extensions/bash-box.ts` — draws a rounded box around bash tool calls, with an `── Output` divider and a wall-time footer. Uses `renderShell: "self"` plus `renderCall`/`renderResult`; execution delegates to the built-in bash tool. Configurable under `bashBox` in settings (`enabled`, `border`, `previewLines`).
- `extensions/permission-gate.ts` — confirms before running dangerous bash commands, including ones that skip git hooks (`--no-verify`, `git commit -n`, `LEFTHOOK=0`, overriding `core.hooksPath`).
- `extensions/agents-local.ts` — loads uncommitted `AGENTS.local.md` files into the project context, next to the `AGENTS.md` files pi already loads. It checks every directory from the working directory up to the filesystem root (as pi does for `AGENTS.md`), and re-reads the files before each agent run.
- `extensions/in-session-auto-name.ts` — gives the main model a `set_session_name` tool, with prompt guidelines to name the session after the first couple of prompts and update the name occasionally so it keeps summarising the topic. Guidelines alone rarely get acted on, so it also attaches a short hidden reminder to user prompts at Fibonacci spacing (prompts 1, 2, 3, 5, 8, 13, 21, …, gap capped at 21). The tool and guidelines are static and reminders are appended, so none of this breaks the prompt cache. It leaves names set with `/name` alone, and hides itself in sessions without a UI, such as sub-agents. `/auto-session-name [hint]` asks the model to rename now, overriding a `/name` name.
- `extensions/mw-auto-compact.ts` — compacts the session at each turn end once context reaches 80% of the model's window or 400k tokens, whichever comes first (override with `PI_MW_AUTO_COMPACT_PERCENT` and `PI_MW_AUTO_COMPACT_MAX_TOKENS`). Compacting aborts the in-flight request, so if the run was mid-task it sends a follow-up prompt to resume. Pi's built-in compaction remains the safety net near the real limit.

## Not here, on purpose

**`settings.json`** — pi rewrites it on every `pi install` and version bump, so it would churn; and it names internal repos, which don't belong in a public repo. Packages worth reinstalling on a new machine:

```bash
pi install npm:pi-web-access          # web search, fetch, GitHub repos, PDFs
pi install npm:pi-lens                # LSP diagnostics, linters, ast-grep
pi install npm:pi-hashline-edit-pro   # anchor-based read/replace/insert
pi install npm:pi-powerline-footer    # powerline status bar
```

Then set `"theme": "mw-dark"` (or pick it in `/settings`).

**`cmux-session.ts`** — installed and upgraded in place by `cmux hooks pi install`; it's cmux's artifact, not config.

**`auth.json`, `models-store.json`, `sessions/`, `npm/`, `git/`, `cache/`** — credentials and local state.
