import { MODEL_VERSION } from './irdashies/tireProfiles.ts';
import { frameOf, OverlayPhysics } from './overlayPhysics.ts';
import type {
  Corner,
  Estimate,
  TireModel,
  TireOutput,
  TireSample,
} from './types.ts';

const CORNERS: readonly Corner[] = ['lf', 'rf', 'lr', 'rr'];

/**
 * The overlay's physics layer as a `TireModel`, so it can be scored.
 *
 * Without the overlay's state machine (docs/extraction-plan.md) it seeds each
 * tire once per session from the first carcass reading it sees: the hottest
 * zone, capped at the car's stale-start value, which is what the overlay does
 * at a session start. It does not reset tires at a pit stop, so its error after
 * a tire change is larger than the overlay's (measured in
 * tests/overlay-equivalence.test.ts).
 */
export class OverlayPhysicsModel implements TireModel {
  private readonly carPath: string | undefined;
  private physics: OverlayPhysics;
  private session: number | null | undefined;
  private seeded = false;

  constructor(carPath: string | undefined) {
    this.carPath = carPath;
    this.physics = new OverlayPhysics(carPath);
  }

  reset(): void {
    this.physics = new OverlayPhysics(this.carPath);
    this.session = undefined;
    this.seeded = false;
  }

  step(sample: TireSample): TireOutput {
    if (this.session !== undefined && sample.car.sessionNum !== this.session) {
      this.physics.reset();
      this.seeded = false;
    }
    this.session = sample.car.sessionNum;
    this.physics.step(frameOf(sample));
    if (!this.seeded) this.seed(sample);

    const label = `overlay-physics@${MODEL_VERSION}`;
    const estimate = (value: number): Estimate<number> => ({
      kind: 'estimate',
      model: label,
      value,
    });
    const out: TireOutput = { carcass: {}, tread: {} };
    if (!this.physics.surface.active) return out;
    for (const c of CORNERS) {
      const carcass = this.physics.carcass(c);
      if (carcass !== undefined && Number.isFinite(carcass))
        out.carcass[c] = estimate(carcass);
      const tread = this.physics.tread(c);
      if (Number.isFinite(tread)) out.tread![c] = estimate(tread);
    }
    return out;
  }

  private seed(sample: TireSample): void {
    // A sample without all four carcass readings seeds nothing and tries again.
    const zones = CORNERS.map((c) => sample.wheels[c].carcass);
    if (zones.some((z) => z === null)) return;
    CORNERS.forEach((c, i) => {
      const hottest = Math.max(...zones[i]!);
      this.physics.start(c, Math.min(hottest, this.physics.profile.staleStart));
    });
    this.seeded = true;
  }
}
