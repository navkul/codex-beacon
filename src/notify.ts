import { ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig, overlayStatePath } from './config.js';
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
  sendOverlayEvent({
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
  });
}

export function clearSessionNotification(sessionId: string): void {
  sendOverlayEvent({
    type: 'clear',
    sessionId,
    timestamp: new Date().toISOString()
  });
}

function sendOverlayEvent(event: OverlayEvent): void {
  const overlay = ensureOverlayProcess();
  try {
    overlay.stdin?.write(`${JSON.stringify(event)}\n`);
  } catch {
    overlayProcess = undefined;
  }
}

function ensureOverlayProcess(): ChildProcess {
  if (overlayProcess && !overlayProcess.killed) {
    return overlayProcess;
  }

  const command = overlayCommand();
  const child = spawn(command, [], {
    stdio: ['pipe', 'ignore', 'ignore'],
    env: {
      ...process.env,
      CODEX_BEACON_OVERLAY_STATE_PATH: overlayStatePath()
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
