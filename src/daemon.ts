import net from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import { loadConfig, socketPath } from './config.js';
import { listSessions, upsertFromEvent, setSessionStopSnapshot } from './session-registry.js';
import { clearSessionNotification, replaceOverlaySnapshot, sendSessionNotification } from './notify.js';
import { summarizeTranscriptTail } from './summary.js';
import { DaemonEvent } from './types.js';
import { usageSnapshotFromTranscript } from './usage.js';

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
    replayWaitingSessions();
  });
}

function handleEvent(event: DaemonEvent): void {
  const session = upsertFromEvent(event);

  if (event.type === 'session-active') {
    clearSessionNotification(event.sessionId);
    return;
  }

  if (event.type === 'session-stop') {
    const summary = summarizeTranscriptTail(event.transcriptPath ?? session.transcriptPath, loadConfig());
    const usage = usageSnapshotFromTranscript(event.transcriptPath ?? session.transcriptPath);
    const updated = setSessionStopSnapshot(event.sessionId, summary.text, summary.state, usage) ?? session;
    sendSessionNotification({
      ...updated,
      lastSummary: summary.text,
      lastSummaryState: summary.state,
      lastUsage: usage
    });
  }
}

function replayWaitingSessions(): void {
  replaceOverlaySnapshot(listSessions().filter((session) => session.status === 'waiting'));
}
