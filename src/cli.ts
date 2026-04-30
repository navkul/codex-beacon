#!/usr/bin/env node
import { Command } from 'commander';
import { runDaemon } from './daemon.js';
import { focusSession } from './focus.js';
import { runSessionStartHook } from './hook-session-start.js';
import { runStopHook } from './hook-stop.js';
import { runUserPromptSubmitHook } from './hook-user-prompt-submit.js';
import { installMessage } from './install.js';
import { launchCodex } from './launch.js';
import { APP_CONFIG_KEYS, AppConfigKey, configPath, loadConfig, saveConfig } from './config.js';
import {
  applyCloudTask,
  openCloudTask,
  printCloudTaskList,
  showCloudTaskDiff,
  showCloudTaskStatus,
  syncCloudTasks
} from './cloud.js';
import { sendOverlayControl } from './overlay-control.js';
import { replaceOverlaySnapshot } from './notify.js';
import { repromptSession } from './reprompt.js';
import { listSessions } from './session-registry.js';

const program = new Command();
program.name('navex');

program
  .command('daemon')
  .description('Run the Navex daemon')
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
  .command('reprompt')
  .description('Send and submit a prompt to a tracked session')
  .requiredOption('--session-id <sessionId>')
  .requiredOption('--message <message>')
  .action(async (options: { sessionId: string; message: string }) => {
    await repromptSession(options.sessionId, options.message);
  });

const overlayCommand = program
  .command('overlay')
  .description('Control the floating overlay');

overlayCommand
  .command('show')
  .description('Show the overlay if there are live sessions')
  .action(() => {
    sendOverlayControl('show');
  });

overlayCommand
  .command('hide')
  .description('Hide the overlay')
  .action(() => {
    sendOverlayControl('hide');
  });

overlayCommand
  .command('toggle')
  .description('Toggle overlay visibility')
  .action(() => {
    sendOverlayControl('toggle');
  });

program
  .command('launch')
  .description('Launch codex through the navex wrapper')
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
  .action((options: { shell: string }) => {
    process.stdout.write(`${installMessage(parseShell(options.shell))}\n`);
  });

program
  .command('sessions')
  .description('List tracked sessions')
  .action(() => {
    for (const session of listSessions()) {
      const source = session.kind === 'cloud-task' ? 'cloud' : 'local';
      process.stdout.write(`${session.displayName}\t${source}\t${session.status}\t${session.cwd}\n`);
    }
  });

const cloudCommand = program
  .command('cloud')
  .description('Track and manage Codex Cloud tasks');

cloudCommand
  .command('list')
  .description('List Codex Cloud tasks as JSON')
  .option('--env <envId>', 'filter by Codex Cloud environment id')
  .option('--limit <n>', 'maximum number of tasks to return')
  .option('--cursor <cursor>', 'pagination cursor')
  .action((options: { env?: string; limit?: string; cursor?: string }) => {
    printCloudTaskList(options);
  });

cloudCommand
  .command('sync')
  .description('Import recent Codex Cloud tasks into the overlay')
  .option('--env <envId>', 'filter by Codex Cloud environment id')
  .option('--limit <n>', 'maximum number of tasks to return')
  .option('--cursor <cursor>', 'pagination cursor')
  .option('--quiet', 'suppress output')
  .action((options: { env?: string; limit?: string; cursor?: string; quiet?: boolean }) => {
    const count = syncCloudTasks(options);
    if (!options.quiet) {
      process.stdout.write(`Synced ${count} Codex Cloud task${count === 1 ? '' : 's'}.\n`);
    }
  });

cloudCommand
  .command('status')
  .description('Show the status of a Codex Cloud task')
  .argument('<taskId>')
  .action((taskId: string) => {
    showCloudTaskStatus(taskId);
  });

cloudCommand
  .command('diff')
  .description('Show the diff for a Codex Cloud task')
  .argument('<taskId>')
  .option('--attempt <n>', 'attempt number')
  .action((taskId: string, options: { attempt?: string }) => {
    showCloudTaskDiff(taskId, options.attempt);
  });

cloudCommand
  .command('apply')
  .description('Apply the diff for a Codex Cloud task locally')
  .argument('<taskId>')
  .option('--attempt <n>', 'attempt number')
  .action((taskId: string, options: { attempt?: string }) => {
    applyCloudTask(taskId, options.attempt);
  });

cloudCommand
  .command('open')
  .description('Open a tracked Codex Cloud task in the browser')
  .argument('<taskId>')
  .action((taskId: string) => {
    openCloudTask(taskId);
  });

const configCommand = program
  .command('config')
  .description('Show or update Navex config');

configCommand
  .command('path')
  .description('Print the config file path')
  .action(() => {
    process.stdout.write(`${configPath()}\n`);
  });

configCommand
  .command('show')
  .description('Print the current config JSON')
  .action(() => {
    process.stdout.write(`${JSON.stringify(loadConfig(), null, 2)}\n`);
  });

configCommand
  .command('get')
  .description('Print one config value')
  .argument('<key>')
  .action((key: string) => {
    const config = loadConfig();
    const validKey = parseConfigKey(key);
    process.stdout.write(`${JSON.stringify(config[validKey])}\n`);
  });

configCommand
  .command('set')
  .description('Set one config value')
  .argument('<key>')
  .argument('<value>')
  .action((key: string, value: string) => {
    const config = loadConfig();
    const validKey = parseConfigKey(key);
    const nextValue = parseConfigValue(validKey, value);
    const updated = { ...config, [validKey]: nextValue } as typeof config;
    saveConfig(updated);
    replaceOverlaySnapshot(listSessions());
    process.stdout.write(`${validKey}=${JSON.stringify(updated[validKey])}\n`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});

function parseShell(shell: string): 'zsh' | 'bash' {
  if (shell === 'zsh' || shell === 'bash') {
    return shell;
  }
  throw new Error(`Unsupported shell: ${shell}`);
}

function parseConfigKey(key: string): AppConfigKey {
  if ((APP_CONFIG_KEYS as readonly string[]).includes(key)) {
    return key as AppConfigKey;
  }
  throw new Error(`Unsupported config key: ${key}`);
}

function parseConfigValue(key: AppConfigKey, raw: string): string | number | boolean | null {
  switch (key) {
    case 'appDisplayName':
      return parseStringValue(raw, key);
    case 'overlayCommand':
      return raw === 'null' ? null : raw;
    case 'overlayHotkey':
      return raw === 'null' ? null : parseHotkeyValue(raw);
    case 'overlayShowSummary':
      if (raw === 'true') {
        return true;
      }
      if (raw === 'false') {
        return false;
      }
      break;
    case 'overlaySummaryStyle':
      if (raw === 'smart' || raw === 'raw') {
        return raw;
      }
      break;
    case 'overlayWidth':
      return parseIntValue(raw, 280, 720);
    case 'overlayMaxVisibleRows':
      return parseIntValue(raw, 1, 12);
    case 'overlaySummaryMaxChars':
      return parseIntValue(raw, 40, 400);
    case 'overlaySummaryMaxWords':
      return parseIntValue(raw, 4, 80);
    case 'overlaySummaryMaxLines':
      return parseIntValue(raw, 1, 4);
  }

  throw new Error(`Invalid value for ${key}: ${raw}`);
}

function parseIntValue(raw: string, min: number, max: number): number {
  const value = Number(raw);
  if (Number.isInteger(value) && value >= min && value <= max) {
    return value;
  }
  throw new Error(`Expected an integer between ${min} and ${max}, got: ${raw}`);
}

function parseStringValue(raw: string, key: string): string {
  const value = raw.trim();
  if (value) {
    return value;
  }
  throw new Error(`Expected a non-empty string for ${key}`);
}

function parseHotkeyValue(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) {
    throw new Error('Expected a non-empty hotkey string or null');
  }
  return value;
}
