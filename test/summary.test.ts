import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeAssistantMessage } from '../src/summary.js';
import { AppConfig } from '../src/types.js';

const config: AppConfig = {
  appDisplayName: 'Navex',
  overlayCommand: null,
  overlayHotkey: null,
  overlayWidth: 384,
  overlayMaxVisibleRows: 4,
  overlayShowSummary: true,
  overlaySummaryStyle: 'smart',
  overlaySummaryMaxChars: 160,
  overlaySummaryMaxWords: 24,
  overlaySummaryMaxLines: 2
};

test('summarizes the supported Stop hook message without a transcript', () => {
  const result = summarizeAssistantMessage(
    'Done. I implemented Desktop session tracking and updated the tests.',
    config
  );
  assert.equal(result.text, 'I implemented Desktop session tracking and updated the tests.');
  assert.equal(result.state, 'done');
});

test('uses a stable fallback when Stop has no assistant message', () => {
  const result = summarizeAssistantMessage(null, config);
  assert.match(result.text, /^Finished\./);
  assert.equal(result.state, 'ready');
});
