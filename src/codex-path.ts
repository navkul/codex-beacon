import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

export function resolveCodexBinary(): string {
  const configured = process.env.CODEX_BEACON_CODEX_BIN?.trim();
  if (configured) {
    if (isExecutableFile(configured)) {
      return configured;
    }
    throw new Error(`CODEX_BEACON_CODEX_BIN is not executable: ${configured}`);
  }

  const found = findExecutableOnPath('codex');
  if (found) {
    return found;
  }

  throw new Error('Unable to locate the real codex binary. Set CODEX_BEACON_CODEX_BIN to its full path.');
}

export function findExecutableOnPath(command: string): string | undefined {
  const paths = process.env.PATH?.split(path.delimiter).filter(Boolean) ?? [];
  for (const entry of paths) {
    const candidate = path.join(entry, command);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function isExecutableFile(file: string): boolean {
  try {
    if (!statSync(file).isFile()) {
      return false;
    }
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
