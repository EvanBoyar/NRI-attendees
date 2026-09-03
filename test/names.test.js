import test from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, nameTokens, cleanDisplayName, editDistance } from '../src/names.js';

test('strips device tags, pronouns, emoji, honorifics, and accents', () => {
  assert.equal(nameKey('Amir Acosta (iPhone)'), 'acosta amir');
  assert.equal(nameKey('Cam A. (he/him)'), 'a cam');
  assert.equal(nameKey('🌱 Lena Park 🌱'), 'lena park');
  assert.equal(nameKey('Prof. Leila Nassar (Guest Speaker)'), 'leila nassar');
  assert.equal(nameKey('José Ramírez'), 'jose ramirez');
  assert.equal(nameKey('NGUYEN THANH'), 'nguyen thanh');
  assert.equal(nameKey('Priya  Shah'), 'priya shah');
});

test('expands short first names', () => {
  assert.equal(nameKey('Mike Sandoval'), 'michael sandoval');
  assert.equal(nameKey('Michael Sandoval'), 'michael sandoval');
});

test('display name keeps casing but drops tags', () => {
  assert.equal(cleanDisplayName('Ahm D. (she/her)'), 'Ahm D.');
  assert.equal(cleanDisplayName('🌱 Lena Park 🌱'), 'Lena Park');
});

test('edit distance counts transpositions as one', () => {
  assert.equal(editDistance('paulo ganonn', 'paulo gannon'), 1);
  assert.equal(editDistance('rebecca daltno', 'rebecca dalton'), 1);
  assert.equal(editDistance('abc', 'abc'), 0);
  assert.deepEqual(nameTokens(''), []);
});
