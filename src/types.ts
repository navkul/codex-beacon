export type SessionStatus = 'active' | 'waiting' | 'done' | 'failed';
export type SessionKind = 'local-interactive' | 'cloud-task';
export type SummaryState = 'ready' | 'done' | 'blocked' | 'failed' | 'needs-input';
export type SummaryStyle = 'smart' | 'raw';

export interface UsageWindowSnapshot {
  usedPercent: number;
  windowMinutes?: number;
  resetsAt?: number;
  resetsInSeconds?: number;
}

export interface SessionUsageSnapshot {
  primary?: UsageWindowSnapshot;
  secondary?: UsageWindowSnapshot;
  totalTokens?: number;
  lastTurnTokens?: number;
  planType?: string;
  capturedAt?: string;
}

export interface SessionRecord {
  sessionId: string;
  kind?: SessionKind;
  displayName: string;
  isCustomName?: boolean;
  cwd: string;
  launcherPid?: number;
  terminalApp?: string;
  terminalWindowId?: string;
  terminalTabIndex?: number;
  terminalSessionUniqueId?: string;
  terminalTty?: string;
  transcriptPath?: string | null;
  createdAt: string;
  updatedAt: string;
  lastSummary?: string;
  lastSummaryState?: SummaryState;
  lastUsage?: SessionUsageSnapshot;
  status: SessionStatus;
  cloudTask?: CloudTaskSession;
}

export interface CloudTaskSession {
  taskId: string;
  url?: string;
  title?: string;
  cloudStatus: string;
  updatedAt?: string;
  environmentId?: string | null;
  environmentLabel?: string | null;
  branch?: string | null;
  attempts?: number;
  filesChanged?: number;
  linesAdded?: number;
  linesRemoved?: number;
  isReview?: boolean;
}

export interface RegistryFile {
  sessions: Record<string, SessionRecord>;
}

export interface HookPayload {
  session_id: string;
  transcript_path?: string | null;
  cwd: string;
  hook_event_name: string;
  model?: string;
}

export interface DaemonEvent {
  type: 'session-stop' | 'session-active' | 'register-session' | 'session-exit';
  sessionId?: string;
  cwd?: string;
  transcriptPath?: string | null;
  displayName?: string;
  launcherPid?: number;
  terminalApp?: string;
  terminalWindowId?: string;
  terminalTabIndex?: number;
  terminalSessionUniqueId?: string;
  terminalTty?: string;
  timestamp: string;
}

export interface AppConfig {
  appDisplayName: string;
  overlayCommand: string | null;
  overlayHotkey: string | null;
  overlayWidth: number;
  overlayMaxVisibleRows: number;
  overlayShowSummary: boolean;
  overlaySummaryStyle: SummaryStyle;
  overlaySummaryMaxChars: number;
  overlaySummaryMaxWords: number;
  overlaySummaryMaxLines: number;
}

export interface SummaryResult {
  text: string;
  state: SummaryState;
}
