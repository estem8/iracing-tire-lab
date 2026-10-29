/**
 * Vendored from irdashies (MIT, see NOTICE): src/app/processors/TireSurfaceModel.ts
 * at d421f679dd546758fab92201810b8d26d0ea7974. Do not edit here; see scripts/vendorIrdashies.ts.
 */
import type { Corner as TireCorner } from '../types.ts';
import type { SurfaceParams } from './tireProfiles.ts';

const CORNERS: readonly TireCorner[] = ['lf', 'rf', 'lr', 'rr'];
const GRAVITY = 9.81;
/** Seconds over which vertical acceleration is averaged: bumps are not banking. */
const VERTICAL_SMOOTH_S = 1;

export interface SurfaceInput {
  dt: number;
  /** m/s */
  speed: number;
  /** m/s2; positive in a left turn, which loads the right tires. */
  lateral: number;
  /** m/s2, negative when braking. */
  longitudinal: number;
  /** Slip angle of the front and rear axle, degrees (see slipAngles). */
  slipFront: number;
  slipRear: number;
  ambient: number;
  /** How fast the front and rear axle slide sideways beyond cornering, m/s. */
  slideFront: number;
  slideRear: number;
  /** Brake pedal, 0 to 1. */
  brake: number;
  /** Driven-wheel slip beyond ordinary traction, m/s, times throttle. */
  driveSlip: number;
  /** Vertical acceleration, m/s2, about 9.81 on a flat road; banking raises it. */
  vertical?: number;
}

const unset = (): Record<TireCorner, number> => ({
  lf: NaN,
  rf: NaN,
  lr: NaN,
  rr: NaN,
});

/**
 * Two nodes per tire fitted to the .ibt tread zones and the GT3 dash with one
 * set of constants for every corner and car: the tread S and the bulk B
 * (carcass and the gas inside). Each tire's heat follows its load share (weight,
 * downforce, lateral transfer) times the slip power of its axle (lateral force
 * x speed x slip angle), plus braking, traction and slide terms; the bulk is
 * also heated by load x speed (hysteresis). The tread cools to the air with
 * speed and gives its heat to the bulk. Free-run error from a fresh set to the
 * first stop on the dash: 0.5 to 1.5 C on road courses, 3 C on an oval.
 */
const LOAD = {
  /** Share of weight added by downforce at 50 m/s, per (v/50)^2. */
  aero: 0.594,
  /** Share moved to the outside tires by 1 g of lateral acceleration. */
  lateral: 0.458,
  max: 4,
};
/** Heat grows with the load share to this power (tread slip, bulk). */
const Q_SLIP = 0.751;
const Q_BULK = 1.164;
/** Lateral and longitudinal acceleration beyond this is a crash, not driving. */
const ACCEL_MAX = 2.5 * GRAVITY;
const W = {
  slip: 0.0205,
  braking: 0.0291,
  /** Traction on the driven rear axle. */
  drive: 0.0264,
  /** Rear wheelspin. */
  spin: 0.114,
  slide: 0.0162,
};
const WB = {
  slip: 1.49e-4,
  /** Load x speed: tire hysteresis. */
  load: 3.25e-3,
  brakeAvg: 9.38e-3,
};
const C0 = 6.94e-3;
const C1 = 5.05e-3;
/** Tread to bulk, bulk to tread (1/s). */
const K_TREAD_BULK = 0.137;
const K_BULK_TREAD = 0.0113;
/** Seconds over which the brake pedal is averaged for the bulk heat. */
const BRAKE_AVG_S = 5;

/**
 * The tire temperatures a car shows: the tread surface S (some dashes show
 * it, it jumps by tens of degrees within seconds of heavy braking or a turn
 * with the wheel wound on) and the bulk B whose gas sets the hot pressure.
 *
 * The brake discs are kept apart, in a fast and a slow part, only to light
 * the disc glow of the cars whose dash shows it.
 */
export class TireSurfaceModel {
  private fast: Record<TireCorner, number> = { lf: 0, rf: 0, lr: 0, rr: 0 };
  private slow: Record<TireCorner, number> = { lf: 0, rf: 0, lr: 0, rr: 0 };
  /** NaN until a start temperature is set or the first step seeds the air's. */
  private tread: Record<TireCorner, number> = unset();
  private bulk: Record<TireCorner, number> = unset();
  private verticalSmooth = GRAVITY;
  private brakeAvg = 0;
  private integrated = false;

  private params: SurfaceParams;

  constructor(params: SurfaceParams) {
    this.params = params;
  }

  configure(params: SurfaceParams): void {
    this.params = params;
  }

  get active(): boolean {
    return this.integrated;
  }

  /** How hot a brake disc is, 0 (cold) to 1 (as hot as the testing made it). */
  discLevel(corner: TireCorner): number {
    return Math.min(1, this.slow[corner] / this.params.discFull);
  }

  /** The tread surface temperature of a tire, in degrees Celsius. */
  temp(corner: TireCorner): number {
    return this.tread[corner];
  }

  /** The bulk (carcass and gas) temperature of a tire, in degrees Celsius. */
  gas(corner: TireCorner): number {
    return this.bulk[corner];
  }

  /**
   * What the GT3 dash shows, the hottest zone of the carcass: it is not in the
   * .ibt (that reading stays frozen between stops), so it is fitted to the dash.
   */
  dash(corner: TireCorner): number {
    return this.bulk[corner];
  }

  step({
    dt,
    speed,
    lateral,
    longitudinal,
    slipFront,
    slipRear,
    ambient,
    slideFront,
    slideRear,
    brake: pedal,
    driveSlip,
    vertical = GRAVITY,
  }: SurfaceInput): void {
    if (!(dt > 0)) return;
    this.seed(ambient);
    const p = this.params;
    const h = Math.min(dt, 0.1);
    const braking = Math.max(0, -longitudinal) * speed;
    this.verticalSmooth +=
      (vertical - this.verticalSmooth) * Math.min(1, h / VERTICAL_SMOOTH_S);
    this.brakeAvg += (pedal - this.brakeAvg) * Math.min(1, h / BRAKE_AVG_S);
    const lat = Math.min(Math.abs(lateral), ACCEL_MAX) / GRAVITY;
    const decel = Math.min(Math.max(0, -longitudinal), ACCEL_MAX) / GRAVITY;
    const accel = Math.min(Math.max(0, longitudinal), ACCEL_MAX) / GRAVITY;
    const air = C0 + C1 * speed;
    const base = this.verticalSmooth / GRAVITY + LOAD.aero * (speed / 50) ** 2;

    for (const corner of CORNERS) {
      const front = corner === 'lf' || corner === 'rf';
      const right = corner === 'rf' || corner === 'rr';
      const load = Math.min(
        LOAD.max,
        Math.max(
          0,
          base + ((right ? 1 : -1) * LOAD.lateral * lateral) / GRAVITY
        )
      );
      const slipPower =
        load ** Q_SLIP * lat * speed * (front ? slipFront : slipRear);
      const heat =
        W.slip * slipPower +
        load ** Q_SLIP *
          speed *
          (W.braking * decel + (front ? 0 : W.drive * accel)) +
        (front ? 0 : W.spin * driveSlip) +
        W.slide * (front ? slideFront : slideRear) * speed;
      const bulkHeat =
        WB.slip * slipPower +
        WB.load * load ** Q_BULK * speed +
        WB.brakeAvg * this.brakeAvg * speed * load;
      const s = this.tread[corner];
      const b = this.bulk[corner];
      this.tread[corner] =
        s + h * (heat - air * (s - ambient) - K_TREAD_BULK * (s - b));
      this.bulk[corner] = b + h * (K_BULK_TREAD * (s - b) + bulkHeat);

      const brake = front
        ? p.frontBrake * braking + p.frontPedal * pedal * pedal * speed
        : p.rearBrake * braking;
      const slowAir = p.slowCool + p.slowCoolSpeed * speed;
      const fastAir = p.fastCool + p.fastCoolSpeed * speed;
      this.fast[corner] = Math.max(
        0,
        this.fast[corner] +
          h * (p.fastShare * brake - this.fast[corner] * fastAir)
      );
      this.slow[corner] = Math.max(
        0,
        this.slow[corner] +
          h * ((1 - p.fastShare) * brake - this.slow[corner] * slowAir)
      );
    }
  }

  private seed(ambient: number): void {
    for (const corner of CORNERS) {
      if (Number.isNaN(this.tread[corner])) this.tread[corner] = ambient;
      if (Number.isNaN(this.bulk[corner])) this.bulk[corner] = ambient;
    }
    this.integrated = true;
  }

  reset(): void {
    this.fast = { lf: 0, rf: 0, lr: 0, rr: 0 };
    this.slow = { lf: 0, rf: 0, lr: 0, rr: 0 };
    this.tread = unset();
    this.bulk = unset();
    this.verticalSmooth = GRAVITY;
    this.brakeAvg = 0;
    this.integrated = false;
  }

  /**
   * Fresh tires: tread and gas start at the temperature they were set at,
   * about 34 C on the dash; the brake discs stay as hot as they are.
   */
  resetTread(corner: TireCorner, start: number): void {
    this.tread[corner] = start;
    this.bulk[corner] = start;
  }
}
