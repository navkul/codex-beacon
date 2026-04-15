import { execFileSync } from 'node:child_process';
import { getSession } from './session-registry.js';

function runAppleScript(script: string): boolean {
  try {
    execFileSync('osascript', ['-e', script], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function focusSession(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }

  const terminal = (session.terminalApp ?? '').toLowerCase();
  if (terminal.includes('iterm')) {
    if (focusITermByTty(session.terminalTty) || focusITermByWindowId(session.terminalWindowId)) {
      return;
    }
    focusITerm();
    return;
  }

  if (focusTerminalByTty(session.terminalTty) || focusTerminalByWindowId(session.terminalWindowId)) {
    return;
  }
  focusTerminal();
}

function focusTerminal(): void {
  runAppleScript('tell application "Terminal" to activate');
}

function focusITerm(): void {
  if (!runAppleScript('tell application "iTerm2" to activate')) {
    runAppleScript('tell application "iTerm" to activate');
  }
}

function focusTerminalByWindowId(windowId?: string): boolean {
  const id = parseAppleScriptInteger(windowId);
  if (!id) {
    return false;
  }
  return runAppleScript(`
tell application "Terminal"
  activate
  repeat with candidateWindow in windows
    if id of candidateWindow is ${id} then
      set index of candidateWindow to 1
      return
    end if
  end repeat
end tell
`);
}

function focusTerminalByTty(tty?: string): boolean {
  if (!tty) {
    return false;
  }
  return runAppleScript(`
tell application "Terminal"
  activate
  repeat with candidateWindow in windows
    repeat with candidateTab in tabs of candidateWindow
      if tty of candidateTab is ${appleScriptString(tty)} then
        set selected tab of candidateWindow to candidateTab
        set index of candidateWindow to 1
        return
      end if
    end repeat
  end repeat
end tell
`);
}

function focusITermByWindowId(windowId?: string): boolean {
  const id = parseAppleScriptInteger(windowId);
  if (!id) {
    return false;
  }
  return runITermScript(`
  repeat with candidateWindow in windows
    if id of candidateWindow is ${id} then
      set index of candidateWindow to 1
      return
    end if
  end repeat
`);
}

function focusITermByTty(tty?: string): boolean {
  if (!tty) {
    return false;
  }
  return runITermScript(`
  repeat with candidateWindow in windows
    repeat with candidateTab in tabs of candidateWindow
      repeat with candidateSession in sessions of candidateTab
        if tty of candidateSession is ${appleScriptString(tty)} then
          select candidateWindow
          select candidateTab
          select candidateSession
          return
        end if
      end repeat
    end repeat
  end repeat
`);
}

function runITermScript(body: string): boolean {
  const script = `
tell application "iTerm2"
  activate
${body}
end tell
`;
  if (runAppleScript(script)) {
    return true;
  }
  return runAppleScript(script.replace('"iTerm2"', '"iTerm"'));
}

function parseAppleScriptInteger(value?: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
