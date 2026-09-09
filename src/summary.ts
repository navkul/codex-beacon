import { AppConfig, SummaryResult, SummaryState } from './types.js';

const DEFAULT_SUMMARY = 'Finished. Open the session when you are ready to continue.';
const GENERIC_SENTENCE = /^(done|fixed|implemented|updated|ready|okay|ok|complete)\.?$/i;
const STATE_ONLY_SENTENCE = /^(done|blocked|failed|needs input|ready)[:\s\-–.]*$/i;
const ACTION_PATTERN = /\b(fixed|implemented|added|updated|wired|built|refactored|changed|completed|resolved|summarized|verified)\b/i;
const BLOCKED_PATTERN = /\b(blocked|waiting on|needs approval|need approval|permission|cannot continue|can't continue|requires approval)\b/i;
const FAILED_PATTERN = /\b(test(?:s)? failed|failing|failed|error|exception|traceback|stack trace|lint failed|build failed)\b/i;
const INPUT_PATTERN = /\b(let me know|confirm|which do you|which one|choose|need your input|waiting for input|question|what would you like)\b/i;

export function summarizeAssistantMessage(message: string | null | undefined, config: AppConfig): SummaryResult {
  const normalized = normalizeAssistantText(message ?? '');
  if (!normalized) {
    return {
      text: limitSummary(DEFAULT_SUMMARY, config),
      state: 'ready'
    };
  }

  const summary = config.overlaySummaryStyle === 'raw'
    ? normalized
    : buildSmartSummary(normalized);
  const text = limitSummary(summary || DEFAULT_SUMMARY, config);
  return {
    text,
    state: classifySummaryState(text)
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

function buildSmartSummary(text: string): string | undefined {
  const fragments = text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((fragment) => fragment.trim().replace(/^[:\-–\s]+/, ''))
    .filter(Boolean);
  const meaningful = chooseMeaningfulFragment(fragments) ?? chooseMeaningfulFragment([text]);
  return meaningful?.replace(/\s+/g, ' ').trim() || undefined;
}

function chooseMeaningfulFragment(fragments: string[]): string | undefined {
  return fragments
    .map((fragment) => ({ fragment, score: scoreFragment(fragment) }))
    .filter(({ score }) => score > -100)
    .sort((left, right) => right.score - left.score)[0]?.fragment;
}

function scoreFragment(fragment: string): number {
  if (GENERIC_SENTENCE.test(fragment) || STATE_ONLY_SENTENCE.test(fragment) || !/[A-Za-z0-9]/.test(fragment)) {
    return -100;
  }

  let score = fragment.length >= 20 ? 2 : 0;
  if (fragment.length > 160) score -= 2;
  if (ACTION_PATTERN.test(fragment)) score += 4;
  if (BLOCKED_PATTERN.test(fragment) || FAILED_PATTERN.test(fragment) || INPUT_PATTERN.test(fragment)) score += 5;
  if (/^(i |i've |i updated|i fixed|i added)/i.test(fragment)) score += 1;
  return score;
}

function classifySummaryState(text: string): SummaryState {
  if (FAILED_PATTERN.test(text)) return 'failed';
  if (BLOCKED_PATTERN.test(text)) return 'blocked';
  if (INPUT_PATTERN.test(text)) return 'needs-input';
  if (ACTION_PATTERN.test(text) || GENERIC_SENTENCE.test(text)) return 'done';
  return 'ready';
}

function limitSummary(text: string, config: AppConfig): string {
  const words = text.split(/\s+/).filter(Boolean);
  const wordLimited = words.length > config.overlaySummaryMaxWords
    ? `${words.slice(0, config.overlaySummaryMaxWords).join(' ')}…`
    : text;
  if (wordLimited.length <= config.overlaySummaryMaxChars) return wordLimited;

  const sliced = wordLimited.slice(0, Math.max(0, config.overlaySummaryMaxChars - 1));
  const boundary = sliced.lastIndexOf(' ');
  return `${(boundary > 24 ? sliced.slice(0, boundary) : sliced).trim()}…`;
}
