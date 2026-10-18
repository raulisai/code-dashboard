import test from 'node:test';
import assert from 'node:assert/strict';
import {best, resetIn, stateMessage, tone, windowLabel} from '../src/quota.js';

test('etiquetas y tonos de las ventanas', () => {
  assert.deepEqual([windowLabel(300), windowLabel(10080), tone(10), tone(75), tone(95)], ['Cada 5 horas', 'Semanal', 'ok', 'warn', 'bad']);
});
test('tiempo hasta el reinicio', () => {
  assert.equal(resetIn(1000 + 90 * 60, 1000), 'se reinicia en 1 h 30 min');
  assert.equal(resetIn(1000 + 3 * 86400 + 5 * 3600, 1000), 'se reinicia en 3 d 5 h');
  assert.equal(resetIn(500, 1000), 'se reinicia ya');
  assert.equal(resetIn(null), '');
});
test('recomienda el proveedor con más margen y explica los estados', () => {
  const ok = used => ({state: 'ok', windows: [{used: 10}, {used}]});
  assert.equal(best({claude: ok(38), codex: {state: 'ok', windows: [{used: 100}, {used: 16}]}}), 'claude');
  assert.equal(best({claude: {state: 'error', windows: []}, codex: ok(5)}), 'codex');
  assert.equal(best({claude: {state: 'error', windows: []}, codex: {state: 'logged_out', windows: []}}), '');
  assert.match(stateMessage({state: 'logged_out'}), /Sin sesión/);
  assert.equal(stateMessage({state: 'ok'}), '');
});
