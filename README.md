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
- explicit `navex overlay show|hide|toggle` control for the floating overlay
- global overlay hotkey, defaulting to `cmd+option+k`
- compact transcript-tail summaries
- focuses the originating terminal session from the overlay
- clears the waiting item on the next prompt submit
- persisted local state across daemon/helper restarts
- drag-to-reorder waiting sessions
- inline reprompt for Terminal.app and iTerm2
- overlay header usage summary
- config for app label, width, and summary behavior
- tracked `navex fork --session-id <id>` for one-session terminal windows

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
hooks = true
```

9. Codex 0.130+ requires hook trust review after hook commands change. Start a new Codex session, run `/hooks`, and trust the Navex `SessionStart`, `UserPromptSubmit`, and `Stop` hooks.

10. Reload your shell:

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

When Codex stops, Navex shows the waiting session in the overlay. You can focus it, reorder it, or reprompt inline when the terminal supports it. Inline reprompts show `Submitting.` immediately, switch to `Working.` after Codex accepts the prompt, and show `Reprompt not confirmed` if the session never starts. When you send the next prompt in that session, the waiting item clears automatically.

## Commands

List tracked sessions:

```bash
navex sessions
```

Show, hide, or toggle the overlay:

```bash
navex overlay show
navex overlay hide
navex overlay toggle
```

Keep the helper running after macOS login so the global hotkey works before any sessions exist:

```bash
navex overlay install-login
```

Overlay command line:

```text
/working-dir Developer
/init
/init -2
/init --project navex -6 --profile god
```

`/working-dir` is saved in `~/.navex/overlay-state.json` and reused by future overlay commands. `/init` launches from the saved working directory, `/init --project navex` resolves to the saved working directory plus `navex`, and `/init --path ~/Developer/navex` bypasses the saved base directory. `/init` forwards Codex arguments such as `--profile god` to `navex launch`; iTerm windows use the default iTerm profile.

Fork a tracked session into a new split-screen terminal window:

```bash
navex fork --session-id <session-id>
```

The fork command requires one tracked Codex session in one Terminal.app or iTerm2 window. It fails closed for ambiguous windows with multiple tabs, split panes, or duplicate tracked sessions. If Codex exposes submitted slash-command text in hook payloads, typing `/fork` in the Codex composer triggers the same coordinator.

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
navex config set overlayHotkey "cmd+option+k"
navex config set overlayWidth 420
navex config set overlayShowSummary true
navex config set overlaySummaryStyle smart
navex config set overlaySummaryMaxWords 18
navex config set overlaySummaryMaxChars 140
```

Disable the global hotkey:

```bash
navex config set overlayHotkey null
```

## Local state

Navex stores local state in `~/.navex/`.

Useful files there:

- `config.json`
- `registry.json`
- `overlay-control.json`
- `overlay-state.json`
- `overlay-snapshot.json`
- `overlay-helper.log`
