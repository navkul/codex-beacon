import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureAppRoot } from './config.js';
import { findExecutableOnPath } from './codex-path.js';

export function renderShellSnippet(shell: 'zsh' | 'bash'): string {
  const codexBin = findExecutableOnPath('codex');
  const functionName = shell === 'zsh' ? 'codex' : 'codex';
  const codexExport = codexBin
    ? `export NAVEX_CODEX_BIN=${shellQuote(codexBin)}`
    : '# export NAVEX_CODEX_BIN=/absolute/path/to/codex';
  return `# Navex wrapper\n${codexExport}\n${functionName}() {\n  local navex_bin\n  navex_bin="$(command -v navex)"\n  if [ -z "$navex_bin" ]; then\n    echo "navex not found" >&2\n    return 1\n  fi\n  "$navex_bin" launch "$@"\n}\n`;
}

export function installMessage(shell: 'zsh' | 'bash'): string {
  ensureAppRoot();
  return [
    `Append the following to your ~/.${shell}rc:`,
    '',
    renderShellSnippet(shell),
    '',
    'Install runtime dependencies:',
    '- Node.js 18 or newer',
    '- Xcode Command Line Tools, so swiftc can build the Navex overlay helper',
    '',
    'Also ensure ~/.codex/config.toml has:',
    '[features]',
    'codex_hooks = true',
    '',
    'Then write the following to ~/.codex/hooks.json:',
    '',
    renderHooksJson()
  ].join('\n');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function renderHooksJson(): string {
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  const navexBin = resolveLinkedNavexBin(cliPath);
  const hookCommand = (event: 'session-start' | 'user-prompt-submit' | 'stop') => {
    return navexBin
      ? `${navexBin} hook ${event}`
      : `${process.execPath} ${cliPath} hook ${event}`;
  };

  return JSON.stringify({
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume',
          hooks: [
            {
              type: 'command',
              command: hookCommand('session-start'),
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
              statusMessage: 'Navex clearing delivered notifications'
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
              statusMessage: 'Navex queueing session notification'
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
