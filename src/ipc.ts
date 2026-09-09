import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { socketPath } from './config.js';
import { DaemonEvent } from './types.js';

const DAEMON_START_ATTEMPTS = 10;
const DAEMON_RETRY_DELAY_MS = 50;

export async function sendEvent(event: DaemonEvent): Promise<void> {
  try {
    await trySend(event);
    return;
  } catch {
    spawn(process.execPath, [fileURLToPath(new URL('./cli.js', import.meta.url)), 'daemon'], {
      detached: true,
      stdio: 'ignore'
    }).unref();
    let lastError: unknown;
    for (let attempt = 0; attempt < DAEMON_START_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, DAEMON_RETRY_DELAY_MS));
      try {
        await trySend(event);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

function trySend(event: DaemonEvent): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath(), () => {
      client.write(JSON.stringify(event));
      client.end();
      resolve();
    });
    client.on('error', reject);
  });
}
