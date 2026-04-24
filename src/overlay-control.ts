import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { overlayControlPath } from './config.js';
import { ensureOverlayHelper } from './notify.js';

export type OverlayControlAction = 'show' | 'hide' | 'toggle';

interface OverlayControlCommand {
  action: OverlayControlAction;
  commandId: string;
  requestedAt: string;
}

export function sendOverlayControl(action: OverlayControlAction): void {
  const command: OverlayControlCommand = {
    action,
    commandId: randomUUID(),
    requestedAt: new Date().toISOString()
  };
  writeFileSync(overlayControlPath(), JSON.stringify(command, null, 2));
  if (action !== 'hide') {
    ensureOverlayHelper(false);
  }
}
