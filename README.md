# Navex

Navex is my personal macOS Codex session manager.

I built it for my own workflow and made the repo public in case it is useful to someone else. It is still opinionated and personal-use-first rather than a polished general product.

Current scope:

- macOS only
- Codex Desktop and interactive Codex CLI sessions
- local machine only
- no `codex exec`
- no cross-machine sync

## Features

- tracks Codex Desktop and CLI sessions through supported lifecycle hooks
- uses Codex thread and turn IDs rather than terminal processes as identity
- native menu-bar overlay for working and finished agents
- explicit `navex overlay show|hide|toggle` control for the floating overlay
- global overlay hotkey, defaulting to `cmd+option+k`
- compact summaries from the supported `Stop.last_assistant_message` field
- opens the exact Codex Desktop task or focuses the originating terminal session
- updates finished agents back to working when you submit the next prompt
- persisted local state across daemon/helper restarts
- drag-to-reorder tracked agents
- completion alerts that bring the overlay forward
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

6. Write the printed hook JSON to `~/.codex/hooks.json`.
7. Make sure `~/.codex/config.toml` has:

```toml
[features]
hooks = true
```

8. Codex requires hook trust review after hook commands change. Start a new Codex session, run `/hooks`, and trust the Navex `SessionStart`, `UserPromptSubmit`, `Stop`, `Interrupt`, and `SessionEnd` hooks.

No shell wrapper is required. Restart Codex Desktop after installing the hooks so new Desktop tasks load them.

## Usage

Start a tracked CLI session normally:

```bash
codex
```

Or start a task normally in Codex Desktop. Both surfaces use the same working/done lifecycle in Navex.

The optional compatibility launcher can attach a custom name and additional terminal metadata:

```bash
navex launch -N api-migration
```

When an agent finishes, Navex brings the overlay forward with its final message summary. Use the open button to return to the exact Desktop task or originating terminal, then continue there. Navex does not accept commands or submit prompts from the overlay.

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
