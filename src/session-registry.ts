import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registryPath } from './config.js';
import { CloudTaskSession, DaemonEvent, RegistryFile, SessionRecord, SessionUsageSnapshot, SummaryState } from './types.js';

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
    kind: existing?.kind ?? 'local-interactive',
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
    status: event.type === 'session-stop' ? 'waiting' : 'active',
    cloudTask: existing?.cloudTask
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
  const registry = loadRegistry();
  pruneStaleLocalSessions(registry);
  saveRegistry(registry);
  return Object.values(registry.sessions).sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true }));
}

export function upsertCloudTask(task: CloudTaskSession, summary?: string): SessionRecord {
  const registry = loadRegistry();
  const sessionId = cloudSessionId(task.taskId);
  const existing = registry.sessions[sessionId];
  const timestamp = nowIso();
  const session: SessionRecord = {
    sessionId,
    kind: 'cloud-task',
    displayName: cloudDisplayName(task),
    isCustomName: true,
    cwd: existing?.cwd ?? process.cwd(),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    lastSummary: summary ?? cloudSummary(task),
    lastSummaryState: cloudSummaryState(task.cloudStatus),
    lastUsage: existing?.lastUsage,
    status: cloudSessionStatus(task.cloudStatus),
    cloudTask: task
  };
  registry.sessions[sessionId] = session;
  normalizeRegistry(registry);
  saveRegistry(registry);
  return session;
}

export function upsertCloudTasks(tasks: CloudTaskSession[]): SessionRecord[] {
  return tasks.map((task) => upsertCloudTask(task));
}

export function replaceCloudTasks(tasks: CloudTaskSession[]): SessionRecord[] {
  const registry = loadRegistry();
  const nextCloudSessionIds = new Set(tasks.map((task) => cloudSessionId(task.taskId)));
  for (const session of Object.values(registry.sessions)) {
    if (session.kind === 'cloud-task' && !nextCloudSessionIds.has(session.sessionId)) {
      delete registry.sessions[session.sessionId];
    }
  }
  saveRegistry(registry);
  return upsertCloudTasks(tasks);
}

export function cloudSessionId(taskId: string): string {
  return `cloud:${taskId}`;
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
    .filter((session) => (session.kind ?? 'local-interactive') === 'local-interactive')
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
    session.kind ??= 'local-interactive';
    session.isCustomName ??= !DEFAULT_NAME_PATTERN.test(session.displayName);
  }

  const defaultSessions = Object.values(registry.sessions)
    .filter((session) => (session.kind ?? 'local-interactive') === 'local-interactive')
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

function pruneStaleLocalSessions(registry: RegistryFile): void {
  for (const session of Object.values(registry.sessions)) {
    if ((session.kind ?? 'local-interactive') !== 'local-interactive') {
      continue;
    }
    if (!session.launcherPid || !processIsRunning(session.launcherPid)) {
      delete registry.sessions[session.sessionId];
    }
  }
  normalizeRegistry(registry);
}

function cloudSessionStatus(status: string): SessionRecord['status'] {
  const normalized = status.toLowerCase();
  if (['done', 'complete', 'completed', 'success', 'succeeded', 'merged'].includes(normalized)) {
    return 'done';
  }
  if (['error', 'failed', 'failure', 'cancelled', 'canceled'].includes(normalized)) {
    return 'failed';
  }
  return 'active';
}

function cloudSummaryState(status: string): SummaryState {
  const normalized = status.toLowerCase();
  if (['done', 'complete', 'completed', 'success', 'succeeded', 'merged'].includes(normalized)) {
    return 'done';
  }
  if (['error', 'failed', 'failure', 'cancelled', 'canceled'].includes(normalized)) {
    return 'failed';
  }
  return 'ready';
}

function cloudSummary(task: CloudTaskSession): string {
  return task.title?.trim() || 'Codex Cloud task.';
}

function cloudDisplayName(task: CloudTaskSession): string {
  return task.environmentLabel?.trim() || task.environmentId?.trim() || 'Codex Cloud';
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
