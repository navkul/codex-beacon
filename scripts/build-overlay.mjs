import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

if (process.platform !== 'darwin') {
  console.error('Navex overlay helper currently builds on macOS only.');
  process.exit(1);
}

const outputDir = path.join(process.cwd(), 'dist', 'macos');
mkdirSync(outputDir, { recursive: true });

const result = spawnSync('swiftc', [
  '-O',
  '-o',
  path.join(outputDir, 'NavexOverlay'),
  path.join(process.cwd(), 'macos', 'NavexOverlay.swift')
], {
  stdio: 'inherit'
});

process.exit(result.status ?? 1);
