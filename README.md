# Codex Beacon

Codex Beacon is a low-latency macOS companion for Codex interactive sessions.

It tracks open interactive Codex sessions, assigns each one a stable display name like `codex 1`, opens a custom macOS menu-bar overlay when a session returns control, and lets you click the overlay row to jump back to the terminal session that needs your next prompt.

## Goals

- keep the Codex hook path fast enough that it does not meaningfully slow active sessions
- support only interactive Codex sessions for the MVP
- give every active session a unique monotonic display name, unless the user provides a custom one
- summarize the latest session state in the overlay row
- let the user reorder the waiting queue and dismiss rows cleanly
- show a compact view of the latest Codex rate-limit usage seen by that session
- let the user inline-reprompt a waiting session without focusing the terminal when the terminal app supports it
- let a click focus the original macOS terminal window when possible
- clear the session overlay row as soon as the user prompts Codex again
- make installation easy for the main user now and other macOS users later

## MVP architecture

- a thin shell wrapper launches Codex and injects session metadata into the environment
- Codex hooks emit tiny JSON events on `SessionStart`, `UserPromptSubmit`, and `Stop`
- a background daemon receives hook events over a local Unix socket
- the daemon updates session state, persists the rendered overlay model, and ensures a native Swift menu-bar helper window is running
- overlay row clicks run a local focus command that re-activates the terminal app and window

The hook path should do no heavy work. It should enqueue and return.

## Why this stack

The current repo uses Node + TypeScript for the MVP because:

- clone-plus-link distribution is simple for local use
- the hook handlers can be tiny and fast
- a detached daemon process is easy to manage on macOS
- AppleScript interop is straightforward from Node
- a small Swift helper gives Beacon a custom local UI without rewriting hook and daemon logic
- it keeps the iteration loop short while the product shape is still moving

The native Swift helper is now part of the MVP path. Mac App Store packaging is not required for the current clone-and-link workflow.

## Installation target

### Main user path

1. Install Node.js 18 or newer.
2. Install Xcode Command Line Tools so `swiftc` is available.
3. `npm install`
4. `npm run build`
5. `npm link`
6. `codex-beacon install --shell zsh`
7. Add the printed snippet to your shell rc file and reload the shell.

### Other clone users later

- clone this repo
- run the same local install steps
- use `npm link`

## Planned shell UX

After install, the user should still type `codex`.

The shell wrapper will:

- intercept optional session naming flags like `--session-name` or `-N`
- preserve the real Codex binary path in `CODEX_BEACON_CODEX_BIN`
- capture terminal app, TTY, and best-effort window metadata
- capture iTerm tab index and session unique id when available
- register the launch with Codex Beacon
- exec the real Codex binary

Examples:

```bash
codex
codex -N api-migration
codex "build the MVP for the overlay daemon"
```

## Current repo status

This repository contains a real scaffold for:

- session registry
- daemon socket server
- low-latency hook handlers
- terminal focus helpers
- install and shell integration generation
- native Swift menu-bar and overlay helper
- markdown operating docs tailored for Codex

The session-summary extraction is intentionally conservative for the MVP. It reads the transcript tail when available and falls back to a generic ready/stopped message when structured parsing is insufficient.

The current summary path is local and deterministic:

- parse assistant text from the Codex JSONL transcript tail
- skip generic fragments such as `Done.`
- classify the turn as `done`, `blocked`, `failed`, `needs-input`, or `ready`
- prefer a stronger sentence or bullet
- apply configured whole-word limits

You can inspect or tune the main overlay settings with:

```bash
codex-beacon config show
codex-beacon config set overlayWidth 420
codex-beacon config set overlayShowSummary false
codex-beacon config set overlaySummaryStyle raw
codex-beacon config set overlaySummaryMaxWords 18
codex-beacon config set overlaySummaryMaxChars 140
```

The overlay now also carries:

- a drag handle for queue ordering
- a compact usage meter based on the latest transcript `token_count` snapshot
- an inline one-line reprompt field for iTerm/iTerm2 and Terminal.app sessions

Beacon now persists the rendered overlay model in `~/.codex-beacon/overlay-snapshot.json`, so restarting the daemon/helper can repopulate current waiting sessions instead of coming back empty.

The helper now bootstraps directly from that persisted snapshot on startup. It no longer depends on live stdin event timing to render the first visible overlay state after a restart.

The visible macOS surface is currently a plain borderless helper window anchored under the `Beacon` status item. That path replaced the earlier panel/popover variants because it was materially more reliable in real compositor captures.

The helper also no longer sets custom borderless-window `collectionBehavior` flags during startup. That behavior turned out to stall helper initialization on restart; the simpler window setup path is the stable one here.

To keep the overlay visible outside the terminal's original desktop, Beacon now applies `canJoinAllSpaces` only when the overlay is shown. That keeps startup stable while making the queue behave more like a global menu-bar surface.

The helper now treats persisted waiting sessions as passive state. Restarting Beacon no longer auto-opens the overlay just because old waiting sessions still exist in `overlay-snapshot.json`; the panel only auto-opens when a fresh stop event adds a new waiting session.

`UserPromptSubmit` can still wake the daemon if it was not running, but daemon recovery now rebuilds the snapshot quietly instead of replaying old waiting sessions as visible notifications.

The overlay itself now sits in the active screen's top-right corner, and the header labels are pinned to the top of the panel.

Usage is now shown once in the overlay header instead of as a repeated battery widget in every row. Beacon uses the latest available account usage snapshot from the waiting sessions and renders:

- 5-hour remaining percent
- weekly remaining percent
- reset times

The header block uses compact monospaced text rather than a graphical battery so it stays closer to Codex's own status style without adding row clutter.

The overlay now uses that same monospaced system font throughout instead of limiting it to the usage block, and the weekly line no longer shows a `wk` prefix.

Rows now use explicit trailing controls instead of full-row focus:

- `x` dismisses the row
- the arrow button under it focuses the terminal session

Rows are still reorderable, but dragging now works from the row body rather than from a dedicated handle icon. The status dot also now sits to the right of the session name.

If you need to debug helper visibility, inspect:

```bash
tail -n 100 ~/.codex-beacon/overlay-helper.log
```

Inline reprompt uses terminal-native AppleScript delivery and does not require focusing the destination terminal window first.

The current focus path is strict for terminal-backed sessions:

- Terminal.app: tty, then window id
- iTerm2: session unique id, then tty, then window plus tab, then window id

Beacon now fails closed when a recorded terminal target cannot be found live. It no longer treats a successful AppleScript run as proof that the original session was located. VS Code and Cursor integrated terminals still use app-level focus only.

The active UI direction is a custom local menu-bar and overlay helper built from [macos/CodexBeaconOverlay.swift](/Users/arnavkulkarni/Developer/codex-beacon/macos/CodexBeaconOverlay.swift). It is intended for clone-plus-link use first; Mac App Store packaging is not required for the current workflow.
