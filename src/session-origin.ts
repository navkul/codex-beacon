import { execFileSync } from 'node:child_process';
import { NavigationPrecision, SessionSurface } from './types.js';

const PROCESS_LOOKUP_TIMEOUT_MS = 250;

export interface SessionOrigin {
  surface: SessionSurface;
  navigationPrecision: NavigationPrecision;
  terminalApp?: string;
  terminalSessionUniqueId?: string;
  terminalTty?: string;
}

export function detectSessionOrigin(env: NodeJS.ProcessEnv = process.env): SessionOrigin {
  const terminalApp = nonEmpty(env.NAVEX_TERMINAL_APP) ?? nonEmpty(env.TERM_PROGRAM);
  const terminalSessionUniqueId =
    nonEmpty(env.NAVEX_TERMINAL_SESSION_UNIQUE_ID)
    ?? parseITermSessionUniqueId(env.ITERM_SESSION_ID)
    ?? parseITermSessionUniqueId(env.TERM_SESSION_ID);
  const originator = nonEmpty(env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE)?.toLowerCase() ?? '';
  const normalizedTerminal = terminalApp?.toLowerCase() ?? '';

  if (originator.includes('desktop')) {
    return {
      surface: 'desktop',
      navigationPrecision: 'exact-thread'
    };
  }

  const terminalTty = nonEmpty(env.NAVEX_TERMINAL_TTY) ?? parentTerminalTty();

  if (normalizedTerminal.includes('vscode') || normalizedTerminal.includes('visual studio code')) {
    return {
      surface: 'vscode',
      navigationPrecision: 'application-only',
      terminalApp,
      terminalTty
    };
  }

  if (normalizedTerminal.includes('cursor')) {
    return {
      surface: 'vscode',
      navigationPrecision: 'application-only',
      terminalApp,
      terminalTty
    };
  }

  if (terminalApp || terminalSessionUniqueId || terminalTty) {
    return {
      surface: 'cli',
      navigationPrecision: terminalSessionUniqueId || terminalTty ? 'exact-window' : 'application-only',
      terminalApp,
      terminalSessionUniqueId,
      terminalTty
    };
  }

  return {
    surface: 'unknown',
    navigationPrecision: 'application-only'
  };
}

export function parseITermSessionUniqueId(value?: string): string | undefined {
  const trimmed = nonEmpty(value);
  if (!trimmed) {
    return undefined;
  }
  return trimmed.split(':').at(-1)?.trim() || undefined;
}

function parentTerminalTty(): string | undefined {
  let pid = process.ppid;
  for (let depth = 0; depth < 4 && pid > 1; depth += 1) {
    try {
      const output = execFileSync('ps', ['-o', 'tty=', '-o', 'ppid=', '-p', String(pid)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: PROCESS_LOOKUP_TIMEOUT_MS
      }).trim();
      const match = output.match(/^(\S+)\s+(\d+)$/);
      if (!match) {
        return undefined;
      }
      const tty = normalizeTty(match[1]);
      if (tty) {
        return tty;
      }
      pid = Number(match[2]);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function normalizeTty(value: string): string | undefined {
  if (!value || value === '??' || value === '?') {
    return undefined;
  }
  return value.startsWith('/dev/') ? value : `/dev/${value}`;
}

function nonEmpty(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
