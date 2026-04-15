import net from 'node:net';
import { spawn } from 'node:child_process';
import { socketPath } from './config.js';
import { DaemonEvent } from './types.js';

export async function sendEvent(event: DaemonEvent): Promise<void> {
  try {
    await trySend(event);
    return;
  } catch {
    spawn(process.execPath, [new URL('./cli.js', import.meta.url).pathname, 'daemon'], {
      detached: true,
      stdio: 'ignore'
    }).unref();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await trySend(event);
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
