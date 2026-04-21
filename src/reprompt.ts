import { execFileSync } from 'node:child_process';
import { getSession } from './session-registry.js';
import { SessionRecord } from './types.js';

export function repromptSession(sessionId: string, message: string): void {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }

  const normalizedMessage = normalizePrompt(message);
  if (!normalizedMessage) {
    throw new Error('Reprompt message cannot be empty');
  }

  if (dispatchReprompt(session, normalizedMessage)) {
    return;
  }

  throw new Error(`Unable to deliver reprompt to session: ${session.displayName}`);
}

export function canRepromptSession(session: SessionRecord): boolean {
  const terminal = (session.terminalApp ?? '').toLowerCase();
  if (terminal.includes('iterm') || terminal.includes('terminal')) {
    return true;
  }
  if (terminal.includes('vscode') || terminal.includes('visual studio code') || terminal.includes('cursor')) {
    return false;
  }
  return Boolean(session.terminalSessionUniqueId || session.terminalTty || session.terminalWindowId);
}

function dispatchReprompt(session: SessionRecord, message: string): boolean {
  const terminal = (session.terminalApp ?? '').toLowerCase();

  if (terminal.includes('iterm')) {
    return repromptITermSession(session, message);
  }

  if (terminal.includes('terminal')) {
    return repromptTerminalSession(session, message);
  }

  if (terminal.includes('vscode') || terminal.includes('visual studio code') || terminal.includes('cursor')) {
    return false;
  }

  return repromptITermSession(session, message) || repromptTerminalSession(session, message);
}

function repromptITermSession(session: SessionRecord, message: string): boolean {
  return (
    repromptITermBySessionUniqueId(session.terminalSessionUniqueId, message) ||
    repromptITermByTty(session.terminalTty, message) ||
    repromptITermByWindowAndTab(session.terminalWindowId, session.terminalTabIndex, message) ||
    repromptITermByWindowId(session.terminalWindowId, message)
  );
}

function repromptTerminalSession(session: SessionRecord, message: string): boolean {
  return repromptTerminalByTty(session.terminalTty, message) || repromptTerminalByWindowId(session.terminalWindowId, message);
}

function repromptITermBySessionUniqueId(sessionUniqueId: string | undefined, message: string): boolean {
  if (!sessionUniqueId) {
    return false;
  }

  return runITermBooleanScript(`
  repeat with candidateWindow in windows
    repeat with candidateTab in tabs of candidateWindow
      repeat with candidateSession in sessions of candidateTab
        if unique id of candidateSession is ${appleScriptString(sessionUniqueId)} then
          tell candidateSession to write text ${appleScriptString(message)}
          return true
        end if
      end repeat
    end repeat
  end repeat
  return false
`);
}

function repromptITermByTty(tty: string | undefined, message: string): boolean {
  if (!tty) {
    return false;
  }

  return runITermBooleanScript(`
  repeat with candidateWindow in windows
    repeat with candidateTab in tabs of candidateWindow
      repeat with candidateSession in sessions of candidateTab
        if tty of candidateSession is ${appleScriptString(tty)} then
          tell candidateSession to write text ${appleScriptString(message)}
          return true
        end if
      end repeat
    end repeat
  end repeat
  return false
`);
}

function repromptITermByWindowAndTab(windowId: string | undefined, tabIndex: number | undefined, message: string): boolean {
  const id = parseAppleScriptInteger(windowId);
  const index = parseAppleScriptIndex(tabIndex);
  if (id === undefined || index === undefined) {
    return false;
  }

  return runITermBooleanScript(`
  repeat with candidateWindow in windows
    if id of candidateWindow is ${id} then
      if (count of tabs of candidateWindow) >= ${index} then
        tell current session of tab ${index} of candidateWindow to write text ${appleScriptString(message)}
        return true
      end if
    end if
  end repeat
  return false
`);
}

function repromptITermByWindowId(windowId: string | undefined, message: string): boolean {
  const id = parseAppleScriptInteger(windowId);
  if (!id) {
    return false;
  }

  return runITermBooleanScript(`
  repeat with candidateWindow in windows
    if id of candidateWindow is ${id} then
      tell current session of candidateWindow to write text ${appleScriptString(message)}
      return true
    end if
  end repeat
  return false
`);
}

function repromptTerminalByTty(tty: string | undefined, message: string): boolean {
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
        do script ${appleScriptString(message)} in candidateTab
        return true
      end if
    end repeat
  end repeat
  return false
end tell
`);
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

function parseAppleScriptInteger(value?: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseAppleScriptIndex(value?: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
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
