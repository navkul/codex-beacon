import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig, overlayControlPath, overlayHelperLogPath, overlaySnapshotPath, overlayStatePath } from './config.js';
import { listSessions } from './session-registry.js';
import { NavigationPrecision, SessionKind, SessionRecord, SessionStatus, SessionSurface, SessionUsageSnapshot, SummaryState } from './types.js';

interface OverlayCommand {
  executable: string;
  args: string[];
}

interface OverlayEvent {
  type: 'show';
  sessionId: string;
  displayName?: string;
  summary?: string;
  kind?: SessionKind;
  surface?: SessionSurface;
  navigationPrecision?: NavigationPrecision;
  sourceLabel?: string;
  status?: SessionStatus;
  cloudStatus?: string;
  cloudDetail?: string;
  state?: SummaryState;
  usage?: SessionUsageSnapshot;
  timestamp: string;
  focusCommand?: OverlayCommand;
  removeCommand?: OverlayCommand;
  presentation?: OverlayPresentation;
}

interface OverlayPresentation {
  appDisplayName: string;
  hotkey: string | null;
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

export function sendSessionCompletionAlert(session: SessionRecord): void {
  const event = overlayShowEvent(session);
  updateOverlaySnapshot(event);
  writeFileSync(overlayControlPath(), JSON.stringify({
    action: 'show',
    commandId: randomUUID(),
    requestedAt: new Date().toISOString()
  }, null, 2));
  ensureOverlayHelper(true);
}

export function replaceOverlaySnapshot(sessions: SessionRecord[]): void {
  const presentation = currentPresentation();
  const snapshot: OverlaySnapshot = {
    presentation,
    items: sessions.map((session) => overlayShowEvent(session, presentation))
  };
  writeFileSync(overlaySnapshotPath(), JSON.stringify(snapshot, null, 2));
}

function overlayShowEvent(session: SessionRecord, presentation = currentPresentation()): OverlayEvent {
  const message = overlaySummary(session);
  return {
    type: 'show',
    sessionId: session.sessionId,
    displayName: session.displayName,
    summary: message,
    kind: session.kind ?? 'codex-thread',
    surface: session.surface ?? 'unknown',
    navigationPrecision: session.navigationPrecision ?? 'application-only',
    sourceLabel: sourceLabel(session),
    status: session.status,
    cloudStatus: session.cloudTask?.cloudStatus,
    cloudDetail: cloudOverlayDetail(session),
    state: session.lastSummaryState ?? 'ready',
    usage: session.lastUsage,
    timestamp: new Date().toISOString(),
    focusCommand: focusCommand(session.sessionId),
    removeCommand: removeCommand(session.sessionId),
    presentation
  };
}

export function ensureOverlayHelper(showOnLaunch: boolean): ChildProcess | undefined {
  if (overlayProcess && !overlayProcess.killed) {
    return overlayProcess;
  }
  if (overlayHelperIsRunning()) {
    return undefined;
  }

  // Rebuild the persisted snapshot before launching the helper so stale rows
  // are not shown during helper bootstrap after a daemon/helper restart.
  replaceOverlaySnapshot(listSessions());

  const command = overlayCommand();
  const child = spawn(command, [], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: overlayHelperEnv(showOnLaunch)
  });
  child.on('exit', () => {
    overlayProcess = undefined;
  });
  child.on('error', () => {
    overlayProcess = undefined;
  });
  child.unref();
  overlayProcess = child;
  return child;
}

export function runOverlayHelperForeground(showOnLaunch: boolean): void {
  replaceOverlaySnapshot(listSessions());
  const command = overlayCommand();
  const child = spawn(command, [], {
    stdio: ['ignore', 'ignore', 'ignore'],
    env: overlayHelperEnv(showOnLaunch)
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
  child.on('error', (error) => {
    process.stderr.write(`Failed to launch overlay helper: ${error.message}\n`);
    process.exit(1);
  });
}

export function overlayHelperEnv(showOnLaunch: boolean): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NAVEX_OVERLAY_CONTROL_PATH: overlayControlPath(),
    NAVEX_OVERLAY_STATE_PATH: overlayStatePath(),
    NAVEX_OVERLAY_SNAPSHOT_PATH: overlaySnapshotPath(),
    NAVEX_OVERLAY_LOG_PATH: overlayHelperLogPath(),
    NAVEX_CLI_PATH: fileURLToPath(new URL('./cli.js', import.meta.url)),
    NAVEX_NODE_PATH: process.execPath,
    NAVEX_OVERLAY_SHOW_ON_LAUNCH: showOnLaunch ? '1' : '0'
  };
}

function updateOverlaySnapshot(event: OverlayEvent): void {
  const snapshot = loadOverlaySnapshot();
  if (event.presentation) {
    snapshot.presentation = event.presentation;
  }

  snapshot.items = snapshot.items.filter((item) => item.sessionId !== event.sessionId);
  snapshot.items.unshift(event);

  writeFileSync(overlaySnapshotPath(), JSON.stringify(snapshot, null, 2));
}

function currentPresentation(): OverlayPresentation {
  const config = loadConfig();
  return {
    appDisplayName: config.appDisplayName,
    hotkey: config.overlayHotkey,
    width: config.overlayWidth,
    maxVisibleRows: config.overlayMaxVisibleRows,
    summaryVisible: config.overlayShowSummary,
    summaryMaxLines: config.overlaySummaryMaxLines
  };
}

function overlaySummary(session: SessionRecord): string {
  const config = loadConfig();
  if (session.kind !== 'cloud-task' && session.status === 'active') {
    return 'Working…';
  }
  const fallback = session.kind === 'cloud-task'
    ? cloudOverlaySummary(session)
    : 'Finished. Open the session when you are ready to continue.';
  return truncate(session.lastSummary ?? fallback, config.overlaySummaryMaxChars);
}

function sourceLabel(session: SessionRecord): string {
  switch (session.surface) {
    case 'desktop':
      return 'Desktop';
    case 'cli':
      return 'CLI';
    case 'vscode':
      return 'Editor';
    case 'cloud':
      return 'Cloud';
    case 'unknown':
    default:
      return session.kind === 'cloud-task' ? 'Cloud' : 'Codex';
  }
}

function cloudOverlaySummary(session: SessionRecord): string {
  const task = session.cloudTask;
  return task?.title?.trim() || 'Codex Cloud task.';
}

function cloudOverlayDetail(session: SessionRecord): string | undefined {
  const task = session.cloudTask;
  if (!task) {
    return undefined;
  }
  const pieces: string[] = [];
  if (task.filesChanged !== undefined) {
    pieces.push(`${task.filesChanged} files changed`);
  }
  if (task.attempts && task.attempts > 1) {
    pieces.push(`${task.attempts} attempts`);
  }
  return pieces.length > 0 ? pieces.join(' · ') : undefined;
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

  const helperPath = fileURLToPath(new URL('./macos/NavexOverlay', import.meta.url));
  if (existsSync(helperPath)) {
    return helperPath;
  }

  return path.join(process.cwd(), 'dist', 'macos', 'NavexOverlay');
}

function overlayHelperIsRunning(): boolean {
  try {
    execFileSync('pgrep', ['-x', path.basename(overlayCommand())], {
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

function focusCommand(sessionId: string): OverlayCommand {
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  return {
    executable: process.execPath,
    args: [cliPath, 'focus', '--session-id', sessionId]
  };
}

function removeCommand(sessionId: string): OverlayCommand {
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  return {
    executable: process.execPath,
    args: [cliPath, 'sessions', 'remove', sessionId]
  };
}
