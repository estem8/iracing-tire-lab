import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { OverlayPhysics } from '../src/model/overlayPhysics.ts';
import type { Corner } from '../src/model/types.ts';
import { OverlayModel } from '../src/model/overlayModel.ts';
import { sampleOf } from './golden/sample.ts';
import { CARS, PIT_IN_S, stimulus, VARIANTS } from './golden/stimulus.ts';

/** Per car and variant, per corner: the overlay's rounded tread temperature and disc level, one entry per frame. */
type Golden = Record<string, Record<string, (number | null)[]>>;
const golden = JSON.parse(
  zlib.gunzipSync(fs.readFileSync('tests/golden/processor.json.gz')).toString(),
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
    const rows = golden[`${car}/base`];
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
        Math.abs(
          physics.tread(c) - golden['ferrari296gt3/base'][`${c}.tread`][i]!,
        ),
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

/**
 * The whole overlay estimate, state machine included, against the real
 * processor over the entire run: tread temperature, the middle zone of the shown
 * temperature (whole degrees, as the processor rounds), brake-disc level and the
 * pressure for the label. Six variants reach different branches: a change
 * ordered early, late or by the pit menu, a stop without a change, a stale hot
 * start and an even (fresh) start.
 */
for (const car of CARS) {
  for (const variant of VARIANTS) {
    test(`${car} / ${variant}: the ported state machine equals the overlay for the whole run`, () => {
      const cols = golden[`${car}/${variant}`];
      const frames = stimulus(variant);
      assert.equal(cols['lf.tread'].length, frames.length);
      const model = new OverlayModel(car);
      let compared = 0;
      frames.forEach((frame, i) => {
        model.step(sampleOf(frame));
        for (const c of CORNERS) {
          const got = model.shown[c];
          const at = `${car}/${variant} ${c} t=${frame.SessionTime}`;
          const check = (
            name: string,
            mine: number | undefined,
            want: number | null,
          ) => {
            assert.equal(mine ?? null, want, `${name} ${at}`);
            if (want !== null) compared++;
          };
          check(
            'tread',
            got?.tread === undefined ? undefined : Math.round(got.tread),
            cols[`${c}.tread`][i],
          );
          check(
            'temp',
            got ? Math.round(got.temp[1]) : undefined,
            cols[`${c}.temp`][i],
          );
          check('disc', got?.disc, cols[`${c}.disc`][i]);
          check('pressure', got?.pressure, cols[`${c}.pressure`][i]);
        }
      });
      assert.ok(compared > 3000, `compared ${compared} values`);
    });
  }
}
