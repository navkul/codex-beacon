import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registryPath } from './config.js';
import { DaemonEvent, RegistryFile, SessionRecord, SessionUsageSnapshot } from './types.js';

const DEFAULT_NAME_PATTERN = /^codex \d+$/;

function nowIso(): string {
  return new Date().toISOString();
}

function emptyRegistry(): RegistryFile {
  return {
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
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as RegistryFile;
  const before = JSON.stringify(parsed);
  normalizeRegistry(parsed);
  if (JSON.stringify(parsed) !== before) {
    saveRegistry(parsed);
  }
  return parsed;
}

export function saveRegistry(registry: RegistryFile): void {
  writeFileSync(registryPath(), JSON.stringify(registry, null, 2));
}

export function allocateDisplayName(registry: RegistryFile, preferred?: string, sessionId?: string): string {
  const requested = preferred?.trim();
  if (requested) {
    if (!displayNameInUse(registry, requested, sessionId)) {
      return requested;
    }

    let suffix = 2;
    while (displayNameInUse(registry, `${requested} ${suffix}`, sessionId)) {
      suffix += 1;
    }
    return `${requested} ${suffix}`;
  }

  return nextDefaultDisplayName(registry, sessionId);
}

export function upsertFromEvent(event: DaemonEvent): SessionRecord {
  if (!event.sessionId) {
    throw new Error(`Cannot upsert session without sessionId for event: ${event.type}`);
  }

  const registry = loadRegistry();
  const existing = registry.sessions[event.sessionId];
  const createdAt = existing?.createdAt ?? event.timestamp ?? nowIso();
  const isCustomName = existing?.isCustomName ?? isRequestedCustomName(event.displayName, existing);
  const session: SessionRecord = {
    sessionId: event.sessionId,
    displayName: existing?.displayName ?? allocateDisplayName(registry, event.displayName, event.sessionId),
    isCustomName,
    cwd: event.cwd ?? existing?.cwd ?? process.cwd(),
    launcherPid: event.launcherPid ?? existing?.launcherPid,
    terminalApp: event.terminalApp ?? existing?.terminalApp,
    terminalWindowId: event.terminalWindowId ?? existing?.terminalWindowId,
    terminalTabIndex: event.terminalTabIndex ?? existing?.terminalTabIndex,
    terminalSessionUniqueId: event.terminalSessionUniqueId ?? existing?.terminalSessionUniqueId,
    terminalTty: event.terminalTty ?? existing?.terminalTty,
    transcriptPath: event.transcriptPath ?? existing?.transcriptPath,
    createdAt,
    updatedAt: event.timestamp ?? nowIso(),
    lastSummary: existing?.lastSummary,
    lastSummaryState: existing?.lastSummaryState,
    lastUsage: existing?.lastUsage,
    status: event.type === 'session-stop' ? 'waiting' : 'active'
  };
  registry.sessions[event.sessionId] = session;
  normalizeRegistry(registry);
  saveRegistry(registry);
  return session;
}

export function setSessionStopSnapshot(
  sessionId: string,
  summary: string,
  state?: SessionRecord['lastSummaryState'],
  usage?: SessionUsageSnapshot
): SessionRecord | undefined {
  const registry = loadRegistry();
  const session = registry.sessions[sessionId];
  if (!session) {
    return undefined;
  }
  session.lastSummary = summary;
  session.lastSummaryState = state;
  session.lastUsage = usage;
  session.updatedAt = nowIso();
  saveRegistry(registry);
  return session;
}

export function getSession(sessionId: string): SessionRecord | undefined {
  return loadRegistry().sessions[sessionId];
}

export function listSessions(): SessionRecord[] {
  return Object.values(loadRegistry().sessions).sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true }));
}

export function removeSessionsByLauncherPid(launcherPid: number): string[] {
  const registry = loadRegistry();
  const removedSessionIds = Object.values(registry.sessions)
    .filter((session) => session.launcherPid === launcherPid)
    .map((session) => session.sessionId);

  if (removedSessionIds.length === 0) {
    return removedSessionIds;
  }

  for (const sessionId of removedSessionIds) {
    delete registry.sessions[sessionId];
  }
  normalizeRegistry(registry);
  saveRegistry(registry);
  return removedSessionIds;
}

export function pruneStaleSessions(): string[] {
  const registry = loadRegistry();
  const removedSessionIds = Object.values(registry.sessions)
    .filter((session) => !session.launcherPid || !processIsRunning(session.launcherPid))
    .map((session) => session.sessionId);

  if (removedSessionIds.length === 0) {
    return removedSessionIds;
  }

  for (const sessionId of removedSessionIds) {
    delete registry.sessions[sessionId];
  }
  normalizeRegistry(registry);
  saveRegistry(registry);
  return removedSessionIds;
}

function normalizeRegistry(registry: RegistryFile): void {
  delete (registry as RegistryFile & { nextDefaultName?: number }).nextDefaultName;

  for (const session of Object.values(registry.sessions)) {
    session.isCustomName ??= !DEFAULT_NAME_PATTERN.test(session.displayName);
  }

  const defaultSessions = Object.values(registry.sessions)
    .filter((session) => !session.isCustomName)
    .sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt);
      return byCreatedAt === 0 ? a.sessionId.localeCompare(b.sessionId) : byCreatedAt;
    });

  const customNames = new Set(
    Object.values(registry.sessions)
      .filter((session) => session.isCustomName)
      .map((session) => session.displayName)
  );
  let nextNumber = 1;

  for (const session of defaultSessions) {
    while (customNames.has(`codex ${nextNumber}`)) {
      nextNumber += 1;
    }
    session.displayName = `codex ${nextNumber}`;
    nextNumber += 1;
  }
}

function nextDefaultDisplayName(registry: RegistryFile, sessionId?: string): string {
  const usedNames = new Set(
    Object.values(registry.sessions)
      .filter((session) => session.sessionId !== sessionId)
      .map((session) => session.displayName)
  );
  let nextNumber = 1;
  while (usedNames.has(`codex ${nextNumber}`)) {
    nextNumber += 1;
  }
  return `codex ${nextNumber}`;
}

function isRequestedCustomName(preferred: string | undefined, existing: SessionRecord | undefined): boolean {
  const requested = preferred?.trim();
  if (requested) {
    return true;
  }
  if (existing?.isCustomName !== undefined) {
    return existing.isCustomName;
  }
  return existing ? !DEFAULT_NAME_PATTERN.test(existing.displayName) : false;
}

function displayNameInUse(registry: RegistryFile, displayName: string, sessionId?: string): boolean {
  return Object.values(registry.sessions).some((session) => {
    return session.sessionId !== sessionId && session.displayName === displayName;
  });
}

function processIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
