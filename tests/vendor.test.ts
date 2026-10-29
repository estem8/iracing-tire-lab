import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FILES, transform } from '../scripts/vendorIrdashies.ts';

const DIR = 'src/model/irdashies';
const provenance = JSON.parse(
  fs.readFileSync(path.join(DIR, 'PROVENANCE.json'), 'utf8'),
) as {
  commit: string;
  files: { from: string; to: string; localSha256: string }[];
};
const sha = (text: string) =>
  crypto.createHash('sha256').update(text).digest('hex');

test('vendored files are exactly what the last vendoring wrote: nobody edited a copy by hand', () => {
  for (const f of provenance.files) {
    assert.equal(
      sha(fs.readFileSync(f.to, 'utf8')),
      f.localSha256,
      `${f.to} differs from the recorded copy; change it upstream and re-vendor`,
    );
  }
});

test('every vendored file is listed, and every listed file exists', () => {
  const onDisk = fs
    .readdirSync(DIR)
    .filter((n) => n.endsWith('.ts'))
    .sort();
  assert.deepEqual(onDisk, FILES.map(([, name]) => name).sort());
  assert.deepEqual(
    provenance.files.map((f) => path.basename(f.to)).sort(),
    onDisk,
  );
  assert.match(provenance.commit, /^[0-9a-f]{40}$/);
});

const COMMIT = 'a'.repeat(40);

test('the transform rewrites what it declares and refuses what it cannot make runnable', () => {
  const ok = transform(
    "import type { TireCorner } from '@irdashies/types';\nimport { a } from './other';\n",
    'src/x.ts',
    COMMIT,
  );
  assert.ok(
    ok.includes("import type { Corner as TireCorner } from '../types.ts';"),
  );
  assert.ok(ok.includes("from './other.ts'"));
  assert.ok(ok.startsWith('/**\n * Vendored from irdashies'));
  assert.ok(ok.includes(COMMIT));

  // an import from the app that has no equivalent here
  assert.throws(
    () => transform("import { x } from '@irdashies/other';", 'f.ts', COMMIT),
    /@irdashies/,
  );
  // syntax Node cannot strip, other than the one constructor it knows how to rewrite
  assert.throws(
    () =>
      transform(
        'class A { constructor(private n: number) {} }',
        'f.ts',
        COMMIT,
      ),
    /parameter property/,
  );
  // the one it knows becomes a plain field
  const c = transform(
    'class A {\n  constructor(private params: SurfaceParams) {}\n}',
    'f.ts',
    COMMIT,
  );
  assert.ok(c.includes('this.params = params;'));
});
