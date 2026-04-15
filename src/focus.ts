import { execFileSync } from 'node:child_process';
import { getSession } from './session-registry.js';

function runAppleScript(script: string): void {
  execFileSync('osascript', ['-e', script]);
}

export function focusSession(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }

  const terminal = (session.terminalApp ?? '').toLowerCase();
  if (terminal.includes('iterm')) {
    focusITerm();
    return;
  }
  focusTerminal();
}

function focusTerminal(): void {
  runAppleScript('tell application "Terminal" to activate');
}

function focusITerm(): void {
  runAppleScript('tell application "iTerm" to activate');
}
