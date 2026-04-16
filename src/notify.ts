import { ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from './config.js';
import { SessionRecord, SummaryState } from './types.js';

interface OverlayFocusCommand {
  executable: string;
  args: string[];
}

interface OverlayEvent {
  type: 'show' | 'clear';
  sessionId: string;
  displayName?: string;
  summary?: string;
  state?: SummaryState;
  timestamp: string;
  focusCommand?: OverlayFocusCommand;
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
    timestamp: new Date().toISOString(),
    focusCommand: focusCommand(session.sessionId),
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
  const process = spawn(command, [], { stdio: ['pipe', 'ignore', 'ignore'] });
  process.on('exit', () => {
    overlayProcess = undefined;
  });
  process.on('error', () => {
    overlayProcess = undefined;
  });
  overlayProcess = process;
  return process;
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

function focusCommand(sessionId: string): OverlayFocusCommand {
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  return {
    executable: process.execPath,
    args: [cliPath, 'focus', '--session-id', sessionId]
  };
}
