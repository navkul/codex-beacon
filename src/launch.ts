import { execFileSync, spawn } from 'node:child_process';
import { resolveCodexBinary } from './codex-path.js';

const APPLESCRIPT_TIMEOUT_MS = 300;
const TTY_TIMEOUT_MS = 100;

export function launchCodex(args: string[], customName?: string): void {
  const codexBin = resolveCodexBinary();
  const terminalApp = process.env.TERM_PROGRAM ?? '';
  const terminalWindowId = captureTerminalWindowId(terminalApp);
  const terminalTty = process.env.TTY || captureTerminalTty();

  const child = spawn(codexBin, args, {
    stdio: 'inherit',
    cwd: process.cwd(),
    argv0: 'codex',
    env: {
      ...process.env,
      CODEX_BEACON_SESSION_NAME: customName ?? '',
      CODEX_BEACON_TERMINAL_APP: terminalApp,
      CODEX_BEACON_TERMINAL_WINDOW_ID: terminalWindowId ?? '',
      CODEX_BEACON_TERMINAL_TTY: terminalTty ?? ''
    }
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    process.stderr.write(`Failed to launch codex: ${error.message}\n`);
    process.exit(1);
  });
}

function captureTerminalWindowId(terminalApp: string): string | undefined {
  const normalized = terminalApp.toLowerCase();
  if (normalized.includes('iterm')) {
    return runAppleScript('tell application "iTerm2" to id of current window');
  }
  if (normalized.includes('terminal')) {
    return runAppleScript('tell application "Terminal" to id of front window');
  }
  return undefined;
}

function captureTerminalTty(): string | undefined {
  try {
    const output = execFileSync('tty', [], {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'ignore'],
      timeout: TTY_TIMEOUT_MS
    }).trim();
    return output.startsWith('/dev/') ? output : undefined;
  } catch {
    return undefined;
  }
}

function runAppleScript(script: string): string | undefined {
  try {
    const output = execFileSync('osascript', ['-e', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: APPLESCRIPT_TIMEOUT_MS
    }).trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}
