export type SessionStatus = 'active' | 'waiting';
export type SummaryState = 'ready' | 'done' | 'blocked' | 'failed' | 'needs-input';
export type SummaryStyle = 'smart' | 'raw';

export interface SessionRecord {
  sessionId: string;
  displayName: string;
  cwd: string;
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
  status: SessionStatus;
}

export interface RegistryFile {
  nextDefaultName: number;
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
  type: 'session-stop' | 'session-active' | 'register-session';
  sessionId: string;
  cwd?: string;
  transcriptPath?: string | null;
  displayName?: string;
  terminalApp?: string;
  terminalWindowId?: string;
  terminalTabIndex?: number;
  terminalSessionUniqueId?: string;
  terminalTty?: string;
  timestamp: string;
}

export interface AppConfig {
  overlayCommand: string | null;
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
