/**
 * PROVISIONAL model contract. Not confirmed against SDK channel semantics:
 * see channels/channels.yaml for what has actually been verified, and do not
 * build on a field whose channel is still `unverified`.
 *
 * This directory must stay pure: no node:*, electron, react, or imports from
 * ../ibt or ../cli (enforced by tests/boundary.test.ts).
 */

export type Corner = 'lf' | 'rf' | 'lr' | 'rr';
export type Zones = readonly [left: number, middle: number, right: number];

/** A value the sim reported, or null when it did not. Never 0 for "unknown". */
export type Measured<T> = T | null;

export interface WheelSample {
  /** Carcass temperature, deg C. Not the surface temperature. */
  carcass: Measured<Zones>;
  /** Tread surface temperature, deg C. Unverified for live telemetry. */
  surface: Measured<Zones>;
  /** Tread remaining, fraction 0..1 (the sim labels the unit '%'). */
  treadRemaining: Measured<Zones>;
  /** Cold pressure as set in the garage, kPa. */
  coldPressureKpa: Measured<number>;
  /** Hot pressure, kPa. Unverified channel. */
  hotPressureKpa: Measured<number>;
  /** Suspension deflection, m. Unverified channel. */
  shockDeflM: Measured<number>;
}

/**
 * Car-level inputs the overlay's tire model reads (docs/extraction-plan.md
 * section 4). Every field is null when the source does not have the channel;
 * all are unverified except where channels/channels.yaml says otherwise.
 */
export interface CarSample {
  sessionNum: Measured<number>;
  /** Pit service checkbox bits, tire change in 0x1 LF, 0x2 RF, 0x4 LR, 0x8 RR. */
  pitSvFlags: Measured<number>;
  /** Pit menu tire boxes (dpLFTireChange and so on); a value above 0 means change. */
  tireChange: Record<
    'lf' | 'rf' | 'lr' | 'rr' | 'left' | 'right',
    Measured<number>
  >;
  /** m/s, in the car's frame. Unverified. */
  velocityX: Measured<number>;
  velocityY: Measured<number>;
  /** rad/s */
  yawRate: Measured<number>;
  /** rad */
  steeringWheelAngle: Measured<number>;
  /** N*m. Unverified. */
  steeringWheelTorque: Measured<number>;
  /** m/s^2, gravity included for vertAccel. */
  latAccel: Measured<number>;
  longAccel: Measured<number>;
  vertAccel: Measured<number>;
  /** Pedals, 0..1. */
  throttle: Measured<number>;
  brake: Measured<number>;
  /** The brake bias setting; its meaning is unverified. */
  dcBrakeBias: Measured<number>;
  /** deg C */
  airTemp: Measured<number>;
  /** Deprecated in the sim; mirrors trackTempCrew. */
  trackTemp: Measured<number>;
  trackTempCrew: Measured<number>;
  lapCompleted: Measured<number>;
  lapDistPct: Measured<number>;
  isOnTrack: Measured<boolean>;
  onPitRoad: Measured<boolean>;
  pitstopActive: Measured<boolean>;
  brakeAbsActive: Measured<boolean>;
}

export interface TireSample {
  /** Session time, s. NaN when the source has no SessionTime (the model then takes no time step). */
  t: number;
  /** Seconds since the previous sample; the caller decides what a gap is. */
  dt: number;
  speed: Measured<number>;
  car: CarSample;
  wheels: Record<Corner, WheelSample>;
}

/** A model output is always labelled as an estimate. */
export interface Estimate<T> {
  readonly kind: 'estimate';
  readonly model: string;
  readonly value: T;
}

/**
 * Something the model's state machine did on one step, for a caller that keeps
 * state of its own (the overlay's wear baseline hangs on these moments).
 *  clear      a new session: everything the model knew was dropped
 *  seed       the first reading of a session started this tire
 *  refresh    a later reading arrived (a pit stop began); `changed` says whether
 *             the tire was ordered changed at that moment
 *  fresh-late the tire was ordered changed only while the service ran, and is
 *             treated as fresh now that it ended
 */
export type ModelEvent =
  | { kind: 'clear' }
  | {
      kind: 'seed' | 'refresh' | 'fresh-late';
      corner: Corner;
      changed: boolean;
    };

/** Inputs a caller computes itself, because the model does not have the means to. */
export interface StepExtras {
  /**
   * Heat from driven-wheel spin (m/s of slip beyond ordinary traction, times
   * throttle), from a slip estimator. 0 when not given.
   */
  driveSlip?: number;
}

export interface TireOutput {
  /** What the state machine did on this step, in order; empty when nothing. */
  events?: ModelEvent[];
  carcass: Partial<Record<Corner, Estimate<number>>>;
  /** Tread surface temperature, where the model has one. */
  tread?: Partial<Record<Corner, Estimate<number>>>;
  /** What an overlay would display per tire (left, middle, right zone), where a model has such a thing. */
  shown?: Partial<Record<Corner, Estimate<Zones>>>;
  /** The pressure an overlay would label a tire with: kPa, whether it is a hot value, and whether it is calculated. */
  pressure?: Partial<
    Record<Corner, { kpa: number; hot: boolean; estimated: boolean }>
  >;
}

export interface TireModel {
  /** Back to the initial state; identical inputs afterwards give identical outputs. */
  reset(): void;
  /** One explicit time step. A sample with dt outside (0, maxDt] holds state. */
  step(sample: TireSample): TireOutput;
}
