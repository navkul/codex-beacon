import { readFileSync } from 'node:fs';
import { sendEvent } from './ipc.js';
import { HookPayload } from './types.js';

export async function runSessionStartHook(): Promise<void> {
  const payload = JSON.parse(readFileSync(0, 'utf8')) as HookPayload;
  await sendEvent({
    type: 'register-session',
    sessionId: payload.session_id,
    cwd: payload.cwd,
    transcriptPath: payload.transcript_path,
    displayName: process.env.CODEX_BEACON_SESSION_NAME || undefined,
    terminalApp: process.env.CODEX_BEACON_TERMINAL_APP || undefined,
    terminalWindowId: process.env.CODEX_BEACON_TERMINAL_WINDOW_ID || undefined,
    terminalTabIndex: parseNumber(process.env.CODEX_BEACON_TERMINAL_TAB_INDEX),
    terminalSessionUniqueId: process.env.CODEX_BEACON_TERMINAL_SESSION_UNIQUE_ID || undefined,
    terminalTty: process.env.CODEX_BEACON_TERMINAL_TTY || undefined,
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
