import net from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import { socketPath } from './config.js';
import { upsertFromEvent, setLastSummary } from './session-registry.js';
import { clearSessionNotification, sendSessionNotification } from './notify.js';
import { summarizeTranscriptTail } from './summary.js';
import { DaemonEvent } from './types.js';

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
}

function handleEvent(event: DaemonEvent): void {
  const session = upsertFromEvent(event);

  if (event.type === 'session-active') {
    clearSessionNotification(event.sessionId);
    return;
  }

  if (event.type === 'session-stop') {
    const summary = summarizeTranscriptTail(event.transcriptPath ?? session.transcriptPath);
    const updated = setLastSummary(event.sessionId, summary) ?? session;
    sendSessionNotification({
      ...updated,
      lastSummary: summary
    });
  }
}
