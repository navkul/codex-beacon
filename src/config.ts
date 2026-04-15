import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { AppConfig } from './types.js';

const DEFAULT_CONFIG: AppConfig = {
  maxNotificationChars: 180,
  notifierCommand: 'terminal-notifier'
};

export function appRoot(): string {
  return process.env.CODEX_BEACON_HOME ?? path.join(homedir(), '.codex-beacon');
}

export function ensureAppRoot(): string {
  const root = appRoot();
  mkdirSync(root, { recursive: true });
  return root;
}

export function registryPath(): string {
  return path.join(ensureAppRoot(), 'registry.json');
}

export function socketPath(): string {
  return path.join(ensureAppRoot(), 'daemon.sock');
}

export function configPath(): string {
  return path.join(ensureAppRoot(), 'config.json');
}

export function loadConfig(): AppConfig {
  const file = configPath();
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...parsed
  };
}
