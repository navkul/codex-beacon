import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureAppRoot } from './config.js';
import { findExecutableOnPath } from './codex-path.js';

export function installMessage(_shell: 'zsh' | 'bash'): string {
  ensureAppRoot();
  return [
    'Install runtime dependencies:',
    '- Node.js 18 or newer',
    '- Xcode Command Line Tools, so swiftc can build the Navex overlay helper',
    '',
    'Start the overlay helper at macOS login:',
    'navex overlay install-login',
    '',
    'Also ensure ~/.codex/config.toml has:',
    '[features]',
    'hooks = true',
    '',
    'Then write the following to ~/.codex/hooks.json:',
    '',
    renderHooksJson(),
    '',
    'Codex 0.130+ requires hook trust review after this file changes:',
    '- Start a new Codex session',
    '- Run /hooks',
    '- Trust the Navex SessionStart, UserPromptSubmit, Stop, Interrupt, and SessionEnd hooks',
    '',
    'No shell wrapper is required. Start sessions normally from Codex Desktop or by running codex.'
  ].join('\n');
}

export function renderHooksJson(): string {
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  const navexBin = resolveLinkedNavexBin(cliPath);
  const hookCommand = (event: 'session-start' | 'user-prompt-submit' | 'stop' | 'interrupt' | 'session-end') => {
    return navexBin
      ? `${navexBin} hook ${event}`
      : `${process.execPath} ${cliPath} hook ${event}`;
  };

  return JSON.stringify({
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: hookCommand('session-start'),
              async: true,
              statusMessage: 'Navex registering session'
            }
          ]
        }
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: hookCommand('user-prompt-submit'),
              async: true,
              statusMessage: 'Navex marking agent as working'
            }
          ]
        }
      ],
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: hookCommand('stop'),
              timeout: 5,
              statusMessage: 'Navex alerting when the agent is done'
            }
          ]
        }
      ],
      Interrupt: [
        {
          hooks: [
            {
              type: 'command',
              command: hookCommand('interrupt'),
              async: true,
              timeout: 3,
              statusMessage: 'Navex recording interrupted agent'
            }
          ]
        }
      ],
      SessionEnd: [
        {
          hooks: [
            {
              type: 'command',
              command: hookCommand('session-end'),
              timeout: 5,
              statusMessage: 'Navex closing session tracking'
            }
          ]
        }
      ]
    }
  }, null, 2);
}

function resolveLinkedNavexBin(cliPath: string): string | null {
  const navexBin = findExecutableOnPath('navex');
  if (!navexBin) {
    return null;
  }

  try {
    return realpathSync(navexBin) === realpathSync(cliPath) ? navexBin : null;
  } catch {
    return null;
  }
}
