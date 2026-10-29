/**
 * Vendored from irdashies (MIT, see NOTICE): src/app/processors/TireThermalModel.ts
 * at d421f679dd546758fab92201810b8d26d0ea7974. Do not edit here; see scripts/vendorIrdashies.ts.
 */
import type { Corner as TireCorner } from '../types.ts';
import { GT3_THERMAL, type ThermalParams } from './tireProfiles.ts';
import { YawGrip } from './YawGrip.ts';

const CORNERS: readonly TireCorner[] = ['lf', 'rf', 'lr', 'rr'];

/** m/s under which the car counts as held still. */
const STILL_SPEED = 2;
/** Lateral acceleration, m/s2, under which the car is treated as going straight. */
const STRAIGHT_LATERAL = 1;
/**
 * The longest step integrated; a hitch in telemetry must not heat a tire.
 * ProcessorHost runs this processor at its tick rate (15 Hz), so ordinary
 * steps are about 0.07 s and pass through whole.
 */
const MAX_DT = 0.5;
const GAIN_LIMITS = [0.4, 2.5] as const;
const GRAVITY = 9.81;
/** Seconds over which vertical acceleration is averaged: bumps are not banking. */
const VERTICAL_SMOOTH_S = 1;

export interface ThermalInput {
  dt: number;
  /** m/s */
  speed: number;
  /** m/s2; positive in a left turn, which loads the right tires. */
  lateral: number;
  /** m/s2, negative when braking. */
  longitudinal: number;
  /**
   * Driven (rear) wheel slip beyond ordinary traction, m/s, times throttle:
   * wheelspin heats the rear tires even with the car standing still.
   */
  driveSlip: number;
  ambient: number;
  /** Steering wheel angle and yaw rate, rad and rad/s, absolute. */
  steering?: number;
  yawRate?: number;
  /** Vertical acceleration, m/s2, about 9.81 on a flat road. */
  vertical?: number;
  /** How fast the front and rear axle slide sideways beyond cornering, m/s. */
  slideFront?: number;
  slideRear?: number;
  /** Front share of the braking force, 0 to 1, from the brake bias setting. */
  brakeBias?: number;
}

/**
 * Estimates the mean carcass temperature of each tire between pit stops, when
 * iRacing publishes no live reading.
 *
 * It is a lumped model, not a simulation: heat goes in as speed times the
 * lateral load a tire carries (more on the outside of the turn), braking on
 * the fronts, wheelspin on the rears and a little with speed cubed for the
 * aerodynamic load, and leaves toward ambient faster at speed. What keeps the
 * result honest is calibration: at every pit stop the prediction is compared with the
 * reading the sim provides and that tire's heat gain is corrected, so the model
 * learns the car and track over a few stints.
 */
export class TireThermalModel {
  private temp: Partial<Record<TireCorner, number>> = {};
  /** The slow node under the tread, where a profile has one. */
  private carcass: Partial<Record<TireCorner, number>> = {};
  private carcassPassive: Partial<Record<TireCorner, number>> = {};
  /** What each tire would read had it only cooled since it was last set. */
  private passive: Partial<Record<TireCorner, number>> = {};
  private gain: Record<TireCorner, number> = { lf: 1, rf: 1, lr: 1, rr: 1 };
  private integrated = false;
  private readonly grip = new YawGrip();
  private verticalSmooth = GRAVITY;
  private params: ThermalParams = GT3_THERMAL;

  /** Switches the constants without touching the temperatures. */
  configure(params: ThermalParams): void {
    this.params = params;
  }

  /** Whether any driving has been integrated since the last reset. */
  get active(): boolean {
    return this.integrated;
  }

  gains(): Record<TireCorner, number> {
    return { ...this.gain };
  }

  /** Starts the tires from gains learned earlier; reset() clears them. */
  setGains(gains: Record<TireCorner, number>): void {
    this.gain = { ...gains };
  }

  gainOf(corner: TireCorner): number {
    return this.gain[corner];
  }

  /** How much of the tire's temperature came from heating since it was set. */
  heated(corner: TireCorner): number {
    return (this.temp[corner] ?? 0) - (this.passive[corner] ?? 0);
  }

  /** The carcass temperature, what the sim's stop reading measures; the tread's without one. */
  carcassOf(corner: TireCorner): number | undefined {
    return this.carcass[corner] ?? this.temp[corner];
  }

  mean(corner: TireCorner): number | undefined {
    return this.temp[corner];
  }

  /** Sets a tire's temperature, e.g. from a reading or for fresh tires. */
  set(corner: TireCorner, value: number): void {
    this.temp[corner] = value;
    this.passive[corner] = value;
    this.carcass[corner] = value;
    this.carcassPassive[corner] = value;
  }

  /**
   * Compares the prediction with a reading and corrects the tire's gain.
   *
   * Only the part of the temperature that came from heating scales with the
   * gain; the part left over from where the tire started does not. Judging the
   * whole rise above ambient let a tire that began the stint warm teach the
   * model that its heating was too strong. A tire that has barely heated says
   * too little to learn from, so the gain is left alone.
   */
  calibrate(corner: TireCorner, measured: number): void {
    // The reading is the carcass'; the tread stands in where there is no node.
    const predicted = this.carcass[corner] ?? this.temp[corner];
    const passive = this.carcassPassive[corner] ?? this.passive[corner];
    if (predicted === undefined || passive === undefined) return;
    const heated = predicted - passive;
    const needed = measured - passive;
    if (heated < 3 || needed <= 0) return;
    const next = this.gain[corner] * (needed / heated) ** 0.8;
    this.gain[corner] = Math.min(
      GAIN_LIMITS[1],
      Math.max(GAIN_LIMITS[0], next)
    );
  }

  step({
    dt,
    speed,
    lateral,
    longitudinal,
    driveSlip,
    ambient,
    steering = 0,
    yawRate = 0,
    vertical = GRAVITY,
    slideFront = 0,
    slideRear = 0,
    brakeBias = 0.5,
  }: ThermalInput): void {
    if (!(dt > 0)) return;
    const par = this.params;
    const h = Math.min(dt, MAX_DT);
    const cooling = par.cool * (1 + speed / par.coolSpeed);
    const cornering = Math.abs(lateral);
    const braking = Math.max(0, -longitudinal);
    const accel = Math.max(0, longitudinal);
    const aero = (par.aeroHeat * speed * speed * speed) / 1000;
    this.grip.learn(h, speed, cornering, steering, yawRate);
    // Banking presses the tires harder than the lateral acceleration says. The
    // threshold sits on the average, or a bumpy track would cross it on every crest.
    this.verticalSmooth +=
      (vertical - this.verticalSmooth) * Math.min(1, h / VERTICAL_SMOOTH_S);
    const banked = par.bank
      ? Math.max(0, this.verticalSmooth - GRAVITY - par.bank.from) *
        par.bank.heat *
        speed
      : 0;
    // Steering the car does not turn on: the front is sliding.
    const unexplained = this.grip.unexplained(speed, steering, yawRate);

    for (const corner of CORNERS) {
      const t = this.temp[corner];
      if (t === undefined) continue;
      const right = corner === 'rf' || corner === 'rr';
      const front = corner === 'lf' || corner === 'rf';
      // A left turn (positive lateral) loads the right tires.
      const outside =
        cornering < STRAIGHT_LATERAL ? 0 : lateral > 0 === right ? 1 : -1;
      const load = cornering * 0.25 * (1 + outside * par.loadTransfer);
      const driving =
        par.heat * speed * load * (front ? 1 : par.rearShare) +
        par.brakeHeat *
          speed *
          braking *
          (front ? 1 : ((par.rearBrake ?? 0) * (1 - brakeBias)) / brakeBias) +
        (front ? 0 : par.accelHeat * speed * accel) +
        aero +
        banked +
        (par.slide ?? 0) * (front ? slideFront : slideRear) +
        (front && par.scrub
          ? par.scrub.heat *
            unexplained *
            speed *
            Math.max(0, 1 + outside * par.scrub.outside)
          : 0);
      const spin = front
        ? 0
        : par.spinHeat *
          Math.min(Math.max(0, t - ambient), par.spinHeatCap) *
          (speed < STILL_SPEED ? par.spinStill : 1) *
          driveSlip;
      // Cold rubber heats faster, fading out as the tire reaches coldBelow.
      const cold =
        1 + par.coldBoost * Math.min(1, Math.max(0, (par.coldBelow - t) / 25));
      const heat = this.gain[corner] * (driving * cold + spin);
      const node = par.carcass;
      const c = this.carcass[corner] ?? t;
      const flow = node ? t - c : 0;
      this.temp[corner] =
        t + h * (heat - (node?.k ?? 0) * flow - cooling * (t - ambient));
      const p = this.passive[corner] ?? t;
      this.passive[corner] = p - h * cooling * (p - ambient);
      if (node) {
        this.carcass[corner] =
          c + h * (node.kc * flow - node.cool * (c - ambient));
        const q = this.carcassPassive[corner] ?? c;
        this.carcassPassive[corner] = q - h * node.cool * (q - ambient);
      }
    }
    this.integrated = true;
  }

  reset(): void {
    this.temp = {};
    this.passive = {};
    this.carcass = {};
    this.carcassPassive = {};
    this.grip.reset();
    this.verticalSmooth = GRAVITY;
    this.gain = { lf: 1, rf: 1, lr: 1, rr: 1 };
    this.integrated = false;
  }
}
