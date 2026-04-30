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

function runAppleScriptBoolean(script: string): boolean {
  try {
    const output = execFileSync('osascript', ['-e', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim().toLowerCase();
    return output === 'true';
  } catch {
    return false;
  }
}

export function focusSession(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }

  if (session.kind === 'cloud-task') {
    focusCloudTask(session);
    return;
  }

  const terminal = (session.terminalApp ?? '').toLowerCase();
  if (terminal.includes('iterm')) {
    if (focusITermSession(session)) {
      return;
    }
    throw new Error(`Unable to locate the original iTerm session for ${session.displayName}`);
  }

  if (terminal.includes('vscode') || terminal.includes('visual studio code')) {
    focusVSCode();
    return;
  }

  if (terminal.includes('cursor')) {
    focusCursor();
    return;
  }

  if (terminal.includes('terminal')) {
    if (focusTerminalSession(session)) {
      return;
    }
    throw new Error(`Unable to locate the original Terminal.app window for ${session.displayName}`);
  }

  if (focusITermSession(session) || focusTerminalSession(session)) {
    return;
  }

  if (!terminal && (session.terminalSessionUniqueId || session.terminalTty || session.terminalWindowId)) {
    throw new Error(`Unable to locate a live terminal target for session: ${sessionId}`);
  }

  if (focusVSCodeIfRunning() || focusCursorIfRunning()) {
    return;
  }

  throw new Error(`Unable to locate a live terminal target for session: ${sessionId}`);
}

function focusCloudTask(session: NonNullable<ReturnType<typeof getSession>>): void {
  const url = session.cloudTask?.url;
  if (!url) {
    throw new Error(`No Codex Cloud URL known for ${session.displayName}`);
  }
  execFileSync('open', [url], { stdio: 'ignore' });
}

function focusITermBySessionUniqueId(sessionUniqueId?: string): boolean {
  if (!sessionUniqueId) {
    return false;
  }
  return runITermBooleanScript(`
  repeat with candidateWindow in windows
    repeat with candidateTab in tabs of candidateWindow
      repeat with candidateSession in sessions of candidateTab
        if unique id of candidateSession is ${appleScriptString(sessionUniqueId)} then
          activate
          select candidateWindow
          select candidateTab
          select candidateSession
          return true
        end if
      end repeat
    end repeat
  end repeat
  return false
`);
}

function focusVSCode(): void {
  if (!activateBundle('com.microsoft.VSCode')) {
    runAppleScript('tell application "Visual Studio Code" to activate');
  }
}

function focusVSCodeIfRunning(): boolean {
  return activateBundleIfRunning('com.microsoft.VSCode');
}

function focusCursor(): void {
  if (!activateBundle('com.todesktop.230313mzl4w4u92')) {
    runAppleScript('tell application "Cursor" to activate');
  }
}

function focusCursorIfRunning(): boolean {
  return activateBundleIfRunning('com.todesktop.230313mzl4w4u92');
}

function activateBundle(bundleId: string): boolean {
  try {
    execFileSync('open', ['-b', bundleId], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function activateBundleIfRunning(bundleId: string): boolean {
  if (!isBundleRunning(bundleId)) {
    return false;
  }
  return activateBundle(bundleId);
}

function isBundleRunning(bundleId: string): boolean {
  try {
    const output = execFileSync('osascript', ['-e', `application id "${bundleId}" is running`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim().toLowerCase();
    return output === 'true';
  } catch {
    return false;
  }
}

function focusTerminalByWindowId(windowId?: string): boolean {
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
      activate
      set index of candidateWindow to 1
      return true
    end if
  end repeat
  return false
end tell
`);
}

function focusTerminalByTty(tty?: string): boolean {
  if (!tty) {
    return false;
  }
  return runAppleScriptBoolean(`
if application id "com.apple.Terminal" is not running then
  return false
end if
tell application "Terminal"
  repeat with candidateWindow in windows
    repeat with candidateTab in tabs of candidateWindow
      if tty of candidateTab is ${appleScriptString(tty)} then
        activate
        set selected tab of candidateWindow to candidateTab
        set index of candidateWindow to 1
        return true
      end if
    end repeat
  end repeat
  return false
end tell
`);
}

function focusITermByWindowId(windowId?: string): boolean {
  const id = parseAppleScriptInteger(windowId);
  if (!id) {
    return false;
  }
  return runITermBooleanScript(`
  repeat with candidateWindow in windows
    if id of candidateWindow is ${id} then
      activate
      set index of candidateWindow to 1
      return true
    end if
  end repeat
  return false
`);
}

function focusITermByWindowAndTab(windowId?: string, tabIndex?: number): boolean {
  const id = parseAppleScriptInteger(windowId);
  const index = parseAppleScriptIndex(tabIndex);
  if (id === undefined || index === undefined) {
    return false;
  }
  return runITermBooleanScript(`
  repeat with candidateWindow in windows
    if id of candidateWindow is ${id} then
      if (count of tabs of candidateWindow) >= ${index} then
        set candidateTab to tab ${index} of candidateWindow
        activate
        select candidateWindow
        select candidateTab
        return true
      end if
    end if
  end repeat
  return false
`);
}

function focusITermByTty(tty?: string): boolean {
  if (!tty) {
    return false;
  }
  return runITermBooleanScript(`
  repeat with candidateWindow in windows
    repeat with candidateTab in tabs of candidateWindow
      repeat with candidateSession in sessions of candidateTab
        if tty of candidateSession is ${appleScriptString(tty)} then
          activate
          select candidateWindow
          select candidateTab
          select candidateSession
          return true
        end if
      end repeat
    end repeat
  end repeat
  return false
`);
}

function runITermBooleanScript(body: string): boolean {
  const script = `
if application id "com.googlecode.iterm2" is not running then
  return false
end if
tell application "iTerm2"
${body}
end tell
`;
  if (runAppleScriptBoolean(script)) {
    return true;
  }
  return runAppleScriptBoolean(script.replace('"iTerm2"', '"iTerm"'));
}

function focusITermSession(session: NonNullable<ReturnType<typeof getSession>>): boolean {
  return (
    focusITermBySessionUniqueId(session.terminalSessionUniqueId) ||
    focusITermByTty(session.terminalTty) ||
    focusITermByWindowAndTab(session.terminalWindowId, session.terminalTabIndex) ||
    focusITermByWindowId(session.terminalWindowId)
  );
}

function focusTerminalSession(session: NonNullable<ReturnType<typeof getSession>>): boolean {
  return focusTerminalByTty(session.terminalTty) || focusTerminalByWindowId(session.terminalWindowId);
}

function parseAppleScriptInteger(value?: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseAppleScriptIndex(value?: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
