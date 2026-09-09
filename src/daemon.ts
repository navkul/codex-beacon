import net from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import { syncCloudTasksQuietly } from './cloud.js';
import { loadConfig, socketPath } from './config.js';
import { getSession, listSessions, markSessionsByLauncherPidDone, setSessionStopSnapshot, upsertFromEvent } from './session-registry.js';
import { replaceOverlaySnapshot, sendSessionCompletionAlert } from './notify.js';
import { summarizeAssistantMessage } from './summary.js';
import { DaemonEvent } from './types.js';

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
      try {
        const event = JSON.parse(body) as DaemonEvent;
        handleEvent(event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Ignoring invalid daemon event: ${message}\n`);
      }
    });
  });

  server.listen(socket);
  server.on('listening', () => {
    syncCloudTasksQuietly({ limit: '20' });
    replayTrackedSessions();
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
      markSessionsByLauncherPidDone(event.launcherPid);
      replaceOverlaySnapshot(listSessions());
    }
    return;
  }

  const previous = event.sessionId ? getSession(event.sessionId) : undefined;
  const session = upsertFromEvent(event);

  if (event.type === 'session-active') {
    replaceOverlaySnapshot(listSessions());
    return;
  }

  if (event.type === 'register-session') {
    replaceOverlaySnapshot(listSessions());
    return;
  }

  if (event.type === 'session-interrupt') {
    if (session.status !== 'interrupted') {
      replaceOverlaySnapshot(listSessions());
      return;
    }
    const updated = setSessionStopSnapshot(session.sessionId, 'Interrupted.', 'ready') ?? session;
    replaceOverlaySnapshot(listSessions());
    sendSessionCompletionAlert(updated);
    return;
  }

  if (event.type === 'session-end') {
    replaceOverlaySnapshot(listSessions());
    return;
  }

  if (event.type === 'session-stop') {
    if (session.status !== 'done' || (event.turnId && session.lastCompletedTurnId !== event.turnId)) {
      replaceOverlaySnapshot(listSessions());
      return;
    }
    const duplicate = event.turnId
      ? previous?.lastCompletedTurnId === event.turnId
      : previous?.status === 'done';
    const summary = summarizeAssistantMessage(event.lastAssistantMessage, loadConfig());
    const updated = setSessionStopSnapshot(session.sessionId, summary.text, summary.state) ?? session;
    replaceOverlaySnapshot(listSessions());
    if (!duplicate) {
      sendSessionCompletionAlert({
        ...updated,
        lastSummary: summary.text,
        lastSummaryState: summary.state
      });
    }
  }
}

function replayTrackedSessions(): void {
  replaceOverlaySnapshot(listSessions());
}
