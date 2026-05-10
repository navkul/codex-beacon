import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { AppConfig } from './types.js';

type LegacyConfig = Partial<AppConfig> & {
  maxNotificationChars?: number;
};

const DEFAULT_APP_ROOT = path.join(homedir(), '.navex');
const LEGACY_APP_ROOT = path.join(homedir(), '.codex-beacon');

const DEFAULT_CONFIG: AppConfig = {
  appDisplayName: 'Navex',
  overlayCommand: null,
  overlayHotkey: 'cmd+option+k',
  overlayWidth: 384,
  overlayMaxVisibleRows: 4,
  overlayShowSummary: true,
  overlaySummaryStyle: 'smart',
  overlaySummaryMaxChars: 160,
  overlaySummaryMaxWords: 24,
  overlaySummaryMaxLines: 2
};

export const APP_CONFIG_KEYS = [
  'appDisplayName',
  'overlayCommand',
  'overlayHotkey',
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
  return process.env.NAVEX_HOME?.trim() || DEFAULT_APP_ROOT;
}

export function ensureAppRoot(): string {
  const root = ensureMigratedAppRoot();
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

export function overlayControlPath(): string {
  return path.join(ensureAppRoot(), 'overlay-control.json');
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
  return normalizeConfig(parsed);
}

export function saveConfig(config: AppConfig): void {
  writeFileSync(configPath(), JSON.stringify(normalizeConfig(config), null, 2));
}

function ensureMigratedAppRoot(): string {
  const configured = process.env.NAVEX_HOME?.trim();
  if (configured) {
    return configured;
  }
  if (!existsSync(LEGACY_APP_ROOT)) {
    return DEFAULT_APP_ROOT;
  }
  if (existsSync(DEFAULT_APP_ROOT)) {
    return DEFAULT_APP_ROOT;
  }

  try {
    renameSync(LEGACY_APP_ROOT, DEFAULT_APP_ROOT);
    return DEFAULT_APP_ROOT;
  } catch {
    return DEFAULT_APP_ROOT;
  }
}

function normalizeConfig(config: LegacyConfig): AppConfig {
  return {
    appDisplayName: typeof config.appDisplayName === 'string' && config.appDisplayName.trim()
      ? config.appDisplayName.trim()
      : DEFAULT_CONFIG.appDisplayName,
    overlayCommand: typeof config.overlayCommand === 'string' ? config.overlayCommand : DEFAULT_CONFIG.overlayCommand,
    overlayHotkey:
      typeof config.overlayHotkey === 'string' && config.overlayHotkey.trim()
        ? config.overlayHotkey.trim()
        : config.overlayHotkey === null
          ? null
          : DEFAULT_CONFIG.overlayHotkey,
    overlayWidth: typeof config.overlayWidth === 'number' ? config.overlayWidth : DEFAULT_CONFIG.overlayWidth,
    overlayMaxVisibleRows:
      typeof config.overlayMaxVisibleRows === 'number' ? config.overlayMaxVisibleRows : DEFAULT_CONFIG.overlayMaxVisibleRows,
    overlayShowSummary:
      typeof config.overlayShowSummary === 'boolean' ? config.overlayShowSummary : DEFAULT_CONFIG.overlayShowSummary,
    overlaySummaryStyle:
      config.overlaySummaryStyle === 'raw' || config.overlaySummaryStyle === 'smart'
        ? config.overlaySummaryStyle
        : DEFAULT_CONFIG.overlaySummaryStyle,
    overlaySummaryMaxChars:
      typeof config.overlaySummaryMaxChars === 'number'
        ? config.overlaySummaryMaxChars
        : typeof config.maxNotificationChars === 'number'
          ? config.maxNotificationChars
          : DEFAULT_CONFIG.overlaySummaryMaxChars,
    overlaySummaryMaxWords:
      typeof config.overlaySummaryMaxWords === 'number' ? config.overlaySummaryMaxWords : DEFAULT_CONFIG.overlaySummaryMaxWords,
    overlaySummaryMaxLines:
      typeof config.overlaySummaryMaxLines === 'number' ? config.overlaySummaryMaxLines : DEFAULT_CONFIG.overlaySummaryMaxLines
  };
}
