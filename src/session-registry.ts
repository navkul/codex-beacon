import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { registryPath } from './config.js';
import { CloudTaskSession, DaemonEvent, NavigationPrecision, RegistryFile, SessionRecord, SessionSurface, SessionUsageSnapshot, SummaryState } from './types.js';

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
  const file = registryPath();
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(registry, null, 2));
  renameSync(temporary, file);
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
  const eventIsStale = existing !== undefined && event.timestamp < existing.updatedAt;
  const createdAt = existing?.createdAt ?? event.timestamp ?? nowIso();
  const isCustomName = existing?.isCustomName ?? isRequestedCustomName(event.displayName, existing);
  const session: SessionRecord = {
    sessionId: event.sessionId,
    kind: existing?.kind === 'cloud-task' ? 'cloud-task' : 'codex-thread',
    surface: event.surface ?? existing?.surface ?? inferSurface(existing),
    navigationPrecision: event.navigationPrecision ?? existing?.navigationPrecision ?? inferNavigationPrecision(existing),
    turnId: eventIsStale ? existing?.turnId : event.turnId ?? existing?.turnId,
    lastCompletedTurnId: !eventIsStale && event.type === 'session-stop'
      ? event.turnId ?? existing?.lastCompletedTurnId
      : existing?.lastCompletedTurnId,
    displayName: existing?.displayName ?? allocateDisplayName(registry, event.displayName, event.sessionId),
    isCustomName,
    cwd: event.cwd ?? existing?.cwd ?? process.cwd(),
    launcherPid: event.launcherPid ?? existing?.launcherPid,
    terminalApp: event.terminalApp ?? existing?.terminalApp,
    terminalWindowId: event.terminalWindowId ?? existing?.terminalWindowId,
    terminalTabIndex: event.terminalTabIndex ?? existing?.terminalTabIndex,
    terminalSessionUniqueId: event.terminalSessionUniqueId ?? existing?.terminalSessionUniqueId,
    terminalTty: event.terminalTty ?? existing?.terminalTty,
    createdAt,
    updatedAt: eventIsStale ? existing.updatedAt : event.timestamp ?? nowIso(),
    lastSummary: existing?.lastSummary,
    lastSummaryState: existing?.lastSummaryState,
    lastUsage: existing?.lastUsage,
    status: eventIsStale ? existing.status : statusForEvent(event, existing),
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

export function removeSession(sessionId: string): boolean {
  const registry = loadRegistry();
  if (!registry.sessions[sessionId]) {
    return false;
  }

  delete registry.sessions[sessionId];
  normalizeRegistry(registry);
  saveRegistry(registry);
  return true;
}

export function listSessions(): SessionRecord[] {
  const registry = loadRegistry();
  normalizeRegistry(registry);
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
    surface: 'cloud',
    navigationPrecision: task.url ? 'exact-thread' : 'application-only',
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

export function markSessionsByLauncherPidDone(launcherPid: number): SessionRecord[] {
  const registry = loadRegistry();
  const sessions = Object.values(registry.sessions).filter((session) => session.launcherPid === launcherPid);

  if (sessions.length === 0) {
    return sessions;
  }

  const timestamp = nowIso();
  for (const session of sessions) {
    if (session.status === 'active') {
      session.status = 'done';
    }
    session.updatedAt = timestamp;
  }
  normalizeRegistry(registry);
  saveRegistry(registry);
  return sessions;
}

export function pruneStaleSessions(): string[] {
  // Session identity belongs to Codex, not to a launcher process. Rows remain
  // available until the user removes them, including Desktop sessions which
  // never have a terminal PID.
  return [];
}

function normalizeRegistry(registry: RegistryFile): void {
  delete (registry as RegistryFile & { nextDefaultName?: number }).nextDefaultName;

  for (const session of Object.values(registry.sessions)) {
    if ((session.kind as string | undefined) !== 'cloud-task') {
      session.kind = 'codex-thread';
    }
    session.surface ??= inferSurface(session);
    session.navigationPrecision ??= inferNavigationPrecision(session);
    session.isCustomName ??= !DEFAULT_NAME_PATTERN.test(session.displayName);
    // "waiting" was the old reprompt-oriented name for a finished local turn.
    if (session.kind === 'codex-thread' && session.status === 'waiting') {
      session.status = 'done';
    }
  }

  const defaultSessions = Object.values(registry.sessions)
    .filter((session) => session.kind === 'codex-thread')
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

function statusForEvent(event: DaemonEvent, existing: SessionRecord | undefined): SessionRecord['status'] {
  switch (event.type) {
    case 'session-active':
      return 'active';
    case 'session-stop':
    case 'session-end':
      return existing?.status === 'failed' || existing?.status === 'interrupted' ? existing.status : 'done';
    case 'session-interrupt':
      return 'interrupted';
    case 'register-session':
      return existing?.status ?? 'done';
    case 'session-exit':
      return existing?.status ?? 'done';
  }
}

function inferSurface(session: SessionRecord | undefined): SessionSurface {
  if (!session) return 'unknown';
  if (session.kind === 'cloud-task') return 'cloud';
  const terminal = session.terminalApp?.toLowerCase() ?? '';
  if (terminal.includes('vscode') || terminal.includes('visual studio code') || terminal.includes('cursor')) return 'vscode';
  if (terminal || session.terminalSessionUniqueId || session.terminalTty || session.launcherPid) return 'cli';
  return 'unknown';
}

function inferNavigationPrecision(session: SessionRecord | undefined): NavigationPrecision {
  if (!session) return 'application-only';
  if (session.surface === 'desktop') return 'exact-thread';
  if (session.cloudTask?.url) return 'exact-thread';
  if (session.terminalSessionUniqueId || session.terminalTty || session.terminalWindowId) return 'exact-window';
  return 'application-only';
}
