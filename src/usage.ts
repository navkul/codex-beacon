import { existsSync, readFileSync } from 'node:fs';
import { SessionUsageSnapshot } from './types.js';

const TRANSCRIPT_TAIL_BYTES = 20000;

export function usageSnapshotFromTranscript(transcriptPath: string | null | undefined): SessionUsageSnapshot | undefined {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return undefined;
  }

  const text = readFileSync(transcriptPath, 'utf8');
  const tail = text.slice(Math.max(0, text.length - TRANSCRIPT_TAIL_BYTES));
  const lines = tail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const record = parseJsonLine(lines[index]);
    const usage = usageFromRecord(record);
    if (usage) {
      return usage;
    }
  }

  return undefined;
}

function usageFromRecord(record: Record<string, unknown> | undefined): SessionUsageSnapshot | undefined {
  if (!record || stringValue(record.type) !== 'event_msg') {
    return undefined;
  }

  const payload = asRecord(record.payload);
  if (!payload || stringValue(payload.type) !== 'token_count') {
    return undefined;
  }

  const info = asRecord(payload.info);
  const rateLimits = asRecord(payload.rate_limits);
  if (!rateLimits) {
    return undefined;
  }

  return {
    primary: usageWindowFromRecord(asRecord(rateLimits.primary)),
    secondary: usageWindowFromRecord(asRecord(rateLimits.secondary)),
    totalTokens: numberValue(asRecord(info?.total_token_usage)?.total_tokens),
    lastTurnTokens: numberValue(asRecord(info?.last_token_usage)?.total_tokens),
    planType: stringValue(rateLimits.plan_type),
    capturedAt: stringValue(record.timestamp)
  };
}

function usageWindowFromRecord(record: Record<string, unknown> | undefined) {
  if (!record) {
    return undefined;
  }

  const usedPercent = numberValue(record.used_percent);
  if (usedPercent === undefined) {
    return undefined;
  }

  return {
    usedPercent,
    windowMinutes: numberValue(record.window_minutes),
    resetsAt: numberValue(record.resets_at),
    resetsInSeconds: numberValue(record.resets_in_seconds)
  };
}

function parseJsonLine(line: string): Record<string, unknown> | undefined {
  if (!line.startsWith('{') || !line.endsWith('}')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
