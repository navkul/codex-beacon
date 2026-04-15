import { spawnSync } from 'node:child_process';
import { loadConfig } from './config.js';
import { SessionRecord } from './types.js';

function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

export function sendSessionNotification(session: SessionRecord): void {
  const config = loadConfig();
  const message = truncate(session.lastSummary ?? 'Codex is ready for your next prompt.', config.maxNotificationChars);
  const execute = `codex-beacon focus --session-id ${shellEscape(session.sessionId)}`;
  spawnSync(config.notifierCommand, [
    '-title',
    session.displayName,
    '-message',
    message,
    '-group',
    session.sessionId,
    '-execute',
    execute,
    '-activate',
    'com.apple.Terminal'
  ]);
}

export function clearSessionNotification(sessionId: string): void {
  const config = loadConfig();
  spawnSync(config.notifierCommand, ['-remove', sessionId]);
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
