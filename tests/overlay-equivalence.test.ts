import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OverlayPhysics } from '../src/model/overlayPhysics.ts';
import type { Corner } from '../src/model/types.ts';
import { CARS, PIT_IN_S, stimulus } from './golden/stimulus.ts';

/** Per car, per corner: the overlay's rounded tread temperature and disc level, one entry per frame. */
type Golden = Record<string, Record<string, (number | null)[]>>;
const golden = JSON.parse(
  fs.readFileSync('tests/golden/processor.json', 'utf8'),
) as Golden;

const CORNERS: Corner[] = ['lf', 'rf', 'lr', 'rr'];
const PREFIX: Record<Corner, string> = {
  lf: 'LF',
  rf: 'RF',
  lr: 'LR',
  rr: 'RR',
};

/**
 * The golden file is the real TireProcessor's output (irdashies d421f67) on the
 * synthetic stimulus. The lab's physics layer must give the same tread
 * temperature and brake-disc level for the part of the run the physics layer
 * owns: from the start to the pit stop, cleared at the session change.
 */
for (const car of CARS) {
  test(`${car}: lab physics equals the overlay's tread and disc before the stop`, () => {
    const frames = stimulus();
    const rows = golden[car];
    assert.equal(rows['lf.tread'].length, frames.length);
    const physics = new OverlayPhysics(car);
    let compared = 0;
    let session: unknown;
    frames.forEach((frame, i) => {
      const first = frame.SessionNum !== session;
      if (first) {
        if (session !== undefined) physics.reset();
        session = frame.SessionNum;
      }
      physics.step(frame);
      if (first) {
        // The processor seeds each tire from the first reading of a session:
        // the hottest zone, but not above the car's stale-start value. That
        // rule belongs to the state machine, so the test applies it by hand.
        for (const c of CORNERS) {
          const zones = ['L', 'M', 'R'].map(
            (z) => frame[`${PREFIX[c]}tempC${z}`] as number,
          );
          physics.start(
            c,
            Math.min(Math.max(...zones), physics.profile.staleStart),
          );
        }
      }
      if ((frame.SessionTime as number) >= PIT_IN_S) return;
      for (const c of CORNERS) {
        const tread = rows[`${c}.tread`][i];
        if (tread === null || !physics.surface.active) continue;
        compared++;
        assert.equal(
          Math.round(physics.tread(c)),
          tread,
          `${car} ${c} tread at t=${frame.SessionTime}`,
        );
        if (physics.dashShowsSurface) {
          assert.equal(
            Math.round(physics.surface.discLevel(c) * 20) / 20,
            rows[`${c}.disc`][i],
            `${car} ${c} disc at t=${frame.SessionTime}`,
          );
        }
      }
    });
    assert.ok(compared > 1000, `compared ${compared} values`);
  });
}

/**
 * What the lab does not reproduce yet, measured: at the pit stop the overlay
 * resets the tires to fresh ones (the state machine); the physics layer alone
 * keeps heating the old ones. If this stops being true the state machine has
 * moved into the lab and the test above should cover the whole run.
 */
test('without the state machine the lab diverges at a tire change', () => {
  const frames = stimulus();
  const physics = new OverlayPhysics('ferrari296gt3');
  let worst = 0;
  let session: unknown;
  frames.forEach((frame, i) => {
    const first = frame.SessionNum !== session;
    if (first) {
      if (session !== undefined) physics.reset();
      session = frame.SessionNum;
    }
    physics.step(frame);
    if (first)
      for (const c of CORNERS) {
        const zones = ['L', 'M', 'R'].map(
          (z) => frame[`${PREFIX[c]}tempC${z}`] as number,
        );
        physics.start(
          c,
          Math.min(Math.max(...zones), physics.profile.staleStart),
        );
      }
    if ((frame.SessionTime as number) < PIT_IN_S + 10) return;
    for (const c of CORNERS)
      worst = Math.max(
        worst,
        Math.abs(physics.tread(c) - golden.ferrari296gt3[`${c}.tread`][i]!),
      );
  });
  assert.ok(
    worst > 10,
    `largest tread difference after the stop: ${worst.toFixed(1)} C`,
  );
});

test('a car sample round-trips to the channels the physics reads, nulls left out', async () => {
  const { EMPTY_CAR, carChannels } = await import('../src/model/channels.ts');
  const { frameOf } = await import('../src/model/overlayPhysics.ts');
  const sample = {
    t: 3,
    dt: 0.05,
    speed: 40,
    car: { ...EMPTY_CAR, latAccel: 5, isOnTrack: true, onPitRoad: false },
    wheels: {} as never,
  };
  assert.deepEqual(carChannels(sample.car), {
    LatAccel: 5,
    IsOnTrack: true,
    OnPitRoad: false,
  });
  const frame = frameOf(sample);
  assert.equal(frame.SessionTime, 3);
  assert.equal(frame.Speed, 40);
  assert.equal('Throttle' in frame, false); // absent, not 0
  assert.equal(frameOf({ ...sample, speed: null }).Speed, undefined);
});
