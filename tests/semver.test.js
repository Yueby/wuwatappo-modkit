// The small range grammar mods use to say which versions of another mod, or of Node, they work
// with.   node --test tests/semver.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, satisfies, validRange } from '../src/lib/semver.js';

test('versions parse, with a leading v, missing parts and tags tolerated', () => {
  assert.deepEqual(parse('1.2.3'), [1, 2, 3]);
  assert.deepEqual(parse('v22'), [22, 0, 0]);
  assert.deepEqual(parse('1.2'), [1, 2, 0]);
  assert.deepEqual(parse('1.2.3-beta.4+build'), [1, 2, 3]);
  assert.equal(parse('not a version'), null);
  assert.equal(parse(''), null);
});

test('ranges say what they say', () => {
  const cases = [
    // [version, range, satisfied]
    ['1.2.3', '*', true],
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '1.2.3', false],
    ['1.2.3', '=1.2.3', true],
    ['1.2.3', '>=1.2.3', true],
    ['1.2.2', '>=1.2.3', false],
    ['1.2.4', '>1.2.3', true],
    ['1.2.3', '>1.2.3', false],
    ['1.2.3', '<=1.2.3', true],
    ['1.2.4', '<=1.2.3', false],
    ['1.2.2', '<1.2.3', true],
    ['1.2.3', '<1.2.3', false],
    ['1.9.0', '^1.2.0', true],
    ['2.0.0', '^1.2.0', false],
    ['1.1.9', '^1.2.0', false],
    ['0.2.5', '^0.2.0', true],
    ['0.3.0', '^0.2.0', false],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.2.2', '~1.2.3', false],
    ['1.5.0', '1.x', true],
    ['2.0.0', '1.x', false],
    ['1.2.7', '1.2', true],
    ['1.3.0', '1.2.x', false],
    ['22.4.0', '>=22', true],
    ['20.0.0', '>=22', false],
    ['1.5.0', '>=1.2.0 <2.0.0', true],
    ['2.0.0', '>=1.2.0 <2.0.0', false],
    ['3.1.0', '^1.0.0 || ^3.0.0', true],
    ['2.1.0', '^1.0.0 || ^3.0.0', false],
  ];
  for (const [version, range, expected] of cases) {
    assert.equal(satisfies(version, range), expected, `${version} against ${range}`);
  }
});

test('a version that is not one satisfies only "any"', () => {
  assert.equal(satisfies(null, '*'), true);
  assert.equal(satisfies(undefined, '^1.0.0'), false);
  assert.equal(satisfies('banana', '>=1.0.0'), false);
});

test('what is not a range is said not to be one', () => {
  for (const bad of ['banana', '>>1.0.0', '1.0.0 ~', '^', '1..2']) assert.equal(validRange(bad), false, bad);
  for (const good of ['*', '1.2.3', '^1.2.3', '>=1 <3', '1.x || 2.x']) assert.equal(validRange(good), true, good);
  assert.equal(satisfies('1.0.0', 'banana'), false);
});
