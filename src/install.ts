import { ensureAppRoot } from './config.js';

export function renderShellSnippet(shell: 'zsh' | 'bash'): string {
  const functionName = shell === 'zsh' ? 'codex' : 'codex';
  return `# Codex Beacon wrapper\n${functionName}() {\n  local beacon_bin\n  beacon_bin="$(command -v codex-beacon)"\n  if [ -z "$beacon_bin" ]; then\n    echo "codex-beacon not found" >&2\n    return 1\n  fi\n  "$beacon_bin" launch "$@"\n}\n`;
}

export function installMessage(shell: 'zsh' | 'bash'): string {
  ensureAppRoot();
  return [
    `Append the following to your ~/.${shell}rc:`,
    '',
    renderShellSnippet(shell),
    '',
    'Also ensure ~/.codex/config.toml has:',
    '[features]',
    'codex_hooks = true',
    '',
    'Then copy or merge this repo\'s .codex/hooks.json into ~/.codex/hooks.json.'
  ].join('\n');
}
