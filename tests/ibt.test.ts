import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { formatValue, readVarValue } from '../src/ibt/binary.ts';
import { IbtFile } from '../src/ibt/reader.ts';
import { anonymizeSessionYaml, summarizeSession } from '../src/ibt/session.ts';
import { buildIbt } from '../src/ibt/testBuilder.ts';
import { IbtVarType } from '../src/ibt/types.ts';

const YAML = `---
WeekendInfo:
 TrackName: test track
 TrackAirTemp: 24.00 C
 SubSessionID: 12345678
DriverInfo:
 DriverCarIdx: 1
 Drivers:
 - CarIdx: 0
   UserName: Other Person
   UserID: 111
   CarPath: other
 - CarIdx: 1
   UserName: Jane Doe
   UserID: 222
   IRating: 2500
   CarPath: ferrari296gt3
   CarScreenName: Ferrari 296 GT3
`;

const vars = [
  { name: 'SessionTime', type: IbtVarType.Double, unit: 's', desc: 'Seconds' },
  {
    name: 'LFtempCL',
    type: IbtVarType.Float,
    unit: 'C',
    desc: 'LF carcass left',
  },
  { name: 'OnPitRoad', type: IbtVarType.Bool },
  { name: 'Shock', type: IbtVarType.Float, unit: 'm', count: 3 },
];
const rows = [
  { SessionTime: 1.5, LFtempCL: 70.3, OnPitRoad: 0, Shock: [1, 2, 3] },
  { SessionTime: 1.5167, LFtempCL: 70.4, OnPitRoad: 1, Shock: [4, 5, 6] },
];

const tmp = (name: string, data: Buffer) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tire-lab-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  return file;
};

test('reads header, units, descriptions and array channels', () => {
  const file = IbtFile.open(
    tmp('a.ibt', buildIbt({ yaml: YAML, vars, rows, tickRate: 60 })),
  );
  try {
    assert.equal(file.header.tickRate, 60);
    assert.equal(file.recordCount, 2);
    const t = file.channel('LFtempCL');
    assert.equal(t?.unit, 'C');
    assert.equal(t?.desc, 'LF carcass left');
    assert.equal(file.channel('Shock')?.count, 3);
    const rec = file.readRecord(1);
    assert.equal(readVarValue(rec, file.channel('Shock')!, 2), 6);
    assert.equal(readVarValue(rec, file.channel('OnPitRoad')!), 1);
    assert.throws(
      () => readVarValue(rec, file.channel('Shock')!, 3),
      RangeError,
    );
  } finally {
    file.close();
  }
});

test('names every missing channel and keeps absence distinct from zero', () => {
  const file = IbtFile.open(tmp('b.ibt', buildIbt({ yaml: YAML, vars, rows })));
  try {
    assert.equal(file.channel('LFtempL'), undefined);
    assert.throws(
      () => file.require(['LFtempL', 'LFpressure']),
      /LFtempL, LFpressure/,
    );
  } finally {
    file.close();
  }
});

test('clamps a header that claims more records than the file holds', () => {
  const file = IbtFile.open(
    tmp('c.ibt', buildIbt({ yaml: YAML, vars, rows, recordCount: 99 })),
  );
  try {
    assert.equal(file.recordCount, 2);
  } finally {
    file.close();
  }
});

test('rejects a wrong version and a truncated file', () => {
  assert.throws(
    () =>
      IbtFile.open(
        tmp('d.ibt', buildIbt({ yaml: YAML, vars, rows, version: 9 })),
      ),
    /version/,
  );
  const whole = buildIbt({ yaml: YAML, vars, rows });
  assert.throws(() => IbtFile.open(tmp('e.ibt', whole.subarray(0, 200))));
});

test('float32 text round-trips exactly', () => {
  const x = Math.fround(70.3);
  assert.equal(Math.fround(Number(formatValue(x, IbtVarType.Float))), x);
  assert.equal(formatValue(x, IbtVarType.Float), '70.3');
  assert.equal(formatValue(Number.NaN, IbtVarType.Float), '');
});

test('summary uses the player car and leaves out personal fields', () => {
  const s = summarizeSession(YAML);
  assert.equal(s.carPath, 'ferrari296gt3');
  assert.equal(s.trackAirTemp, '24.00 C');
  assert.ok(!JSON.stringify(s).includes('Jane'));
});

test('anonymizing keeps the byte length and removes names and ids', () => {
  const out = anonymizeSessionYaml(YAML);
  assert.equal(out.length, YAML.length);
  for (const secret of ['Jane', 'Doe', 'Other Person', '2500', '12345678']) {
    assert.ok(!out.includes(secret), secret);
  }
  assert.ok(out.includes('ferrari296gt3'));
  assert.ok(out.includes('TrackName: test track'));
});

test('cli: export writes a CSV and a sidecar, anonymize yields a readable file', () => {
  const input = tmp('f.ibt', buildIbt({ yaml: YAML, vars, rows }));
  const dir = path.dirname(input);
  const cli = path.resolve('src/cli/index.ts');
  const csv = path.join(dir, 'out.csv');
  execFileSync('node', [
    cli,
    'export',
    input,
    '--channels',
    'SessionTime,LFtempCL,Shock[2]',
    '--out',
    csv,
  ]);
  assert.equal(
    fs.readFileSync(csv, 'utf8'),
    'record,SessionTime,LFtempCL,Shock[2]\n0,1.5,70.3,3\n1,1.5167,70.4,6\n',
  );
  const meta = JSON.parse(
    fs.readFileSync(path.join(dir, 'out.meta.json'), 'utf8'),
  );
  assert.equal(meta.channels[1].unit, 'C');
  assert.equal(meta.session.carPath, 'ferrari296gt3');

  const anon = path.join(dir, 'anon.ibt');
  execFileSync('node', [cli, 'anonymize', input, anon], { stdio: 'pipe' });
  // `inspect --session` prints the raw YAML, so what is left can be read.
  const shown = execFileSync('node', [cli, 'inspect', anon, '--session'], {
    encoding: 'utf8',
  });
  assert.ok(!shown.includes('Jane') && !shown.includes('2500'));
  assert.ok(shown.includes('CarPath: ferrari296gt3'));
  const file = IbtFile.open(anon);
  try {
    assert.ok(!file.sessionYaml.includes('Jane'));
    assert.equal(file.recordCount, 2);
  } finally {
    file.close();
  }
});
