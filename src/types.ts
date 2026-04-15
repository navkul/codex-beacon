export type SessionStatus = 'active' | 'waiting';

export interface SessionRecord {
  sessionId: string;
  displayName: string;
  cwd: string;
  terminalApp?: string;
  terminalWindowId?: string;
  terminalTty?: string;
  transcriptPath?: string | null;
  createdAt: string;
  updatedAt: string;
  lastSummary?: string;
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
  terminalTty?: string;
  timestamp: string;
}

export interface AppConfig {
  maxNotificationChars: number;
  notifierCommand: string;
  notificationSound: string | null;
  appIcon: string | null;
}
