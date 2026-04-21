import { ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig, overlayHelperLogPath, overlaySnapshotPath, overlayStatePath } from './config.js';
import { canRepromptSession } from './reprompt.js';
import { SessionRecord, SessionUsageSnapshot, SummaryState } from './types.js';

interface OverlayCommand {
  executable: string;
  args: string[];
}

interface OverlayEvent {
  type: 'show' | 'clear';
  sessionId: string;
  displayName?: string;
  summary?: string;
  state?: SummaryState;
  usage?: SessionUsageSnapshot;
  timestamp: string;
  focusCommand?: OverlayCommand;
  repromptCommand?: OverlayCommand;
  presentation?: OverlayPresentation;
}

interface OverlayPresentation {
  width: number;
  maxVisibleRows: number;
  summaryVisible: boolean;
  summaryMaxLines: number;
}

interface OverlaySnapshot {
  presentation: OverlayPresentation | null;
  items: OverlayEvent[];
}

let overlayProcess: ChildProcess | undefined;

function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

export function sendSessionNotification(session: SessionRecord): void {
  const config = loadConfig();
  const message = truncate(session.lastSummary ?? 'Ready for your next prompt.', config.overlaySummaryMaxChars);
  const event: OverlayEvent = {
    type: 'show',
    sessionId: session.sessionId,
    displayName: session.displayName,
    summary: message,
    state: session.lastSummaryState ?? 'ready',
    usage: session.lastUsage,
    timestamp: new Date().toISOString(),
    focusCommand: focusCommand(session.sessionId),
    repromptCommand: canRepromptSession(session) ? repromptCommand(session.sessionId) : undefined,
    presentation: {
      width: config.overlayWidth,
      maxVisibleRows: config.overlayMaxVisibleRows,
      summaryVisible: config.overlayShowSummary,
      summaryMaxLines: config.overlaySummaryMaxLines
    }
  };
  updateOverlaySnapshot(event);
  sendOverlayEvent(event);
}

export function clearSessionNotification(sessionId: string): void {
  const event: OverlayEvent = {
    type: 'clear',
    sessionId,
    timestamp: new Date().toISOString()
  };
  updateOverlaySnapshot(event);
  sendOverlayEvent(event);
}

function sendOverlayEvent(event: OverlayEvent): void {
  void event;
  ensureOverlayProcess();
}

function ensureOverlayProcess(): ChildProcess {
  if (overlayProcess && !overlayProcess.killed) {
    return overlayProcess;
  }

  const command = overlayCommand();
  const child = spawn(command, [], {
    stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...process.env,
      CODEX_BEACON_OVERLAY_STATE_PATH: overlayStatePath(),
      CODEX_BEACON_OVERLAY_SNAPSHOT_PATH: overlaySnapshotPath(),
      CODEX_BEACON_OVERLAY_LOG_PATH: overlayHelperLogPath()
    }
  });
  child.on('exit', () => {
    overlayProcess = undefined;
  });
  child.on('error', () => {
    overlayProcess = undefined;
  });
  overlayProcess = child;
  return child;
}

function updateOverlaySnapshot(event: OverlayEvent): void {
  const snapshot = loadOverlaySnapshot();
  if (event.presentation) {
    snapshot.presentation = event.presentation;
  }

  if (event.type === 'clear') {
    snapshot.items = snapshot.items.filter((item) => item.sessionId !== event.sessionId);
  } else {
    snapshot.items = snapshot.items.filter((item) => item.sessionId !== event.sessionId);
    snapshot.items.unshift(event);
  }

  writeFileSync(overlaySnapshotPath(), JSON.stringify(snapshot, null, 2));
}

function loadOverlaySnapshot(): OverlaySnapshot {
  const file = overlaySnapshotPath();
  if (!existsSync(file)) {
    return {
      presentation: null,
      items: []
    };
  }

  try {
    return JSON.parse(readFileSync(file, 'utf8')) as OverlaySnapshot;
  } catch {
    return {
      presentation: null,
      items: []
    };
  }
}

function overlayCommand(): string {
  const configured = loadConfig().overlayCommand;
  if (configured?.trim()) {
    return configured.trim();
  }

  const helperPath = fileURLToPath(new URL('./macos/CodexBeaconOverlay', import.meta.url));
  if (existsSync(helperPath)) {
    return helperPath;
  }

  return path.join(process.cwd(), 'dist', 'macos', 'CodexBeaconOverlay');
}

function focusCommand(sessionId: string): OverlayCommand {
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  return {
    executable: process.execPath,
    args: [cliPath, 'focus', '--session-id', sessionId]
  };
}

function repromptCommand(sessionId: string): OverlayCommand {
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  return {
    executable: process.execPath,
    args: [cliPath, 'reprompt', '--session-id', sessionId, '--message']
  };
}
