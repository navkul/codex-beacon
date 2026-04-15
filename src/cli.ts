#!/usr/bin/env node
import { Command } from 'commander';
import { runDaemon } from './daemon.js';
import { focusSession } from './focus.js';
import { runSessionStartHook } from './hook-session-start.js';
import { runStopHook } from './hook-stop.js';
import { runUserPromptSubmitHook } from './hook-user-prompt-submit.js';
import { installMessage } from './install.js';
import { launchCodex } from './launch.js';
import { listSessions } from './session-registry.js';

const program = new Command();
program.name('codex-beacon');

program
  .command('daemon')
  .description('Run the Codex Beacon daemon')
  .action(() => {
    runDaemon();
  });

program
  .command('hook')
  .description('Internal hook entrypoint')
  .argument('<event>', 'hook event name')
  .action(async (event: string) => {
    if (event === 'session-start') {
      await runSessionStartHook();
      return;
    }
    if (event === 'stop') {
      await runStopHook();
      return;
    }
    if (event === 'user-prompt-submit') {
      await runUserPromptSubmitHook();
      return;
    }
    throw new Error(`Unsupported hook event: ${event}`);
  });

program
  .command('focus')
  .description('Focus a tracked session')
  .requiredOption('--session-id <sessionId>')
  .action((options: { sessionId: string }) => {
    focusSession(options.sessionId);
  });

program
  .command('launch')
  .description('Launch codex through the beacon wrapper')
  .allowUnknownOption(true)
  .option('-N, --session-name <name>', 'custom session name')
  .argument('[args...]')
  .action((args: string[], options: { sessionName?: string }) => {
    launchCodex(args, options.sessionName);
  });

program
  .command('install')
  .description('Print shell integration instructions')
  .option('--shell <shell>', 'shell type', 'zsh')
  .action((options: { shell: 'zsh' | 'bash' }) => {
    process.stdout.write(`${installMessage(options.shell)}\n`);
  });

program
  .command('sessions')
  .description('List tracked sessions')
  .action(() => {
    for (const session of listSessions()) {
      process.stdout.write(`${session.displayName}\t${session.status}\t${session.cwd}\n`);
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
