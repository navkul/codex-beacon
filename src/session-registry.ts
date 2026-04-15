import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registryPath } from './config.js';
import { DaemonEvent, RegistryFile, SessionRecord } from './types.js';

function nowIso(): string {
  return new Date().toISOString();
}

function emptyRegistry(): RegistryFile {
  return {
    nextDefaultName: 1,
    sessions: {}
  };
}

export function loadRegistry(): RegistryFile {
  const file = registryPath();
  if (!existsSync(file)) {
    const initial = emptyRegistry();
    saveRegistry(initial);
    return initial;
  }
  return JSON.parse(readFileSync(file, 'utf8')) as RegistryFile;
}

export function saveRegistry(registry: RegistryFile): void {
  writeFileSync(registryPath(), JSON.stringify(registry, null, 2));
}

export function allocateDisplayName(registry: RegistryFile, preferred?: string): string {
  if (preferred && preferred.trim()) {
    return preferred.trim();
  }

  while (true) {
    const candidate = `codex ${registry.nextDefaultName}`;
    registry.nextDefaultName += 1;
    const inUse = Object.values(registry.sessions).some((session) => session.displayName === candidate);
    if (!inUse) {
      return candidate;
    }
  }
}

export function upsertFromEvent(event: DaemonEvent): SessionRecord {
  const registry = loadRegistry();
  const existing = registry.sessions[event.sessionId];
  const createdAt = existing?.createdAt ?? event.timestamp ?? nowIso();
  const session: SessionRecord = {
    sessionId: event.sessionId,
    displayName: event.displayName ?? existing?.displayName ?? allocateDisplayName(registry),
    cwd: event.cwd ?? existing?.cwd ?? process.cwd(),
    terminalApp: event.terminalApp ?? existing?.terminalApp,
    terminalWindowId: event.terminalWindowId ?? existing?.terminalWindowId,
    transcriptPath: event.transcriptPath ?? existing?.transcriptPath,
    createdAt,
    updatedAt: event.timestamp ?? nowIso(),
    lastSummary: existing?.lastSummary,
    status: event.type === 'session-active' ? 'active' : 'waiting'
  };
  registry.sessions[event.sessionId] = session;
  saveRegistry(registry);
  return session;
}

export function setLastSummary(sessionId: string, summary: string): SessionRecord | undefined {
  const registry = loadRegistry();
  const session = registry.sessions[sessionId];
  if (!session) {
    return undefined;
  }
  session.lastSummary = summary;
  session.updatedAt = nowIso();
  saveRegistry(registry);
  return session;
}

export function getSession(sessionId: string): SessionRecord | undefined {
  return loadRegistry().sessions[sessionId];
}

export function listSessions(): SessionRecord[] {
  return Object.values(loadRegistry().sessions).sort((a, b) => a.displayName.localeCompare(b.displayName));
}
