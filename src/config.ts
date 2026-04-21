import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { AppConfig } from './types.js';

type LegacyConfig = Partial<AppConfig> & {
  maxNotificationChars?: number;
};

const DEFAULT_CONFIG: AppConfig = {
  overlayCommand: null,
  overlayWidth: 384,
  overlayMaxVisibleRows: 4,
  overlayShowSummary: true,
  overlaySummaryStyle: 'smart',
  overlaySummaryMaxChars: 160,
  overlaySummaryMaxWords: 24,
  overlaySummaryMaxLines: 2
};

export const APP_CONFIG_KEYS = [
  'overlayCommand',
  'overlayWidth',
  'overlayMaxVisibleRows',
  'overlayShowSummary',
  'overlaySummaryStyle',
  'overlaySummaryMaxChars',
  'overlaySummaryMaxWords',
  'overlaySummaryMaxLines'
] as const;

export type AppConfigKey = (typeof APP_CONFIG_KEYS)[number];

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

export function overlayStatePath(): string {
  return path.join(ensureAppRoot(), 'overlay-state.json');
}

export function overlaySnapshotPath(): string {
  return path.join(ensureAppRoot(), 'overlay-snapshot.json');
}

export function overlayHelperLogPath(): string {
  return path.join(ensureAppRoot(), 'overlay-helper.log');
}

export function loadConfig(): AppConfig {
  const file = configPath();
  if (!existsSync(file)) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as LegacyConfig;
  return {
    ...DEFAULT_CONFIG,
    overlaySummaryMaxChars: parsed.overlaySummaryMaxChars ?? parsed.maxNotificationChars ?? DEFAULT_CONFIG.overlaySummaryMaxChars,
    ...parsed
  };
}

export function saveConfig(config: AppConfig): void {
  writeFileSync(configPath(), JSON.stringify(config, null, 2));
}
