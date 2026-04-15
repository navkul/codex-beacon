import { existsSync, readFileSync } from 'node:fs';

export function summarizeTranscriptTail(transcriptPath?: string | null): string {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return 'Codex is ready for your next prompt.';
  }

  const text = readFileSync(transcriptPath, 'utf8');
  const tail = text.slice(Math.max(0, text.length - 6000));
  const lines = tail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.length < 8) {
      continue;
    }
    if (line.includes('"type":"assistant"') || line.includes('assistant')) {
      return compact(line);
    }
  }

  return compact(lines.at(-1) ?? 'Codex is ready for your next prompt.');
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[{}\[\]"]/g, '').slice(0, 220).trim();
}
