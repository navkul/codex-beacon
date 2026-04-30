import { execFileSync, spawn } from 'node:child_process';
import { resolveCodexBinary } from './codex-path.js';
import { replaceOverlaySnapshot } from './notify.js';
import { cloudSessionId, getSession, listSessions, replaceCloudTasks } from './session-registry.js';
import { CloudTaskSession } from './types.js';

const DEFAULT_TRACKED_CLOUD_LIMIT = '20';
const RECENT_TERMINAL_TASK_MS = 24 * 60 * 60 * 1000;
const ACTIVE_CLOUD_STATUSES = new Set([
  'queued',
  'pending',
  'starting',
  'running',
  'in_progress',
  'in-progress',
  'working',
  'processing'
]);
const TERMINAL_CLOUD_STATUSES = new Set([
  'done',
  'complete',
  'completed',
  'success',
  'succeeded',
  'merged',
  'error',
  'failed',
  'failure',
  'cancelled',
  'canceled'
]);

interface CodexCloudListResponse {
  tasks?: CodexCloudTask[];
  cursor?: string | null;
}

interface CodexCloudTask {
  id?: string;
  url?: string;
  title?: string;
  status?: string;
  updated_at?: string;
  environment_id?: string | null;
  environment_label?: string | null;
  branch?: string | null;
  summary?: {
    files_changed?: number;
    lines_added?: number;
    lines_removed?: number;
  } | null;
  is_review?: boolean;
  attempt_total?: number;
}

interface CloudListOptions {
  env?: string;
  limit?: string;
  cursor?: string;
}

export function listCloudTasks(options: CloudListOptions = {}): CodexCloudListResponse {
  const args = cloudListArgs(options);
  const output = execFileSync(resolveCodexBinary(), args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  });
  return JSON.parse(output) as CodexCloudListResponse;
}

export function printCloudTaskList(options: CloudListOptions = {}): void {
  const args = cloudListArgs(options);
  const output = execFileSync(resolveCodexBinary(), args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  });
  process.stdout.write(output);
}

export function syncCloudTasks(options: CloudListOptions = {}): number {
  const response = listCloudTasks({
    ...options,
    limit: options.limit ?? DEFAULT_TRACKED_CLOUD_LIMIT
  });
  const tasks = (response.tasks ?? [])
    .map(parseCloudTask)
    .filter((task): task is CloudTaskSession => task !== undefined)
    .filter(isTrackableCloudTask);
  replaceCloudTasks(tasks);
  replaceOverlaySnapshot(listSessions());
  return tasks.length;
}

export function syncCloudTasksQuietly(options: CloudListOptions = {}): number {
  try {
    return syncCloudTasks(options);
  } catch {
    return 0;
  }
}

export function syncCloudTasksDetached(options: CloudListOptions = {}): void {
  const cliPath = new URL('./cli.js', import.meta.url).pathname;
  const args = [cliPath, 'cloud', 'sync', '--quiet'];
  if (options.env) {
    args.push('--env', options.env);
  }
  if (options.limit) {
    args.push('--limit', options.limit);
  }
  if (options.cursor) {
    args.push('--cursor', options.cursor);
  }
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: process.env
  });
  child.unref();
}

export function showCloudTaskStatus(taskId: string): void {
  runCodexCloudPassthrough(['status', taskId]);
}

export function showCloudTaskDiff(taskId: string, attempt?: string): void {
  const args = ['diff'];
  if (attempt) {
    args.push('--attempt', attempt);
  }
  args.push(taskId);
  runCodexCloudPassthrough(args);
}

export function applyCloudTask(taskId: string, attempt?: string): void {
  const args = ['apply'];
  if (attempt) {
    args.push('--attempt', attempt);
  }
  args.push(taskId);
  runCodexCloudPassthrough(args);
}

export function openCloudTask(taskIdOrSessionId: string): void {
  const normalizedSessionId = taskIdOrSessionId.startsWith('cloud:') ? taskIdOrSessionId : cloudSessionId(taskIdOrSessionId);
  const session = getSession(normalizedSessionId);
  const url = session?.cloudTask?.url;
  if (!url) {
    throw new Error(`No Codex Cloud URL known for task: ${taskIdOrSessionId}. Run navex cloud sync first.`);
  }
  execFileSync('open', [url], { stdio: 'ignore' });
}

function cloudListArgs(options: CloudListOptions): string[] {
  const args = ['cloud', 'list', '--json'];
  if (options.env) {
    args.push('--env', options.env);
  }
  if (options.limit) {
    args.push('--limit', options.limit);
  }
  if (options.cursor) {
    args.push('--cursor', options.cursor);
  }
  return args;
}

function runCodexCloudPassthrough(args: string[]): void {
  const result = execFileSync(resolveCodexBinary(), ['cloud', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  });
  process.stdout.write(result);
}

function parseCloudTask(task: CodexCloudTask): CloudTaskSession | undefined {
  if (!task.id) {
    return undefined;
  }
  return {
    taskId: task.id,
    url: task.url,
    title: task.title,
    cloudStatus: task.status ?? 'unknown',
    updatedAt: task.updated_at,
    environmentId: task.environment_id,
    environmentLabel: task.environment_label,
    branch: task.branch,
    attempts: task.attempt_total,
    filesChanged: task.summary?.files_changed,
    linesAdded: task.summary?.lines_added,
    linesRemoved: task.summary?.lines_removed,
    isReview: task.is_review
  };
}

function isTrackableCloudTask(task: CloudTaskSession): boolean {
  const status = task.cloudStatus.toLowerCase();
  if (ACTIVE_CLOUD_STATUSES.has(status)) {
    return true;
  }
  if (!TERMINAL_CLOUD_STATUSES.has(status)) {
    return true;
  }
  return isRecentlyUpdated(task.updatedAt);
}

function isRecentlyUpdated(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return false;
  }
  return Date.now() - time <= RECENT_TERMINAL_TASK_MS;
}
