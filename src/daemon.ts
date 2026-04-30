import net from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import { syncCloudTasksQuietly } from './cloud.js';
import { loadConfig, socketPath } from './config.js';
import { listSessions, pruneStaleSessions, removeSessionsByLauncherPid, setSessionStopSnapshot, upsertFromEvent } from './session-registry.js';
import { replaceOverlaySnapshot, sendSessionNotification } from './notify.js';
import { summarizeTranscriptTail } from './summary.js';
import { DaemonEvent } from './types.js';
import { usageSnapshotFromTranscript } from './usage.js';

const CLOUD_SYNC_INTERVAL_MS = 60_000;

export function runDaemon(): void {
  const socket = socketPath();
  if (existsSync(socket)) {
    unlinkSync(socket);
  }

  const server = net.createServer((connection) => {
    let body = '';
    connection.on('data', (chunk) => {
      body += chunk.toString('utf8');
    });
    connection.on('end', () => {
      if (!body.trim()) {
        return;
      }
      const event = JSON.parse(body) as DaemonEvent;
      handleEvent(event);
    });
  });

  server.listen(socket);
  server.on('listening', () => {
    pruneStaleSessions();
    syncCloudTasksQuietly({ limit: '20' });
    replayWaitingSessions();
    startCloudSyncTimer();
  });
}

function startCloudSyncTimer(): void {
  setInterval(() => {
    syncCloudTasksQuietly({ limit: '20' });
  }, CLOUD_SYNC_INTERVAL_MS).unref();
}

function handleEvent(event: DaemonEvent): void {
  if (event.type === 'session-exit') {
    if (event.launcherPid) {
      removeSessionsByLauncherPid(event.launcherPid);
      replaceOverlaySnapshot(listSessions());
    }
    return;
  }

  const session = upsertFromEvent(event);

  if (event.type === 'session-active') {
    replaceOverlaySnapshot(listSessions());
    return;
  }

  if (event.type === 'register-session') {
    replaceOverlaySnapshot(listSessions());
    return;
  }

  if (event.type === 'session-stop') {
    const summary = summarizeTranscriptTail(event.transcriptPath ?? session.transcriptPath, loadConfig());
    const usage = usageSnapshotFromTranscript(event.transcriptPath ?? session.transcriptPath);
    const updated = setSessionStopSnapshot(session.sessionId, summary.text, summary.state, usage) ?? session;
    replaceOverlaySnapshot(listSessions());
    sendSessionNotification({
      ...updated,
      lastSummary: summary.text,
      lastSummaryState: summary.state,
      lastUsage: usage
    });
  }
}

function replayWaitingSessions(): void {
  replaceOverlaySnapshot(listSessions());
}
