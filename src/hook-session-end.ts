import { readFileSync } from 'node:fs';
import { sendEvent } from './ipc.js';
import { detectSessionOrigin } from './session-origin.js';
import { HookPayload } from './types.js';

export async function runSessionEndHook(): Promise<void> {
  const payload = JSON.parse(readFileSync(0, 'utf8')) as HookPayload;
  const origin = detectSessionOrigin();
  await sendEvent({
    type: 'session-end',
    sessionId: payload.session_id,
    cwd: payload.cwd,
    surface: origin.surface,
    navigationPrecision: origin.navigationPrecision,
    terminalApp: origin.terminalApp,
    terminalSessionUniqueId: origin.terminalSessionUniqueId,
    terminalTty: origin.terminalTty,
    timestamp: new Date().toISOString()
  });
}
