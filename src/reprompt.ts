import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { ensureAppRoot } from './config.js';
import { getSession } from './session-registry.js';
import { SessionRecord } from './types.js';

type RepromptDelivery = 'confirmed' | 'failed';
type RepromptResult = { ok: true } | { ok: false; error: string };

const ITERM_SCRIPT_NAME = 'NavexReprompt.py';
const ITERM_SCRIPTS_DIR = path.join(homedir(), 'Library', 'Application Support', 'iTerm2', 'Scripts');
const ITERM_SCRIPT_PATH = path.join(ITERM_SCRIPTS_DIR, ITERM_SCRIPT_NAME);
const ITERM_RESULT_TIMEOUT_MS = 5000;
const ITERM_RESULT_POLL_MS = 50;
const ITERM_SCRIPT = `#!/usr/bin/env python3
import asyncio
import json
import os
import sys
import traceback

import AppKit
import Quartz
import iterm2


SESSION_HINT = sys.argv[1]
WINDOW_ID = sys.argv[2]
TAB_INDEX = sys.argv[3]
PAYLOAD = sys.argv[4]
RESULT_PATH = sys.argv[5]


def write_result(ok, error=None):
    os.makedirs(os.path.dirname(RESULT_PATH), exist_ok=True)
    with open(RESULT_PATH, "w", encoding="utf-8") as handle:
        json.dump({"ok": ok, "error": error}, handle)


def parse_tab_index(raw):
    try:
        return int(raw)
    except Exception:
        return 0


def iterm_pid():
    running = AppKit.NSRunningApplication.runningApplicationsWithBundleIdentifier_("com.googlecode.iterm2")
    if running and len(running) > 0:
        return running[0].processIdentifier()
    return None


def post_character(pid, character):
    source = Quartz.CGEventSourceCreate(Quartz.kCGEventSourceStateCombinedSessionState)
    if source is None:
        raise RuntimeError("Unable to create keyboard event source")

    down = Quartz.CGEventCreateKeyboardEvent(source, 0, True)
    up = Quartz.CGEventCreateKeyboardEvent(source, 0, False)
    if down is None or up is None:
        raise RuntimeError("Unable to create keyboard events")

    Quartz.CGEventKeyboardSetUnicodeString(down, len(character), character)
    Quartz.CGEventKeyboardSetUnicodeString(up, len(character), character)
    Quartz.CGEventPostToPid(pid, down)
    Quartz.CGEventPostToPid(pid, up)


def post_return(pid):
    source = Quartz.CGEventSourceCreate(Quartz.kCGEventSourceStateCombinedSessionState)
    if source is None:
        raise RuntimeError("Unable to create return-key source")

    down = Quartz.CGEventCreateKeyboardEvent(source, 36, True)
    up = Quartz.CGEventCreateKeyboardEvent(source, 36, False)
    if down is None or up is None:
        raise RuntimeError("Unable to create return-key events")

    Quartz.CGEventKeyboardSetUnicodeString(down, 1, "\\r")
    Quartz.CGEventKeyboardSetUnicodeString(up, 1, "\\r")
    Quartz.CGEventPostToPid(pid, down)
    Quartz.CGEventPostToPid(pid, up)


async def resolve_session(connection):
    app = await iterm2.async_get_app(connection)
    if SESSION_HINT:
        session = app.get_session_by_id(SESSION_HINT)
        if session is not None:
            return session
        return None

    if WINDOW_ID:
        window = app.get_window_by_id(WINDOW_ID)
        tab_index = parse_tab_index(TAB_INDEX) - 1
        if window is not None and 0 <= tab_index < len(window.tabs):
            tab = window.tabs[tab_index]
            if tab.current_session is not None:
                return tab.current_session

    return None


async def main(connection):
    session = await resolve_session(connection)
    if session is None:
        write_result(False, "iTerm session not found")
        return

    await session.async_activate(select_tab=True, order_window_front=False)
    await asyncio.sleep(0.05)

    pid = iterm_pid()
    if pid is None:
        write_result(False, "Unable to resolve iTerm process")
        return

    for character in PAYLOAD:
        post_character(pid, character)
    await asyncio.sleep(0.12)
    post_return(pid)
    write_result(True)


try:
    iterm2.run_until_complete(main)
except Exception as exc:
    detail = "".join(traceback.format_exception_only(type(exc), exc)).strip() or "Unknown iTerm Python API failure"
    write_result(False, detail)
`;

export async function repromptSession(sessionId: string, message: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }

  const normalizedMessage = normalizePrompt(message);
  if (!normalizedMessage) {
    throw new Error('Reprompt message cannot be empty');
  }

  const delivery = await dispatchReprompt(session, normalizedMessage);
  if (delivery === 'failed') {
    throw new Error(`Unable to deliver reprompt to session: ${session.displayName}`);
  }

}

export function canRepromptSession(session: SessionRecord): boolean {
  const terminal = (session.terminalApp ?? '').toLowerCase();
  if (terminal.includes('iterm')) {
    return Boolean(session.terminalSessionUniqueId);
  }
  if (terminal.includes('terminal')) {
    return true;
  }
  if (terminal.includes('vscode') || terminal.includes('visual studio code') || terminal.includes('cursor')) {
    return false;
  }
  return Boolean(session.terminalSessionUniqueId || session.terminalWindowId);
}

async function dispatchReprompt(session: SessionRecord, message: string): Promise<RepromptDelivery> {
  const terminal = (session.terminalApp ?? '').toLowerCase();
  if (terminal.includes('iterm')) {
    return (await repromptITermSession(session, message)) ? 'confirmed' : 'failed';
  }

  if (terminal.includes('terminal')) {
    return repromptTerminalSession(session, message) ? 'confirmed' : 'failed';
  }

  if (terminal.includes('vscode') || terminal.includes('visual studio code') || terminal.includes('cursor')) {
    return 'failed';
  }

  if (await repromptITermSession(session, message)) {
    return 'confirmed';
  }
  return repromptTerminalSession(session, message) ? 'confirmed' : 'failed';
}

async function repromptITermSession(session: SessionRecord, message: string): Promise<boolean> {
  ensureITermRepromptScript();
  const resultPath = path.join(ensureAppRoot(), `iterm-reprompt-${randomUUID()}.json`);
  rmSync(resultPath, { force: true });

  try {
    launchITermRepromptScript(session, message, resultPath);
    const result = await waitForITermRepromptResult(resultPath);
    if (!result.ok) {
      throw new Error(result.error);
    }
    return true;
  } finally {
    rmSync(resultPath, { force: true });
  }
}

function repromptTerminalSession(session: SessionRecord, message: string): boolean {
  return repromptTerminalByWindowId(session.terminalWindowId, message);
}

function repromptTerminalByWindowId(windowId: string | undefined, message: string): boolean {
  const id = parseAppleScriptInteger(windowId);
  if (!id) {
    return false;
  }

  return runAppleScriptBoolean(`
if application id "com.apple.Terminal" is not running then
  return false
end if
tell application "Terminal"
  repeat with candidateWindow in windows
    if id of candidateWindow is ${id} then
      do script ${appleScriptString(message)} in selected tab of candidateWindow
      return true
    end if
  end repeat
  return false
end tell
`);
}

function ensureITermRepromptScript(): void {
  mkdirSync(ITERM_SCRIPTS_DIR, { recursive: true });
  const current = existsSync(ITERM_SCRIPT_PATH) ? readFileSync(ITERM_SCRIPT_PATH, 'utf8') : null;
  if (current === ITERM_SCRIPT) {
    return;
  }
  writeFileSync(ITERM_SCRIPT_PATH, ITERM_SCRIPT, { mode: 0o755 });
}

function launchITermRepromptScript(session: SessionRecord, message: string, resultPath: string): void {
  const windowId = session.terminalWindowId?.trim() ?? '';
  const tabIndex = parseAppleScriptIndex(session.terminalTabIndex)?.toString() ?? '';
  const sessionHint = session.terminalSessionUniqueId?.trim() ?? '';
  const payload = message;
  const scriptName = appleScriptString(ITERM_SCRIPT_NAME);
  const args = [sessionHint, windowId, tabIndex, payload, resultPath].map(appleScriptString).join(', ');
  const script = `
if application id "com.googlecode.iterm2" is not running then
  error "iTerm is not running"
end if
tell application "iTerm2"
  launch API script named ${scriptName} arguments {${args}}
end tell
`;

  try {
    runAppleScript(script);
  } catch (primaryError) {
    try {
      runAppleScript(script.replace('"iTerm2"', '"iTerm"'));
    } catch {
      throw improveITermLaunchError(primaryError);
    }
  }
}

async function waitForITermRepromptResult(resultPath: string): Promise<RepromptResult> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ITERM_RESULT_TIMEOUT_MS) {
    if (existsSync(resultPath)) {
      try {
        const parsed = JSON.parse(readFileSync(resultPath, 'utf8')) as { ok?: boolean; error?: string };
        if (parsed.ok === true) {
          return { ok: true };
        }
        return { ok: false, error: parsed.error?.trim() || 'Unknown iTerm reprompt failure' };
      } catch {
        return { ok: false, error: 'Invalid iTerm reprompt result' };
      }
    }
    await delay(ITERM_RESULT_POLL_MS);
  }

  return {
    ok: false,
    error: `Timed out waiting for iTerm reprompt result. Restart iTerm once so it discovers ${ITERM_SCRIPT_NAME}, then try again.`
  };
}

function runAppleScript(script: string): string {
  try {
    return execFileSync('osascript', ['-e', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    throw extractExecError(error);
  }
}

function runAppleScriptBoolean(script: string): boolean {
  try {
    return runAppleScript(script).trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

function improveITermLaunchError(error: unknown): Error {
  const message = extractExecError(error).message;
  if (message.includes('Script not found')) {
    return new Error(`iTerm has not loaded ${ITERM_SCRIPT_NAME} yet. Restart iTerm once, then try reprompt again.`);
  }
  if (message.includes('User canceled')) {
    return new Error('iTerm Python API launch was canceled. Enable Python API in iTerm settings, then retry.');
  }
  return new Error(`Unable to launch iTerm reprompt helper: ${message}`);
}

function extractExecError(error: unknown): Error {
  if (error instanceof Error) {
    const withStderr = error as Error & { stderr?: string | Buffer };
    const stderr = typeof withStderr.stderr === 'string' ? withStderr.stderr.trim() : withStderr.stderr?.toString().trim();
    if (stderr) {
      return new Error(stderr);
    }
    return error;
  }
  return new Error(String(error));
}

function parseAppleScriptInteger(value?: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseAppleScriptIndex(value?: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizePrompt(message: string): string {
  return message
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
