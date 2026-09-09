import assert from 'node:assert/strict';
import test from 'node:test';
import { renderHooksJson } from '../src/install.js';

test('installs passive lifecycle hooks for complete session tracking', () => {
  const rendered = JSON.parse(renderHooksJson()) as {
    hooks: Record<string, Array<{ hooks: Array<{ async?: boolean }> }>>;
  };
  assert.deepEqual(Object.keys(rendered.hooks), [
    'SessionStart',
    'UserPromptSubmit',
    'Stop',
    'Interrupt',
    'SessionEnd'
  ]);
  assert.equal(rendered.hooks.SessionStart[0].hooks[0].async, true);
  assert.equal(rendered.hooks.Stop[0].hooks[0].async, undefined);
  assert.equal(rendered.hooks.SessionEnd[0].hooks[0].async, undefined);
});
