import { spawn } from 'node:child_process';

export function launchCodex(args: string[], customName?: string): never {
  const child = spawn('codex', args, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_BEACON_SESSION_NAME: customName ?? '',
      CODEX_BEACON_TERMINAL_APP: process.env.TERM_PROGRAM ?? ''
    }
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  throw new Error('unreachable');
}
