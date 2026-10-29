import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { OverlayModel } from '../src/model/overlayModel.ts';
import { fromTelemetryFrame } from '../src/model/telemetry.ts';
import type { ModelEvent } from '../src/model/types.ts';
import { sampleOf } from './golden/sample.ts';
import {
  CARS,
  PIT_IN_S,
  SESSION_CHANGE_S,
  stimulus,
  VARIANTS,
  type StimulusFrame,
} from './golden/stimulus.ts';

const wrap = (f: StimulusFrame) =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { value: [v] }]));

type Golden = Record<string, Record<string, (number | null)[]>>;
const golden = JSON.parse(
  zlib.gunzipSync(fs.readFileSync('tests/golden/processor.json.gz')).toString(),
) as Golden;

/** [time, event] for every event of a run. */
const eventsOf = (variant: (typeof VARIANTS)[number]) => {
  const model = new OverlayModel('bmwm4gt3');
  const log: [number, ModelEvent][] = [];
  for (const frame of stimulus(variant)) {
    const out = model.step(sampleOf(frame));
    for (const e of out.events ?? [])
      log.push([frame.SessionTime as number, e]);
  }
  return log;
};
const kinds = (log: [number, ModelEvent][], kind: string) =>
  log.filter(([, e]) => e.kind === kind);

test('events: clear at the session change, a seed per tire after it, refresh at the stop', () => {
  const log = eventsOf('base');
  const clears = kinds(log, 'clear');
  assert.equal(clears.length, 1);
  assert.ok(Math.abs(clears[0][0] - SESSION_CHANGE_S) < 0.2);
  // Two seeds per tire: at the start and again after the clear.
  assert.equal(kinds(log, 'seed').length, 8);
  const refresh = kinds(log, 'refresh');
  assert.equal(refresh.length, 4);
  for (const [t, e] of refresh) {
    assert.ok(Math.abs(t - (PIT_IN_S + 10)) < 0.2);
    assert.equal(e.kind === 'refresh' && e.changed, true);
  }
  assert.equal(kinds(log, 'fresh-late').length, 0);
});

test('events: which tires were changed, by variant', () => {
  const changed = (variant: (typeof VARIANTS)[number]) =>
    kinds(eventsOf(variant), 'refresh')
      .map(([, e]) => (e.kind === 'refresh' && e.changed ? e.corner : null))
      .filter(Boolean)
      .sort();
  assert.deepEqual(changed('base'), ['lf', 'lr', 'rf', 'rr']);
  assert.deepEqual(changed('during'), ['lf', 'lr', 'rf', 'rr']);
  assert.deepEqual(changed('menu'), ['lf', 'lr']);
  assert.deepEqual(changed('nochange'), []);
  // Ordered only after the reading: not changed at the refresh, fresh later.
  assert.deepEqual(changed('late'), []);
  const late = kinds(eventsOf('late'), 'fresh-late');
  assert.equal(late.length, 4);
  assert.ok(late.every(([t]) => t > PIT_IN_S + 15));
  assert.equal(kinds(eventsOf('nochange'), 'fresh-late').length, 0);
});

test('events are per step: a step with nothing to report has an empty list', () => {
  const model = new OverlayModel('ferrari296gt3');
  const frames = stimulus('base');
  model.step(sampleOf(frames[0]));
  const quiet = model.step(sampleOf(frames[1]));
  assert.deepEqual(quiet.events, []);
});

for (const car of CARS) {
  test(`${car}: telemetry frames through fromTelemetryFrame equal the overlay in every variant`, () => {
    for (const variant of VARIANTS) {
      const cols = golden[`${car}/${variant}`];
      const model = new OverlayModel(car);
      stimulus(variant).forEach((frame, i) => {
        model.step(fromTelemetryFrame(wrap(frame)));
        for (const c of ['lf', 'rf', 'lr', 'rr'] as const) {
          const got = model.shown[c];
          const at = `${car}/${variant} ${c} i=${i}`;
          assert.equal(
            got?.tread === undefined ? null : Math.round(got.tread),
            cols[`${c}.tread`][i],
            `tread ${at}`,
          );
          assert.equal(
            got ? Math.round(got.temp[1]) : null,
            cols[`${c}.temp`][i],
            `temp ${at}`,
          );
          assert.equal(
            got?.pressure ?? null,
            cols[`${c}.pressure`][i],
            `pressure ${at}`,
          );
        }
      });
    }
  });
}

test('fromTelemetryFrame: absent and odd channels are null, never 0', () => {
  const s = fromTelemetryFrame({
    Speed: { value: [30] },
    LatAccel: { value: [Number.NaN] },
    Throttle: { value: ['x'] },
    IsOnTrack: { value: [true] },
    OnPitRoad: { value: [false] },
    LFtempCL: { value: [60] },
    LFtempCM: { value: [61] },
    LFtempCR: { value: [62] },
    RFtempCL: { value: [60] },
    RFtempCM: { value: [61] },
    LFSHshockDefl: { value: [0.04] },
    RFshockDefl: { value: [0.05] },
    RFSHshockDefl: { value: [0.09] },
    LRcoldPressure: { value: [150] },
  });
  assert.equal(s.speed, 30);
  assert.ok(Number.isNaN(s.t)); // no SessionTime
  assert.equal(s.dt, 0);
  assert.equal(s.car.latAccel, null); // not finite
  assert.equal(s.car.throttle, null); // not a number
  assert.equal(s.car.brake, null);
  assert.equal(s.car.isOnTrack, true);
  assert.equal(s.car.onPitRoad, false);
  assert.equal(s.car.pitstopActive, null); // absent, not false
  assert.deepEqual(s.wheels.lf.carcass, [60, 61, 62]);
  assert.equal(s.wheels.rf.carcass, null); // a zone is missing
  assert.equal(s.wheels.lf.treadRemaining, null);
  assert.equal(s.wheels.lf.shockDeflM, 0.04); // the NASCAR name
  assert.equal(s.wheels.rf.shockDeflM, 0.05); // the plain name wins
  assert.equal(s.wheels.lr.coldPressureKpa, 150);
  assert.equal(s.wheels.rr.coldPressureKpa, null);
});

test('driveSlip given by the caller heats the driven (rear) tires only', () => {
  const run = (driveSlip: number | undefined) => {
    const model = new OverlayModel('ferrari296gt3');
    for (const frame of stimulus('base').slice(0, 600)) {
      model.step(sampleOf(frame), driveSlip === undefined ? {} : { driveSlip });
    }
    return model.shown;
  };
  const none = run(undefined);
  const spin = run(3);
  assert.equal(run(0).rr?.tread, none.rr?.tread); // 0 is the default
  assert.ok(spin.rr!.tread! > none.rr!.tread! + 0.5, 'rear tread is hotter');
  assert.equal(spin.lf!.tread, none.lf!.tread); // the front does not drive
});
