import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from '../src/csv.js';

test('parses quoted fields, CRLF, and BOM', () => {
  const text = '﻿a,b,c\r\n"x, y","he said ""hi""",3\r\n';
  assert.deepEqual(parseCsv(text), [['a', 'b', 'c'], ['x, y', 'he said "hi"', '3']]);
});

test('skips blank lines', () => {
  assert.deepEqual(parseCsv('a,b\n\n,\n1,2\n'), [['a', 'b'], ['1', '2']]);
});

test('round trips through toCsv', () => {
  const rows = [['a', 'b,c', 'd"e'], ['1', '', 'x']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});
