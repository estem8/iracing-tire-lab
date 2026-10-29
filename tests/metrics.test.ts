import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  errorStats,
  formatScore,
  parseReference,
  score,
  scoreSteps,
  type ScoreStep,
} from '../src/metrics/index.ts';
import { OverlayPhysicsModel } from '../src/model/overlayModel.ts';
import { IbtFile } from '../src/ibt/reader.ts';
import { IbtVarType } from '../src/ibt/types.ts';
import { buildIbt } from '../src/ibt/testBuilder.ts';
import { frames } from '../src/replay/samples.ts';
import type { Corner, TireOutput } from '../src/model/types.ts';

test('errorStats: known values, and nothing to measure is null, not 0', () => {
  const s = errorStats([2, -4, 0]);
  assert.equal(s.n, 3);
  assert.equal(s.mae, 2);
  assert.equal(s.max, 4);
  assert.equal(s.bias, -2 / 3);
  assert.ok(Math.abs((s.rmse as number) - Math.sqrt(20 / 3)) < 1e-12);
  assert.deepEqual(errorStats([]), {
    n: 0,
    mae: null,
    rmse: null,
    max: null,
    bias: null,
  });
});

const valid = {
  schema: 1,
  source: 'hand-read dash, test',
  readings: [{ t: 10, corner: 'lf', quantity: 'carcass', value: 80 }],
};

test('parseReference accepts a valid file and defaults the kind', () => {
  const ref = parseReference(JSON.stringify(valid));
  assert.equal(ref.readings[0].kind, 'other');
  assert.equal(ref.source, 'hand-read dash, test');
});

test('parseReference names what is wrong', () => {
  const bad = (patch: object, expect: RegExp) =>
    assert.throws(
      () => parseReference(JSON.stringify({ ...valid, ...patch })),
      expect,
    );
  assert.throws(() => parseReference('{'), /not valid JSON/);
  bad({ schema: 2 }, /schema/);
  bad({ source: '' }, /where the values came from/);
  bad({ readings: [{ ...valid.readings[0], t: -1 }] }, /readings\[0\].*"t"/);
  bad({ readings: [{ ...valid.readings[0], corner: 'xx' }] }, /corner/);
  bad({ readings: [{ ...valid.readings[0], quantity: 'wear' }] }, /quantity/);
  bad({ readings: [{ ...valid.readings[0], value: null }] }, /value/);
  bad({ readings: [{ ...valid.readings[0], kind: 'guess' }] }, /kind/);
});

const out = (carcass: number, tread?: number): TireOutput => ({
  carcass: { lf: { kind: 'estimate', model: 't', value: carcass } },
  ...(tread !== undefined && {
    tread: { lf: { kind: 'estimate', model: 't', value: tread } },
  }),
});
const steps: ScoreStep[] = [
  { t: 0, phase: 'track', output: out(50, 60) },
  { t: 1, phase: 'track', output: out(60, 70) },
  { t: 2, phase: 'pit', output: out(70, 80) },
];
const ref = (...r: [number, string, number, string?][]) =>
  parseReference(
    JSON.stringify({
      schema: 1,
      source: 's',
      readings: r.map(([t, quantity, value, kind]) => ({
        t,
        corner: 'lf',
        quantity,
        value,
        kind,
      })),
    }),
  );

test('score matches a reading to the latest step at or before it', () => {
  const s = score(
    steps,
    ref([1, 'carcass', 58], [1.9, 'carcass', 64], [2, 'tread', 78]),
  );
  assert.deepEqual(
    s.pairs.map((p) => [p.model, p.reference]),
    [
      [60, 58], // exactly at t=1
      [60, 64], // 1.9 s: the step at t=1, not the later one
      [80, 78], // tread, from the step at t=2
    ],
  );
  assert.equal(s.overall.n, 3);
  assert.equal(s.overall.bias, (2 - 4 + 2) / 3);
  assert.equal(s.unmatched, 0);
});

test('score counts what it cannot compare instead of dropping it silently', () => {
  // t=5 is 3 s after the last step, over the 1 s gap; t=1 tread is fine.
  const s = score(steps, ref([5, 'carcass', 70], [1, 'tread', 70]));
  assert.equal(s.unmatched, 1);
  assert.equal(s.overall.n, 1);
  // A reading before the first step has nothing to compare to.
  const late = score([{ ...steps[1] }], ref([0.5, 'carcass', 60]));
  assert.equal(late.unmatched, 1);
  // A step with no value for the corner is unmatched too.
  const none = score(
    [{ t: 0, phase: 'track', output: { carcass: {} } }],
    ref([0, 'carcass', 1]),
  );
  assert.equal(none.unmatched, 1);
  assert.equal(none.overall.mae, null);
});

test('score groups by corner, quantity, phase and kind', () => {
  const s = score(
    steps,
    ref([1, 'carcass', 55, 'dash'], [2, 'carcass', 75, 'pit-reading']),
  );
  assert.deepEqual(
    s.byPhase.map((g) => [g.key, g.stats.n, g.stats.bias]),
    [
      ['pit', 1, -5],
      ['track', 1, 5],
    ],
  );
  assert.deepEqual(
    s.byKind.map((g) => g.key),
    ['dash', 'pit-reading'],
  );
  assert.deepEqual(
    s.byCorner.map((g) => g.key),
    ['lf'],
  );
  const text = formatScore(s);
  assert.match(text, /by phase/);
  assert.match(text, /model minus reference/);
});

const YAML =
  'DriverInfo:\n DriverCarIdx: 0\n Drivers:\n - CarIdx: 0\n   CarPath: ferrari296gt3\n';
const CORNERS: Corner[] = ['lf', 'rf', 'lr', 'rr'];
const P = { lf: 'LF', rf: 'RF', lr: 'LR', rr: 'RR' };
const vars = [
  { name: 'SessionTick', type: IbtVarType.Int },
  { name: 'SessionTime', type: IbtVarType.Double },
  { name: 'Speed', type: IbtVarType.Float },
  { name: 'LatAccel', type: IbtVarType.Float },
  { name: 'IsOnTrack', type: IbtVarType.Bool },
  { name: 'AirTemp', type: IbtVarType.Float },
  ...CORNERS.flatMap((c) =>
    ['L', 'M', 'R'].map((z) => ({
      name: `${P[c]}tempC${z}`,
      type: IbtVarType.Float,
    })),
  ),
];
const rows = Array.from({ length: 1800 }, (_, i) => ({
  SessionTick: i,
  SessionTime: i / 60,
  Speed: 50,
  LatAccel: 10 * Math.sin(i / 90),
  IsOnTrack: 1,
  AirTemp: 20,
  ...Object.fromEntries(
    CORNERS.flatMap((c) =>
      ['L', 'M', 'R'].map((z) => [`${P[c]}tempC${z}`, 40]),
    ),
  ),
}));

test('the overlay-physics model seeds from the first reading and gives carcass and tread', () => {
  const file = path.join(os.tmpdir(), `score-${process.pid}.ibt`);
  fs.writeFileSync(file, buildIbt({ yaml: YAML, vars, rows }));
  const ibt = IbtFile.open(file);
  const result = scoreSteps(
    new OverlayPhysicsModel('ferrari296gt3'),
    frames(ibt),
    {
      hz: 15,
      mask: 'live',
    },
  );
  ibt.close();
  fs.rmSync(file);
  assert.ok(result.length > 400);
  const first = result.find((s) => s.output.carcass.lf);
  assert.ok(first, 'carcass appears once the model has stepped');
  // Seeded at the 40 C reading (below the stale-start cap), then driven.
  assert.ok(Math.abs((first.output.carcass.lf!.value as number) - 40) < 2);
  assert.ok(result.at(-1)!.output.tread!.lf!.value > 0);
  assert.equal(first.phase, 'track');
});

test('tire-lab score prints the table and --json; a bad reference fails with its reason', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-cli-'));
  const ibt = path.join(dir, 'a.ibt');
  fs.writeFileSync(ibt, buildIbt({ yaml: YAML, vars, rows }));
  const refPath = path.join(dir, 'ref.json');
  fs.writeFileSync(
    refPath,
    JSON.stringify({
      schema: 1,
      source: 'synthetic',
      readings: [
        { t: 10, corner: 'lf', quantity: 'carcass', value: 41, kind: 'dash' },
        { t: 20, corner: 'rr', quantity: 'carcass', value: 45, kind: 'dash' },
      ],
    }),
  );
  const run = (...args: string[]) =>
    execFileSync('node', ['src/cli/index.ts', 'score', ibt, ...args], {
      encoding: 'utf8',
    });
  const table = run('--reference', refPath);
  assert.match(table, /car ferrari296gt3/);
  assert.match(table, /RMSE/);
  const json = JSON.parse(run('--reference', refPath, '--json'));
  assert.equal(json.overall.n, 2);
  assert.equal(json.unmatched, 0);
  fs.writeFileSync(refPath, '{"schema":1,"source":"x","readings":[{"t":1}]}');
  assert.throws(() => run('--reference', refPath), /readings\[0\]/);
  fs.rmSync(dir, { recursive: true });
});

test('tire-lab chart --model adds dashed model series to the page', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-model-'));
  const ibt = path.join(dir, 'a.ibt');
  fs.writeFileSync(ibt, buildIbt({ yaml: YAML, vars, rows }));
  const html = path.join(dir, 'c.html');
  const said = execFileSync(
    'node',
    [
      'src/cli/index.ts',
      'chart',
      ibt,
      '--out',
      html,
      '--channels',
      'LFtempCM',
      '--model',
    ],
    { encoding: 'utf8' },
  );
  const page = fs.readFileSync(html, 'utf8');
  assert.match(page, /model LF carcass/);
  assert.match(page, /model RR tread/);
  assert.match(said, /series/);
  fs.rmSync(dir, { recursive: true });
});
