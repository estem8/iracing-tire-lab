import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { IbtFile } from '../src/ibt/reader.ts';
import { buildIbt } from '../src/ibt/testBuilder.ts';
import { IbtVarType } from '../src/ibt/types.ts';
import { applyMask } from '../src/model/mask.ts';
import type {
  TireModel,
  TireOutput,
  TireSample,
  WheelSample,
} from '../src/model/types.ts';
import { PRODUCTION_HZ, replayModel } from '../src/replay/replay.ts';
import { frames } from '../src/replay/samples.ts';
import { resample, takeTick } from '../src/replay/schedule.ts';

const clocks = (n: number, hz = 60) =>
  Array.from({ length: n }, (_, i) => ({ clock: i / hz }));

test('15 Hz on 60 Hz frames keeps every fourth frame', () => {
  const kept = [...resample(clocks(120), 15)];
  assert.equal(kept.length, 30);
  assert.deepEqual(
    kept.slice(0, 3).map((f) => f.clock),
    [0, 4 / 60, 8 / 60],
  );
});

test('a rate that does not divide the frame rate still averages the rate', () => {
  const kept = [...resample(clocks(600), 25)];
  assert.ok(Math.abs(kept.length - 250) <= 1, String(kept.length));
});

test('a seek back restarts the schedule; a frozen clock always runs', () => {
  const s = {};
  assert.equal(takeTick(s, 15, 10), true);
  assert.equal(takeTick(s, 15, 10.01), false);
  assert.equal(takeTick(s, 15, 2), true); // seek back
  assert.equal(takeTick(s, 15, 2), true); // same time again: frozen clock
});

const wheelAll: WheelSample = {
  carcass: [60, 61, 62],
  surface: [70, 71, 72],
  treadRemaining: [0.9, 0.9, 0.9],
  coldPressureKpa: 160,
  hotPressureKpa: 190,
};
const sample: TireSample = {
  t: 1,
  dt: 0.1,
  speed: 30,
  wheels: { lf: wheelAll, rf: wheelAll, lr: wheelAll, rr: wheelAll },
};

test('the live mask removes surface and hot pressure, keeps the rest, copies', () => {
  const live = applyMask(sample, 'live');
  assert.equal(live.wheels.lf.surface, null);
  assert.equal(live.wheels.rr.hotPressureKpa, null);
  assert.deepEqual(live.wheels.lf.carcass, [60, 61, 62]);
  assert.equal(live.wheels.lf.coldPressureKpa, 160);
  assert.deepEqual(sample.wheels.lf.surface, [70, 71, 72]); // input untouched
  assert.equal(applyMask(sample, 'all'), sample);
});

const YAML = 'WeekendInfo:\n TrackName: t\n';
const ROWS = 120;
const corner = (p: string, surface: boolean) => [
  ...['L', 'M', 'R'].map((z) => ({
    name: `${p}tempC${z}`,
    type: IbtVarType.Float,
  })),
  ...['L', 'M', 'R'].map((z) => ({
    name: `${p}wear${z}`,
    type: IbtVarType.Float,
  })),
  { name: `${p}coldPressure`, type: IbtVarType.Float },
  ...(surface
    ? ['L', 'M', 'R'].map((z) => ({
        name: `${p}temp${z}`,
        type: IbtVarType.Float,
      }))
    : []),
];
const vars = [
  { name: 'SessionTick', type: IbtVarType.Int },
  { name: 'SessionTime', type: IbtVarType.Double },
  { name: 'Speed', type: IbtVarType.Float },
  ...corner('LF', true), // LF records everything but hot pressure
  { name: 'RFtempCL', type: IbtVarType.Float }, // RF: one zone only; LR, RR: nothing
];
const rows = Array.from({ length: ROWS }, (_, i) => ({
  SessionTick: 1000 + i,
  SessionTime: i / 60,
  Speed: 40,
  LFtempCL: 60 + i / 100,
  LFtempCM: 61,
  LFtempCR: 62,
  LFtempL: 80,
  LFtempM: 81,
  LFtempR: 82,
  LFcoldPressure: 160,
  LFwearL: 0.9,
  LFwearM: 0.9,
  LFwearR: 0.9,
}));

const tmpIbt = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tire-lab-'));
  const file = path.join(dir, 'r.ibt');
  fs.writeFileSync(file, buildIbt({ yaml: YAML, vars, rows }));
  return file;
};

test('missing channels become null, never 0; present ones are read', () => {
  const f = IbtFile.open(tmpIbt());
  try {
    const first = frames(f).next().value!;
    assert.deepEqual(first.sample.wheels.lf.carcass, [60, 61, 62]);
    assert.deepEqual(first.sample.wheels.lf.surface, [80, 81, 82]);
    assert.equal(first.sample.wheels.rf.surface, null);
    assert.equal(first.sample.wheels.rf.hotPressureKpa, null);
    assert.equal(first.sample.wheels.lf.hotPressureKpa, null); // channel not in the file
    assert.equal(first.sample.wheels.rf.carcass, null); // RF zones not recorded here
    assert.equal(first.clock, 1000 / 60);
  } finally {
    f.close();
  }
});

/** Keeps a running sum of dt and what it was shown. */
const probe = () => {
  const seen: TireSample[] = [];
  let elapsed = 0;
  const model: TireModel = {
    reset() {
      seen.length = 0;
      elapsed = 0;
    },
    step(s): TireOutput {
      seen.push(s);
      elapsed += s.dt;
      return {
        carcass: { lf: { kind: 'estimate', model: 'probe', value: elapsed } },
      };
    },
  };
  return { model, seen };
};

test('replay at the production rate is deterministic and shows the live set', () => {
  const f = IbtFile.open(tmpIbt());
  try {
    const run = () => {
      const { model, seen } = probe();
      const steps = [
        ...replayModel(model, frames(f), {
          hz: PRODUCTION_HZ,
          mask: 'live',
        }),
      ];
      return { steps, seen };
    };
    const a = run();
    const b = run();
    assert.deepEqual(a.steps, b.steps);
    assert.equal(a.steps.length, 30);
    assert.equal(a.steps[0].dt, 0);
    // 15 Hz picked from 20 Hz frames: the step alternates 50 and 100 ms, 2:1
    const ms = a.steps.slice(1).map((s) => Math.round(s.dt * 1000));
    assert.deepEqual([...new Set(ms)].sort(), [100, 50]);
    assert.equal(ms.filter((d) => d === 50).length, 19);
    assert.equal(ms.filter((d) => d === 100).length, 10);
    assert.ok(a.seen.every((s) => s.wheels.lf.surface === null));
    assert.deepEqual(a.seen[0].wheels.lf.carcass, [60, 61, 62]);
    const all = probe();
    [...replayModel(all.model, frames(f), { hz: 15, mask: 'all' })];
    assert.deepEqual(all.seen[0].wheels.lf.surface, [80, 81, 82]);
  } finally {
    f.close();
  }
});

test('arrivalHz is an option: the recording rate gives an even 15 Hz, a finer rate more steps', () => {
  const f = IbtFile.open(tmpIbt());
  try {
    const steps = (arrivalHz?: number) => [
      ...replayModel(probe().model, frames(f), {
        hz: PRODUCTION_HZ,
        mask: 'live',
        arrivalHz,
      }),
    ];
    const even = steps(60);
    assert.equal(even.length, 30);
    assert.ok(even.slice(1).every((s) => Math.abs(s.dt - 1 / 15) < 1e-9));
    assert.deepEqual(steps(undefined), steps(20)); // 20 Hz is the default
    assert.throws(() => steps(0), RangeError);
  } finally {
    f.close();
  }
});

test('cli sample writes the masked input stream at the overlay rates', () => {
  const input = tmpIbt();
  const out = path.join(path.dirname(input), 's.csv');
  execFileSync('node', [
    path.resolve('src/cli/index.ts'),
    'sample',
    input,
    '--out',
    out,
  ]);
  const lines = fs.readFileSync(out, 'utf8').trim().split('\n');
  assert.equal(lines.length, 31); // header + 30 samples
  const header = lines[0].split(',');
  const row = lines[1].split(',');
  assert.equal(row.length, header.length);
  assert.equal(row[header.indexOf('lf.carcassL')], '60');
  assert.equal(row[header.indexOf('lf.surfaceL')], ''); // masked: empty, not 0
  assert.equal(row[header.indexOf('rf.carcassL')], ''); // not recorded: empty, not 0
  const ms = lines
    .slice(2)
    .map((l) => Math.round(Number(l.split(',')[header.indexOf('dt')]) * 1000));
  assert.deepEqual([...new Set(ms)].sort(), [100, 50]); // alternating, as in the app
});
