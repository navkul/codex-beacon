import assert from 'node:assert/strict';
import test from 'node:test';
import { detectSessionOrigin } from '../src/session-origin.js';

test('identifies Codex Desktop and enables exact thread navigation', () => {
  const origin = detectSessionOrigin({
    CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'Codex Desktop',
    CODEX_THREAD_ID: 'thread-123'
  });
  assert.deepEqual(origin, {
    surface: 'desktop',
    navigationPrecision: 'exact-thread'
  });
});

test('identifies an ordinary iTerm Codex session without the Navex wrapper', () => {
  const origin = detectSessionOrigin({
    TERM_PROGRAM: 'iTerm.app',
    ITERM_SESSION_ID: 'w0t1p0:session-456'
  });
  assert.equal(origin.surface, 'cli');
  assert.equal(origin.navigationPrecision, 'exact-window');
  assert.equal(origin.terminalSessionUniqueId, 'session-456');
});
