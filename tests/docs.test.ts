import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { renderChannelsDoc } from '../scripts/channelsDoc.ts';

const yamlText = fs.readFileSync('channels/channels.yaml', 'utf8');

test('docs/channels.md is up to date with channels/channels.yaml', () => {
  assert.equal(
    fs.readFileSync('docs/channels.md', 'utf8'),
    renderChannelsDoc(yamlText),
    'run `npm run docs` and commit the result',
  );
});

test('the channel page separates verified from unverified and escapes cells', () => {
  const page = renderChannelsDoc(`channels:
  - name: A
    meaning: "a | b"
    unit: C
    status: verified
    evidence: seen
    update_behaviour: unknown
  - name: B
    meaning: m
    unit: unknown
    status: unverified
    evidence: guessed
    update_behaviour: unknown
`);
  assert.ok(page.includes('## Verified (1)'));
  assert.ok(page.includes('## Unverified (1)'));
  assert.ok(page.includes('a \\| b'));
});

test('a channel without a valid status is rejected', () => {
  assert.throws(
    () =>
      renderChannelsDoc(
        'channels:\n  - name: X\n    status: probably\n    meaning: m\n    unit: u\n    evidence: e\n    update_behaviour: u\n',
      ),
    /status must be/,
  );
});

test('the examples run and print what the docs promise', () => {
  const read = execFileSync('node', ['examples/read-channels.ts'], {
    encoding: 'utf8',
  });
  assert.match(read, /surface channel recorded: false/);
  assert.match(read, /LFtempCL = 70\.4 C/);
  assert.match(read, /LatAccel_ST\[2\] = 2/);

  const replay = execFileSync('node', ['examples/replay-a-model.ts'], {
    encoding: 'utf8',
  });
  assert.match(replay, /30 steps at 15 Hz/);
  assert.match(replay, /"kind":"estimate"/);
});
