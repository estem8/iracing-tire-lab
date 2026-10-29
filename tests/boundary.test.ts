import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** The model must stay reusable in the overlay: no I/O, UI or reader imports. */
test('src/model imports nothing but itself', () => {
  const dir = path.resolve('src/model');
  const offenders: string[] = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const m of text.matchAll(
      /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g,
    )) {
      if (!m[1].startsWith('./')) offenders.push(`${name}: ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});
