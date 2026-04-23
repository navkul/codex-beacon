import { readFileSync } from 'node:fs';
import { sendEvent } from './ipc.js';
import { HookPayload } from './types.js';

export async function runSessionStartHook(): Promise<void> {
  const payload = JSON.parse(readFileSync(0, 'utf8')) as HookPayload;
  const terminalApp = process.env.NAVEX_TERMINAL_APP || process.env.TERM_PROGRAM || undefined;
  const terminalSessionUniqueId =
    process.env.NAVEX_TERMINAL_SESSION_UNIQUE_ID
    || parseITermSessionUniqueId(process.env.ITERM_SESSION_ID)
    || parseITermSessionUniqueId(process.env.TERM_SESSION_ID);

  await sendEvent({
    type: 'register-session',
    sessionId: payload.session_id,
    cwd: payload.cwd,
    transcriptPath: payload.transcript_path,
    displayName: process.env.NAVEX_SESSION_NAME || undefined,
    launcherPid: parseNumber(process.env.NAVEX_LAUNCH_PID),
    terminalApp,
    terminalWindowId: process.env.NAVEX_TERMINAL_WINDOW_ID || undefined,
    terminalTabIndex: parseNumber(process.env.NAVEX_TERMINAL_TAB_INDEX),
    terminalSessionUniqueId,
    terminalTty: process.env.NAVEX_TERMINAL_TTY || undefined,
    timestamp: new Date().toISOString()
  });
}

function parseNumber(value?: string): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseITermSessionUniqueId(value?: string): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const candidate = value.split(':').at(-1)?.trim();
  return candidate || undefined;
}
