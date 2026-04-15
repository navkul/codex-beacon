import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  const execute = focusCommand(session.sessionId);
  const args = [
    '-title',
    session.displayName,
    '-message',
    message,
    '-group',
    session.sessionId,
    '-execute',
    execute
  ];
  if (config.notificationSound) {
    args.push('-sound', config.notificationSound);
  }
  if (config.appIcon) {
    args.push('-appIcon', config.appIcon);
  }
  spawnSync(config.notifierCommand, args);
}

export function clearSessionNotification(sessionId: string): void {
  const config = loadConfig();
  spawnSync(config.notifierCommand, ['-remove', sessionId]);
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function focusCommand(sessionId: string): string {
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  return [
    shellEscape(process.execPath),
    shellEscape(cliPath),
    'focus',
    '--session-id',
    shellEscape(sessionId)
  ].join(' ');
}
