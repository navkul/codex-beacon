import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listSessions, upsertFromEvent } from '../src/session-registry.js';

test('keeps Desktop sessions that do not have launcher processes', { concurrency: false }, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'navex-registry-'));
  const previous = process.env.NAVEX_HOME;
  process.env.NAVEX_HOME = root;

  try {
    upsertFromEvent({
      type: 'session-active',
      sessionId: 'thread-desktop',
      turnId: 'turn-1',
      cwd: '/workspace',
      surface: 'desktop',
      navigationPrecision: 'exact-thread',
      timestamp: '2026-09-09T10:00:00.000Z'
    });
    upsertFromEvent({
      type: 'session-stop',
      sessionId: 'thread-desktop',
      turnId: 'turn-1',
      cwd: '/workspace',
      surface: 'desktop',
      navigationPrecision: 'exact-thread',
      timestamp: '2026-09-09T10:01:00.000Z'
    });

    const [session] = listSessions();
    assert.equal(session.sessionId, 'thread-desktop');
    assert.equal(session.kind, 'codex-thread');
    assert.equal(session.surface, 'desktop');
    assert.equal(session.status, 'done');
    assert.equal(session.lastCompletedTurnId, 'turn-1');

    upsertFromEvent({
      type: 'session-active',
      sessionId: 'thread-desktop',
      turnId: 'turn-2',
      cwd: '/workspace',
      surface: 'desktop',
      navigationPrecision: 'exact-thread',
      timestamp: '2026-09-09T10:02:00.000Z'
    });
    upsertFromEvent({
      type: 'session-stop',
      sessionId: 'thread-desktop',
      turnId: 'turn-1',
      cwd: '/workspace',
      surface: 'desktop',
      navigationPrecision: 'exact-thread',
      timestamp: '2026-09-09T10:01:30.000Z'
    });

    const [afterLateStop] = listSessions();
    assert.equal(afterLateStop.status, 'active');
    assert.equal(afterLateStop.turnId, 'turn-2');
  } finally {
    if (previous === undefined) delete process.env.NAVEX_HOME;
    else process.env.NAVEX_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
