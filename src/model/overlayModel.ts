import { MODEL_VERSION } from './irdashies/tireProfiles.ts';
import { DEFAULT_AMBIENT, frameOf, OverlayPhysics } from './overlayPhysics.ts';
import type { TuningValues } from './tuning.ts';
import type {
  Corner,
  Estimate,
  ModelEvent,
  StepExtras,
  TireModel,
  TireOutput,
  TireSample,
  Zones,
} from './types.ts';

/** Gain per tire learned at pit stops (1 = the fitted heat). */
export type Gains = Record<Corner, number>;

export interface OverlayModelOptions {
  /**
   * Constants to replace for an experiment, by parameter id (see tuning.ts).
   * None: the overlay's own, which the tests pin to the real processor.
   */
  tuning?: TuningValues;
  /**
   * Gains to start from, asked for when the model is made and again whenever it
   * starts over (a new session). Return undefined for none. Ignored for a car
   * whose profile does not calibrate. The caller owns where they are stored.
   */
  startingGains?: () => Gains | undefined;
}

const CORNERS: readonly Corner[] = ['lf', 'rf', 'lr', 'rr'];
const KELVIN = 273.15;

/** Wear (percent) at which tires still count as unused: a reading below it is mileage. */
const USED_BELOW = 99.9;
/** PitSvFlags bits that order a tire change, per corner. */
const TIRE_CHANGE_BIT: Record<Corner, number> = {
  lf: 0x1,
  rf: 0x2,
  lr: 0x4,
  rr: 0x8,
};

/**
 * What the overlay remembers about one tire between sample readings. The
 * overlay's own record also tracks wear; that part is not here.
 */
interface CornerState {
  /** The hottest zone at the previous reading: the zone spread is scaled against it. */
  lastMean: number;
  fresh?: boolean;
  /** Tire temperature when it was set at its cold pressure, for the pressure estimate. */
  refTemp?: number;
  /** How each zone differs from the hottest at the last reading. */
  tempOffset: Zones;
}

const peak = (z: Zones) => Math.max(z[0], z[1], z[2]);
const offsets = (z: Zones): Zones => {
  const m = peak(z);
  return [z[0] - m, z[1] - m, z[2] - m];
};

/** What the overlay shows for one tire, before it rounds (the processor rounds to whole degrees). */
export interface ShownCorner {
  /** Left, middle and right zone, deg C. */
  temp: Zones;
  /** Tread surface, deg C, once the surface model has stepped. */
  tread?: number;
  /** Brake disc level 0..1 in steps of 0.05, for cars whose dash shows it. */
  disc?: number;
  /** True while the model, not the sim's reading, gives the temperature. */
  estimated: boolean;
  /** Pressure for the label (kPa) and whether it is hot (measured or estimated). */
  pressure?: number;
  pressureHot?: boolean;
  /** True when the hot pressure is the gas-law estimate, not a value the sim sent. */
  pressureEstimated?: boolean;
}

/**
 * The overlay's tire estimate: the physics layer plus the state machine that
 * reconciles it with the sim's readings. Ported from irdashies' TireProcessor
 * at the commit in src/model/irdashies/PROVENANCE.json, and checked against the
 * real processor's output (tests/overlay-equivalence.test.ts).
 *
 * The sim refreshes the carcass and wear readings only when a pit stop starts
 * and they describe the tires taken off. A change in a reading is taken as that
 * refresh: the first one seeds the tires, a later one teaches the model (the
 * per-stop gain, the fresh-tire offset) and, for a tire that was changed, puts
 * fresh tires in the model.
 *
 * Not ported: wear and wear rate (the `events` of each step tell a caller when to reset its own), load from shock travel, camber and toe, the
 * slip estimator (so wheel-spin heat is 0 unless the caller passes `driveSlip`), saved calibrations on disk. A
 * sample without all four carcass zones and wear zones for a tire says nothing
 * about that tire, as in the overlay.
 */
export class OverlayModel implements TireModel {
  private readonly carPath: string | undefined;
  private readonly options: OverlayModelOptions;
  private physics: OverlayPhysics;
  private state: Partial<Record<Corner, CornerState>> = {};
  private lastReading = '';
  private session: number | null | undefined;
  private service: { applied: number; running: boolean } | undefined;
  private pendingBits = 0;
  private orderedBits = 0;
  private freshOffset: number;
  private events: ModelEvent[] = [];
  /** What each corner would show on the latest sample. */
  shown: Partial<Record<Corner, ShownCorner>> = {};

  constructor(carPath: string | undefined, options: OverlayModelOptions = {}) {
    this.carPath = carPath;
    this.options = options;
    this.physics = new OverlayPhysics(carPath, options.tuning);
    this.freshOffset = this.physics.profile.freshOffset;
    this.applyStartingGains();
  }

  /** The gains the model has learned, per tire. */
  gains(): Gains {
    return this.physics.thermal.gains();
  }

  /** Whether this car's gains are corrected at stops (and so worth saving). */
  get calibrates(): boolean {
    return this.physics.profile.calibrates !== false;
  }

  /** Asks for starting gains again, e.g. when the car and track pair changes mid-session. */
  applyStartingGains(): void {
    if (!this.calibrates) return;
    const gains = this.options.startingGains?.();
    if (gains) this.physics.thermal.setGains(gains);
  }

  reset(): void {
    this.physics = new OverlayPhysics(this.carPath, this.options.tuning);
    this.clear();
    this.session = undefined;
  }

  private clear(): void {
    this.physics.reset();
    this.state = {};
    this.lastReading = '';
    this.service = undefined;
    this.pendingBits = 0;
    this.orderedBits = 0;
    this.freshOffset = this.physics.profile.freshOffset;
    this.applyStartingGains();
    this.shown = {};
    this.events.push({ kind: 'clear' });
  }

  step(sample: TireSample, extras: StepExtras = {}): TireOutput {
    this.events = [];
    // A new session starts on other tires: begin again. A sample without
    // SessionNum says nothing.
    const num = sample.car.sessionNum;
    if (num !== null) {
      if (
        this.session !== undefined &&
        this.session !== null &&
        num !== this.session
      )
        this.clear();
      this.session = num;
    }

    const temps: Partial<Record<Corner, Zones>> = {};
    const readings: Partial<Record<Corner, Zones>> = {};
    for (const c of CORNERS) {
      const w = sample.wheels[c];
      if (w.carcass && w.treadRemaining) {
        temps[c] = w.carcass;
        readings[c] = w.treadRemaining.map((x) => x * 100) as unknown as Zones;
      }
    }

    this.physics.step(frameOf(sample), extras);
    if (sample.car.onPitRoad !== true)
      this.orderedBits = this.requested(sample);
    this.trackStints(sample, readings, temps);
    this.followService(sample);
    return this.output(sample, temps);
  }

  private ambient(sample: TireSample): number {
    return sample.car.airTemp ?? sample.car.trackTemp ?? DEFAULT_AMBIENT;
  }

  /** Which tires are being changed, from the service flags and the pit-menu boxes. */
  private requested(sample: TireSample): number {
    const box = sample.car.tireChange;
    let bits = (sample.car.pitSvFlags ?? 0) & 0xf;
    for (const [value, bit] of [
      [box.lf, 0x1],
      [box.rf, 0x2],
      [box.lr, 0x4],
      [box.rr, 0x8],
      [box.left, 0x1 | 0x4],
      [box.right, 0x2 | 0x8],
    ] as const) {
      if ((value ?? 0) > 0) bits |= bit;
    }
    return bits;
  }

  /** A reading that differs from the previous one is a refresh. */
  private trackStints(
    sample: TireSample,
    readings: Partial<Record<Corner, Zones>>,
    temps: Partial<Record<Corner, Zones>>,
  ): void {
    const key = JSON.stringify(readings);
    if (key === '{}' || key === this.lastReading) return;
    const seeding = this.lastReading === '';
    this.lastReading = key;
    const flags = this.requested(sample) || this.orderedBits;
    const ambient = this.ambient(sample);
    const { thermal, surface, profile } = this.physics;
    // Starting in the box with the crew at work: the tires ordered are being
    // swapped now, and the reading is the old ones.
    if (seeding && sample.car.pitstopActive === true)
      this.service = { applied: 0, running: true };

    for (const c of CORNERS) {
      const reading = readings[c];
      const temp = temps[c];
      if (!reading || !temp) continue;
      const st = this.state[c];
      if (seeding || !st) {
        const seeded: CornerState = {
          tempOffset: offsets(temp),
          lastMean: peak(temp),
        };
        this.state[c] = seeded;
        // A hot reading at start-up is the last session's, so assume fresh
        // tires instead; a cold one is kept. An even reading across the zones
        // is the sim's fresh-tire value: the real start, and it teaches the
        // offset used for later fresh sets. Tires with mileage are the ones on
        // the car, so their reading is real.
        const used = Math.min(...reading) < USED_BELOW;
        let start = used
          ? peak(temp)
          : Math.min(peak(temp), profile.staleStart);
        if (Math.max(...temp) - Math.min(...temp) < 1) {
          this.freshOffset = Math.min(30, Math.max(0, peak(temp) - ambient));
          start = peak(temp);
        }
        thermal.set(c, start);
        surface.resetTread(c, start);
        seeded.refTemp = thermal.mean(c);
        this.events.push({ kind: 'seed', corner: c, changed: false });
        continue;
      }
      const changed = (flags & TIRE_CHANGE_BIT[c]) !== 0;
      st.lastMean = peak(temp);
      if (st.fresh && thermal.heated(c) < 2) {
        const offset = Math.min(30, Math.max(0, peak(temp) - ambient));
        this.freshOffset = (this.freshOffset + offset) / 2;
      }
      if (profile.calibrates !== false) thermal.calibrate(c, peak(temp));
      // The reading describes the tires being removed. Fresh ones start at
      // ambient and carry no zone spread yet.
      thermal.set(c, changed ? ambient + this.freshOffset : peak(temp));
      if (changed) {
        st.refTemp = ambient + this.freshOffset;
        surface.resetTread(c, ambient + this.freshOffset);
      }
      st.tempOffset = offsets(temp);
      st.fresh = changed;
      this.events.push({ kind: 'refresh', corner: c, changed });
    }
    if (!seeding) this.service = { applied: flags, running: false };
  }

  /**
   * The reading arrives as the service starts, but which tires get changed is
   * often settled in the pit menu while it runs, so the requested changes are
   * collected until the service ends and any tire ordered in that time is
   * treated as fresh from then on.
   */
  private followService(sample: TireSample): void {
    if (!this.service) return;
    const requested = this.requested(sample);
    if (sample.car.pitstopActive === true) {
      this.service.running = true;
      this.pendingBits |= requested;
      return;
    }
    const left = sample.car.onPitRoad !== true;
    if (!this.service.running && !left) return;
    const late = this.pendingBits & ~this.service.applied;
    const ambient = this.ambient(sample);
    const { thermal, surface } = this.physics;
    for (const c of CORNERS) {
      const st = this.state[c];
      if (!st || (late & TIRE_CHANGE_BIT[c]) === 0) continue;
      st.fresh = true;
      thermal.set(c, ambient + this.freshOffset);
      st.refTemp = ambient + this.freshOffset;
      surface.resetTread(c, ambient + this.freshOffset);
      this.events.push({ kind: 'fresh-late', corner: c, changed: true });
    }
    this.service = undefined;
    this.pendingBits = 0;
  }

  /** The gas in the tire follows the carcass: P = P_cold * T / T_start in kelvin. */
  private pressure(sample: TireSample, c: Corner) {
    const w = sample.wheels[c];
    const st = this.state[c];
    const { surface } = this.physics;
    if (w.hotPressureKpa !== null && w.hotPressureKpa > 0)
      return {
        pressure: Math.round(w.hotPressureKpa * 10) / 10,
        pressureHot: true,
      };
    const cold = w.coldPressureKpa;
    if (cold === null || cold <= 0) return {};
    if (surface.active && st?.refTemp !== undefined) {
      const estimated =
        (cold * (KELVIN + surface.gas(c))) / (KELVIN + st.refTemp);
      return {
        pressure: Math.round(estimated * 10) / 10,
        pressureHot: true,
        pressureEstimated: true,
      };
    }
    return { pressure: Math.round(cold * 10) / 10 };
  }

  private output(
    sample: TireSample,
    temps: Partial<Record<Corner, Zones>>,
  ): TireOutput {
    const label = `overlay@${MODEL_VERSION}`;
    const estimate = (value: number): Estimate<number> => ({
      kind: 'estimate',
      model: label,
      value,
    });
    const { physics } = this;
    const ambient = this.ambient(sample);
    const out: TireOutput = {
      carcass: {},
      tread: {},
      shown: {},
      pressure: {},
      disc: {},
      events: this.events,
    };
    this.shown = {};
    for (const c of CORNERS) {
      const temp = temps[c];
      const st = this.state[c];
      if (!temp || !st) continue;
      const modelled = physics.carcass(c);
      // The zone spread seen at the last reading builds up as the tire heats,
      // so it is applied in proportion to how far this tire has warmed.
      const warmed =
        modelled !== undefined && st.lastMean > ambient + 5
          ? Math.min(
              1,
              Math.max(0, (modelled - ambient) / (st.lastMean - ambient)),
            )
          : 1;
      const temp3 =
        modelled === undefined
          ? temp
          : (st.tempOffset.map(
              (o) => modelled + o * warmed,
            ) as unknown as Zones);
      const corner: ShownCorner = {
        temp: temp3,
        estimated: physics.thermal.active && modelled !== undefined,
        ...this.pressure(sample, c),
      };
      if (physics.surface.active) {
        corner.tread = physics.tread(c);
        if (physics.dashShowsSurface)
          corner.disc = Math.round(physics.surface.discLevel(c) * 20) / 20;
      }
      this.shown[c] = corner;
      if (corner.disc !== undefined) out.disc![c] = corner.disc;
      if (corner.pressure !== undefined)
        out.pressure![c] = {
          kpa: corner.pressure,
          hot: corner.pressureHot === true,
          estimated: corner.pressureEstimated === true,
        };
      out.shown![c] = { kind: 'estimate', model: label, value: temp3 };
      if (modelled !== undefined && Number.isFinite(modelled))
        out.carcass[c] = estimate(modelled);
      if (corner.tread !== undefined && Number.isFinite(corner.tread))
        out.tread![c] = estimate(corner.tread);
    }
    return out;
  }
}
