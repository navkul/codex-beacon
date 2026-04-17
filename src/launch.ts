import { execFileSync, spawn } from 'node:child_process';
import { resolveCodexBinary } from './codex-path.js';

const APPLESCRIPT_TIMEOUT_MS = 300;
const TTY_TIMEOUT_MS = 100;

interface LaunchTerminalMetadata {
  terminalWindowId?: string;
  terminalTabIndex?: number;
  terminalSessionUniqueId?: string;
  terminalTty?: string;
}

export function launchCodex(args: string[], customName?: string): void {
  const codexBin = resolveCodexBinary();
  const terminalApp = process.env.TERM_PROGRAM ?? '';
  const metadata = captureTerminalMetadata(terminalApp);

  const child = spawn(codexBin, args, {
    stdio: 'inherit',
    cwd: process.cwd(),
    argv0: 'codex',
    env: {
      ...process.env,
      CODEX_BEACON_SESSION_NAME: customName ?? '',
      CODEX_BEACON_TERMINAL_APP: terminalApp,
      CODEX_BEACON_TERMINAL_WINDOW_ID: metadata.terminalWindowId ?? '',
      CODEX_BEACON_TERMINAL_TAB_INDEX: String(metadata.terminalTabIndex ?? ''),
      CODEX_BEACON_TERMINAL_SESSION_UNIQUE_ID: metadata.terminalSessionUniqueId ?? '',
      CODEX_BEACON_TERMINAL_TTY: metadata.terminalTty ?? ''
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

function captureTerminalMetadata(terminalApp: string): LaunchTerminalMetadata {
  const normalized = terminalApp.toLowerCase();
  if (normalized.includes('iterm')) {
    const metadata = captureITermMetadata();
    const envSessionUniqueId = parseITermSessionUniqueId(process.env.ITERM_SESSION_ID ?? process.env.TERM_SESSION_ID);
    return {
      ...metadata,
      terminalSessionUniqueId: parseITermSessionUniqueId(process.env.CODEX_BEACON_TERMINAL_SESSION_UNIQUE_ID) ?? envSessionUniqueId ?? metadata.terminalSessionUniqueId,
      terminalTty: process.env.TTY || captureTerminalTty()
    };
  }
  if (normalized.includes('terminal')) {
    return {
      terminalWindowId: runAppleScript('tell application "Terminal" to id of front window'),
      terminalTty: process.env.TTY || captureTerminalTty()
    };
  }
  return {
    terminalTty: process.env.TTY || captureTerminalTty()
  };
}

function captureITermMetadata(): Omit<LaunchTerminalMetadata, 'terminalTty'> {
  const output = runITermAppleScript(`
set tabPosition to 0
tell current window
  repeat with i from 1 to (count of tabs)
    if current tab is tab i then
      set tabPosition to i
      exit repeat
    end if
  end repeat
  return (id as string) & "|" & (tabPosition as string) & "|" & (unique id of current session as string)
end tell
`);
  if (!output) {
    return {};
  }
  const [windowId, tabIndex, sessionUniqueId] = output.split('|');
  return {
    terminalWindowId: windowId || undefined,
    terminalTabIndex: parseNumber(tabIndex),
    terminalSessionUniqueId: sessionUniqueId || undefined
  };
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

function runITermAppleScript(body: string): string | undefined {
  const script = `tell application "iTerm2"\n${body}\nend tell`;
  return runAppleScript(script) ?? runAppleScript(script.replace('"iTerm2"', '"iTerm"'));
}

function parseNumber(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseITermSessionUniqueId(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parts = trimmed.split(':');
  const candidate = parts.at(-1)?.trim();
  return candidate || undefined;
}
