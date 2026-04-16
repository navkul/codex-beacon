import { existsSync, readFileSync } from 'node:fs';
import { AppConfig, SummaryResult, SummaryState, SummaryStyle } from './types.js';

const DEFAULT_SUMMARY = 'Ready for your next prompt.';
const GENERIC_SENTENCE = /^(done|fixed|implemented|updated|ready|okay|ok|complete)\.?$/i;
const ACTION_PATTERN = /\b(fixed|implemented|added|updated|wired|built|refactored|changed|completed|resolved|summarized)\b/i;
const BLOCKED_PATTERN = /\b(blocked|waiting on|needs approval|need approval|permission|cannot continue|can't continue|requires approval)\b/i;
const FAILED_PATTERN = /\b(test(?:s)? failed|failing|failed|error|exception|traceback|stack trace|lint failed|build failed)\b/i;
const INPUT_PATTERN = /\b(let me know|confirm|which do you|which one|choose|need your input|waiting for input|question|what would you like)\b/i;

export function summarizeTranscriptTail(transcriptPath: string | null | undefined, config: AppConfig): SummaryResult {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return {
      text: limitSummary(DEFAULT_SUMMARY, config),
      state: 'ready'
    };
  }

  const text = readFileSync(transcriptPath, 'utf8');
  const tail = text.slice(Math.max(0, text.length - 12000));
  const lines = tail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const assistantTexts = extractAssistantTexts(lines);
  for (const assistantText of assistantTexts) {
    const normalized = normalizeAssistantText(assistantText);
    if (!normalized) {
      continue;
    }
    const state = classifySummaryState(normalized);
    const summary = config.overlaySummaryStyle === 'raw'
      ? normalized
      : buildSmartSummary(normalized, state);

    if (summary) {
      return {
        text: limitSummary(summary, config),
        state
      };
    }
  }

  return {
    text: limitSummary(DEFAULT_SUMMARY, config),
    state: 'ready'
  };
}

function normalizeAssistantText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAssistantTexts(lines: string[]): string[] {
  const texts: string[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parseJsonLine(lines[index]);
    if (!parsed) {
      continue;
    }

    const summary = assistantTextFromRecord(parsed);
    if (summary) {
      texts.push(summary);
    }
  }

  return texts;
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
  if (role !== 'assistant' && type !== 'assistant' && type !== 'message' && type !== 'response_item') {
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

function buildSmartSummary(text: string, state: SummaryState): string | undefined {
  const fragments = candidateFragments(text);
  const meaningful = chooseMeaningfulFragment(fragments) ?? chooseMeaningfulFragment([text]);
  if (!meaningful) {
    return undefined;
  }

  const body = meaningful.replace(/\s+/g, ' ').trim();
  if (!body) {
    return undefined;
  }

  return addStatePrefix(body, state);
}

function candidateFragments(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((fragment) => fragment.trim().replace(/^[:\-–\s]+/, ''))
    .filter(Boolean);
}

function chooseMeaningfulFragment(fragments: string[]): string | undefined {
  const scored = fragments
    .map((fragment) => ({ fragment, score: scoreFragment(fragment) }))
    .filter(({ score }) => score > -100)
    .sort((left, right) => right.score - left.score);

  return scored[0]?.fragment;
}

function scoreFragment(fragment: string): number {
  if (GENERIC_SENTENCE.test(fragment)) {
    return -100;
  }

  let score = 0;
  if (fragment.length >= 20) {
    score += 2;
  }
  if (fragment.length > 160) {
    score -= 2;
  }
  if (ACTION_PATTERN.test(fragment)) {
    score += 4;
  }
  if (BLOCKED_PATTERN.test(fragment) || FAILED_PATTERN.test(fragment) || INPUT_PATTERN.test(fragment)) {
    score += 5;
  }
  if (/^(i |i've |i updated|i fixed|i added)/i.test(fragment)) {
    score += 1;
  }
  return score;
}

function classifySummaryState(text: string): SummaryState {
  if (FAILED_PATTERN.test(text)) {
    return 'failed';
  }
  if (BLOCKED_PATTERN.test(text)) {
    return 'blocked';
  }
  if (INPUT_PATTERN.test(text)) {
    return 'needs-input';
  }
  if (ACTION_PATTERN.test(text) || GENERIC_SENTENCE.test(text)) {
    return 'done';
  }
  return 'ready';
}

function addStatePrefix(text: string, state: SummaryState): string {
  const existingPrefix = /^(done|blocked|failed|needs input|ready):/i;
  if (existingPrefix.test(text)) {
    return text;
  }

  const label = summaryLabel(state);
  return `${label}: ${text}`;
}

function summaryLabel(state: SummaryState): string {
  switch (state) {
    case 'done':
      return 'Done';
    case 'blocked':
      return 'Blocked';
    case 'failed':
      return 'Failed';
    case 'needs-input':
      return 'Needs Input';
    case 'ready':
    default:
      return 'Ready';
  }
}

function limitSummary(text: string, config: AppConfig): string {
  const words = text.split(/\s+/).filter(Boolean);
  const wordLimited = words.length > config.overlaySummaryMaxWords
    ? `${words.slice(0, config.overlaySummaryMaxWords).join(' ')}…`
    : text;

  if (wordLimited.length <= config.overlaySummaryMaxChars) {
    return wordLimited;
  }

  const sliced = wordLimited.slice(0, Math.max(0, config.overlaySummaryMaxChars - 1));
  const boundary = sliced.lastIndexOf(' ');
  const trimmed = boundary > 24 ? sliced.slice(0, boundary) : sliced;
  return `${trimmed.trim()}…`;
}
