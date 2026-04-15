import { ensureAppRoot } from './config.js';
import { findExecutableOnPath } from './codex-path.js';

export function renderShellSnippet(shell: 'zsh' | 'bash'): string {
  const codexBin = findExecutableOnPath('codex');
  const functionName = shell === 'zsh' ? 'codex' : 'codex';
  const codexExport = codexBin
    ? `export CODEX_BEACON_CODEX_BIN=${shellQuote(codexBin)}`
    : '# export CODEX_BEACON_CODEX_BIN=/absolute/path/to/codex';
  return `# Codex Beacon wrapper\n${codexExport}\n${functionName}() {\n  local beacon_bin\n  beacon_bin="$(command -v codex-beacon)"\n  if [ -z "$beacon_bin" ]; then\n    echo "codex-beacon not found" >&2\n    return 1\n  fi\n  "$beacon_bin" launch "$@"\n}\n`;
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
    '- terminal-notifier, for example: brew install terminal-notifier',
    '',
    'Also ensure ~/.codex/config.toml has:',
    '[features]',
    'codex_hooks = true',
    '',
    'Then copy or merge this repo\'s .codex/hooks.json into ~/.codex/hooks.json.'
  ].join('\n');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
