import { mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

if (process.platform !== 'darwin') {
  console.error('Navex overlay helper currently builds on macOS only.');
  process.exit(1);
}

const outputDir = path.join(process.cwd(), 'dist', 'macos');
mkdirSync(outputDir, { recursive: true });

const outputPath = path.join(outputDir, 'NavexOverlay');
const sourcePath = path.join(process.cwd(), 'macos', 'NavexOverlay.swift');
const moduleCachePath = path.join(os.tmpdir(), 'navex-swift-module-cache');
mkdirSync(moduleCachePath, { recursive: true });

const baseArgs = [
  '-O',
  '-module-cache-path',
  moduleCachePath,
  '-o',
  outputPath,
  sourcePath
];

let result = spawnSync('swiftc', baseArgs, { encoding: 'utf8' });
if (result.status !== 0) {
  for (const sdk of fallbackSdkCandidates()) {
    const version = path.basename(sdk).match(/^MacOSX([0-9.]+)\.sdk$/)?.[1];
    if (!version) continue;
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    result = spawnSync('swiftc', [
      '-sdk', sdk,
      '-target', `${architecture}-apple-macosx${version}`,
      ...baseArgs
    ], { encoding: 'utf8' });
    if (result.status === 0) break;
  }
}

if (result.status !== 0) {
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
}

process.exit(result.status ?? 1);

function fallbackSdkCandidates() {
  const lookup = spawnSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' });
  const defaultSdk = lookup.stdout?.trim();
  if (!defaultSdk) return [];

  try {
    return readdirSync(path.dirname(defaultSdk))
      .filter((name) => /^MacOSX[0-9.]+\.sdk$/.test(name))
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map((name) => path.join(path.dirname(defaultSdk), name));
  } catch {
    return [];
  }
}
