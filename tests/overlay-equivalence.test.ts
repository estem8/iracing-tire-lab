import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OverlayPhysics } from '../src/model/overlayPhysics.ts';
import type { Corner } from '../src/model/types.ts';
import { CARS, PIT_IN_S, stimulus } from './golden/stimulus.ts';

interface Row {
  t: number;
  corners: Partial<
    Record<Corner, { temp: number[]; tempReal?: number[]; disc?: number }>
  >;
}
const golden = JSON.parse(
  fs.readFileSync('tests/golden/processor.json', 'utf8'),
) as Record<string, Row[]>;

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
    assert.equal(rows.length, frames.length);
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
        const want = rows[i].corners[c];
        if (!want?.tempReal || !physics.surface.active) continue;
        compared++;
        assert.equal(
          Math.round(physics.tread(c)),
          want.tempReal[0],
          `${car} ${c} tread at t=${rows[i].t}`,
        );
        if (physics.dashShowsSurface) {
          assert.equal(
            Math.round(physics.surface.discLevel(c) * 20) / 20,
            want.disc,
            `${car} ${c} disc at t=${rows[i].t}`,
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
          physics.tread(c) - golden.ferrari296gt3[i].corners[c]!.tempReal![0],
        ),
      );
  });
  assert.ok(
    worst > 10,
    `largest tread difference after the stop: ${worst.toFixed(1)} C`,
  );
});
