import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureAppRoot } from './config.js';

const LABEL = 'com.navex.overlay';

export function installOverlayLoginItem(): string {
  const appRoot = ensureAppRoot();
  const plist = loginItemPath();
  mkdirSync(path.dirname(plist), { recursive: true });
  writeFileSync(plist, renderPlist(appRoot));
  unloadLoginItem(plist);
  stopManualHelperIfRunning();
  execFileSync('launchctl', ['bootstrap', launchctlDomain(), plist], { stdio: 'ignore' });
  execFileSync('launchctl', ['kickstart', '-k', `${launchctlDomain()}/${LABEL}`], { stdio: 'ignore' });
  return plist;
}

function stopManualHelperIfRunning(): void {
  try {
    execFileSync('pkill', ['-x', 'NavexOverlay'], { stdio: 'ignore' });
  } catch {
    // No manually started helper is running.
  }
}

export function uninstallOverlayLoginItem(): string {
  const plist = loginItemPath();
  unloadLoginItem(plist);
  if (existsSync(plist)) {
    rmSync(plist);
  }
  return plist;
}

function unloadLoginItem(plist: string): void {
  try {
    execFileSync('launchctl', ['bootout', launchctlDomain(), plist], { stdio: 'ignore' });
  } catch {
    // launchctl returns non-zero when the job is not loaded.
  }
}

function launchctlDomain(): string {
  return `gui/${process.getuid?.() ?? 501}`;
}

function loginItemPath(): string {
  return path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function renderPlist(appRoot: string): string {
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  const stdoutPath = path.join(appRoot, 'overlay-launchagent.out.log');
  const stderrPath = path.join(appRoot, 'overlay-launchagent.err.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(cliPath)}</string>
    <string>overlay</string>
    <string>helper</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderrPath)}</string>
</dict>
</plist>
`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
