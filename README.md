# Navex

Navex is my personal macOS Codex session manager.

I built it for my own workflow and made the repo public in case it is useful to someone else. It is still opinionated and personal-use-first rather than a polished general product.

Current scope:

- macOS only
- interactive Codex sessions only
- local machine only
- no `codex exec`
- no cross-machine sync

## Features

- tracks interactive Codex sessions launched through the wrapper
- stable session names, plus custom names with `codex -N <name>`
- native menu-bar overlay for waiting sessions
- compact transcript-tail summaries
- focuses the originating terminal session from the overlay
- clears the waiting item on the next prompt submit
- persisted local state across daemon/helper restarts
- drag-to-reorder waiting sessions
- dismiss controls per session
- inline reprompt for Terminal.app and iTerm2
- overlay header usage summary
- config for app label, width, and summary behavior

Terminal support is centered on:

- Terminal.app
- iTerm2

## Install

1. Install Node.js 18+.
2. Install Xcode Command Line Tools so `swiftc` is available.
3. Clone this repo.
4. Run:

```bash
npm install
npm run build
npm link
```

5. Print the setup output:

```bash
navex install --shell zsh
```

6. Add the printed shell wrapper to `~/.zshrc`.
7. Write the printed hook JSON to `~/.codex/hooks.json`.
8. Make sure `~/.codex/config.toml` has:

```toml
[features]
codex_hooks = true
```

9. Reload your shell:

```bash
source ~/.zshrc
```

After setup, you keep using `codex`.

## Usage

Start a tracked session:

```bash
codex
```

Start one with a custom name:

```bash
codex -N api-migration
```

When Codex stops, Navex shows the waiting session in the overlay. You can focus it, dismiss it, reorder it, or reprompt inline when the terminal supports it. When you send the next prompt in that session, the waiting item clears automatically.

## Commands

List tracked sessions:

```bash
navex sessions
```

Show config:

```bash
navex config show
```

Print config path:

```bash
navex config path
```

Set the menu-bar / overlay label:

```bash
navex config set appDisplayName "Arnav"
```

Tune the overlay:

```bash
navex config set overlayWidth 420
navex config set overlayShowSummary true
navex config set overlaySummaryStyle smart
navex config set overlaySummaryMaxWords 18
navex config set overlaySummaryMaxChars 140
```

## Local state

Navex stores local state in `~/.navex/`.

Useful files there:

- `config.json`
- `registry.json`
- `overlay-state.json`
- `overlay-snapshot.json`
- `overlay-helper.log`
