import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const MODEL = path.resolve('src/model');

const tsFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return tsFiles(full);
    return e.name.endsWith('.ts') ? [full] : [];
  });

/**
 * The model must stay reusable in the overlay: no I/O, UI or reader imports.
 * A relative import is fine only if it stays inside src/model, so a file in a
 * subfolder cannot reach out to ../ibt or ../cli.
 */
test('src/model, subfolders included, imports nothing from outside itself', () => {
  const files = tsFiles(MODEL);
  assert.ok(files.length > 3, 'the walk should find the vendored files too');
  const offenders: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(
      /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g,
    )) {
      const spec = m[1];
      const inside =
        spec.startsWith('.') &&
        path.resolve(path.dirname(file), spec).startsWith(MODEL + path.sep);
      if (!inside) offenders.push(`${path.relative(MODEL, file)}: ${spec}`);
    }
  }
  assert.deepEqual(offenders, []);
});
