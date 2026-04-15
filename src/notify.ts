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
  const bundleId = activationBundleId(session.terminalApp);
  if (bundleId) {
    args.push('-activate', bundleId);
  }
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

function activationBundleId(terminalApp?: string): string | undefined {
  const normalized = (terminalApp ?? '').toLowerCase();
  if (normalized.includes('iterm')) {
    return 'com.googlecode.iterm2';
  }
  if (normalized.includes('terminal')) {
    return 'com.apple.Terminal';
  }
  return undefined;
}
