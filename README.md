# Codex Beacon

Codex Beacon is a low-latency macOS companion for Codex interactive sessions.

It tracks open interactive Codex sessions, assigns each one a stable display name like `codex 1`, sends a macOS notification when a session returns control, and lets you click the notification to jump back to the terminal session that needs your next prompt.

## Goals

- keep the Codex hook path fast enough that it does not meaningfully slow active sessions
- support only interactive Codex sessions for the MVP
- give every active session a unique monotonic display name, unless the user provides a custom one
- summarize the latest session state in the notification body
- let a click focus the original macOS terminal window when possible
- clear the session notification as soon as the user prompts Codex again
- make installation easy for the main user now and other macOS users later

## MVP architecture

- a thin shell wrapper launches Codex and injects session metadata into the environment
- Codex hooks emit tiny JSON events on `SessionStart`, `UserPromptSubmit`, and `Stop`
- a background daemon receives hook events over a local Unix socket
- the daemon updates session state and shells out to `terminal-notifier` for notifications
- notification clicks run a local focus command that re-activates the terminal app and window

The hook path should do no heavy work. It should enqueue and return.

## Why this stack

The current repo uses Node + TypeScript for the MVP because:

- distribution is simple through npm for other users
- the hook handlers can be tiny and fast
- a detached daemon process is easy to manage on macOS
- AppleScript and `terminal-notifier` interop are straightforward from Node
- it keeps the iteration loop short while the product shape is still moving

A future native Swift helper remains a good optimization if the click-to-focus behavior needs tighter macOS integration.

## Installation target

### Main user path

1. Install Node.js 18 or newer.
2. `brew install terminal-notifier`
3. `npm install`
4. `npm run build`
5. `npm link`
6. `codex-beacon install --shell zsh`
7. Add the printed snippet to your shell rc file and reload the shell.

### Other users later

- `npm install -g codex-beacon`
- future Homebrew tap once the CLI stabilizes

## Planned shell UX

After install, the user should still type `codex`.

The shell wrapper will:

- intercept optional session naming flags like `--session-name` or `-N`
- preserve the real Codex binary path in `CODEX_BEACON_CODEX_BIN`
- capture terminal app, TTY, and best-effort window metadata
- register the launch with Codex Beacon
- exec the real Codex binary

Examples:

```bash
codex
codex -N api-migration
codex "build the MVP for the notification daemon"
```

## Current repo status

This repository contains a real scaffold for:

- session registry
- daemon socket server
- low-latency hook handlers
- terminal focus helpers
- install and shell integration generation
- markdown operating docs tailored for Codex

The session-summary extraction is intentionally conservative for the MVP. It reads the transcript tail when available and falls back to a generic ready/stopped message when structured parsing is insufficient.

The current focus path is best effort: it tries to match the original Terminal.app or iTerm2 session by TTY, then by recorded window id, then falls back to activating the terminal app.
