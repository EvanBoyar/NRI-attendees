import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionWindow, mergeIntervals, secondsInWindow } from '../src/score.js';
import { parseZoomTime } from '../src/zoom.js';

const session = { date: '2026-08-26', start: '17:00', end: '18:30' };

test('session window is 90 minutes', () => {
  const win = sessionWindow(session);
  assert.equal(win.seconds, 5400);
});

test('overlapping intervals are merged before counting', () => {
  const win = sessionWindow(session);
  const ivs = [
    { start: parseZoomTime('08/26/2026 4:50:00 PM'), end: parseZoomTime('08/26/2026 5:30:00 PM') },
    { start: parseZoomTime('08/26/2026 5:20:00 PM'), end: parseZoomTime('08/26/2026 5:40:00 PM') },
    { start: parseZoomTime('08/26/2026 6:00:00 PM'), end: parseZoomTime('08/26/2026 6:45:00 PM') },
  ];
  assert.equal(mergeIntervals(ivs).length, 2);
  assert.equal(secondsInWindow(ivs, win), (40 + 30) * 60);
});

test('parses Zoom timestamps with and without seconds', () => {
  assert.equal(parseZoomTime('08/26/2026 4:50:00 PM').getHours(), 16);
  assert.equal(parseZoomTime('08/26/2026 12:05 AM').getHours(), 0);
  assert.equal(parseZoomTime('08/26/2026 12:05 PM').getHours(), 12);
  assert.equal(parseZoomTime('not a time'), null);
});
