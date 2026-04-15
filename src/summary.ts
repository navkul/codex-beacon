import { existsSync, readFileSync } from 'node:fs';

const DEFAULT_SUMMARY = 'Codex is ready for your next prompt.';

export function summarizeTranscriptTail(transcriptPath?: string | null): string {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return DEFAULT_SUMMARY;
  }

  const text = readFileSync(transcriptPath, 'utf8');
  const tail = text.slice(Math.max(0, text.length - 12000));
  const lines = tail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const structured = latestStructuredAssistantText(lines);
  if (structured) {
    return structured;
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.length < 8) {
      continue;
    }
    if (!looksLikeJson(line) && line.toLowerCase().includes('assistant')) {
      return compact(line);
    }
  }

  return DEFAULT_SUMMARY;
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 220).trim();
}

function latestStructuredAssistantText(lines: string[]): string | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parseJsonLine(lines[index]);
    if (!parsed) {
      continue;
    }

    const summary = assistantTextFromRecord(parsed);
    if (summary) {
      return compact(summary);
    }
  }

  return undefined;
}

function parseJsonLine(line: string): Record<string, unknown> | undefined {
  if (!looksLikeJson(line)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function assistantTextFromRecord(record: Record<string, unknown>): string | undefined {
  const payload = asRecord(record.payload);
  if (payload) {
    const payloadText = assistantTextFromMessage(payload);
    if (payloadText) {
      return payloadText;
    }
  }

  return assistantTextFromMessage(record);
}

function assistantTextFromMessage(record: Record<string, unknown>): string | undefined {
  const role = stringValue(record.role);
  const type = stringValue(record.type);
  if (role !== 'assistant' && type !== 'assistant' && type !== 'message') {
    return undefined;
  }

  return textFromContent(record.content) ?? stringValue(record.text) ?? stringValue(record.message);
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        const record = asRecord(item);
        if (!record) {
          return undefined;
        }
        const type = stringValue(record.type);
        if (type && type !== 'text' && type !== 'output_text') {
          return undefined;
        }
        return stringValue(record.text);
      })
      .filter((part): part is string => Boolean(part?.trim()));
    return parts.length > 0 ? parts.join(' ') : undefined;
  }

  const record = asRecord(content);
  return record ? stringValue(record.text) : undefined;
}

function looksLikeJson(line: string): boolean {
  return line.startsWith('{') && line.endsWith('}');
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
